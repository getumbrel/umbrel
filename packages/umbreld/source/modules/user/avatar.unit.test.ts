import {createHash} from 'node:crypto'
import nodePath from 'node:path'
import {Readable} from 'node:stream'

import {execa} from 'execa'
import fse from 'fs-extra'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import Umbreld from '../../index.ts'
import temporaryDirectory from '../utilities/temporary-directory.ts'
import {MAX_AVATAR_UPLOAD_BYTES, removeAccountAvatar, resolveAccountAvatar, setAccountAvatar} from './avatar.ts'

vi.mock('execa', async (importOriginal) => ({
	...(await importOriginal<typeof import('execa')>()),
	execa: vi.fn(),
}))

const jpegUpload = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
const pngUpload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const webpUpload = Buffer.from('RIFF\x00\x00\x00\x00WEBP')
const canonicalWebp = (value: string) => Buffer.concat([Buffer.from('RIFF\x00\x00\x00\x00WEBP'), Buffer.from(value)])
const accountAvatarDirectory = (umbreld: Umbreld, userId: string) =>
	nodePath.join(umbreld.dataDirectory, 'avatars', userId)
const accountAvatarPath = (umbreld: Umbreld, userId: string, hash: string) =>
	nodePath.join(accountAvatarDirectory(umbreld, userId), `${hash}.webp`)

