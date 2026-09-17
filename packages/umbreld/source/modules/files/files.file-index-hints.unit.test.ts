import nodePath from 'node:path'
import {createHash} from 'node:crypto'
import {lstat, rename} from 'node:fs/promises'

import fse from 'fs-extra'
import {afterAll, beforeAll, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import {OWNER_USER_ID} from '../user/constants.js'
import temporaryDirectory from '../utilities/temporary-directory.js'
import Files from './files.js'

const temporary = temporaryDirectory()

beforeAll(temporary.createRoot)
afterAll(temporary.destroyRoot)

function filesFixture(systemPath: string) {
	const error = vi.fn()
	const mcp = {removeFileGrantsWithin: vi.fn(async () => {})}
	const memberShares = {removeWithin: vi.fn(async () => {})}
	const files = new Files({
		dataDirectory: nodePath.dirname(systemPath),
		logger: {createChildLogger: () => ({error})},
		eventBus: {emit: vi.fn()},
		mcp,
	} as unknown as Umbreld)
	Object.assign(files, {
		virtualToSystemPath: vi.fn(async () => systemPath),
		getAllowedOperations: vi.fn(async () => ['writable', 'delete']),
		isCloudPathOverlap: vi.fn(() => false),
		chownSystemPath: vi.fn(async () => {}),
		memberShares,
		cloud: {resolveSharedDestinationDeletesAsOwner: vi.fn(async () => new Map())},
	})
	return {files, error, mcp, memberShares}
}

test('a successful create posts its index hint without waiting for it', async () => {
	const directory = await temporary.create()
	const systemPath = nodePath.join(directory, 'created')
	const {files} = filesFixture(systemPath)
	let releaseIndexHint!: () => void
	const indexHintReleased = new Promise<void>((resolve) => (releaseIndexHint = resolve))
	const reconcilePath = vi.fn(() => indexHintReleased)
	Object.assign(files, {fileIndex: {reconcilePath}})

	await expect(files.createDirectory('/Home/created')).resolves.toMatchObject({created: true})

	expect(reconcilePath).toHaveBeenCalledWith(systemPath)
	expect(await fse.pathExists(systemPath)).toBe(true)
	releaseIndexHint()
})

test('an index failure never changes a successful filesystem result', async () => {
	const directory = await temporary.create()
	const systemPath = nodePath.join(directory, 'deleted.txt')
	await fse.writeFile(systemPath, 'content')
	const {files, error} = filesFixture(systemPath)
	const removePath = vi.fn(async () => {
		throw new Error('index unavailable')
	})
	Object.assign(files, {fileIndex: {removePath}})

	await expect(files.delete('/Home/deleted.txt')).resolves.toStrictEqual(true)

	expect(removePath).toHaveBeenCalledWith(systemPath)
	expect(await fse.pathExists(systemPath)).toBe(false)
	await vi.waitFor(() =>
		expect(error).toHaveBeenCalledWith(`Failed to update file index after delete '${systemPath}'`, expect.any(Error)),
	)
})

test('deleting app data clears Samba shares and favorites without waiting for a watcher', async () => {
	const directory = await temporary.create()
	const systemPath = nodePath.join(directory, 'shared')
	await fse.ensureDir(systemPath)
	const {files, memberShares} = filesFixture(systemPath)
	const removeSharesWithin = vi.fn(async () => true)
	const removeWithin = vi.fn(async () => {})
	Object.assign(files, {
		fileIndex: {removePath: vi.fn(async () => {})},
		samba: {removeSharesWithin},
		favorites: {removeWithin},
	})
	await expect(files.delete('/Apps/example/shared')).resolves.toBe(true)
	expect(removeSharesWithin).toHaveBeenCalledWith('/Apps/example/shared')
	expect(removeWithin).toHaveBeenCalledWith('/Apps/example/shared')
	expect(memberShares.removeWithin).toHaveBeenCalledWith('/Apps/example/shared')
})

test('revision-checked deletion never removes a replacement at the indexed path', async () => {
	const directory = await temporary.create()
	const systemPath = nodePath.join(directory, 'replacement.jpg')
	const virtualPath = '/Trash/replacement.jpg'
	await fse.writeFile(systemPath, 'indexed bytes')
	const stats = await lstat(systemPath, {bigint: true})
	const indexedRevision = {
		inode: stats.ino.toString(),
		size: Number(stats.size),
		modifiedNs: stats.mtimeNs.toString(),
		ctimeNs: stats.ctimeNs.toString(),
	}
	await fse.writeFile(systemPath, 'replacement bytes with a different revision')
	const {files} = filesFixture(systemPath)
	Object.assign(files, {fileIndex: {removePath: vi.fn(async () => {})}})

	await expect(
		files.deleteMany([virtualPath], OWNER_USER_ID, {
			expectedRevisions: new Map([[virtualPath, indexedRevision]]),
		}),
	).resolves.toStrictEqual([false])
	await expect(fse.readFile(systemPath, 'utf8')).resolves.toBe('replacement bytes with a different revision')
	expect((await fse.readdir(directory)).some((name) => name.endsWith('.umbrel-trash'))).toBe(false)
})

test('revision-checked deletion removes the exact indexed file without leaving a claim', async () => {
	const directory = await temporary.create()
	const systemPath = nodePath.join(directory, 'exact.jpg')
	const virtualPath = '/Trash/exact.jpg'
	await fse.writeFile(systemPath, 'indexed bytes')
	const stats = await lstat(systemPath, {bigint: true})
	const indexedRevision = {
		inode: stats.ino.toString(),
		size: Number(stats.size),
		modifiedNs: stats.mtimeNs.toString(),
		ctimeNs: stats.ctimeNs.toString(),
	}
	const {files} = filesFixture(systemPath)
	Object.assign(files, {fileIndex: {removePath: vi.fn(async () => {})}})

	await expect(
		files.deleteMany([virtualPath], OWNER_USER_ID, {
			expectedRevisions: new Map([[virtualPath, indexedRevision]]),
		}),
	).resolves.toStrictEqual([true])
	await expect(fse.pathExists(systemPath)).resolves.toBe(false)
	expect((await fse.readdir(directory)).some((name) => name.endsWith('.umbrel-trash'))).toBe(false)
})

test('a failed revision-checked deletion keeps its journal when a replacement blocks restoration', async () => {
	const directory = await temporary.create()
	const systemPath = nodePath.join(directory, 'collision.jpg')
	const virtualPath = '/Trash/collision.jpg'
	await fse.writeFile(systemPath, 'indexed bytes')
	const stats = await lstat(systemPath, {bigint: true})
	const indexedRevision = {
		inode: stats.ino.toString(),
		size: Number(stats.size),
		modifiedNs: stats.mtimeNs.toString(),
		ctimeNs: stats.ctimeNs.toString(),
	}
	const {files} = filesFixture(systemPath)
	const movePathRequired = vi.fn(async () => {})
	Object.assign(files, {
		fileIndex: {removePath: vi.fn(async () => {}), movePathRequired},
		cloud: {
			resolveSharedDestinationDeletesAsOwner: vi.fn(async () => new Map([[virtualPath, {}]])),
			deleteSharedDestinationAsOwner: vi.fn(async () => {
				await fse.writeFile(systemPath, 'replacement bytes')
				throw new Error('delete failed')
			}),
		},
	})

	await expect(
		files.deleteMany([virtualPath], OWNER_USER_ID, {
			expectedRevisions: new Map([[virtualPath, indexedRevision]]),
		}),
	).resolves.toStrictEqual([false])
	await expect(fse.readFile(systemPath, 'utf8')).resolves.toBe('replacement bytes')
	expect((await fse.readdir(directory)).filter((name) => name.endsWith('.umbrel-trash'))).toHaveLength(2)

	await fse.remove(systemPath)
	await expect(files.recoverTrashClaim(virtualPath)).resolves.toBe(true)
	await expect(fse.readFile(systemPath, 'utf8')).resolves.toBe('indexed bytes')
	expect(movePathRequired).toHaveBeenCalledWith(expect.stringContaining('.umbrel-trash'), systemPath)
	expect((await fse.readdir(directory)).some((name) => name.endsWith('.umbrel-trash'))).toBe(false)
})

test.each(['home', 'trash'] as const)(
	'startup claim recovery discovers nested interrupted work in %s',
	async (root) => {
		const dataDirectory = await temporary.create()
		const parentSystemPath = nodePath.join(dataDirectory, root, 'nested')
		const originalSystemPath = nodePath.join(parentSystemPath, 'interrupted.jpg')
		const claimId = createHash('sha256').update(originalSystemPath).digest('hex').slice(0, 32)
		const claimSystemPath = nodePath.join(parentSystemPath, `.${claimId}.umbrel-trash`)
		const manifestSystemPath = nodePath.join(parentSystemPath, `.${claimId}.json.umbrel-trash`)
		await Promise.all([
			fse.ensureDir(nodePath.join(dataDirectory, 'home')),
			fse.ensureDir(nodePath.join(dataDirectory, 'trash')),
		])
		await fse.outputFile(originalSystemPath, 'claimed bytes')
		const stats = await lstat(originalSystemPath, {bigint: true})
		await fse.writeJson(manifestSystemPath, {
			version: 1,
			originalSystemPath,
			revision: {
				inode: stats.ino.toString(),
				size: Number(stats.size),
				modifiedNs: stats.mtimeNs.toString(),
				ctimeNs: stats.ctimeNs.toString(),
			},
		})
		await rename(originalSystemPath, claimSystemPath)
		const movePathRequired = vi.fn(async () => {})
		const files = new Files({
			dataDirectory,
			logger: {createChildLogger: () => ({error: vi.fn()})},
			user: {listMembers: vi.fn(async () => [])},
			eventBus: {emit: vi.fn()},
		} as unknown as Umbreld)
		Object.assign(files, {fileIndex: {movePathRequired}})

		await expect(files.recoverTrashClaims()).resolves.toBeUndefined()
		expect(movePathRequired).toHaveBeenCalledWith(claimSystemPath, originalSystemPath)
		await expect(fse.readFile(originalSystemPath, 'utf8')).resolves.toBe('claimed bytes')
		await expect(fse.pathExists(claimSystemPath)).resolves.toBe(false)
		await expect(fse.pathExists(manifestSystemPath)).resolves.toBe(false)
	},
)

test('returns after access cleanup without waiting for the delete index hint', async () => {
	const directory = await temporary.create()
	const systemPath = nodePath.join(directory, 'deleted.txt')
	await fse.writeFile(systemPath, 'content')
	const {files, mcp, memberShares} = filesFixture(systemPath)
	let releaseIndexHint!: () => void
	const indexHintReleased = new Promise<void>((resolve) => (releaseIndexHint = resolve))
	const removePath = vi.fn(() => indexHintReleased)
	Object.assign(files, {fileIndex: {removePath}})

	let deletionFinished = false
	const deletion = files.delete('/Home/deleted.txt').then((result) => {
		deletionFinished = true
		return result
	})
	await vi.waitFor(() => expect(removePath).toHaveBeenCalledWith(systemPath))

	expect(await fse.pathExists(systemPath)).toBe(false)
	expect(memberShares.removeWithin).toHaveBeenCalledWith('/Home/deleted.txt')
	expect(mcp.removeFileGrantsWithin).toHaveBeenCalledWith('/Home/deleted.txt')
	expect(deletionFinished).toBe(true)
	await expect(deletion).resolves.toBe(true)

	releaseIndexHint()
})

test('registers the same physical member roots with Watcher and FileIndex', async () => {
	const dataDirectory = await temporary.create()
	const error = vi.fn()
	const files = new Files({
		dataDirectory,
		logger: {createChildLogger: () => ({error})},
		eventBus: {emit: vi.fn()},
	} as unknown as Umbreld)
	const addPath = vi.fn(async () => {})
	const addRoot = vi.fn(async () => {})
	Object.assign(files, {
		watcher: {addPath},
		fileIndex: {addRoot},
		chownSystemPath: vi.fn(async () => {}),
	})

	await files.createMemberDirectories('alice')

	expect(addPath.mock.calls).toStrictEqual([[`/Users/alice`], [`/Users/alice/Trash`]])
	expect(addRoot.mock.calls).toStrictEqual([
		[
			{
				virtualPath: '/Users/alice',
				systemPath: nodePath.join(dataDirectory, 'members/alice/home'),
				ownerId: 'alice',
				kind: 'home',
				searchEnabled: true,
			},
		],
		[
			{
				virtualPath: '/Users/alice/Trash',
				systemPath: nodePath.join(dataDirectory, 'members/alice/trash'),
				ownerId: 'alice',
				kind: 'trash',
				searchEnabled: false,
			},
		],
	])
})
