import {EventEmitter} from 'node:events'
import nodePath from 'node:path'
import {writeFile} from 'node:fs/promises'
import type {Worker} from 'node:worker_threads'

import BetterSqlite3 from 'better-sqlite3'
import fse from 'fs-extra'
import pRetry from 'p-retry'
import {afterEach, expect, test, vi} from 'vitest'

import temporaryDirectory from '../utilities/temporary-directory.js'
import FileIndex, {type FileIndexRoot} from './file-index.js'
import type {
	FileIndexRequestMethod,
	FileIndexWorkerInboundMessage,
	FileIndexWorkerOutboundMessage,
} from './file-index-worker-protocol.js'

const temporary = temporaryDirectory()
const indexes: FileIndex[] = []
const logger = {log: vi.fn(), verbose: vi.fn(), error: vi.fn()}

afterEach(async () => {
	await Promise.all(indexes.splice(0).map((index) => index.stop()))
	await temporary.destroyRoot()
	vi.clearAllMocks()
})

async function fixture() {
	const dataDirectory = await temporary.create()
	const homeDirectory = nodePath.join(dataDirectory, 'home')
	await fse.ensureDir(homeDirectory)
	const root: FileIndexRoot = {
		virtualPath: '/Home',
		systemPath: homeDirectory,
		ownerId: 'owner',
		kind: 'home',
		searchEnabled: true,
	}
	const index = new FileIndex({
		dataDirectory,
		logger,
		hiddenFiles: ['.hidden'],
		hiddenExtensions: ['.umbrel-upload'],
	})
	indexes.push(index)
	await index.setRoots([root])
	return {dataDirectory, homeDirectory, index, root}
}

test('owns crawling, SQLite, and search in a dedicated worker', async () => {
	const {homeDirectory, index} = await fixture()
	await writeFile(nodePath.join(homeDirectory, 'worker-result.txt'), 'visible')
	await writeFile(nodePath.join(homeDirectory, '.hidden'), 'hidden')

	await index.start()
	await index.reconcileRoot('/Home', 'test')

	expect(index.available).toBe(true)
	expect(index.workerThreadId).toBeGreaterThan(0)
	await expect(index.getEntryByVirtualPath('/Home/worker-result.txt')).resolves.toMatchObject({
		name: 'worker-result.txt',
		size: 7,
	})
	await expect(index.searchCandidates('/Home', 'worker-result', 10)).resolves.toEqual([
		expect.objectContaining({name: 'worker-result.txt'}),
	])
	await expect(index.recentCandidates('/Home', 10, [])).resolves.toEqual([
		expect.objectContaining({name: 'worker-result.txt'}),
	])
	await expect(index.directorySizes(['/Home'])).resolves.toStrictEqual([{virtualPath: '/Home', size: 13}])
	await expect(index.searchCandidates('/Home', 'hidden', 10)).resolves.toStrictEqual([])
	await expect(index.status()).resolves.toMatchObject({
		available: true,
		entryCount: 2,
		workerThreadId: index.workerThreadId,
	})
})

test('rebuilds the filesystem index and enrichment artifacts from scratch', async () => {
	const {dataDirectory, homeDirectory, index} = await fixture()
	const sourcePath = nodePath.join(homeDirectory, 'rebuild.png')
	await writeFile(sourcePath, 'image-like source')

	await index.start()
	await index.reconcileRoot('/Home', 'rebuild-fixture')
	await index.photosSummary('owner')
	const previousReaders = (await index.status()).readers!.threadIds
	expect(previousReaders.length).toBeGreaterThan(0)
	const indexSentinel = nodePath.join(dataDirectory, 'file-index', 'stale-index-state')
	const thumbnailSentinel = nodePath.join(dataDirectory, 'thumbnails', 'stale-enrichment-artifact')
	await writeFile(indexSentinel, 'stale')
	await writeFile(thumbnailSentinel, 'stale')

	await index.rebuild()
	await index.photosSummary('owner')
	const nextReaders = (await index.status()).readers!.threadIds
	expect(nextReaders.length).toBeGreaterThan(0)
	expect(nextReaders.every((id) => !previousReaders.includes(id))).toBe(true)

	await expect(fse.pathExists(indexSentinel)).resolves.toBe(false)
	await expect(fse.pathExists(thumbnailSentinel)).resolves.toBe(false)
	await expect(fse.pathExists(sourcePath)).resolves.toBe(true)
	await pRetry(
		async () => {
			await expect(index.getEntryByVirtualPath('/Home/rebuild.png')).resolves.toMatchObject({
				name: 'rebuild.png',
			})
			await expect(index.status()).resolves.toMatchObject({enrichment: {hashedEntries: 1}})
		},
		{retries: 100, factor: 1, minTimeout: 100, maxTimeout: 100},
	)
})

