import nodePath from 'node:path'

import fse from 'fs-extra'
import {afterAll, beforeAll, beforeEach, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import getLiveDirectorySize from '../utilities/get-directory-size.js'
import temporaryDirectory from '../utilities/temporary-directory.js'
import Files, {type File} from './files.js'

vi.mock('../utilities/get-directory-size.js', () => ({default: vi.fn()}))

const temporary = temporaryDirectory()

beforeAll(temporary.createRoot)
afterAll(temporary.destroyRoot)

function fixture(memberIds: string[] = [], dataDirectory = '/tmp/umbreld-indexed-directory-sizes-test') {
	const error = vi.fn()
	const files = new Files({
		dataDirectory,
		logger: {createChildLogger: () => ({error, log: vi.fn(), verbose: vi.fn()})},
		eventBus: {emit: vi.fn()},
		user: {listMembers: vi.fn(async () => memberIds.map((id) => ({id})))},
	} as unknown as Umbreld)
	return {dataDirectory, error, files}
}

beforeEach(() => {
	vi.mocked(getLiveDirectorySize).mockReset()
})

test('does not recursively watch Apps and retires the previous app root', () => {
	const {files} = fixture()
	expect(files.watcher.pathsToWatch.has('/Apps')).toBe(false)
	expect(files.watcher.pathsToWatch.has('/Home')).toBe(true)
	expect(files.watcher.pathsToWatch.has('/Trash')).toBe(true)
})

test('reports indexed sizes from status while leaving unindexed directories undefined', async () => {
	const dataDirectory = await temporary.create()
	const indexedDirectory = nodePath.join(dataDirectory, 'home', 'indexed')
	const emptyDirectory = nodePath.join(dataDirectory, 'home', 'empty')
	const externalDirectory = nodePath.join(dataDirectory, 'external', 'unindexed')
	await Promise.all([fse.ensureDir(indexedDirectory), fse.ensureDir(emptyDirectory), fse.ensureDir(externalDirectory)])
	const {files} = fixture([], dataDirectory)
	const indexedSizes = new Map([
		['/Home/indexed', 123],
		['/Home/empty', 0],
	])
	const directorySizes = vi.fn(async (paths: readonly string[]) =>
		paths.flatMap((virtualPath) => {
			const size = indexedSizes.get(virtualPath)
			return size === undefined ? [] : [{virtualPath, size}]
		}),
	)
	Object.assign(files, {
		fileIndex: {directorySizes},
		getAllowedOperations: vi.fn(async () => []),
		thumbnails: {getExistingThumbnail: vi.fn(async () => undefined)},
	})

	await expect(files.status(indexedDirectory)).resolves.toMatchObject({
		path: '/Home/indexed',
		type: 'directory',
		size: 123,
	})
	await expect(files.status(emptyDirectory)).resolves.toMatchObject({
		path: '/Home/empty',
		type: 'directory',
		size: 0,
	})
	await expect(files.status(externalDirectory)).resolves.toMatchObject({
		path: '/External/unindexed',
		type: 'directory',
		size: undefined,
	})
	expect(getLiveDirectorySize).not.toHaveBeenCalled()
})

test('annotates only directories for which the index returns a ready aggregate', async () => {
	const {files} = fixture()
	const directorySizes = vi.fn(async () => [
		{virtualPath: '/Home/indexed', size: 123},
		{virtualPath: '/Home/empty', size: 0},
	])
	Object.assign(files, {fileIndex: {directorySizes}})
	const entries: File[] = [
		{name: 'indexed', path: '/Home/indexed', type: 'directory', size: undefined, modified: 1, operations: []},
		{name: 'empty', path: '/Home/empty', type: 'directory', size: undefined, modified: 1, operations: []},
		{name: 'external', path: '/External/external', type: 'directory', size: undefined, modified: 1, operations: []},
		{name: 'file.txt', path: '/Home/file.txt', type: 'text/plain', size: 7, modified: 1, operations: []},
	]

	await expect(files.annotateIndexedDirectorySizes(entries)).resolves.toStrictEqual([
		{...entries[0], size: 123},
		{...entries[1], size: 0},
		entries[2],
		entries[3],
	])
	expect(directorySizes).toHaveBeenCalledWith(['/Home/indexed', '/Home/empty', '/External/external'])
	expect(getLiveDirectorySize).not.toHaveBeenCalled()
})

test('does not disclose unshared directory sizes through member share ancestors', async () => {
	const dataDirectory = await temporary.create()
	await Promise.all([
		fse.ensureDir(nodePath.join(dataDirectory, 'home', 'Media', 'Shared')),
		fse.ensureDir(nodePath.join(dataDirectory, 'home', 'Direct')),
	])
	const {files} = fixture([], dataDirectory)
	const indexedSizes = new Map([
		['/Home', 1_000],
		['/Home/Media', 800],
		['/Home/Direct', 200],
	])
	const directorySizes = vi.fn(async (paths: readonly string[]) =>
		paths.flatMap((virtualPath) => {
			const size = indexedSizes.get(virtualPath)
			return size === undefined ? [] : [{virtualPath, size}]
		}),
	)
	const shareGrantFor = vi.fn(async (virtualPath: string) =>
		virtualPath === '/Home/Direct' ? {path: virtualPath, sharedWith: ['alice']} : undefined,
	)
	Object.assign(files, {
		fileIndex: {directorySizes},
		memberShares: {
			shareGrantFor,
			visibleChildrenFor: vi.fn(async () => ['Media', 'Direct']),
		},
		getAllowedOperations: vi.fn(async () => []),
		thumbnails: {getExistingThumbnail: vi.fn(async () => undefined)},
	})

	const listing = await files.list('/Home', 'alice')

	expect(listing.size).toBeUndefined()
	expect(listing.files.find(({path}) => path === '/Home/Media')?.size).toBeUndefined()
	expect(listing.files.find(({path}) => path === '/Home/Direct')?.size).toBe(200)
	expect(directorySizes).toHaveBeenCalledTimes(1)
	expect(directorySizes).toHaveBeenCalledWith(['/Home/Direct'])
})

test('counts owner and member Home and Trash roots, falling back per unavailable aggregate', async () => {
	const {dataDirectory, files} = fixture(['alice', 'bob'])
	const directorySizes = vi.fn(async () => [
		{virtualPath: '/Home', size: 10},
		{virtualPath: '/Users/alice', size: 20},
		{virtualPath: '/Users/alice/Trash', size: 30},
		{virtualPath: '/Users/bob', size: 40},
		{virtualPath: '/Users/bob/Trash', size: 50},
	])
	Object.assign(files, {fileIndex: {directorySizes}})
	vi.mocked(getLiveDirectorySize).mockImplementation(async (systemPath) => {
		if (systemPath === nodePath.join(dataDirectory, 'trash')) return 60
		if (systemPath === nodePath.join(dataDirectory, 'thumbnails')) return 70
		throw new Error(`Unexpected live directory walk: ${systemPath}`)
	})

	await expect(files.getStorageUsage()).resolves.toBe(280)
	expect(directorySizes).toHaveBeenCalledWith([
		'/Home',
		'/Trash',
		'/Users/alice',
		'/Users/alice/Trash',
		'/Users/bob',
		'/Users/bob/Trash',
	])
	expect(getLiveDirectorySize).toHaveBeenCalledTimes(2)
	expect(getLiveDirectorySize).not.toHaveBeenCalledWith(expect.stringContaining('external'))
	expect(getLiveDirectorySize).not.toHaveBeenCalledWith(expect.stringContaining('network'))
})

test('falls back independently for every Files root while the index is unavailable', async () => {
	const {files} = fixture(['alice'])
	Object.assign(files, {fileIndex: {directorySizes: vi.fn(async () => [])}})
	vi.mocked(getLiveDirectorySize).mockResolvedValue(5)

	await expect(files.getStorageUsage()).resolves.toBe(25)
	expect(getLiveDirectorySize).toHaveBeenCalledTimes(5)
})
