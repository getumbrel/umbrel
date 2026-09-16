import nodePath from 'node:path'

import fse from 'fs-extra'
import {afterEach, expect, test, vi} from 'vitest'

import Umbreld from '../../index.js'
import * as system from '../system/system.js'
import temporaryDirectory from '../utilities/temporary-directory.js'

vi.mock('execa', async (importOriginal) => ({
	...(await importOriginal<typeof import('execa')>()),
	$: vi.fn(async () => ({stdout: ''})),
}))

vi.mock('../utilities/copy-with-progress.js', () => ({
	copyWithProgress: (source: string, destination: string) => fse.copy(source, destination),
}))

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
	vi.useRealTimers()
	vi.restoreAllMocks()
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function referenceFixture(path = '/Apps/example/shared') {
	const temporary = temporaryDirectory()
	const umbreld = new Umbreld({dataDirectory: await temporary.create(), logLevel: 'silent'})
	cleanups.push(async () => {
		await umbreld.auth.stop()
		await temporary.destroyRoot()
	})
	const {files} = umbreld
	const paths = [path, `${path}/child`, `${path}-sibling`, '/Apps/another/shared']
	for (const path of ['/Home', '/Trash', ...paths]) await fse.ensureDir(files.virtualToSystemPathUnsafe(path))
	await umbreld.store.set('user', {name: 'Owner', hashedPassword: 'unused'})
	await umbreld.user.updateAccountFavorites('0', () => paths)
	await umbreld.store.set(
		'files.shares',
		paths.map((path, index) => ({name: `Share${index}`, path, userId: '0'})),
	)
	await umbreld.store.set(
		'files.memberShares',
		paths.map((path) => ({path, sharedWith: 'all' as const})),
	)
	const applyShares = vi.spyOn(files.samba, 'applyShares').mockResolvedValue(undefined as never)
	vi.spyOn(files, 'getAllowedOperations').mockResolvedValue([
		'writable',
		'move',
		'rename',
		'trash',
		'restore',
		'delete',
	])
	vi.spyOn(files, 'isCloudPathOverlap').mockReturnValue(false)
	vi.spyOn(files, 'trackOperation').mockImplementation(async (_operation, run) => run(() => {}))
	vi.spyOn(system, 'getDiskUsageByPath').mockResolvedValue({size: 10e9, totalUsed: 0, available: 10e9})
	const expectReferences = async (remaining: string[]) => {
		expect(await umbreld.user.getAccountFavorites('0')).toEqual(remaining)
		expect((await umbreld.store.get('files.shares'))?.map(({path}) => path)).toEqual(remaining)
		expect((await files.memberShares.list()).map(({path}) => path)).toEqual(remaining)
	}
	return {files, path, paths, applyShares, expectReferences, systemPath: files.virtualToSystemPathUnsafe(path)}
}

test.each(['move', 'rename', 'trash', 'delete'] as const)(
	'%s immediately removes app subtree references without watcher events',
	async (operation) => {
		const {files, path, paths, systemPath, applyShares, expectReferences} = await referenceFixture()
		if (operation === 'move') await files.move(path, '/Home')
		else if (operation === 'rename') await files.rename(path, 'renamed')
		else await files[operation](path)

		await expect(fse.pathExists(systemPath)).resolves.toBe(false)
		await expectReferences(paths.slice(2))
		expect(applyShares).toHaveBeenCalledOnce()
	},
)

test.each(['copy', 'move', 'restore'] as const)(
	'%s replacement revokes old subtree references before exposing new content',
	async (operation) => {
		const {files, paths, systemPath, applyShares, expectReferences} = await referenceFixture()
		const source = operation === 'restore' ? '/Trash/shared' : '/Home/shared'
		await fse.outputFile(`${files.virtualToSystemPathUnsafe(source)}/private.txt`, 'private data')
		if (operation === 'restore') {
			await fse.outputJson(nodePath.join(files.trashMetaDirectory, 'shared.json'), {path: paths[0]})
		}
		applyShares.mockImplementation(async () => {
			await expect(fse.pathExists(`${systemPath}/private.txt`)).resolves.toBe(false)
			await expect(fse.pathExists(`${systemPath}/child`)).resolves.toBe(true)
			return undefined as never
		})

		if (operation === 'restore') await files.restore(source, {collision: 'replace'})
		else await files[operation](source, '/Apps/example', {collision: 'replace'})

		await expect(fse.readFile(`${systemPath}/private.txt`, 'utf8')).resolves.toBe('private data')
		await expect(fse.pathExists(`${systemPath}/child`)).resolves.toBe(false)
		await expectReferences(paths.slice(2))
		expect(applyShares).toHaveBeenCalledOnce()
	},
)