test('routes the complete Photos repository surface through the worker boundary', async () => {
	const {dataDirectory, index} = await fixture()
	await index.start()
	await index.reconcileRoot('/Home', 'photos-worker')
	await index.initializePhotos('owner')

	await expect(index.photosIndexingState('owner')).resolves.toMatchObject({phase: 'ready', total: 0})
	await expect(index.photosSummary('owner')).resolves.toMatchObject({counts: {items: 0}})
	const album = await index.photosCreateAlbum('owner', 'Worker album')
	await expect(index.photosListAlbums('owner')).resolves.toContainEqual(
		expect.objectContaining({id: album.id, name: 'Worker album'}),
	)
	await expect(index.photosListSources('owner')).resolves.toContainEqual(
		expect.objectContaining({type: 'umbrel', stats: {photos: 0, videos: 0, sizeBytes: 0}}),
	)

	const backupPath = nodePath.join(dataDirectory, '.umbrel-backup', 'umbrel.db')
	await index.createUmbrelDatabaseBackup(backupPath)
	const snapshot = new BetterSqlite3(backupPath, {readonly: true})
	expect(snapshot.pragma('quick_check', {simple: true})).toBe('ok')
	expect(snapshot.prepare('SELECT name FROM photos_albums WHERE id = ?').get(album.id)).toStrictEqual({
		name: 'Worker album',
	})
	snapshot.close()
})

test('keeps the main event loop responsive during CPU-heavy fuzzy searches', async () => {
	const {dataDirectory, index, root} = await fixture()
	await index.start()
	await index.stop()
	indexes.splice(indexes.indexOf(index), 1)

	const database = new BetterSqlite3(index.databasePath)
	const rootId = (database.prepare("SELECT id FROM index_roots WHERE virtual_path = '/Home'").get() as {id: number}).id
	database
		.prepare(
			`WITH RECURSIVE sequence(value) AS (
				VALUES(1)
				UNION ALL SELECT value + 1 FROM sequence WHERE value < 100000
			)
			INSERT INTO entries(root_id, relative_path, name, search_name, type, size, modified_ms, hidden)
			SELECT ?, printf('bulk/%06d.txt', value), printf('worker-isolation-%06d.txt', value),
				printf('worker-isolation-%06d.txt', value), 'file', 1, 1, 0
			FROM sequence`,
		)
		.run(rootId)
	database.close()

	const reopened = new FileIndex({
		dataDirectory,
		logger,
		hiddenFiles: [],
		hiddenExtensions: [],
	})
	indexes.push(reopened)
	await reopened.setRoots([root])
	await reopened.start()

	let heartbeats = 0
	const heartbeat = setInterval(() => heartbeats++, 1)
	try {
		await Promise.all(
			Array.from({length: 4}, (_, index) => reopened.searchCandidates('/Home', `worker-isolation-${index}`, 10)),
		)
	} finally {
		clearInterval(heartbeat)
	}

	// One timer tick is enough to prove the searches did not monopolize the main
	// thread. Requiring an arbitrary number makes the assertion fail when the
	// indexed query becomes faster, especially under CI coverage instrumentation.
	expect(heartbeats).toBeGreaterThan(0)
})

class FakeWorker extends EventEmitter {
	readonly messages: FileIndexWorkerInboundMessage[] = []
	readonly threadId: number
	#heldMethods = new Set<string>()

	constructor(threadId: number) {
		super()
		this.threadId = threadId
		queueMicrotask(() => this.emitMessage({type: 'ready', threadId}))
	}

	hold(method: string) {
		this.#heldMethods.add(method)
	}

	release(method: FileIndexRequestMethod) {
		this.#heldMethods.delete(method)
		const request = this.messages.findLast(
			(message): message is Extract<FileIndexWorkerInboundMessage, {type: 'request'}> =>
				message.type === 'request' && message.method === method,
		)
		if (!request) throw new Error(`No pending '${method}' request`)
		queueMicrotask(() => this.emitMessage({type: 'response', id: request.id, result: undefined}))
	}

