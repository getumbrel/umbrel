import {once} from 'node:events'
import type {AddressInfo} from 'node:net'
import nodePath from 'node:path'
import {PassThrough} from 'node:stream'

import express from 'express'
import fse from 'fs-extra'
import got from 'got'
import {afterAll, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import {Blake3Hasher} from '../files/blake3.ts'
import UploadDiskPreflight from '../server/upload-disk-preflight.ts'
import temporaryDirectory from '../utilities/temporary-directory.ts'
import photoApi from './api.ts'

type FileWriteFailureCode = 'ENOSPC' | 'EDQUOT' | 'EIO'

const fileWriteFailure = vi.hoisted(() => ({code: undefined as FileWriteFailureCode | undefined}))
const fileDurability = vi.hoisted(() => ({syncedPaths: [] as string[], failSyncPath: undefined as string | undefined}))

vi.mock('node:fs/promises', async (importOriginal) => {
	const original = await importOriginal<typeof import('node:fs/promises')>()
	const {Writable} = await import('node:stream')
	const originalOpen = original.open
	return {
		...original,
		open: async (...args: Parameters<typeof originalOpen>) => {
			const file = await originalOpen(...args)
			const path = String(args[0])
			const code = fileWriteFailure.code
			if (!code) {
				const sync = file.sync.bind(file)
				file.sync = async () => {
					fileDurability.syncedPaths.push(path)
					if (fileDurability.failSyncPath === path) throw Object.assign(new Error('EIO'), {code: 'EIO'})
					await sync()
				}
				return file
			}
			await file.close()
			return {
				createWriteStream: () =>
					new Writable({
						write(_chunk, _encoding, callback) {
							callback(Object.assign(new Error(code), {code}))
						},
					}),
				close: async () => {},
			} as unknown as typeof file
		},
	}
})

const SOURCE_ID = '11111111-1111-4111-8111-111111111111'
const RESOURCE_KEY = 'a'.repeat(64)
const ORIGINAL_FILENAME = 'IMG_1234.HEIC'

function filenameHeader(originalFilename = ORIGINAL_FILENAME) {
	return {
		'X-Umbrel-Photo-Original-Filename-Base64': Buffer.from(originalFilename).toString('base64'),
	}
}

function blake3(contents: Buffer | string) {
	const hasher = new Blake3Hasher()
	hasher.update(Buffer.isBuffer(contents) ? contents : Buffer.from(contents))
	return hasher.digestBuffer()
}

describe('photo backup API', () => {
	const directory = temporaryDirectory()
	const source = {id: SOURCE_ID, accountId: '0', name: 'Pixel 9', directoryName: 'Pixel 9', createdAt: 1}
	const registeredResources = new Map<
		string,
		{
			hash: Buffer
			receipt: {resourceKey: string; path: string; bytes: number}
			revision: {inode: string; size: number; modifiedNs: string; ctimeNs: string}
		}
	>()
	const touchSession = vi.fn(async () => true)
	let sourceActive = true
	const getBackupSource = vi.fn(async () => source)
	const withBackupSource = vi.fn(
		async (_accountId: string, _sourceId: string, operation: (backupSource: typeof source) => Promise<unknown>) =>
			sourceActive ? {active: true as const, value: await operation(source)} : {active: false as const},
	)
	const registerBackupResource = vi.fn(
		async (
			_source: typeof source,
			resourceKey: string,
			systemPath: string,
			hash: Buffer,
			revision: {inode: string; size: number; modifiedNs: string; ctimeNs: string},
			_originalFilename?: string,
			_sourceCreationDate?: number,
			_cloud?: {cloudIdentifier: string; role: string},
		) => {
			const receipt = {
				resourceKey,
				path: systemPath.replace(mediaDirectory, '/Home'),
				bytes: revision.size,
			}
			registeredResources.set(resourceKey, {hash: Buffer.from(hash), receipt, revision})
			return receipt
		},
	)
	const registerMatchingBackupResource = vi.fn(
		async (
			backupSource: typeof source,
			resourceKey: string,
			virtualPath: string,
			hash: Buffer,
			originalFilename: string,
			sourceCreationDate?: number,
		) => {
			const registered = registeredResources.get(resourceKey)
			if (registered?.hash.equals(hash)) {
				const stats = await fse
					.stat(registered.receipt.path.replace('/Home', mediaDirectory), {bigint: true})
					.catch(() => undefined)
				if (
					stats &&
					stats.ino.toString() === registered.revision.inode &&
					Number(stats.size) === registered.revision.size &&
					stats.mtimeNs.toString() === registered.revision.modifiedNs &&
					stats.ctimeNs.toString() === registered.revision.ctimeNs
				) {
					return {receipt: registered.receipt, revision: registered.revision}
				}
			}
			const systemPath = virtualPath.replace('/Home', mediaDirectory)
			const contents = await fse.readFile(systemPath).catch(() => undefined)
			if (!contents || !blake3(contents).equals(hash)) return
			const stats = await fse.stat(systemPath, {bigint: true})
			const revision = {
				inode: stats.ino.toString(),
				size: Number(stats.size),
				modifiedNs: stats.mtimeNs.toString(),
				ctimeNs: stats.ctimeNs.toString(),
			}
			const receipt = await registerBackupResource(
				backupSource,
				resourceKey,
				systemPath,
				hash,
				revision,
				originalFilename,
				sourceCreationDate,
			)
			return {receipt, revision}
		},
	)
	// Another receipt in this source already holds the bytes: record the new
	// key against its location without publishing a second copy.
	const registerSourceDuplicateBackupResource = vi.fn(
		async (
			_source: typeof source,
			resourceKey: string,
			hash: Buffer,
			_originalFilename: string,
			_sourceCreationDate?: number,
			_cloud?: {cloudIdentifier: string; role: string},
		) => {
			for (const registered of [...registeredResources.values()]) {
				if (!registered.hash.equals(hash)) continue
				if (!(await backupResourceRevisionIsCurrent('0', registered.receipt.path, registered.revision))) continue
				const receipt = {...registered.receipt, resourceKey}
				registeredResources.set(resourceKey, {hash: Buffer.from(hash), receipt, revision: registered.revision})
				return {receipt, revision: registered.revision}
			}
		},
	)
	const claimBackupResources = vi.fn(
		async ({
			resources,
		}: {
			accountId: string
			sourceId: string
			createdAt: number
			resources: Array<{resourceKey: string}>
		}): Promise<Array<{resourceKey: string; bytes: number}> | undefined> =>
			resources.map(({resourceKey}) => ({resourceKey, bytes: 5})),
	)
	const backupResourceRevisionIsCurrent = vi.fn(
		async (
			_accountId: string,
			virtualPath: string,
			revision: {inode: string; size: number; modifiedNs: string; ctimeNs: string},
		) => {
			const stats = await fse.stat(virtualPath.replace('/Home', mediaDirectory), {bigint: true}).catch(() => undefined)
			return Boolean(
				stats &&
					stats.ino.toString() === revision.inode &&
					Number(stats.size) === revision.size &&
					stats.mtimeNs.toString() === revision.modifiedNs &&
					stats.ctimeNs.toString() === revision.ctimeNs,
			)
		},
	)
	let availableBytes = Number.MAX_SAFE_INTEGER
	let mediaDirectory: string
	let server: ReturnType<express.Express['listen']>
	let origin: string

	beforeAll(async () => {
		await directory.createRoot()
		mediaDirectory = await directory.create()
		const auth = {
			authenticatePhotoBackupGrant: async (token: string) => {
				if (token === 'photo-grant') {
					return {sessionId: 'native-session', accountId: '0', actor: 'account' as const, sourceId: SOURCE_ID}
				}
				throw new Error('Invalid credential')
			},
			touchSession,
		}
		const photos = {
			getBackupSource,
			withBackupSource,
			backupSourceVirtualDirectory: () => `/Home/Photos/${source.directoryName}`,
			prepareBackupResourcePath: async (_source: typeof source, resourceKey: string, fileExtension: string) =>
				`/Home/Photos/${source.directoryName}/${resourceKey.slice(0, 2)}/${resourceKey}.${fileExtension.toLowerCase()}`,
			registerBackupResource,
			registerMatchingBackupResource,
			registerSourceDuplicateBackupResource,
			backupResourceRevisionIsCurrent,
			claimBackupResources,
		}
		const files = {
			virtualToSystemPath: async (path: string) => path.replace('/Home', mediaDirectory),
			authorizeWritableDestinationSystemPath: async (path: string) => path,
			systemToVirtualPath: (path: string) => path.replace(mediaDirectory, '/Home'),
			isInternalStorageVirtualPath: () => true,
			getUniqueName: async (path: string) => {
				if (!(await fse.pathExists(path))) return path
				const parsed = nodePath.parse(path)
				for (let index = 1; index <= 1000; index++) {
					const candidate = nodePath.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`)
					if (!(await fse.pathExists(candidate))) return candidate
				}
				throw new Error('Could not allocate upload path')
			},
			chownSystemPath: async () => {},
			fileIndex: {movePath: async () => {}},
			logger: {error: vi.fn()},
		}
		const umbreld = {
			auth,
			photos,
			files,
			logger: {error: vi.fn()},
		} as unknown as Umbreld
		const uploadDiskPreflight = new UploadDiskPreflight({
			getAvailableBytes: async () => availableBytes,
			reserveBytes: 0,
		})
		const app = express()
		app.use('/api/photos', photoApi(umbreld, uploadDiskPreflight))
		server = app.listen(0, '127.0.0.1')
		await once(server, 'listening')
		origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
	})

	beforeEach(async () => {
		await fse.emptyDir(mediaDirectory)
		registeredResources.clear()
		source.name = 'Pixel 9'
		source.directoryName = 'Pixel 9'
		availableBytes = Number.MAX_SAFE_INTEGER
		fileWriteFailure.code = undefined
		fileDurability.syncedPaths = []
		fileDurability.failSyncPath = undefined
		registerBackupResource.mockClear()
		registerMatchingBackupResource.mockClear()
		registerSourceDuplicateBackupResource.mockClear()
		backupResourceRevisionIsCurrent.mockClear()
		claimBackupResources.mockClear()
		getBackupSource.mockClear()
		withBackupSource.mockClear()
		sourceActive = true
	})

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
		await directory.destroyRoot()
	})

	function upload(
		resourceKey: string,
		fileExtension: string,
		body: string,
		originalFilename = ORIGINAL_FILENAME,
		sourceCreationDate?: number,
	) {
		return got(`${origin}/api/photos/upload`, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer photo-grant',
				'X-Umbrel-Photo-Backup-Key': resourceKey,
				'X-Umbrel-Photo-Backup-Extension': fileExtension,
				...filenameHeader(originalFilename),
				...(sourceCreationDate === undefined ? {} : {'X-Umbrel-Photo-Creation-Date-Ms': String(sourceCreationDate)}),
			},
			body,
			throwHttpErrors: false,
		})
	}

	async function expectNoUploadArtifacts(resourceKey: string) {
		const shardDirectory = `${mediaDirectory}/Photos/${source.directoryName}/${resourceKey.slice(0, 2)}`
		await vi.waitFor(async () => {
			const entries = (await fse.pathExists(shardDirectory)) ? await fse.readdir(shardDirectory) : []
			expect(entries.some((name) => name.includes(resourceKey))).toBe(false)
		})
	}

	test('answers the unauthenticated PhotoKit capability probe with 501', async () => {
		const response = await got(`${origin}/api/photos/upload`, {method: 'OPTIONS', throwHttpErrors: false})
		expect(response.statusCode).toBe(501)
	})

	test.each([
		['POST', '/api/photos/upload'],
		['POST', '/api/photos/claim'],
		['GET', '/api/photos/future-route'],
	] as const)('%s %s is denied before its handler runs', async (method, path) => {
		const response = await got(`${origin}${path}`, {method, throwHttpErrors: false})
		expect(response.statusCode).toBe(401)
		expect(claimBackupResources).not.toHaveBeenCalled()
	})

	function claim(resources: unknown, grant = 'photo-grant', body: Record<string, unknown> = {}) {
		return got(`${origin}/api/photos/claim`, {
			method: 'POST',
			headers: {Authorization: `Bearer ${grant}`},
			json: {...body, resources},
			throwHttpErrors: false,
		})
	}

	test("claims a bounded batch of resources for the grant's own backup", async () => {
		const resource = {resourceKey: RESOURCE_KEY, fileExtension: 'heic', cloudIdentifier: 'asset-1', role: 'photo'}
		// The grant names the account and backup; the body can't
		const response = await claim([resource], 'photo-grant', {accountId: 'Alice', sourceId: 'other'})
		expect(response.statusCode).toBe(200)
		expect(JSON.parse(response.body)).toEqual([{resourceKey: RESOURCE_KEY, bytes: 5}])
		expect(claimBackupResources).toHaveBeenCalledWith({
			accountId: '0',
			sourceId: SOURCE_ID,
			createdAt: source.createdAt,
			resources: [resource],
		})
		// Without an identity, a resource is only confirmed by its key
		const keyOnly = {resourceKey: RESOURCE_KEY, fileExtension: 'heic'}
		expect((await claim([keyOnly])).statusCode).toBe(200)
		expect(claimBackupResources).toHaveBeenLastCalledWith({
			accountId: '0',
			sourceId: SOURCE_ID,
			createdAt: source.createdAt,
			resources: [keyOnly],
		})

		expect((await claim([resource], 'invalid-grant')).statusCode).toBe(401)
		for (const invalid of [
			{...resource, role: 'Photo'},
			{...resource, role: ''},
			{...resource, cloudIdentifier: ''},
			{...resource, cloudIdentifier: 'x'.repeat(1025)},
			{...resource, cloudIdentifier: 'asset\n1'},
			// Both or neither
			{resourceKey: RESOURCE_KEY, fileExtension: 'heic', cloudIdentifier: 'asset-1'},
			{resourceKey: RESOURCE_KEY, fileExtension: 'heic', role: 'photo'},
		]) {
			expect((await claim([invalid])).statusCode).toBe(400)
		}
		const tooMany = Array.from({length: 257}, (_, index) => ({
			...resource,
			resourceKey: index.toString(16).padStart(64, '0'),
		}))
		expect((await claim(tooMany)).statusCode).toBe(400)
		expect(claimBackupResources).toHaveBeenCalledTimes(2)
	})

	test('answers a body it cannot read without a server error', async () => {
		const malformed = await got(`${origin}/api/photos/claim`, {
			method: 'POST',
			headers: {Authorization: 'Bearer photo-grant', 'Content-Type': 'application/json'},
			body: '{"resources": [',
			throwHttpErrors: false,
		})
		expect(malformed.statusCode).toBe(400)
		const oversized = await claim(['x'.repeat(2 * 1024 * 1024)])
		expect(oversized.statusCode).toBe(413)
		expect(claimBackupResources).not.toHaveBeenCalled()
	})

	test("refuses a claim for a backup that's removed or was created again", async () => {
		const resource = {resourceKey: RESOURCE_KEY, fileExtension: 'heic'}
		getBackupSource.mockResolvedValueOnce(undefined as never)
		expect((await claim([resource])).statusCode).toBe(401)
		expect(claimBackupResources).not.toHaveBeenCalled()

		// Removed, or replaced under the same id, while the body arrived
		claimBackupResources.mockResolvedValueOnce(undefined)
		expect((await claim([resource])).statusCode).toBe(401)
	})

	test('answers a failed claim with a server error', async () => {
		claimBackupResources.mockRejectedValueOnce(new Error('index unavailable'))
		const response = await claim([{resourceKey: RESOURCE_KEY, fileExtension: 'heic'}])
		expect(response.statusCode).toBe(500)
	})

	test('distinguishes invalid upload metadata from an invalid grant', async () => {
		const invalidMetadata = await got(`${origin}/api/photos/upload`, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer photo-grant',
				'X-Umbrel-Photo-Backup-Key': 'not-a-resource-key',
				'X-Umbrel-Photo-Backup-Extension': 'heic',
				...filenameHeader(),
			},
			body: 'photo',
			throwHttpErrors: false,
		})
		expect(invalidMetadata.statusCode).toBe(400)

		const invalidGrant = await got(`${origin}/api/photos/upload`, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer invalid-grant',
				'X-Umbrel-Photo-Backup-Key': RESOURCE_KEY,
				'X-Umbrel-Photo-Backup-Extension': 'heic',
				...filenameHeader(),
			},
			body: 'photo',
			throwHttpErrors: false,
		})
		expect(invalidGrant.statusCode).toBe(401)
	})

	test('rejects a missing or malformed original filename', async () => {
		const missingFilename = await got(`${origin}/api/photos/upload`, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer photo-grant',
				'X-Umbrel-Photo-Backup-Key': RESOURCE_KEY,
				'X-Umbrel-Photo-Backup-Extension': 'heic',
			},
			body: 'photo',
			throwHttpErrors: false,
		})
		const controlCharacterFilename = await got(`${origin}/api/photos/upload`, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer photo-grant',
				'X-Umbrel-Photo-Backup-Key': RESOURCE_KEY,
				'X-Umbrel-Photo-Backup-Extension': 'heic',
				...filenameHeader('IMG_1234\u0000.HEIC'),
			},
			body: 'photo',
			throwHttpErrors: false,
		})

		expect(missingFilename.statusCode).toBe(400)
		expect(controlCharacterFilename.statusCode).toBe(400)
	})

	test('accepts a bounded PhotoKit creation date and rejects malformed values', async () => {
		const creationDate = 1_706_990_400_000
		const accepted = await upload(RESOURCE_KEY, 'heic', 'photo', ORIGINAL_FILENAME, creationDate)
		const malformed = await got(`${origin}/api/photos/upload`, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer photo-grant',
				'X-Umbrel-Photo-Backup-Key': 'b'.repeat(64),
				'X-Umbrel-Photo-Backup-Extension': 'heic',
				'X-Umbrel-Photo-Creation-Date-Ms': 'today',
				...filenameHeader(),
			},
			body: 'photo',
			throwHttpErrors: false,
		})

		expect(accepted.statusCode).toBe(200)
		expect(registerBackupResource.mock.calls[0]?.[6]).toBe(creationDate)
		expect(malformed.statusCode).toBe(400)
	})

	test('derives a friendly Home source path and deduplicates exact retries', async () => {
		const upload = (body: string) =>
			got(`${origin}/api/photos/upload?path=/Home/ignored.jpg`, {
				method: 'POST',
				headers: {
					Authorization: 'Bearer photo-grant',
					'X-Umbrel-Photo-Backup-Key': RESOURCE_KEY,
					'X-Umbrel-Photo-Backup-Extension': 'HEIC',
					...filenameHeader(),
				},
				body,
			})

		const first = await upload('photo')
		const retry = await upload('photo')
		const shard = RESOURCE_KEY.slice(0, 2)
		const systemPath = `${mediaDirectory}/Photos/${source.directoryName}/${shard}/${RESOURCE_KEY}.heic`

		expect(first.headers['x-umbrel-photo-backup-key']).toBe(RESOURCE_KEY)
		expect(retry.headers['x-umbrel-upload-bytes']).toBe(String(Buffer.byteLength('photo')))
		expect(JSON.parse(retry.body)).toEqual({resourceKey: RESOURCE_KEY, bytes: Buffer.byteLength('photo')})
		await expect(fse.readFile(systemPath, 'utf8')).resolves.toBe('photo')
		await expect(fse.readdir(nodePath.dirname(systemPath))).resolves.toStrictEqual([`${RESOURCE_KEY}.heic`])
		expect((await fse.stat(systemPath)).mode & 0o777).toBe(0o600)
		expect((await fse.stat(`${mediaDirectory}/Photos/${source.directoryName}`)).mode & 0o777).toBe(0o755)
		expect((await fse.stat(`${mediaDirectory}/Photos/${source.directoryName}/${shard}`)).mode & 0o777).toBe(0o755)
		expect(fileDurability.syncedPaths.filter((path) => path.endsWith('.umbrel-upload'))).toHaveLength(2)
		expect(
			fileDurability.syncedPaths.filter((path) => path === `${mediaDirectory}/Photos/${source.directoryName}/${shard}`),
		).toHaveLength(1)
		expect(
			(await fse.readdir(`${mediaDirectory}/Photos/${source.directoryName}/${shard}`)).filter((name) =>
				name.endsWith('.umbrel-upload'),
			),
		).toEqual([])
		expect(registerBackupResource).toHaveBeenCalledTimes(1)
		expect(registerMatchingBackupResource).toHaveBeenCalledTimes(2)
		expect(touchSession).toHaveBeenCalledWith(
			expect.objectContaining({sessionId: 'native-session', accountId: '0', sourceId: SOURCE_ID}),
		)
	})

	test('answers with the normal receipt and stores no second copy when this backup already has the bytes', async () => {
		// The old phone's receipt and file, in the backup this phone took over
		const oldKey = '5'.repeat(64)
		const oldSystemPath = `${mediaDirectory}/Photos/iPhone/${oldKey.slice(0, 2)}/${oldKey}.heic`
		await fse.outputFile(oldSystemPath, 'same photo')
		const stats = await fse.stat(oldSystemPath, {bigint: true})
		const revision = {
			inode: stats.ino.toString(),
			size: Number(stats.size),
			modifiedNs: stats.mtimeNs.toString(),
			ctimeNs: stats.ctimeNs.toString(),
		}
		const oldReceipt = {
			resourceKey: oldKey,
			path: `/Home/Photos/iPhone/${oldKey.slice(0, 2)}/${oldKey}.heic`,
			bytes: 10,
		}
		registeredResources.set(oldKey, {hash: blake3('same photo'), receipt: oldReceipt, revision})

		const response = await got(`${origin}/api/photos/upload`, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer photo-grant',
				'X-Umbrel-Photo-Backup-Key': RESOURCE_KEY,
				'X-Umbrel-Photo-Backup-Extension': 'heic',
				'X-Umbrel-Photo-Cloud-Identifier-Base64': Buffer.from('asset-1').toString('base64'),
				'X-Umbrel-Photo-Resource-Role': 'photo',
				...filenameHeader(),
			},
			body: 'same photo',
			throwHttpErrors: false,
		})

		expect(response.statusCode).toBe(200)
		expect(response.headers['x-umbrel-photo-backup-key']).toBe(RESOURCE_KEY)
		expect(response.headers['x-umbrel-upload-bytes']).toBe('10')
		expect(JSON.parse(response.body)).toEqual({resourceKey: RESOURCE_KEY, bytes: 10})
		expect(registerSourceDuplicateBackupResource).toHaveBeenCalledWith(
			source,
			RESOURCE_KEY,
			blake3('same photo'),
			ORIGINAL_FILENAME,
			undefined,
			{cloudIdentifier: 'asset-1', role: 'photo'},
		)
		expect(registerBackupResource).not.toHaveBeenCalled()
		await expectNoUploadArtifacts(RESOURCE_KEY)
		await expect(fse.readFile(oldSystemPath, 'utf8')).resolves.toBe('same photo')
	})

	test('records the PhotoKit cloud identity sent with an upload and rejects a malformed or partial one', async () => {
		const identity = {
			'X-Umbrel-Photo-Cloud-Identifier-Base64': Buffer.from('8A1B…/L0/001:asset').toString('base64'),
			'X-Umbrel-Photo-Resource-Role': 'live-photo-motion',
		}
		const send = (resourceKey: string, headers: Record<string, string>) =>
			got(`${origin}/api/photos/upload`, {
				method: 'POST',
				headers: {
					Authorization: 'Bearer photo-grant',
					'X-Umbrel-Photo-Backup-Key': resourceKey,
					'X-Umbrel-Photo-Backup-Extension': 'mov',
					...filenameHeader('IMG_1234.MOV'),
					...headers,
				},
				body: 'motion',
				throwHttpErrors: false,
			})

		const accepted = await send('6'.repeat(64), identity)
		expect(accepted.statusCode).toBe(200)
		expect(registerBackupResource.mock.calls[0]?.[7]).toEqual({
			cloudIdentifier: '8A1B…/L0/001:asset',
			role: 'live-photo-motion',
		})

		for (const headers of [
			{'X-Umbrel-Photo-Resource-Role': 'photo'} as Record<string, string>,
			{'X-Umbrel-Photo-Cloud-Identifier-Base64': identity['X-Umbrel-Photo-Cloud-Identifier-Base64']},
			{...identity, 'X-Umbrel-Photo-Resource-Role': 'Photo'},
			{...identity, 'X-Umbrel-Photo-Cloud-Identifier-Base64': 'not base64!'},
			{...identity, 'X-Umbrel-Photo-Cloud-Identifier-Base64': Buffer.from('asset\n1').toString('base64')},
		]) {
			const rejected = await send('7'.repeat(64), headers)
			expect(rejected.statusCode).toBe(400)
			expect(JSON.parse(rejected.body)).toEqual({error: 'invalid photo backup request'})
		}
		expect(registerBackupResource).toHaveBeenCalledTimes(1)
	})

	test('keeps user-edited resource bytes when the phone re-uploads its version', async () => {
		const first = await upload(RESOURCE_KEY, 'heic', 'phone original')
		const shard = RESOURCE_KEY.slice(0, 2)
		const originalPath = `${mediaDirectory}/Photos/${source.directoryName}/${shard}/${RESOURCE_KEY}.heic`
		await fse.writeFile(originalPath, 'user edit')

		const retry = await upload(RESOURCE_KEY, 'heic', 'phone original')
		const repeatedRetry = await upload(RESOURCE_KEY, 'heic', 'phone original')
		const preservedUploadPath = `${mediaDirectory}/Photos/${source.directoryName}/${shard}/${RESOURCE_KEY} (1).heic`

		expect(first.statusCode).toBe(200)
		expect(retry.statusCode).toBe(200)
		expect(repeatedRetry.statusCode).toBe(200)
		expect(JSON.parse(retry.body)).toEqual({resourceKey: RESOURCE_KEY, bytes: Buffer.byteLength('phone original')})
		expect(JSON.parse(repeatedRetry.body)).toEqual(JSON.parse(retry.body))
		await expect(fse.readFile(originalPath, 'utf8')).resolves.toBe('user edit')
		await expect(fse.readFile(preservedUploadPath, 'utf8')).resolves.toBe('phone original')
		await expect(fse.pathExists(`${nodePath.dirname(preservedUploadPath)}/${RESOURCE_KEY} (2).heic`)).resolves.toBe(
			false,
		)
	})

	test('does not expose a Unicode device folder in the receipt', async () => {
		source.name = '李娜’s iPhone'
		source.directoryName = '李娜’s iPhone'
		const originalFilename = '海边照片.HEIC'
		const response = await upload(RESOURCE_KEY, 'heic', 'photo', originalFilename)

		expect(response.statusCode).toBe(200)
		expect(response.headers['x-umbrel-upload-path']).toBeUndefined()
		expect(JSON.parse(response.body)).toEqual({resourceKey: RESOURCE_KEY, bytes: 5})
		expect(registerBackupResource).toHaveBeenCalledWith(
			source,
			RESOURCE_KEY,
			expect.any(String),
			expect.any(Buffer),
			expect.any(Object),
			originalFilename,
			undefined,
			undefined,
		)
		await expect(
			fse.readFile(
				`${mediaDirectory}/Photos/${source.directoryName}/${RESOURCE_KEY.slice(0, 2)}/${RESOURCE_KEY}.heic`,
				'utf8',
			),
		).resolves.toBe('photo')
	})

	test('stores a Live Photo still and motion resource independently', async () => {
		const stillKey = '1'.repeat(64)
		const motionKey = '2'.repeat(64)
		const still = await upload(stillKey, 'heic', 'still', 'IMG_1234.HEIC')
		const motion = await upload(motionKey, 'mov', 'motion', 'IMG_1234.MOV')

		expect(still.statusCode).toBe(200)
		expect(motion.statusCode).toBe(200)
		expect(registerBackupResource.mock.calls.map(([, key]) => key)).toStrictEqual([stillKey, motionKey])
		expect(registerBackupResource.mock.calls.map((call) => call[5])).toStrictEqual(['IMG_1234.HEIC', 'IMG_1234.MOV'])
		await expect(
			fse.readFile(`${mediaDirectory}/Photos/${source.directoryName}/${stillKey.slice(0, 2)}/${stillKey}.heic`, 'utf8'),
		).resolves.toBe('still')
		await expect(
			fse.readFile(
				`${mediaDirectory}/Photos/${source.directoryName}/${motionKey.slice(0, 2)}/${motionKey}.mov`,
				'utf8',
			),
		).resolves.toBe('motion')
	})

	test('accepts a PhotoKit resource format that Photos enrichment does not support yet', async () => {
		const resourceKey = '3'.repeat(64)
		const response = await upload(resourceKey, 'aae', 'sidecar')

		expect(response.statusCode).toBe(200)
		expect(registerBackupResource).toHaveBeenCalledWith(
			source,
			resourceKey,
			`${mediaDirectory}/Photos/${source.directoryName}/${resourceKey.slice(0, 2)}/${resourceKey}.aae`,
			expect.any(Buffer),
			expect.objectContaining({size: 7}),
			ORIGINAL_FILENAME,
			undefined,
			undefined,
		)
		await expect(
			fse.readFile(
				`${mediaDirectory}/Photos/${source.directoryName}/${resourceKey.slice(0, 2)}/${resourceKey}.aae`,
				'utf8',
			),
		).resolves.toBe('sidecar')
	})

	test('checks source removal only after a stalled request body has finished staging', async () => {
		const resourceKey = '4'.repeat(64)
		const body = new PassThrough()
		const responsePromise = got(`${origin}/api/photos/upload`, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer photo-grant',
				'Content-Length': '5',
				'X-Umbrel-Photo-Backup-Key': resourceKey,
				'X-Umbrel-Photo-Backup-Extension': 'heic',
				...filenameHeader(),
			},
			body,
			throwHttpErrors: false,
		})
		body.write('a')
		await vi.waitFor(() => expect(getBackupSource).toHaveBeenCalledTimes(1))
		expect(withBackupSource).not.toHaveBeenCalled()

		sourceActive = false
		body.end('bcde')
		const response = await responsePromise

		expect(response.statusCode).toBe(401)
		expect(withBackupSource).toHaveBeenCalledTimes(1)
		expect(registerBackupResource).not.toHaveBeenCalled()
		await expectNoUploadArtifacts(resourceKey)
	})

	test('does not hold the box-wide publication queue while a source lifecycle guard waits', async () => {
		let releaseGuard!: () => void
		let markGuardEntered!: () => void
		const guardEntered = new Promise<void>((resolve) => (markGuardEntered = resolve))
		const guardGate = new Promise<void>((resolve) => (releaseGuard = resolve))
		withBackupSource.mockImplementationOnce(async (_accountId, _sourceId, operation) => {
			markGuardEntered()
			await guardGate
			return {active: true as const, value: await operation(source)}
		})

		const blockedUpload = upload('4'.repeat(64), 'heic', 'blocked')
		await guardEntered
		const independentUpload = upload('5'.repeat(64), 'heic', 'independent')
		let independentResponse
		try {
			independentResponse = await Promise.race([
				independentUpload,
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('independent upload was blocked by another source guard')), 1_000),
				),
			])
		} finally {
			releaseGuard()
		}

		expect(independentResponse.statusCode).toBe(200)
		await expect(blockedUpload).resolves.toMatchObject({statusCode: 200})
	})

	test('withholds the receipt when the final directory entry cannot be synced', async () => {
		const resourceKey = 'f'.repeat(64)
		const shardDirectory = `${mediaDirectory}/Photos/${source.directoryName}/${resourceKey.slice(0, 2)}`
		fileDurability.failSyncPath = shardDirectory

		const response = await upload(resourceKey, 'heic', 'photo')

		expect(response.statusCode).toBe(500)
		expect(fileDurability.syncedPaths.some((path) => path.endsWith('.umbrel-upload'))).toBe(true)
		expect(fileDurability.syncedPaths).toContain(shardDirectory)
		await expect(fse.readFile(`${shardDirectory}/${resourceKey}.heic`, 'utf8')).resolves.toBe('photo')
	})

	test('rejects an upload before writing when it cannot fit', async () => {
		availableBytes = 1
		const resourceKey = 'b'.repeat(64)
		const response = await upload(resourceKey, 'mov', 'too large')

		expect(response.statusCode).toBe(507)
		expect(response.headers['x-umbrel-photo-backup-error']).toBe('insufficient-storage')
		expect(response.headers.connection).not.toBe('close')
		expect(JSON.parse(response.body)).toEqual({error: '[not-enough-space]'})
		await expectNoUploadArtifacts(resourceKey)
	})

	test.each(['ENOSPC', 'EDQUOT'] as const)('labels a mid-upload %s and removes the partial file', async (code) => {
		const resourceKey = code === 'ENOSPC' ? 'c'.repeat(64) : 'd'.repeat(64)
		fileWriteFailure.code = code
		const response = await upload(resourceKey, 'heic', 'photo')

		expect(response.statusCode).toBe(507)
		expect(response.headers['x-umbrel-photo-backup-error']).toBe('insufficient-storage')
		expect(JSON.parse(response.body)).toEqual({error: '[not-enough-space]'})
		await expectNoUploadArtifacts(resourceKey)
	})

	test('does not label unrelated filesystem failures as insufficient storage', async () => {
		const resourceKey = 'e'.repeat(64)
		fileWriteFailure.code = 'EIO'
		const response = await upload(resourceKey, 'heic', 'photo')

		expect(response.statusCode).toBe(500)
		expect(response.headers['x-umbrel-photo-backup-error']).toBeUndefined()
		expect(JSON.parse(response.body)).toEqual({error: 'error writing file'})
		await expectNoUploadArtifacts(resourceKey)
	})
})