test('a failed replacement copy keeps the deleted destination references revoked', async () => {
	const {files, paths, systemPath, expectReferences} = await referenceFixture()
	await fse.ensureDir(files.virtualToSystemPathUnsafe('/Home/shared'))
	vi.mocked(files.trackOperation).mockRejectedValueOnce(new Error('copy failed'))

	await expect(files.copy('/Home/shared', '/Apps/example', {collision: 'replace'})).rejects.toThrow('copy failed')
	await expect(fse.pathExists(systemPath)).resolves.toBe(false)
	await expectReferences(paths.slice(2))
})

test('failed share revocation prevents replacement content from being written', async () => {
	const {files, systemPath, applyShares} = await referenceFixture()
	await fse.outputFile(`${files.virtualToSystemPathUnsafe('/Home/shared')}/private.txt`, 'private data')
	applyShares.mockRejectedValueOnce(new Error('Samba reload failed'))

	await expect(files.copy('/Home/shared', '/Apps/example', {collision: 'replace'})).rejects.toThrow(
		'Samba reload failed',
	)
	await expect(fse.pathExists(`${systemPath}/private.txt`)).resolves.toBe(false)
	await expect(fse.pathExists(`${systemPath}/child`)).resolves.toBe(true)
})

test('copying with keep-both preserves existing destination references', async () => {
	const {files, paths, applyShares, expectReferences} = await referenceFixture()
	await fse.outputFile(`${files.virtualToSystemPathUnsafe('/Home/shared')}/private.txt`, 'private data')

	await expect(files.copy('/Home/shared', '/Apps/example', {collision: 'keep-both'})).resolves.not.toBe(paths[0])
	await expectReferences(paths)
	expect(applyShares).not.toHaveBeenCalled()
})

test('app removal clears root and descendant references without removing similarly named app references', async () => {
	const {files, path, paths, expectReferences} = await referenceFixture('/Apps/example')
	await files.removeReferencesWithin(path)
	await expectReferences(paths.slice(2))
})

test('cleans up app favorites, Samba shares and member grants once every 24 hours', async () => {
	const temporary = temporaryDirectory()
	const umbreld = new Umbreld({dataDirectory: await temporary.create(), logLevel: 'silent'})
	const path = '/Apps/example/shared'
	const systemPath = umbreld.files.virtualToSystemPathUnsafe(path)
	await fse.ensureDir(systemPath)
	await umbreld.store.set('user', {name: 'Owner', hashedPassword: 'unused'})
	await umbreld.user.updateAccountFavorites('0', () => [path])
	await umbreld.store.set('files.shares', [{name: 'Shared', path, userId: '0'}])
	await umbreld.store.set('files.memberShares', [{path, sharedWith: 'all'}])
	vi.spyOn(umbreld.files.samba, 'applyCredentials').mockResolvedValue(undefined)
	const applyShares = vi.spyOn(umbreld.files.samba, 'applyShares').mockResolvedValue(undefined as never)
	try {
		vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
		await umbreld.files.favorites.start()
		await umbreld.files.memberShares.start()
		await umbreld.files.samba.start()

		// Replace the directory between polls, with no time when the poll can
		// observe an absent path. The next daily check removes the old shares.
		await fse.rename(systemPath, nodePath.join(nodePath.dirname(systemPath), 'old-shared'))
		await fse.ensureDir(systemPath)
		await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 - 1)
		expect(await umbreld.user.getAccountFavorites('0')).toEqual([path])
		expect(await umbreld.store.get('files.shares')).toHaveLength(1)
		expect(await umbreld.files.memberShares.list()).toHaveLength(1)
		expect(applyShares).toHaveBeenCalledOnce()
		await vi.advanceTimersByTimeAsync(1)
		await vi.waitFor(async () => {
			expect(await umbreld.user.getAccountFavorites('0')).toEqual([])
			expect(await umbreld.store.get('files.shares')).toEqual([])
			expect(await umbreld.files.memberShares.list()).toEqual([])
		})
		expect(applyShares).toHaveBeenCalledTimes(2)
		await expect(fse.pathExists(systemPath)).resolves.toBe(true)
	} finally {
		await umbreld.files.favorites.stop()
		await umbreld.files.memberShares.stop()
		await umbreld.files.samba.stop()
		await umbreld.auth.stop()
		await temporary.destroyRoot()
	}
})