	postMessage(message: FileIndexWorkerInboundMessage) {
		this.messages.push(message)
		if (message.type !== 'request' || this.#heldMethods.has(message.method)) return
		queueMicrotask(() => {
			if (message.method === 'start') this.emitMessage({type: 'availability', available: true})
			this.emitMessage({
				type: 'response',
				id: message.id,
				result: ['directorySizes', 'recentCandidates', 'searchCandidates'].includes(message.method) ? [] : undefined,
			})
		})
	}

	crash() {
		this.emit('exit', 1)
	}

	photosChanged(accountIds = ['Alice']) {
		this.emitMessage({type: 'photos-change', accountIds})
	}

	photosIndexingProgress() {
		this.emitMessage({
			type: 'photos-indexing-progress',
			progress: [{accountId: 'Alice', state: {phase: 'enriching', completed: 1, total: 2, percentage: 50}}],
		})
	}

	async terminate() {
		this.emit('exit', 0)
		return 0
	}

	private emitMessage(message: FileIndexWorkerOutboundMessage) {
		this.emit('message', message)
	}
}

test('forwards Photos library changes from the worker to the main process', async () => {
	const dataDirectory = await temporary.create()
	const worker = new FakeWorker(1)
	const onPhotosChange = vi.fn()
	const index = new FileIndex(
		{dataDirectory, logger, hiddenFiles: [], hiddenExtensions: [], onPhotosChange},
		{createWorker: () => worker as unknown as Worker},
	)
	indexes.push(index)
	await index.start()

	worker.photosChanged()
	expect(onPhotosChange).toHaveBeenCalledOnce()
	expect(onPhotosChange).toHaveBeenCalledWith(['Alice'])
})

test('forwards Photos indexing progress from the worker to the main process', async () => {
	const dataDirectory = await temporary.create()
	const worker = new FakeWorker(1)
	const onPhotosIndexingProgress = vi.fn()
	const index = new FileIndex(
		{dataDirectory, logger, hiddenFiles: [], hiddenExtensions: [], onPhotosIndexingProgress},
		{createWorker: () => worker as unknown as Worker},
	)
	indexes.push(index)
	await index.start()

	worker.photosIndexingProgress()
	expect(onPhotosIndexingProgress).toHaveBeenCalledOnce()
	expect(onPhotosIndexingProgress).toHaveBeenCalledWith([
		{accountId: 'Alice', state: {phase: 'enriching', completed: 1, total: 2, percentage: 50}},
	])
})

test('compacts watcher bursts and restores state after an unexpected worker exit', async () => {
	const dataDirectory = await temporary.create()
	const workers: FakeWorker[] = []
	const createWorker = () => {
		const worker = new FakeWorker(workers.length + 1)
		workers.push(worker)
		return worker as unknown as Worker
	}
	const root: FileIndexRoot = {
		virtualPath: '/Home',
		systemPath: nodePath.join(dataDirectory, 'home'),
		ownerId: 'owner',
		kind: 'home',
		searchEnabled: true,
	}
	const index = new FileIndex(
		{dataDirectory, logger, hiddenFiles: [], hiddenExtensions: [], watcherBulkThreshold: 250},
		{createWorker, workerRestartDelayMs: 1},
	)
	indexes.push(index)
	await index.setRoots([root])
	index.startBackgroundReconciliation()
	await index.start()
	await index.initializePhotos('owner')

	workers[0].messages.length = 0
	index.noteWatcherChanges(
		'/Home',
		Array.from({length: 249}, (_, index) => ({path: `${root.systemPath}/${index}`, type: 'create' as const})),
	)
	index.noteWatcherChanges(
		'/Home',
		Array.from({length: 250}, (_, index) => ({path: `${root.systemPath}/bulk-${index}`, type: 'create' as const})),
	)
	expect(workers[0].messages).toStrictEqual([
		{
			type: 'notification',
			method: 'noteWatcherChanges',
			args: ['/Home', Array.from({length: 249}, (_, index) => ({path: `${root.systemPath}/${index}`, type: 'create'}))],
		},
		{type: 'notification', method: 'noteWatcherBurst', args: ['/Home']},
	])

	workers[0].hold('searchCandidates')
	const interruptedSearch = index.searchCandidates('/Home', 'pending', 10)
	workers[0].crash()
	await expect(interruptedSearch).rejects.toThrow('exited with code 1')
	await pRetry(
		async () => {
			expect(workers).toHaveLength(2)
			expect(index.available).toBe(true)
			expect(index.workerThreadId).toBe(2)
		},
		{retries: 20, factor: 1, minTimeout: 5, maxTimeout: 5},
	)
	expect(workers[1].messages).toEqual(
		expect.arrayContaining([
			expect.objectContaining({type: 'request', method: 'setRoots', args: [[root]]}),
			expect.objectContaining({type: 'request', method: 'start'}),
			expect.objectContaining({
				type: 'request',
				method: 'enableThumbnailVariants',
				args: [['preview-192-webp-v1', 'preview-512-webp-v2', 'preview-1280-webp-v2']],
			}),
			{type: 'notification', method: 'startBackgroundReconciliation', args: []},
		]),
	)
})

test('restarts when a live worker stalls during boot', async () => {
	const dataDirectory = await temporary.create()
	const workers: FakeWorker[] = []
	const createWorker = () => {
		const worker = new FakeWorker(workers.length + 1)
		if (workers.length === 0) worker.hold('setRoots')
		workers.push(worker)
		return worker as unknown as Worker
	}
	const index = new FileIndex(
		{dataDirectory, logger, hiddenFiles: [], hiddenExtensions: []},
		{createWorker, workerRestartDelayMs: 1, workerBootTimeoutMs: 5},
	)
	indexes.push(index)

	await index.start()
	await pRetry(
		async () => {
			expect(workers).toHaveLength(2)
			expect(index.available).toBe(true)
			expect(index.workerThreadId).toBe(2)
		},
		{retries: 20, factor: 1, minTimeout: 5, maxTimeout: 5},
	)
	expect(logger.error).toHaveBeenCalledWith('Failed to start file index worker', expect.any(Error))
})

test('does not dispatch public work until worker initialization completes', async () => {
	const dataDirectory = await temporary.create()
	let worker!: FakeWorker
	const index = new FileIndex(
		{dataDirectory, logger, hiddenFiles: [], hiddenExtensions: []},
		{
			createWorker: () => {
				worker = new FakeWorker(1)
				worker.hold('setRoots')
				return worker as unknown as Worker
			},
		},
	)
	indexes.push(index)
	await index.setRoots([
		{
			virtualPath: '/Home',
			systemPath: nodePath.join(dataDirectory, 'home'),
			ownerId: 'owner',
			kind: 'home',
			searchEnabled: true,
		},
	])

	const starting = index.start()
	await vi.waitFor(() => expect(worker.messages).toContainEqual(expect.objectContaining({method: 'setRoots'})))
	await expect(index.searchCandidates('/Home', 'photo', 10)).rejects.toThrow('File index worker is unavailable')
	await expect(index.recentCandidates('/Home', 10)).rejects.toThrow('File index worker is unavailable')
	await expect(index.directorySizes(['/Home'])).resolves.toStrictEqual([])
	await expect(index.movePathRequired('/home/source', '/home/destination')).rejects.toThrow('[file-index-unavailable]')
	await expect(index.ensureThumbnail('/data/photo.jpg')).rejects.toThrow('File index worker is unavailable')
	await expect(index.getExistingThumbnail('/data/photo.jpg')).resolves.toBeUndefined()
	index.scheduleFullReconciliation('boot-race')
	expect(worker.messages.some((message) => message.type === 'request' && message.method === 'searchCandidates')).toBe(
		false,
	)
	expect(worker.messages.some((message) => message.type === 'request' && message.method === 'recentCandidates')).toBe(
		false,
	)
	expect(worker.messages.some((message) => message.type === 'request' && message.method === 'directorySizes')).toBe(
		false,
	)
	expect(worker.messages.some((message) => message.type === 'notification')).toBe(false)

	worker.release('setRoots')
	await starting
	await expect(index.searchCandidates('/Home', 'photo', 10)).resolves.toStrictEqual([])
	await expect(index.recentCandidates('/Home', 10)).resolves.toStrictEqual([])
})

test('stops without waiting for a worker stalled during boot', async () => {
	const dataDirectory = await temporary.create()
	const worker = new FakeWorker(1)
	worker.hold('setRoots')
	const index = new FileIndex(
		{dataDirectory, logger, hiddenFiles: [], hiddenExtensions: []},
		{createWorker: () => worker as unknown as Worker, workerBootTimeoutMs: 60_000},
	)
	indexes.push(index)

	const starting = index.start()
	await vi.waitFor(() => expect(worker.messages).toContainEqual(expect.objectContaining({method: 'setRoots'})))
	await expect(index.stop()).resolves.toBeUndefined()
	await expect(starting).resolves.toBeUndefined()
	await expect(index.status()).resolves.toMatchObject({available: false, workerThreadId: undefined})
})

test('forcibly terminates a worker that stalls during graceful shutdown', async () => {
	const dataDirectory = await temporary.create()
	const worker = new FakeWorker(1)
	const index = new FileIndex(
		{dataDirectory, logger, hiddenFiles: [], hiddenExtensions: []},
		{createWorker: () => worker as unknown as Worker, workerShutdownTimeoutMs: 5},
	)
	indexes.push(index)
	await index.start()
	worker.hold('stop')

	await expect(index.stop()).resolves.toBeUndefined()
	expect(logger.error).toHaveBeenCalledWith('Failed to stop file index worker cleanly', expect.any(Error))
	await expect(index.status()).resolves.toMatchObject({available: false, workerThreadId: undefined})
})
