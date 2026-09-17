import {createHash} from 'node:crypto'
import nodePath from 'node:path'

import fse from 'fs-extra'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import Umbreld from '../../index.js'
import temporaryDirectory from '../utilities/temporary-directory.js'
import routes from './routes.js'
import type {Context} from '../server/trpc/context.js'

const SOURCE_ID = '11111111-1111-4111-8111-111111111111'
const libraryId = (accountId: string) =>
	`iphone:${createHash('sha256').update(accountId).update('\0').update(SOURCE_ID).digest('hex')}`

let temporary: ReturnType<typeof temporaryDirectory>
let dataDirectory: string
let umbreld: Umbreld

beforeEach(async () => {
	temporary = temporaryDirectory()
	dataDirectory = await temporary.create()
	await fse.ensureDir(nodePath.join(dataDirectory, 'home'))
	umbreld = new Umbreld({dataDirectory, port: 0, logLevel: 'silent'})
	vi.spyOn(umbreld.files.fileIndex, 'photosUpsertBackupSource').mockResolvedValue(true)
})

afterEach(async () => {
	await temporary.destroyRoot()
})

async function register() {
	return umbreld.photos.registerBackupSource({accountId: '0', sourceId: SOURCE_ID, suggestedName: 'iPhone'})
}

test('renames only the display name and retains it across reconnects and restarts', async () => {
	const original = await register()
	const key = 'ab'.repeat(32)
	const path = await umbreld.photos.prepareBackupResourcePath(original, key, 'heic')
	const systemPath = umbreld.files.virtualToSystemPathUnsafe(path)
	await fse.writeFile(systemPath, 'photo')
	const emit = vi.spyOn(umbreld.eventBus, 'emit')

	await expect(umbreld.photos.renameSource('0', libraryId('0'), '  Holiday phone  ')).resolves.toBe(true)
	const renamed = {...original, name: 'Holiday phone'}
	await expect(umbreld.store.get('photos.backupSources')).resolves.toEqual([renamed])
	expect(umbreld.files.fileIndex.photosUpsertBackupSource).toHaveBeenLastCalledWith(
		'0',
		libraryId('0'),
		'Holiday phone',
		original.createdAt,
	)
	expect(emit).toHaveBeenCalledWith('photos:change', {accountIds: ['0']})
	await expect(register()).resolves.toEqual(renamed)

	const restarted = new Umbreld({dataDirectory, port: 0, logLevel: 'silent'})
	vi.spyOn(restarted.files.fileIndex, 'photosUpsertBackupSource').mockResolvedValue(true)
	await expect(
		restarted.photos.registerBackupSource({
			accountId: '0',
			sourceId: SOURCE_ID,
			suggestedName: 'iPhone',
		}),
	).resolves.toEqual(renamed)
	expect(restarted.files.fileIndex.photosUpsertBackupSource).toHaveBeenLastCalledWith(
		'0',
		libraryId('0'),
		'Holiday phone',
		original.createdAt,
	)
	await expect(restarted.photos.prepareBackupResourcePath(renamed, key, 'heic')).resolves.toBe(path)
	await expect(fse.readFile(systemPath, 'utf8')).resolves.toBe('photo')
	await expect(fse.pathExists(nodePath.join(dataDirectory, 'home', 'Photos', 'Holiday phone'))).resolves.toBe(false)
})

test('cannot rename another account’s source or the built-in Umbrel source', async () => {
	const original = await register()
	vi.mocked(umbreld.files.fileIndex.photosUpsertBackupSource).mockClear()
	await expect(umbreld.photos.renameSource('Alice', libraryId('0'), 'Other phone')).resolves.toBe(false)
	await expect(umbreld.photos.renameSource('0', 'home', 'Other home')).resolves.toBe(false)
	await expect(umbreld.photos.renameSource('0', libraryId('Alice'), 'Other phone')).resolves.toBe(false)
	await expect(umbreld.store.get('photos.backupSources')).resolves.toEqual([original])
	expect(umbreld.files.fileIndex.photosUpsertBackupSource).not.toHaveBeenCalled()
})