describe('account avatars', () => {
	let directory: ReturnType<typeof temporaryDirectory>
	let umbreld: Umbreld
	let convertedBytes: Buffer
	let sourceInspection = 'JPEG 640 480'
	let conversionError: Error | undefined

	beforeEach(async () => {
		directory = temporaryDirectory()
		await directory.createRoot()
		umbreld = new Umbreld({dataDirectory: await directory.create()})
		await umbreld.store.set('user', {name: 'Owner', hashedPassword: 'unused', language: 'en'})
		convertedBytes = canonicalWebp('first')
		sourceInspection = 'JPEG 640 480'
		conversionError = undefined

		vi.mocked(execa).mockImplementation((async (command: string, args: readonly string[]) => {
			if (command === 'identify') {
				const source = args.at(-1) ?? ''
				return {stdout: source.includes('.tmp.webp') ? 'WEBP 512 512' : sourceInspection}
			}
			if (command === 'convert') {
				if (conversionError) throw conversionError
				await fse.writeFile(args.at(-1)!, convertedBytes)
				return {stdout: ''}
			}
			throw new Error(`Unexpected command: ${command}`)
		}) as any)
	})

	afterEach(async () => {
		vi.restoreAllMocks()
		await directory.destroyRoot()
	})

	test('promotes a canonical WebP before committing its stable SHA-256 metadata', async () => {
		const expectedHash = createHash('sha256').update(convertedBytes).digest('hex')
		const originalWriteLock = umbreld.store.getWriteLock.bind(umbreld.store)
		vi.spyOn(umbreld.store, 'getWriteLock').mockImplementation((job) =>
			originalWriteLock(async (methods) => {
				expect(await fse.pathExists(accountAvatarPath(umbreld, '0', expectedHash))).toBe(true)
				await job(methods)
			}),
		)

		await expect(setAccountAvatar(umbreld, '0', Readable.from(jpegUpload))).resolves.toBe(expectedHash)
		expect(await umbreld.store.get('user.avatarHash')).toBe(expectedHash)
		expect(await fse.readFile(accountAvatarPath(umbreld, '0', expectedHash))).toEqual(convertedBytes)

		const execaCalls = vi.mocked(execa).mock.calls as unknown as [
			command: string,
			arguments: readonly string[],
			options: Record<string, unknown>,
		][]
		const convertCall = execaCalls.find(([command]) => command === 'convert')!
		const imageMagickLimits = [
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
		for (const [command, args] of execaCalls) {
			if (command === 'identify' || command === 'convert') {
				expect(args.slice(0, imageMagickLimits.length)).toEqual(imageMagickLimits)
			}
		}
		expect(convertCall[1]).toEqual(
			expect.arrayContaining([
				'-auto-orient',
				'-colorspace',
				'sRGB',
				'-resize',
				'512x512^',
				'-gravity',
				'center',
				'-extent',
				'512x512',
				'-strip',
				'-quality',
				'84',
				'webp:method=4',
			]),
		)
		expect(convertCall[1].find((argument) => argument.endsWith('[0]'))).toBeDefined()
		expect(convertCall[2]).toMatchObject({timeout: 15_000})
	})

	test.each([
		['JPEG', jpegUpload],
		['PNG', pngUpload],
		['WEBP', webpUpload],
	] as const)('accepts %s uploads', async (format, upload) => {
		sourceInspection = `${format} 640 480`
		await expect(setAccountAvatar(umbreld, '0', Readable.from(upload))).resolves.toMatch(/^[a-f0-9]{64}$/)
	})

	test('rejects empty, unsupported, oversized, and over-dimensioned inputs', async () => {
		await expect(setAccountAvatar(umbreld, '0', Readable.from([]))).rejects.toThrow('empty')
		await expect(setAccountAvatar(umbreld, '0', Readable.from(Buffer.from('<svg/>')))).rejects.toThrow('Unsupported')

		async function* oversizedUpload() {
			for (let size = 0; size <= MAX_AVATAR_UPLOAD_BYTES; size += 1024 * 1024) yield Buffer.alloc(1024 * 1024)
		}
		await expect(setAccountAvatar(umbreld, '0', Readable.from(oversizedUpload()))).rejects.toMatchObject({
			statusCode: 413,
		})

		sourceInspection = 'JPEG 10000 6000'
		await expect(setAccountAvatar(umbreld, '0', Readable.from(jpegUpload))).rejects.toThrow('dimensions')
	})

	test('leaves metadata unchanged when conversion fails', async () => {
		const previousHash = 'b'.repeat(64)
		await umbreld.user.setAccountAvatarHash('0', previousHash)
		conversionError = new Error('decoder failed')

		await expect(setAccountAvatar(umbreld, '0', Readable.from(jpegUpload))).rejects.toThrow('Unable to process')
		expect(await umbreld.user.getAccountAvatarHash('0')).toBe(previousHash)
	})

	test('replacement invalidates and removes the old hash while removal restores fallback state', async () => {
		const firstHash = await setAccountAvatar(umbreld, '0', Readable.from(jpegUpload))
		convertedBytes = canonicalWebp('second')
		const secondHash = await setAccountAvatar(umbreld, '0', Readable.from(jpegUpload))

		expect(secondHash).not.toBe(firstHash)
		await expect(resolveAccountAvatar(umbreld, '0', firstHash)).rejects.toThrow('not found')
		expect(await fse.pathExists(accountAvatarPath(umbreld, '0', firstHash))).toBe(false)
		await expect(resolveAccountAvatar(umbreld, '0', secondHash)).resolves.toBe(
			accountAvatarPath(umbreld, '0', secondHash),
		)

		await expect(removeAccountAvatar(umbreld, '0')).resolves.toBeUndefined()
		expect(await umbreld.user.getAccountAvatarHash('0')).toBeUndefined()
		await expect(resolveAccountAvatar(umbreld, '0', secondHash)).rejects.toThrow('not found')
	})

	test('commits avatar removal before strong directory cleanup and retries a failed cleanup', async () => {
		const hash = 'b'.repeat(64)
		const avatarDirectory = accountAvatarDirectory(umbreld, '0')
		await umbreld.user.setAccountAvatarHash('0', hash)
		await fse.outputFile(accountAvatarPath(umbreld, '0', hash), canonicalWebp('orphan'))

		const originalRemove = fse.remove.bind(fse)
		const removeSpy = vi.spyOn(fse, 'remove').mockImplementation(async (path) => {
			if (path === avatarDirectory) throw new Error('simulated avatar directory failure')
			return originalRemove(path)
		})

		await expect(removeAccountAvatar(umbreld, '0')).rejects.toThrow('simulated avatar directory failure')
		expect(await umbreld.user.getAccountAvatarHash('0')).toBeUndefined()
		expect(await fse.pathExists(avatarDirectory)).toBe(true)

		removeSpy.mockRestore()
		await expect(removeAccountAvatar(umbreld, '0')).resolves.toBeUndefined()
		expect(await fse.pathExists(avatarDirectory)).toBe(false)
	})

	test('bounds queued removals with the same admission limit as uploads', async () => {
		const avatarDirectory = accountAvatarDirectory(umbreld, '0')
		const originalRemove = fse.remove.bind(fse)
		let releaseFirstRemoval!: () => void
		const firstRemovalBlocked = new Promise<void>((resolve) => {
			releaseFirstRemoval = resolve
		})
		let hasBlockedRemoval = false
		vi.spyOn(fse, 'remove').mockImplementation(async (path) => {
			if (path === avatarDirectory && !hasBlockedRemoval) {
				hasBlockedRemoval = true
				await firstRemovalBlocked
			}
			return originalRemove(path)
		})

		const admitted = Array.from({length: 4}, () => removeAccountAvatar(umbreld, '0'))
		await expect(removeAccountAvatar(umbreld, '0')).rejects.toMatchObject({statusCode: 503})

		releaseFirstRemoval()
		await expect(Promise.all(admitted)).resolves.toHaveLength(4)
	})

	test('rejects stale, malformed, missing, and tombstoned account resolution', async () => {
		await expect(resolveAccountAvatar(umbreld, '0', 'bad')).rejects.toThrow('not found')
		await expect(resolveAccountAvatar(umbreld, '0', 'c'.repeat(64))).rejects.toThrow('not found')
		await expect(resolveAccountAvatar(umbreld, '../owner', 'c'.repeat(64))).rejects.toThrow('not found')

		await umbreld.store.set('members', [{id: 'Alice', deleted: true}])
		await expect(resolveAccountAvatar(umbreld, 'Alice', 'c'.repeat(64))).rejects.toThrow('not found')
	})
})
