import nodePath from 'node:path'

import fse from 'fs-extra'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import Umbreld from '../../index.js'
import {Blake3Hasher} from '../files/blake3.js'
import temporaryDirectory from '../utilities/temporary-directory.js'

const SOURCE_ID = '11111111-1111-4111-8111-111111111111'

function blake3(contents: string) {
	const hasher = new Blake3Hasher()
	hasher.update(Buffer.from(contents))
	return hasher.digestBuffer()
}

async function indexedRevision(systemPath: string) {
	const stats = await fse.stat(systemPath, {bigint: true})
	return {
		device: stats.dev.toString(),
		inode: stats.ino.toString(),
		size: Number(stats.size),
		modifiedNs: stats.mtimeNs.toString(),
		ctimeNs: stats.ctimeNs.toString(),
	}
}

describe('Photos backup storage', () => {
	let directory: ReturnType<typeof temporaryDirectory>
	let dataDirectory: string
	let umbreld: Umbreld

	beforeEach(async () => {
		directory = temporaryDirectory()
		await directory.createRoot()
		dataDirectory = await directory.create()
		await Promise.all([
			fse.ensureDir(nodePath.join(dataDirectory, 'home')),
			fse.ensureDir(nodePath.join(dataDirectory, 'members', 'Alice', 'home')),
		])
		umbreld = new Umbreld({dataDirectory, port: 0, logLevel: 'silent'})
		vi.spyOn(umbreld.files.fileIndex, 'photosUpsertBackupSource').mockResolvedValue(true)
	})

	afterEach(async () => {
		await directory.destroyRoot()
	})

	test('stores a friendly source directory in the account Home', async () => {
		const source = await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID.toUpperCase(),
			suggestedName: '  Pixel 9  ',
		})

		expect(source).toMatchObject({id: SOURCE_ID, accountId: '0', name: 'Pixel 9', directoryName: 'Pixel 9'})
		expect(source.createdAt).toBeTypeOf('number')
		expect(await umbreld.store.get('photos.backupSources')).toEqual([source])
		expect(umbreld.photos.backupSourceVirtualDirectory(source)).toBe('/Home/Photos/Pixel 9')
		await expect(fse.pathExists(`${dataDirectory}/home/Photos/Pixel 9`)).resolves.toBe(true)
		expect(umbreld.files.fileIndex.photosUpsertBackupSource).toHaveBeenCalledWith(
			'0',
			expect.stringMatching(/^iphone:/),
			'Pixel 9',
			expect.any(Number),
		)
		const resourceKey = 'ab'.repeat(32)
		await expect(umbreld.photos.prepareBackupResourcePath(source, resourceKey, 'HEIC')).resolves.toBe(
			`/Home/Photos/Pixel 9/ab/${resourceKey}.heic`,
		)
		expect((await fse.stat(`${dataDirectory}/home/Photos/Pixel 9/ab`)).mode & 0o777).toBe(0o755)
	})

	test('announces a new backup source, but not a re-registration', async () => {
		const emit = vi.spyOn(umbreld.eventBus, 'emit')
		await umbreld.photos.registerBackupSource({accountId: '0', sourceId: SOURCE_ID, suggestedName: 'Pixel 9'})
		expect(emit).toHaveBeenCalledWith('photos:change', {accountIds: ['0']})

		emit.mockClear()
		await umbreld.photos.registerBackupSource({accountId: '0', sourceId: SOURCE_ID, suggestedName: 'Pixel 9'})
		expect(emit).not.toHaveBeenCalledWith('photos:change', expect.anything())
	})

	test('serializes concurrent creation of the same backup shard', async () => {
		const source = await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: 'Pixel 9',
		})
		const originalCreateDirectory = umbreld.files.createDirectory.bind(umbreld.files)
		const createDirectory = vi.spyOn(umbreld.files, 'createDirectory')
		let activeShardCreations = 0
		let maximumActiveShardCreations = 0
		createDirectory.mockImplementation(async (virtualPath, accountId) => {
			if (!virtualPath.endsWith('/ab')) return originalCreateDirectory(virtualPath, accountId)
			activeShardCreations += 1
			maximumActiveShardCreations = Math.max(maximumActiveShardCreations, activeShardCreations)
			await new Promise((resolve) => setImmediate(resolve))
			try {
				return await originalCreateDirectory(virtualPath, accountId)
			} finally {
				activeShardCreations -= 1
			}
		})

		const firstKey = `ab${'1'.repeat(62)}`
		const secondKey = `ab${'2'.repeat(62)}`
		await Promise.all([
			umbreld.photos.prepareBackupResourcePath(source, firstKey, 'heic'),
			umbreld.photos.prepareBackupResourcePath(source, secondKey, 'mov'),
		])

		expect(maximumActiveShardCreations).toBe(1)
	})

	test('preserves the first backup source registration across retries and restarts', async () => {
		const original = await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: 'Pixel 9',
		})
		const retry = await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: 'Renamed phone',
		})
		expect(retry).toEqual(original)

		await fse.remove(umbreld.files.virtualToSystemPathUnsafe(umbreld.photos.backupSourceVirtualDirectory(original)))
		const restarted = new Umbreld({dataDirectory, port: 0, logLevel: 'silent'})
		vi.spyOn(restarted.files.fileIndex, 'photosUpsertBackupSource').mockResolvedValue(true)
		await expect(
			restarted.photos.registerBackupSource({accountId: '0', sourceId: SOURCE_ID, suggestedName: 'Another name'}),
		).resolves.toEqual(original)
		await expect(
			fse.pathExists(
				restarted.files.virtualToSystemPathUnsafe(restarted.photos.backupSourceVirtualDirectory(original)),
			),
		).resolves.toBe(true)
	})

	test('migrates legacy private backups into Home and rebuilds their durable relations', async () => {
		const resourceKey = 'c'.repeat(64)
		const fileName = `${resourceKey}.dng`
		const legacyPath = nodePath.join(dataDirectory, 'photos', 'media', '0', SOURCE_ID, fileName)
		await fse.outputFile(legacyPath, 'raw photo')
		await umbreld.store.set('photos.backupSources', [
			// @ts-expect-error This deliberately represents the source record written by the legacy storage layout.
			{id: SOURCE_ID, accountId: '0', name: "Luke's iPhone", createdAt: 123},
		])
		const register = vi.spyOn(umbreld.files.fileIndex, 'photosRegisterBackupResource').mockResolvedValue({
			resourceKey,
			path: `/Home/Photos/Luke's iPhone/${resourceKey.slice(0, 2)}/${fileName}`,
			bytes: 9,
		})

		const source = await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: 'Ignored retry name',
		})

		expect(source).toMatchObject({
			id: SOURCE_ID,
			name: "Luke's iPhone",
			directoryName: "Luke's iPhone",
			storageVersion: 3,
		})
		const targetPath = nodePath.join(
			dataDirectory,
			'home',
			'Photos',
			"Luke's iPhone",
			resourceKey.slice(0, 2),
			fileName,
		)
		await expect(fse.readFile(targetPath, 'utf8')).resolves.toBe('raw photo')
		await expect(fse.pathExists(legacyPath)).resolves.toBe(false)
		expect(register).toHaveBeenCalledWith(
			'0',
			expect.stringMatching(/^iphone:/),
			resourceKey,
			targetPath,
			blake3('raw photo'),
			expect.objectContaining({size: 9}),
			undefined,
			undefined,
		)
		await expect(umbreld.store.get('photos.backupSources')).resolves.toEqual([source])
	})

	test('migrates the previous flat Home layout into resource-key shards', async () => {
		const resourceKey = 'de'.repeat(32)
		const fileName = `${resourceKey}.heic`
		const flatPath = nodePath.join(dataDirectory, 'home', 'Photos', 'Phone', fileName)
		await fse.outputFile(flatPath, 'photo')
		await umbreld.store.set('photos.backupSources', [
			{
				id: SOURCE_ID,
				accountId: '0',
				name: 'Phone',
				directoryName: 'Phone',
				createdAt: 123,
				// @ts-expect-error This deliberately represents the storage-v2 record written by the previous layout.
				storageVersion: 2,
			},
		])
		const shardedVirtualPath = `/Home/Photos/Phone/${resourceKey.slice(0, 2)}/${fileName}`
		vi.spyOn(umbreld.files.fileIndex, 'photosRegisterBackupResource').mockResolvedValue({
			resourceKey,
			path: shardedVirtualPath,
			bytes: 5,
		})

		const source = await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: 'Ignored retry name',
		})

		expect(source.storageVersion).toBe(3)
		await expect(fse.pathExists(flatPath)).resolves.toBe(false)
		await expect(fse.readFile(umbreld.files.virtualToSystemPathUnsafe(shardedVirtualPath), 'utf8')).resolves.toBe(
			'photo',
		)
	})

	test('scopes the same client source id independently to each account', async () => {
		const owner = await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: 'Owner phone',
		})
		const member = await umbreld.photos.registerBackupSource({
			accountId: 'Alice',
			sourceId: SOURCE_ID,
			suggestedName: 'Alice phone',
		})

		expect(member).toMatchObject({id: SOURCE_ID, accountId: 'Alice', name: 'Alice phone'})
		expect(umbreld.photos.backupSourceVirtualDirectory(member)).toBe('/Users/Alice/Photos/Alice phone')
		expect(umbreld.photos.backupSourceVirtualDirectory(member)).not.toBe(
			umbreld.photos.backupSourceVirtualDirectory(owner),
		)
	})

	test('sanitizes source folder names and keeps duplicate device names distinct', async () => {
		const first = await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: 'Luke/iPhone',
		})
		const second = await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: '22222222-2222-4222-8222-222222222222',
			suggestedName: 'Luke/iPhone',
		})

		expect(first).toMatchObject({name: 'Luke/iPhone', directoryName: 'Luke-iPhone'})
		expect(second).toMatchObject({name: 'Luke/iPhone', directoryName: 'Luke-iPhone (2)'})
	})

	test('bounds a multibyte source folder name to a portable filesystem component', async () => {
		const suggestedName = '界'.repeat(100)
		const source = await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName,
		})

		expect(source.name).toBe(suggestedName)
		expect(Buffer.byteLength(source.directoryName)).toBeLessThanOrEqual(240)
		await expect(
			fse.pathExists(umbreld.files.virtualToSystemPathUnsafe(umbreld.photos.backupSourceVirtualDirectory(source))),
		).resolves.toBe(true)
	})

	test('does not leave a Windows-invalid suffix after truncating a source folder name', async () => {
		const source = await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: `${'界'.repeat(79)}aa.suffix`,
		})

		expect(Buffer.byteLength(source.directoryName)).toBeLessThanOrEqual(240)
		expect(source.directoryName).not.toMatch(/[ .]$/)
	})

	test('continues restoring backup sources after one source fails during startup', async () => {
		await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: 'First phone',
		})
		await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: '22222222-2222-4222-8222-222222222222',
			suggestedName: 'Second phone',
		})
		vi.spyOn(umbreld.files.fileIndex, 'initializePhotos').mockResolvedValue(true)
		const restore = vi.mocked(umbreld.files.fileIndex.photosUpsertBackupSource)
		restore.mockClear()
		restore.mockRejectedValueOnce(new Error('corrupt source'))

		await expect(umbreld.photos.start()).resolves.toBeUndefined()
		expect(restore).toHaveBeenCalledTimes(2)
		expect(restore.mock.calls.map(([, , name]) => name)).toStrictEqual(['First phone', 'Second phone'])
	})

	test('confirms resources through their durable source and hash relation', async () => {
		const owner = await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: 'Owner phone',
		})
		const confirmedKey = 'a'.repeat(64)
		const otherAccountKey = 'b'.repeat(64)
		const confirmedSystemPath = nodePath.join(dataDirectory, 'home', 'Moved', 'photo.heic')
		await fse.outputFile(confirmedSystemPath, 'photo')
		const confirmed = {resourceKey: confirmedKey, bytes: 5}
		vi.spyOn(umbreld.files.fileIndex, 'photosConfirmedBackupResources').mockResolvedValue([
			{
				...confirmed,
				path: '/Home/Moved/photo.heic',
				contentHash: Buffer.alloc(32, 1),
				revision: await indexedRevision(confirmedSystemPath),
			},
		])

		await expect(
			umbreld.photos.confirmedBackupResources({
				accountId: '0',
				sourceId: SOURCE_ID,
				resources: [
					{resourceKey: confirmedKey, fileExtension: 'heic'},
					{resourceKey: otherAccountKey, fileExtension: 'heic'},
				],
			}),
		).resolves.toEqual([confirmed])
		expect(umbreld.files.fileIndex.photosConfirmedBackupResources).toHaveBeenCalledWith(
			'0',
			expect.stringMatching(/^iphone:/),
			[confirmedKey, otherAccountKey],
		)
		await expect(
			umbreld.photos.confirmedBackupResources({
				accountId: 'Bob',
				sourceId: SOURCE_ID,
				resources: [{resourceKey: confirmedKey, fileExtension: 'heic'}],
			}),
		).resolves.toEqual([])
	})

	test('reuses a matching registered keep-both path on later upload retries', async () => {
		const source = await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: 'Owner phone',
		})
		const resourceKey = 'c'.repeat(64)
		const baseVirtualPath = umbreld.photos.backupResourceVirtualPath(source, resourceKey, 'heic')
		const keepBothVirtualPath = baseVirtualPath.replace('.heic', ' (1).heic')
		const keepBothSystemPath = umbreld.files.virtualToSystemPathUnsafe(keepBothVirtualPath)
		await fse.outputFile(umbreld.files.virtualToSystemPathUnsafe(baseVirtualPath), 'user edit')
		await fse.outputFile(keepBothSystemPath, 'phone original')
		const revision = await indexedRevision(keepBothSystemPath)
		const hash = blake3('phone original')
		vi.spyOn(umbreld.files.fileIndex, 'photosConfirmedBackupResources').mockResolvedValue([
			{
				resourceKey,
				contentHash: hash,
				path: keepBothVirtualPath,
				bytes: Buffer.byteLength('phone original'),
				revision,
			},
		])
		const register = vi.spyOn(umbreld.files.fileIndex, 'photosRegisterBackupResource')
		await expect(
			umbreld.photos.registerMatchingBackupResource(source, resourceKey, baseVirtualPath, hash, 'IMG_1234.HEIC'),
		).resolves.toEqual({
			receipt: {resourceKey, path: keepBothVirtualPath, bytes: Buffer.byteLength('phone original')},
			revision,
		})
		expect(register).not.toHaveBeenCalled()
	})

	test('does not confirm an indexed receipt after its file disappears', async () => {
		await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: 'Owner phone',
		})
		const resourceKey = 'e'.repeat(64)
		const virtualPath = '/Home/Photos/Owner phone/stale.heic'
		const systemPath = umbreld.files.virtualToSystemPathUnsafe(virtualPath)
		await fse.outputFile(systemPath, 'photo')
		const revision = await indexedRevision(systemPath)
		await fse.remove(systemPath)
		vi.spyOn(umbreld.files.fileIndex, 'photosConfirmedBackupResources').mockResolvedValue([
			{resourceKey, contentHash: blake3('photo'), path: virtualPath, bytes: 5, revision},
		])

		await expect(
			umbreld.photos.confirmedBackupResources({
				accountId: '0',
				sourceId: SOURCE_ID,
				resources: [{resourceKey, fileExtension: 'heic'}],
			}),
		).resolves.toEqual([])
	})

	test('confirms a backed-up format that is not eligible for Photos enrichment', async () => {
		const source = await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: 'Sidecars',
		})
		const resourceKey = 'd'.repeat(64)
		const contents = 'unsupported sidecar bytes'
		const virtualPath = umbreld.photos.backupResourceVirtualPath(source, resourceKey, 'aae')
		await fse.outputFile(umbreld.files.virtualToSystemPathUnsafe(virtualPath), contents)
		vi.spyOn(umbreld.files.fileIndex, 'photosConfirmedBackupResources').mockResolvedValue([
			{resourceKey, contentHash: blake3(contents)},
		])

		await expect(
			umbreld.photos.confirmedBackupResources({
				accountId: '0',
				sourceId: SOURCE_ID,
				resources: [{resourceKey, fileExtension: 'aae'}],
			}),
		).resolves.toEqual([{resourceKey, bytes: Buffer.byteLength(contents)}])
	})

	test('deletes one account source records without deleting Home outside the Files lifecycle', async () => {
		const owner = await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: 'Owner phone',
		})
		const member = await umbreld.photos.registerBackupSource({
			accountId: 'Alice',
			sourceId: SOURCE_ID,
			suggestedName: 'Alice phone',
		})
		const ownerMedia = nodePath.join(
			umbreld.files.virtualToSystemPathUnsafe(umbreld.photos.backupSourceVirtualDirectory(owner)),
			'photo.jpg',
		)
		const memberMedia = nodePath.join(
			umbreld.files.virtualToSystemPathUnsafe(umbreld.photos.backupSourceVirtualDirectory(member)),
			'photo.jpg',
		)
		await fse.writeFile(ownerMedia, 'owner')
		await fse.writeFile(memberMedia, 'member')

		await umbreld.photos.deleteAccount('Alice')
		await expect(umbreld.photos.deleteAccount('Alice')).resolves.toBeUndefined()

		await expect(fse.pathExists(ownerMedia)).resolves.toBe(true)
		await expect(fse.pathExists(memberMedia)).resolves.toBe(true)
		await expect(umbreld.store.get('photos.backupSources')).resolves.toEqual([owner])
		await expect(
			umbreld.photos.registerBackupSource({
				accountId: 'Alice',
				sourceId: SOURCE_ID,
				suggestedName: 'New registration',
			}),
		).resolves.toMatchObject({name: 'New registration'})
	})

	test('removing an iPhone source drops its registry entry and every matching upload grant', async () => {
		await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: "Luke's iPhone",
		})
		const librarySourceId = vi.mocked(umbreld.files.fileIndex.photosUpsertBackupSource).mock.calls[0]![1]
		vi.spyOn(umbreld.files.fileIndex, 'photosRemoveSource').mockResolvedValue(true)
		const revoke = vi.spyOn(umbreld.auth, 'revokePhotoBackupGrantsForSource').mockResolvedValue(1)

		await expect(umbreld.photos.removeSource('0', librarySourceId, true)).resolves.toBe(true)
		await expect(umbreld.store.get('photos.backupSources')).resolves.toEqual([])
		expect(revoke).toHaveBeenCalledWith('0', SOURCE_ID)
		expect(umbreld.files.fileIndex.photosRemoveSource).toHaveBeenCalledWith('0', librarySourceId, true)
	})

	test('replays a durable source-removal intent after a restart', async () => {
		await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: "Luke's iPhone",
		})
		const librarySourceId = vi.mocked(umbreld.files.fileIndex.photosUpsertBackupSource).mock.calls[0]![1]
		vi.spyOn(umbreld.auth, 'revokePhotoBackupGrantsForSource').mockResolvedValue(1)
		const revision = {
			inode: '2',
			size: 5,
			modifiedNs: '3',
			ctimeNs: '4',
		}
		const removalFiles = vi
			.spyOn(umbreld.files.fileIndex, 'photosSourceRemovalFiles')
			.mockResolvedValue([{id: 'a'.repeat(64), path: '/Home/Photos/Phone/aa/photo.heic', revision}])
		const trash = vi.spyOn(umbreld.files, 'trash').mockResolvedValue('/Trash/photo.heic')
		const failedRemove = vi
			.spyOn(umbreld.files.fileIndex, 'photosRemoveSource')
			.mockRejectedValue(new Error('database unavailable'))

		await expect(umbreld.photos.removeSource('0', librarySourceId, false)).rejects.toThrow('database unavailable')
		expect(removalFiles).toHaveBeenCalledWith('0', librarySourceId)
		expect(trash).toHaveBeenCalledWith('/Home/Photos/Phone/aa/photo.heic', '0', revision)
		expect(trash.mock.invocationCallOrder[0]).toBeLessThan(failedRemove.mock.invocationCallOrder[0]!)
		await expect(umbreld.store.get('photos.backupSources')).resolves.toHaveLength(1)
		await expect(umbreld.store.get('photos.backupSourceRemovals')).resolves.toEqual([
			expect.objectContaining({accountId: '0', sourceId: SOURCE_ID, keepItems: false}),
		])

		const restarted = new Umbreld({dataDirectory, port: 0, logLevel: 'silent'})
		vi.spyOn(restarted.files.fileIndex, 'initializePhotos').mockResolvedValue(true)
		vi.spyOn(restarted.files.fileIndex, 'photosSourceRemovalFiles').mockResolvedValue([])
		const remove = vi.spyOn(restarted.files.fileIndex, 'photosRemoveSource').mockResolvedValue(true)
		const revoke = vi.spyOn(restarted.auth, 'revokePhotoBackupGrantsForSource').mockResolvedValue(1)
		await restarted.photos.start()

		expect(revoke).toHaveBeenCalledWith('0', SOURCE_ID)
		expect(remove).toHaveBeenCalledWith('0', librarySourceId, false)
		await expect(restarted.store.get('photos.backupSources')).resolves.toEqual([])
		await expect(restarted.store.get('photos.backupSourceRemovals')).resolves.toEqual([])
	})

	test('serializes source removal behind an in-flight backup operation', async () => {
		await umbreld.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: "Luke's iPhone",
		})
		const librarySourceId = vi.mocked(umbreld.files.fileIndex.photosUpsertBackupSource).mock.calls[0]![1]
		const remove = vi.spyOn(umbreld.files.fileIndex, 'photosRemoveSource').mockResolvedValue(true)
		vi.spyOn(umbreld.auth, 'revokePhotoBackupGrantsForSource').mockResolvedValue(1)
		let releaseOperation!: () => void
		let markEntered!: () => void
		const entered = new Promise<void>((resolve) => (markEntered = resolve))
		const operation = umbreld.photos.withBackupSource('0', SOURCE_ID, async () => {
			markEntered()
			await new Promise<void>((resolve) => (releaseOperation = resolve))
			return 'uploaded'
		})
		await entered

		const removal = umbreld.photos.removeSource('0', librarySourceId, true)
		await new Promise<void>((resolve) => setImmediate(resolve))
		expect(remove).not.toHaveBeenCalled()
		releaseOperation()

		await expect(operation).resolves.toEqual({active: true, value: 'uploaded'})
		await expect(removal).resolves.toBe(true)
		expect(remove).toHaveBeenCalledTimes(1)
	})

	test('serializes source removal behind source registration and grant issuance', async () => {
		let releaseGrant!: () => void
		let markGrantEntered!: () => void
		const grantEntered = new Promise<void>((resolve) => (markGrantEntered = resolve))
		vi.spyOn(umbreld.auth, 'issuePhotoBackupGrant').mockImplementation(async () => {
			markGrantEntered()
			await new Promise<void>((resolve) => (releaseGrant = resolve))
			return {token: 'photo-grant'}
		})
		const grant = umbreld.photos.createBackupGrant({
			principal: {sessionId: 'native-session', accountId: '0', actor: 'account'},
			sourceId: SOURCE_ID,
			suggestedName: "Luke's iPhone",
		})
		await grantEntered
		const librarySourceId = vi.mocked(umbreld.files.fileIndex.photosUpsertBackupSource).mock.calls[0]![1]
		const remove = vi.spyOn(umbreld.files.fileIndex, 'photosRemoveSource').mockResolvedValue(true)
		vi.spyOn(umbreld.auth, 'revokePhotoBackupGrantsForSource').mockResolvedValue(1)

		const removal = umbreld.photos.removeSource('0', librarySourceId, true)
		await new Promise<void>((resolve) => setImmediate(resolve))
		expect(remove).not.toHaveBeenCalled()
		releaseGrant()

		await expect(grant).resolves.toMatchObject({token: 'photo-grant'})
		await expect(removal).resolves.toBe(true)
		expect(remove).toHaveBeenCalledTimes(1)
	})

	test('rejects a Photos directory symlink that escapes the account Home', async () => {
		const outside = await directory.create()
		const photosDirectory = nodePath.join(dataDirectory, 'home', 'Photos')
		await fse.remove(photosDirectory)
		await fse.symlink(outside, photosDirectory, 'dir')

		await expect(
			umbreld.photos.registerBackupSource({
				accountId: '0',
				sourceId: SOURCE_ID,
				suggestedName: "Luke's iPhone",
			}),
		).rejects.toThrow('[escapes-base]')
		await expect(fse.readdir(outside)).resolves.toEqual([])
	})

	test('rejects path-like identities before deriving storage paths', async () => {
		expect(() => umbreld.photos.backupSourceVirtualDirectory({accountId: '0', directoryName: '../Documents'})).toThrow(
			'Invalid photo backup directory name',
		)
		await expect(
			umbreld.photos.registerBackupSource({accountId: '../Alice', sourceId: SOURCE_ID, suggestedName: 'Phone'}),
		).rejects.toThrow('Invalid Photos account id')
		await expect(
			umbreld.photos.registerBackupSource({accountId: '0', sourceId: '../phone', suggestedName: 'Phone'}),
		).rejects.toThrow('Invalid photo backup source id')
		await expect(
			umbreld.photos.registerBackupSource({accountId: '0', sourceId: SOURCE_ID, suggestedName: ' '}),
		).rejects.toThrow('Invalid photo backup source name')
		await expect(
			umbreld.photos.confirmedBackupResources({
				accountId: '0',
				sourceId: SOURCE_ID,
				resources: [{resourceKey: 'not-a-key', fileExtension: 'heic'}],
			}),
		).rejects.toThrow('Invalid photo backup resource')
	})
})