test('does not revive a source with an unfinished removal', async () => {
	const original = await register()
	await umbreld.store.set('photos.backupSourceRemovals', [
		{
			accountId: '0',
			sourceId: SOURCE_ID,
			keepItems: true,
			createdAt: Date.now(),
		},
	])
	vi.mocked(umbreld.files.fileIndex.photosUpsertBackupSource).mockClear()
	await expect(umbreld.photos.renameSource('0', libraryId('0'), 'New name')).resolves.toBe(false)
	await expect(umbreld.store.get('photos.backupSources')).resolves.toEqual([original])
	expect(umbreld.files.fileIndex.photosUpsertBackupSource).not.toHaveBeenCalled()
})

test('shares the source lock with uploads and re-reads the record before saving', async () => {
	const original = await register()
	let release!: () => void
	let started!: () => void
	const ready = new Promise<void>((resolve) => {
		started = resolve
	})
	const held = new Promise<void>((resolve) => {
		release = resolve
	})
	const upload = umbreld.photos.withBackupSource('0', SOURCE_ID, async () => {
		started()
		await held
		// A source removed while rename waits must not be written back from its stale read.
		await umbreld.store.set('photos.backupSources', [])
	})
	await ready
	vi.mocked(umbreld.files.fileIndex.photosUpsertBackupSource).mockClear()
	const writeLock = vi.spyOn(umbreld.store, 'getWriteLock')
	const sourceRead = Promise.resolve([original])
	vi.spyOn(umbreld.store, 'get').mockReturnValueOnce(sourceRead)
	const rename = umbreld.photos.renameSource('0', libraryId('0'), 'New name')
	try {
		// Rename awaits this same resolved read first, so its continuation attempts
		// the source lock before this one runs. No disk or timer timing assumption.
		await sourceRead
		expect(writeLock).not.toHaveBeenCalled()
		expect(umbreld.files.fileIndex.photosUpsertBackupSource).not.toHaveBeenCalled()
	} finally {
		release()
	}
	await upload
	await expect(rename).resolves.toBe(false)
	await expect(umbreld.store.get('photos.backupSources')).resolves.toEqual([])
})

test('can retry a rename if updating the Photos database fails', async () => {
	const original = await register()
	vi.mocked(umbreld.files.fileIndex.photosUpsertBackupSource).mockRejectedValueOnce(new Error('Database unavailable'))
	await expect(umbreld.photos.renameSource('0', libraryId('0'), 'New name')).rejects.toThrow('Database unavailable')
	await expect(umbreld.store.get('photos.backupSources')).resolves.toEqual([{...original, name: 'New name'}])
	vi.mocked(umbreld.files.fileIndex.photosUpsertBackupSource).mockClear()
	await expect(umbreld.photos.renameSource('0', libraryId('0'), 'New name')).resolves.toBe(true)
	expect(vi.mocked(umbreld.files.fileIndex.photosUpsertBackupSource).mock.calls).toEqual([
		['0', libraryId('0'), 'New name', original.createdAt],
	])
})

function caller() {
	const principal = {sessionId: 'session', accountId: '0', actor: 'account'} as const
	vi.spyOn(umbreld.auth, 'authenticateApiCredentials').mockResolvedValue(principal)
	return routes.createCaller({
		umbreld,
		transport: 'express',
		request: {headers: {authorization: 'Bearer access'}},
		principal,
		logger: {verbose: vi.fn(), error: vi.fn()},
		dangerouslyBypassAuthentication: false,
	} as unknown as Context)
}

test('the route uses the signed-in account and reports missing sources', async () => {
	const original = await register()
	const api = caller()
	await expect(api.sources.rename({id: libraryId('0'), name: '  李娜’s iPhone  '})).resolves.toBeUndefined()
	await expect(umbreld.photos.getBackupSource('0', SOURCE_ID)).resolves.toEqual({...original, name: '李娜’s iPhone'})
	await expect(api.sources.rename({id: libraryId('Alice'), name: 'Phone'})).rejects.toMatchObject({code: 'NOT_FOUND'})
})

test.each(['', '   ', 'a'.repeat(101), 'Bad\nname', 'Bad\0name', 'Bad\x7fname'])(
	'the route rejects invalid name %j without changing the saved source',
	async (name) => {
		const original = await register()
		await expect(caller().sources.rename({id: libraryId('0'), name})).rejects.toMatchObject({code: 'BAD_REQUEST'})
		await expect(umbreld.store.get('photos.backupSources')).resolves.toEqual([original])
	},
)
