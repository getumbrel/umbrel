import {createHash, randomBytes} from 'node:crypto'
import {constants} from 'node:fs'
import {open, rename, rmdir, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import nodePath from 'node:path'
import type {Readable} from 'node:stream'

import {execa} from 'execa'
import fse from 'fs-extra'
import PQueue from 'p-queue'

import type Umbreld from '../../index.ts'

export const MAX_AVATAR_UPLOAD_BYTES = 20 * 1024 * 1024
const MAX_AVATAR_DECODED_PIXELS = 50_000_000
const AVATAR_SIZE = 512
const AVATAR_WEBP_QUALITY = 84
const AVATAR_CONVERSION_TIMEOUT_MS = 15_000

const MAX_CONCURRENT_OR_QUEUED_UPLOADS = 4
const avatarMutationQueue = new PQueue({concurrency: 1})
const HASH_PATTERN = /^[a-f0-9]{64}$/
const USER_ID_PATTERN = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/
const IMAGE_MAGICK_LIMITS = [
	'-limit',
	'memory',
	'256MiB',
	'-limit',
	'map',
	'512MiB',
	'-limit',
	'disk',
	'1GiB',
	'-limit',
	'thread',
	'1',
	'-limit',
	'area',
	'50MP',
]

type SupportedImageFormat = 'JPEG' | 'PNG' | 'WEBP'

export class AvatarError extends Error {
	statusCode: number

	constructor(message: string, statusCode = 400) {
		super(message)
		this.statusCode = statusCode
	}
}

function accountAvatarDirectory(umbreld: Umbreld, userId: string) {
	if (!USER_ID_PATTERN.test(userId)) throw new AvatarError('Account not found', 404)
	return nodePath.join(umbreld.dataDirectory, 'avatars', userId)
}

function accountAvatarPath(umbreld: Umbreld, userId: string, hash: string) {
	if (!HASH_PATTERN.test(hash)) throw new AvatarError('Avatar not found', 404)
	return nodePath.join(accountAvatarDirectory(umbreld, userId), `${hash}.webp`)
}

async function writeChunk(file: Awaited<ReturnType<typeof open>>, chunk: Buffer) {
	let offset = 0
	while (offset < chunk.length) {
		const {bytesWritten} = await file.write(chunk, offset, chunk.length - offset)
		if (bytesWritten === 0) throw new Error('Unable to write avatar upload')
		offset += bytesWritten
	}
}

async function writeUpload(stream: Readable, destination: string) {
	let file: Awaited<ReturnType<typeof open>> | undefined
	let size = 0
	try {
		file = await open(
			destination,
			constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
			0o600,
		)
		for await (const value of stream) {
			const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
			size += chunk.length
			if (size > MAX_AVATAR_UPLOAD_BYTES) throw new AvatarError('Avatar image is too large', 413)
			await writeChunk(file, chunk)
		}
	} finally {
		await file?.close().catch(() => {})
	}

	if (size === 0) throw new AvatarError('Avatar image is empty')
}

async function uploadedImageFormat(source: string): Promise<SupportedImageFormat> {
	const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
	try {
		const header = Buffer.alloc(12)
		const {bytesRead} = await file.read(header, 0, header.length, 0)
		if (bytesRead >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'JPEG'
		if (bytesRead >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
			return 'PNG'
		}
		if (
			bytesRead >= 12 &&
			header.subarray(0, 4).toString('ascii') === 'RIFF' &&
			header.subarray(8, 12).toString('ascii') === 'WEBP'
		) {
			return 'WEBP'
		}
	} finally {
		await file.close()
	}
	throw new AvatarError('Unsupported avatar image')
}

async function inspectImage(source: string) {
	const expectedFormat = await uploadedImageFormat(source)
	let stdout: string
	try {
		;({stdout} = await execa(
			'identify',
			[...IMAGE_MAGICK_LIMITS, '-quiet', '-ping', '-format', '%m %w %h', `${source}[0]`],
			{timeout: AVATAR_CONVERSION_TIMEOUT_MS},
		))
	} catch {
		throw new AvatarError('Invalid avatar image')
	}

	const [format, widthValue, heightValue] = stdout.trim().split(/\s+/)
	const width = Number(widthValue)
	const height = Number(heightValue)
	if (
		format !== expectedFormat ||
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width < 1 ||
		height < 1
	) {
		throw new AvatarError('Invalid avatar image')
	}
	if (width * height > MAX_AVATAR_DECODED_PIXELS) throw new AvatarError('Avatar image dimensions are too large')
	return {format, width, height}
}

async function convertImage(source: string, destination: string) {
	await inspectImage(source)
	try {
		await execa(
			'convert',
			[
				...IMAGE_MAGICK_LIMITS,
				`${source}[0]`,
				'-auto-orient',
				'-colorspace',
				'sRGB',
				'-resize',
				`${AVATAR_SIZE}x${AVATAR_SIZE}^`,
				'-gravity',
				'center',
				'-extent',
				`${AVATAR_SIZE}x${AVATAR_SIZE}`,
				'-strip',
				'-quality',
				String(AVATAR_WEBP_QUALITY),
				'-define',
				'webp:method=4',
				destination,
			],
			{timeout: AVATAR_CONVERSION_TIMEOUT_MS},
		)
	} catch {
		throw new AvatarError('Unable to process avatar image')
	}

	const output = await inspectImage(destination).catch(() => {
		throw new AvatarError('Unable to process avatar image')
	})
	if (output.format !== 'WEBP' || output.width !== AVATAR_SIZE || output.height !== AVATAR_SIZE) {
		throw new AvatarError('Unable to process avatar image')
	}
	const outputStats = await stat(destination)
	if (!outputStats.isFile() || outputStats.size === 0) throw new AvatarError('Unable to process avatar image')
}

async function hashFile(path: string) {
	const hash = createHash('sha256')
	const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
	try {
		for await (const chunk of file.createReadStream({autoClose: false})) hash.update(chunk)
	} finally {
		await file.close()
	}
	return hash.digest('hex')
}

async function removeAvatarFile(umbreld: Umbreld, userId: string, hash: string) {
	if (!HASH_PATTERN.test(hash)) return
	const directory = accountAvatarDirectory(umbreld, userId)
	await fse.remove(nodePath.join(directory, `${hash}.webp`)).catch(() => {})
	await rmdir(directory).catch(() => {})
}

async function enqueueAvatarMutation<T>(operation: () => Promise<T>) {
	if (avatarMutationQueue.pending + avatarMutationQueue.size >= MAX_CONCURRENT_OR_QUEUED_UPLOADS) {
		throw new AvatarError('Avatar processing is busy, try again', 503)
	}
	return avatarMutationQueue.add(operation)
}

export async function setAccountAvatar(umbreld: Umbreld, userId: string, stream: Readable) {
	const result = await enqueueAvatarMutation(async () => {
		await umbreld.user.getAccountAvatarHash(userId)
		const uploadDirectory = await fse.mkdtemp(nodePath.join(tmpdir(), 'umbrel-avatar-'))
		const source = nodePath.join(uploadDirectory, 'upload')
		const avatarDirectory = accountAvatarDirectory(umbreld, userId)
		const staging = nodePath.join(avatarDirectory, `.avatar-${randomBytes(16).toString('hex')}.tmp.webp`)

		try {
			await writeUpload(stream, source)
			await fse.ensureDir(avatarDirectory)
			await convertImage(source, staging)
			const hash = await hashFile(staging)
			const destination = accountAvatarPath(umbreld, userId, hash)
			const destinationExisted = await fse.pathExists(destination)

			await rename(staging, destination)
			try {
				const previousHash = await umbreld.user.setAccountAvatarHash(userId, hash)
				if (previousHash && previousHash !== hash) await removeAvatarFile(umbreld, userId, previousHash)
			} catch (error) {
				const referencedHash = await umbreld.user.getAccountAvatarHash(userId).catch(() => undefined)
				if (!destinationExisted && referencedHash !== hash) await fse.remove(destination).catch(() => {})
				throw error
			}

			return hash
		} finally {
			await Promise.all([fse.remove(uploadDirectory).catch(() => {}), fse.remove(staging).catch(() => {})])
		}
	})

	if (!result) throw new AvatarError('Unable to process avatar image', 500)
	return result
}

export async function removeAccountAvatar(umbreld: Umbreld, userId: string) {
	const result = await enqueueAvatarMutation(async () => {
		await umbreld.user.removeAccountAvatarHash(userId)
		await removeAccountAvatarDirectory(umbreld, userId)
		return true
	})
	if (!result) throw new AvatarError('Unable to remove avatar image', 500)
}

export async function resolveAccountAvatar(umbreld: Umbreld, userId: string, hash: string) {
	if (!HASH_PATTERN.test(hash)) throw new AvatarError('Avatar not found', 404)
	const currentHash = await umbreld.user.getAccountAvatarHash(userId).catch(() => undefined)
	if (currentHash !== hash) throw new AvatarError('Avatar not found', 404)
	const path = accountAvatarPath(umbreld, userId, hash)
	const fileStats = await fse.lstat(path).catch(() => undefined)
	if (!fileStats?.isFile() || fileStats.isSymbolicLink()) throw new AvatarError('Avatar not found', 404)
	return path
}

export async function removeAccountAvatarDirectory(umbreld: Umbreld, userId: string) {
	await fse.remove(accountAvatarDirectory(umbreld, userId))
}
