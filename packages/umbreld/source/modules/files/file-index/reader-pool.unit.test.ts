import {EventEmitter} from 'node:events'
import nodePath from 'node:path'
import {lstat, mkdir, writeFile} from 'node:fs/promises'
import type {Worker} from 'node:worker_threads'

import PQueue from 'p-queue'
import {afterEach, expect, test, vi} from 'vitest'

import FileIndexReaderPool, {type FileIndexReaderPoolOptions} from './reader-pool.js'
import FileIndexReader, {type FileIndexReadArgs} from './reader.js'
import type {SqlRead} from './read-database.js'
import type {FileIndexReaderRequest, FileIndexReaderResponse} from './reader-worker.js'
import FileIndexEngine, {type FileIndexEngineOptions} from '../file-index-engine.js'
import temporaryDirectory from '../../utilities/temporary-directory.js'

class FakeReader extends EventEmitter {
	messages: FileIndexReaderRequest[] = []
	constructor(
		readonly threadId: number,
		ready = true,
	) {
		super()
		if (ready) queueMicrotask(() => this.emit('message', {type: 'ready'}))
	}
	postMessage(message: FileIndexReaderRequest) {
		this.messages.push(message)
	}
	reply(message: FileIndexReaderResponse) {
		this.emit('message', message)
	}
	snapshot() {
		this.reply({type: 'snapshot', id: this.messages.at(-1)!.id})
	}
	finish(result: unknown) {
		this.reply({type: 'result', id: this.messages.at(-1)!.id, result})
	}
	async terminate() {
		this.emit('exit', 0)
		return 0
	}
}

const pools: FileIndexReaderPool[] = []
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
	await Promise.all(pools.splice(0).map((pool) => pool.stop()))
	for (const close of cleanup.splice(0).reverse()) await close()
	vi.restoreAllMocks()
	vi.useRealTimers()
})

function fixture({
	size,
	reservedReaders,
	ready = true,
	timeout = 1000,
}: Pick<FileIndexReaderPoolOptions, 'size' | 'reservedReaders'> & {
	ready?: boolean
	timeout?: number
} = {}) {
	const workers: FakeReader[] = []
	const pool = new FileIndexReaderPool(
		{databasePath: 'unused-index', umbrelDatabasePath: 'unused-umbrel'},
		{
			size,
			reservedReaders,
			startupTimeoutMs: timeout,
			snapshotTimeoutMs: timeout,
			createWorker: () => {
				const worker = new FakeReader(workers.length + 1, ready)
				workers.push(worker)
				return worker as unknown as Worker
			},
		},
	)
	pools.push(pool)
	return {pool, workers}
}

const directly = (begin: () => Promise<void>) => begin()

test('startup waits for both readers before any query and reuses their workers', async () => {
	const {pool, workers} = fixture({ready: false})
	const started = vi.fn()
	const starting = pool.start().then(started)
	expect(workers).toHaveLength(2)
	expect(workers.every((worker) => worker.messages.length === 0)).toBe(true)
	workers[0]!.reply({type: 'ready'})
	await new Promise<void>((resolve) => setImmediate(resolve))
	expect(started).not.toHaveBeenCalled()
	workers[1]!.reply({type: 'ready'})
	await starting
	await pool.start()
	expect(pool.status()).toEqual({threadIds: [1, 2], active: 0, queued: 0})
	expect(workers).toHaveLength(2)
	await pool.stop()
	await expect(pool.start()).rejects.toThrow('stopped')
	expect(pool.status().threadIds).toEqual([])
})

test.each(['crash', 'timeout'] as const)(
	'startup %s closes every reader, including workers already ready',
	async (failure) => {
		vi.useFakeTimers()
		const {pool, workers} = fixture({ready: false, timeout: 10})
		const starting = pool.start()
		const rejected = expect(starting).rejects.toThrow(failure === 'crash' ? 'startup crash' : 'startup timed out')
		const terminated = workers.map((worker) => vi.spyOn(worker, 'terminate'))
		workers[0]!.reply({type: 'ready'})
		if (failure === 'crash') workers[1]!.emit('error', new Error('startup crash'))
		else await vi.advanceTimersByTimeAsync(20)
		await rejected
		expect(terminated.every((terminate) => terminate.mock.calls.length === 1)).toBe(true)
		expect(pool.status().threadIds).toEqual([])
		await expect(pool.read('getItem', ['owner', 'item'], directly)).rejects.toThrow('stopped')
	},
)

test('shutdown during startup closes ready and starting readers', async () => {
	const {pool, workers} = fixture({ready: false})
	const starting = pool.start()
	const rejected = expect(starting).rejects.toThrow('stopped')
	workers[0]!.reply({type: 'ready'})
	await pool.stop()
	await rejected
	expect(pool.status().threadIds).toEqual([])
})

async function engineFixture(options: Partial<FileIndexEngineOptions> = {}) {
	const temporary = temporaryDirectory()
	const dataDirectory = await temporary.create()
	const home = nodePath.join(dataDirectory, 'home')
	await mkdir(home)
	const workers: FakeReader[] = []
	const index = new FileIndexEngine({
		dataDirectory,
		logger: {log() {}, verbose() {}, error() {}},
		isHidden: () => false,
		...options,
		readerPoolOptions: {
			createWorker: () => {
				const worker = new FakeReader(workers.length + 1)
				workers.push(worker)
				return worker as unknown as Worker
			},
		},
	})
	cleanup.push(async () => {
		await index.stop()
		await temporary.destroyRoot()
	})
	await index.setRoots([{virtualPath: '/Home', systemPath: home, ownerId: 'owner', kind: 'home', searchEnabled: true}])
	await index.start()
	return {index, workers, home}
}

test('the engine starts both readers before becoming available without a read request', async () => {
	const {index, workers} = await engineFixture()
	expect(index.available).toBe(true)
	expect(workers).toHaveLength(2)
	expect(workers.every((worker) => worker.messages.length === 0)).toBe(true)
	const terminated = workers.map((worker) => vi.spyOn(worker, 'terminate'))
	await index.stop()
	expect(terminated.every((terminate) => terminate.mock.calls.length === 1)).toBe(true)
})

test('Photos preparation passes queued scan writes without overtaking an earlier user mutation', async () => {
	let releaseWalk!: () => void
	const walkGate = new Promise<void>((resolve) => (releaseWalk = resolve))
	let walking!: () => void
	const walkStarted = new Promise<void>((resolve) => (walking = resolve))
	const {index, workers, home} = await engineFixture({
		batchSize: 1,
		walkTree: async function* (root) {
			const systemPath = nodePath.join(root, 'scanned.txt')
			const stats = await lstat(systemPath)
			walking()
			await walkGate
			yield {systemPath, stats}
		},
	})
	const reader = new FileIndexReader({databasePath: index.databasePath, umbrelDatabasePath: index.umbrelDatabasePath})
	cleanup.push(async () => reader.close())
	await writeFile(nodePath.join(home, 'scanned.txt'), 'scan result')
	const scan = index.reconcileRoot('/Home', 'priority-test')
	const scanResult = Promise.allSettled([scan])
	await walkStarted

	// Delay one snapshot acknowledgement to hold the real writer queue.
	const first = index.photosGetItem('owner', 'item')
	const firstResult = Promise.allSettled([first])
	await vi.waitFor(() => expect(workers[0]?.messages).toHaveLength(1))
	releaseWalk()
	await new Promise<void>((resolve) => setImmediate(resolve))
	const mutation = index.photosCreateAlbum('owner', 'Before the read')
	const albums = index.photosListAlbums('owner')
	const results = Promise.allSettled([mutation, albums])
	await vi.waitFor(() => expect(workers).toHaveLength(2))
	await new Promise<void>((resolve) => setImmediate(resolve))
	workers[0]!.snapshot()
	await vi.waitFor(() => expect(workers[1]?.messages).toHaveLength(1))

	reader.beginSnapshot()
	const visibleAlbums = reader.read('listAlbums', ['owner'])
	expect(visibleAlbums).toContainEqual(expect.objectContaining({name: 'Before the read'}))
	expect(
		reader.read('sql', [{sql: "SELECT COUNT(*) AS count FROM entries WHERE name = 'scanned.txt'", parameters: []}]),
	).toEqual({count: 0})
	reader.endSnapshot()
	workers[1]!.snapshot()
	workers[1]!.finish(visibleAlbums)
	workers[0]!.finish(undefined)
	expect((await results).every((result) => result.status === 'fulfilled')).toBe(true)
	expect((await firstResult)[0]!.status).toBe('fulfilled')
	expect((await scanResult)[0]!.status).toBe('fulfilled')
	reader.beginSnapshot()
	expect(
		reader.read('sql', [{sql: "SELECT COUNT(*) AS count FROM entries WHERE name = 'scanned.txt'", parameters: []}]),
	).toEqual({count: 1})
	reader.endSnapshot()
})

test.each(['getEntryByVirtualPath', 'getEntryBySystemPath'] as const)(
	'%s shares FIFO priority with on-demand thumbnails during a burst',
	async (method) => {
		const {index, workers, home} = await engineFixture()
		const path = method === 'getEntryByVirtualPath' ? '/Home/item.txt' : nodePath.join(home, 'item.txt')
		const dispatch = vi.spyOn(FileIndexReaderPool.prototype, 'read')
		const first = index[method](path)
		const pool = dispatch.mock.contexts[0] as FileIndexReaderPool
		const scan = pool.read('summary', ['owner'], directly)
		const scanResult = Promise.allSettled([scan])
		await vi.waitFor(() => expect(workers.every((worker) => worker.messages.length === 1)).toBe(true))
		for (const worker of workers) worker.snapshot()
		const thumbnail = (id: number) =>
			pool.read('sql', [{sql: 'SELECT 1 FROM thumbnail_variants WHERE content_id = ?', parameters: [id]}], directly, {
				priority: 20,
			})
		const earlierThumbnail = thumbnail(0)
		const entry = index[method](path)
		const results = Promise.allSettled([
			first,
			earlierThumbnail,
			entry,
			...Array.from({length: 250}, (_, id) => thumbnail(id + 1)),
		])
		const worker = workers[0]!
		const postMessage = worker.postMessage.bind(worker)
		vi.spyOn(worker, 'postMessage').mockImplementation((message) => {
			postMessage(message)
			queueMicrotask(() => {
				worker.snapshot()
				worker.finish(undefined)
			})
		})
		worker.finish(undefined)
		expect((await results).every((result) => result.status === 'fulfilled')).toBe(true)
		const queries = worker.messages.slice(1).map(({args}) => args[0] as SqlRead)
		expect(queries[0]!.parameters).toEqual([0])
		expect(queries[1]!.sql).toContain('entries.relative_path = ?')
		expect(queries[1]!.parameters.at(-1)).toBe('item.txt')
		expect(queries.slice(2).map(({parameters}) => parameters[0])).toEqual(Array.from({length: 250}, (_, id) => id + 1))
		workers[1]!.finish([])
		expect((await scanResult)[0]!.status).toBe('fulfilled')
	},
)

test('two slow reads run concurrently and queued reads never hold the writer queue', async () => {
	const {pool, workers} = fixture({size: 2, reservedReaders: 0})
	const writes = new PQueue({concurrency: 1})
	let preparations = 0
	const prepare = async (begin: () => Promise<void>) => {
		await writes.add(async () => {
			preparations++
			await begin()
		})
	}
	const first = pool.read('summary', ['owner'], prepare)
	const second = pool.read('summary', ['member'], prepare)
	const third = pool.read('summary', ['owner'], prepare)
	await vi.waitFor(() => expect(workers[0]?.messages).toHaveLength(1))
	let writeCompleted = false
	const write = writes.add(() => {
		writeCompleted = true
	})
	expect(writeCompleted).toBe(false)
	workers[0]!.snapshot()
	await vi.waitFor(() => expect(workers[1]?.messages).toHaveLength(1))
	workers[1]!.snapshot()
	await write
	// Neither SELECT has completed, but writes are now free to proceed.
	expect(writeCompleted).toBe(true)
	expect(preparations).toBe(2)
	expect(pool.status()).toMatchObject({active: 2, queued: 1})
	workers[0]!.finish('first')
	await expect(first).resolves.toBe('first')
	await vi.waitFor(() => expect(workers[0]!.messages).toHaveLength(2))
	workers[0]!.snapshot()
	workers[0]!.finish('third')
	workers[1]!.finish('second')
	await expect(Promise.all([second, third])).resolves.toEqual(['second', 'third'])
})

test('a crashed reader rejects its request and a replacement serves queued work', async () => {
	const {pool, workers} = fixture({size: 1})
	const first = pool.read('summary', ['owner'], directly)
	const second = pool.read('summary', ['owner'], directly)
	await vi.waitFor(() => expect(workers[0]?.messages).toHaveLength(1))
	workers[0]!.emit('exit', 1)
	await expect(first).rejects.toThrow('exited with code 1')
	await vi.waitFor(() => expect(workers[1]?.messages).toHaveLength(1))
	// Late messages from the previous worker must not complete the new request.
	workers[0]!.finish('stale')
	workers[1]!.snapshot()
	workers[1]!.finish('fresh')
	await expect(second).resolves.toBe('fresh')
})

test('shutdown rejects both active and queued reads and releases a pending snapshot barrier', async () => {
	const {pool, workers} = fixture({size: 1})
	const writes = new PQueue({concurrency: 1})
	const prepare = async (begin: () => Promise<void>) => {
		await writes.add(begin)
	}
	const requests = [pool.read('summary', ['owner'], prepare), pool.read('summary', ['member'], prepare)]
	await vi.waitFor(() => expect(workers[0]?.messages).toHaveLength(1))
	await pool.stop()
	const results = await Promise.allSettled(requests)
	expect(results.every((result) => result.status === 'rejected')).toBe(true)
	await writes.onIdle()
	await expect(pool.read('summary', ['owner'], directly)).rejects.toThrow('stopped')
})

test('a missing snapshot acknowledgement times out instead of holding writes indefinitely', async () => {
	vi.useFakeTimers()
	const {pool} = fixture({size: 1, timeout: 10})
	const writes = new PQueue({concurrency: 1})
	const result = pool.read('summary', ['owner'], async (begin) => {
		await writes.add(begin)
	})
	const rejected = expect(result).rejects.toThrow('snapshot timed out')
	await vi.advanceTimersByTimeAsync(20)
	await rejected
	await writes.onIdle()
	expect(pool.status().threadIds).toEqual([])
})

test('reader startup timeout rejects the request before entering the writer queue', async () => {
	vi.useFakeTimers()
	const {pool} = fixture({size: 1, ready: false, timeout: 10})
	const prepare = vi.fn(directly)
	const result = pool.read('summary', ['owner'], prepare)
	const rejected = expect(result).rejects.toThrow('startup timed out')
	await vi.advanceTimersByTimeAsync(20)
	await rejected
	expect(prepare).not.toHaveBeenCalled()
})

test('serves every read in a burst the size of a normal Files search page', async () => {
	const {pool, workers} = fixture({size: 1})
	// Files search concurrently resolves thumbnail metadata for up to 250 rows.
	const accounts = Array.from({length: 250}, (_, index) => `owner-${index}`)
	const results = Promise.allSettled(accounts.map((account) => pool.read('summary', [account], directly)))
	await vi.waitFor(() => expect(workers[0]?.messages).toHaveLength(1))
	const worker = workers[0]!
	const postMessage = worker.postMessage.bind(worker)
	vi.spyOn(worker, 'postMessage').mockImplementation((message) => {
		postMessage(message)
		queueMicrotask(() => {
			worker.snapshot()
			worker.finish(message.args[0])
		})
	})
	worker.snapshot()
	worker.finish(accounts[0])
	expect(await results).toEqual(accounts.map((value) => ({status: 'fulfilled', value})))
	expect(workers).toHaveLength(1)
})

test('the file-index engine releases its actual mutation queue while readers are occupied', async () => {
	const temporary = temporaryDirectory()
	const dataDirectory = await temporary.create()
	const home = nodePath.join(dataDirectory, 'home')
	await mkdir(home)
	const workers: FakeReader[] = []
	const index = new FileIndexEngine({
		dataDirectory,
		logger: {log() {}, verbose() {}, error() {}},
		isHidden: () => false,
		readerPoolOptions: {
			size: 2,
			reservedReaders: 0,
			createWorker: () => {
				const worker = new FakeReader(workers.length + 1)
				workers.push(worker)
				return worker as unknown as Worker
			},
		},
	})
	try {
		await index.setRoots([
			{virtualPath: '/Home', systemPath: home, ownerId: 'owner', kind: 'home', searchEnabled: true},
		])
		await index.start()
		const reads = [index.photosSummary('owner'), index.photosListSources('owner')]
		await vi.waitFor(() => expect(workers[0]?.messages).toHaveLength(1))
		workers[0]!.snapshot()
		await vi.waitFor(() => expect(workers[1]?.messages).toHaveLength(1))
		workers[1]!.snapshot()
		// Real writer operations finish while both SELECTs are held.
		await expect(index.photosCreateAlbum('owner', 'During reads')).resolves.toMatchObject({name: 'During reads'})
		await writeFile(nodePath.join(home, 'new.txt'), 'new file')
		await index.reconcilePath(nodePath.join(home, 'new.txt'))
		workers[0]!.finish({})
		workers[1]!.finish([])
		await Promise.all(reads)
	} finally {
		await index.stop()
		await temporary.destroyRoot()
	}
})

test('the default pool reserves one reader for quick work while slow reads queue on the shared reader', async () => {
	const {pool, workers} = fixture()
	const slow = Array.from({length: 250}, (_, index) =>
		pool.read(index % 2 ? 'listSources' : 'summary', ['owner'], directly),
	)
	const slowResults = Promise.allSettled(slow)
	await vi.waitFor(() => expect(workers).toHaveLength(1))
	await vi.waitFor(() => expect(workers.every((worker) => worker.messages.length === 1)).toBe(true))
	for (const worker of workers) worker.snapshot()
	const quick = pool.read('getItem', ['owner', 'item'], directly)
	await vi.waitFor(() => expect(workers).toHaveLength(2))
	await vi.waitFor(() => expect(workers[1]?.messages).toHaveLength(1))
	for (const worker of workers.slice(1)) {
		worker.snapshot()
		worker.finish({id: 'item'})
	}
	await expect(quick).resolves.toEqual({id: 'item'})
	// A large heavy backlog cannot borrow the reserved slots when they become idle.
	await vi.waitFor(() => expect(pool.status()).toMatchObject({active: 1, queued: 249}))
	expect(workers.every((worker) => worker.messages.length === 1)).toBe(true)
	await pool.stop()
	expect((await slowResults).every((result) => result.status === 'rejected')).toBe(true)
})

test('quick bursts use both readers by default', async () => {
	const {pool, workers} = fixture()
	const quick = [
		pool.read('neighbors', ['owner', 'item', {kind: 'photo', favorite: true, albumIds: [], sourceIds: []}], directly),
		pool.read('listItems', ['owner', {albumIds: ['album'], sourceIds: ['source']}, undefined, 50], directly),
	]
	await vi.waitFor(() => expect(workers).toHaveLength(2))
	await vi.waitFor(() => expect(workers.every((worker) => worker.messages.length === 1)).toBe(true))
	for (const worker of workers) {
		worker.snapshot()
		worker.finish({id: 'item'})
	}
	await expect(Promise.all(quick)).resolves.toHaveLength(2)
})

test.each([1, 200])('a %i-folder size lookup uses the reserved reader while a slow query runs', async (count) => {
	const {pool, workers} = fixture()
	const slow = pool.read('summary', ['owner'], directly)
	const slowResult = Promise.allSettled([slow])
	const requests = Array.from({length: count}, (_, id) => ({
		rootId: 1,
		relativePath: `folder-${id}`,
		virtualPath: `/Home/folder-${id}`,
	}))
	const sizes = pool.read('directorySizes', [requests], directly)
	const sizeResult = Promise.allSettled([sizes])
	await vi.waitFor(() => expect(workers).toHaveLength(2))
	await vi.waitFor(() => expect(workers.every((worker) => worker.messages.length === 1)).toBe(true))
	expect(workers[0]!.messages[0]!.method).toBe('summary')
	expect(workers[1]!.messages[0]!.method).toBe('directorySizes')
	workers[0]!.snapshot()
	workers[1]!.snapshot()
	const expected = requests.map(({virtualPath}) => ({virtualPath, size: 123}))
	workers[1]!.finish(expected)
	await expect(sizeResult).resolves.toEqual([{status: 'fulfilled', value: expected}])
	expect(pool.status()).toMatchObject({active: 1, queued: 0})
	workers[0]!.finish({})
	await slowResult
})

test('concurrent Home and favorites size lookups can use both readers', async () => {
	const {pool, workers} = fixture()
	const requests: FileIndexReadArgs<'directorySizes'>[] = [
		[[{rootId: 1, relativePath: '', virtualPath: '/Home'}]],
		[[{rootId: 1, relativePath: 'Photos', virtualPath: '/Home/Photos'}]],
	]
	const results = Promise.allSettled(requests.map((args) => pool.read('directorySizes', args, directly)))
	await vi.waitFor(() => expect(workers).toHaveLength(2))
	await vi.waitFor(() => expect(workers.every((worker) => worker.messages.length === 1)).toBe(true))
	for (const worker of workers) {
		expect(worker.messages[0]!.method).toBe('directorySizes')
		worker.snapshot()
		worker.finish([])
	}
	expect((await results).every(({status}) => status === 'fulfilled')).toBe(true)
})

test.each<{
	description: string
	method: 'listAlbums' | 'neighbors' | 'directorySizes'
	args: FileIndexReadArgs<'listAlbums'> | FileIndexReadArgs<'neighbors'> | FileIndexReadArgs<'directorySizes'>
}>([
	{description: 'album listing', method: 'listAlbums', args: ['owner']},
	{description: 'album-filtered neighbors', method: 'neighbors', args: ['owner', 'item', {albumIds: ['album']}]},
	{description: 'source-filtered neighbors', method: 'neighbors', args: ['owner', 'item', {sourceIds: ['source']}]},
	{
		description: 'a large folder-size batch',
		method: 'directorySizes',
		args: [
			Array.from({length: 201}, (_, id) => ({
				rootId: 1,
				relativePath: `folder-${id}`,
				virtualPath: `/Home/folder-${id}`,
			})),
		],
	},
])('$description waits for the shared reader while thumbnail lookups proceed', async ({method, args}) => {
	const {pool, workers} = fixture()
	const scan = pool.read('summary', ['owner'], directly)
	const photos = pool.read(method, args, directly)
	const pending = Promise.allSettled([scan, photos])
	const thumbnailQuery = {
		sql: "SELECT 1 FROM thumbnail_variants WHERE content_id = ? AND variant = ? AND state = 'ready'",
		parameters: [1, 'preview'],
	}
	const thumbnail = pool.read('sql', [thumbnailQuery], directly)
	const thumbnailResult = Promise.allSettled([thumbnail])
	await vi.waitFor(() => expect(workers.every((worker) => worker.messages.length === 1)).toBe(true))
	expect(workers).toHaveLength(2)
	expect(workers[0]!.messages[0]!.method).toBe('summary')
	expect(workers[1]!.messages[0]).toMatchObject({method: 'sql', args: [thumbnailQuery]})
	workers[0]!.snapshot()
	workers[1]!.snapshot()
	workers[1]!.finish({ready: true})
	await expect(thumbnailResult).resolves.toEqual([{status: 'fulfilled', value: {ready: true}}])
	await vi.waitFor(() => expect(pool.status()).toMatchObject({active: 1, queued: 1}))

	// The Photos request can start only after the scan releases the shared reader.
	workers[0]!.finish([])
	await vi.waitFor(() => expect(workers[0]!.messages).toHaveLength(2))
	expect(workers[0]!.messages[1]).toMatchObject({method, args})
	workers[0]!.snapshot()
	workers[0]!.finish(method === 'listAlbums' ? [] : {})
	expect((await pending).every((result) => result.status === 'fulfilled')).toBe(true)
	expect(workers[1]!.messages).toHaveLength(1)
})

test('replacing a reserved reader preserves quick capacity during a scan backlog', async () => {
	const {pool, workers} = fixture({size: 4, reservedReaders: 2})
	const scans = Promise.allSettled(Array.from({length: 4}, () => pool.read('summary', ['owner'], directly)))
	const first = pool.read('getItem', ['owner', 'first'], directly)
	const second = pool.read('getItem', ['owner', 'second'], directly)
	const waiting = pool.read('getItem', ['owner', 'waiting'], directly)
	await vi.waitFor(() => expect(workers).toHaveLength(4))
	await vi.waitFor(() => expect(workers.every((worker) => worker.messages.length === 1)).toBe(true))
	workers[2]!.emit('exit', 1)
	await expect(first).rejects.toThrow('exited with code 1')
	await vi.waitFor(() => expect(workers[4]?.messages).toHaveLength(1))
	expect(workers[4]!.messages[0]!.method).toBe('getItem')
	for (const worker of [workers[3]!, workers[4]!]) {
		worker.snapshot()
		worker.finish({id: worker.messages[0]!.args[1]})
	}
	await expect(Promise.all([second, waiting])).resolves.toEqual([{id: 'second'}, {id: 'waiting'}])
	await pool.stop()
	expect((await scans).every((result) => result.status === 'rejected')).toBe(true)
})

test('a failed shared reader is replaced without consuming the reserved reader', async () => {
	const {pool, workers} = fixture()
	const slow = pool.read('summary', ['owner'], directly)
	const waiting = pool.read('summary', ['owner'], directly)
	const quick = pool.read('getItem', ['owner', 'item'], directly)
	await vi.waitFor(() => expect(workers.every((worker) => worker.messages.length === 1)).toBe(true))
	workers[0]!.emit('exit', 1)
	await expect(slow).rejects.toThrow('exited with code 1')
	await vi.waitFor(() => expect(workers[2]?.messages).toHaveLength(1))
	expect(workers[2]!.messages[0]!.method).toBe('summary')
	workers[1]!.snapshot()
	workers[1]!.finish([])
	await expect(quick).resolves.toEqual([])
	workers[2]!.snapshot()
	workers[2]!.finish({})
	await waiting
})

test('Files and thumbnail reads and writes complete while a slow Files search is held', async () => {
	const {Worker} = await import('node:worker_threads')
	const temporary = temporaryDirectory()
	const dataDirectory = await temporary.create()
	const home = nodePath.join(dataDirectory, 'home')
	await mkdir(home)
	let releaseSearch!: () => void
	let markSearchStarted!: () => void
	const searchStarted = new Promise<void>((resolve) => {
		markSearchStarted = resolve
	})
	const index = new FileIndexEngine({
		dataDirectory,
		logger: {log() {}, verbose() {}, error() {}},
		isHidden: () => false,
		enrichmentRuntime: {
			hashFile: async () => Buffer.alloc(32, 7),
			generateThumbnail: async (_source, destination) => {
				await mkdir(nodePath.dirname(destination), {recursive: true})
				await writeFile(destination, 'thumbnail')
			},
		},
		readerPoolOptions: {
			createWorker: (url, options) => {
				const worker = new Worker(url, options)
				const send = worker.postMessage.bind(worker)
				worker.postMessage = (message: FileIndexReaderRequest) => {
					if (message.method === 'searchCandidates') {
						releaseSearch = () => send(message)
						markSearchStarted()
					} else send(message)
				}
				return worker
			},
		},
	})
	let search: ReturnType<typeof index.searchCandidates> | undefined
	try {
		await index.setRoots([
			{virtualPath: '/Home', systemPath: home, ownerId: 'owner', kind: 'home', searchEnabled: true},
		])
		await index.start()
		const source = nodePath.join(home, 'photo.jpg')
		await writeFile(source, 'image')
		await index.reconcilePath(source)
		await index.reconcileRoot('/Home', 'ready-size-reads')
		search = index.searchCandidates('/Home', 'photo', 10)
		await searchStarted
		await expect(index.photosCreateAlbum('owner', 'While searching')).resolves.toMatchObject({name: 'While searching'})
		const thumbnail = await index.ensureThumbnail(source)
		await expect(index.getExistingThumbnail(source)).resolves.toEqual(thumbnail)
		await expect(index.matchesThumbnail(source, thumbnail.kind, thumbnail.key, thumbnail.variant)).resolves.toBe(true)
		await expect(index.getEntryByVirtualPath('/Home/photo.jpg')).resolves.toMatchObject({name: 'photo.jpg'})
		await expect(index.recentCandidates('/Home', 10)).resolves.toMatchObject([{name: 'photo.jpg'}])
		await expect(index.directorySizes(['/Home'])).resolves.toEqual([{virtualPath: '/Home', size: 5}])
		releaseSearch()
		await expect(search).resolves.toMatchObject([{name: 'photo.jpg'}])
	} finally {
		await index.stop()
		await search?.catch(() => {})
		await temporary.destroyRoot()
	}
})

test('an asynchronous Files search discards its results when root ownership changes', async () => {
	const temporary = temporaryDirectory()
	const dataDirectory = await temporary.create()
	const home = nodePath.join(dataDirectory, 'home')
	await mkdir(home)
	const workers: FakeReader[] = []
	const index = new FileIndexEngine({
		dataDirectory,
		logger: {log() {}, verbose() {}, error() {}},
		isHidden: () => false,
		readerPoolOptions: {
			createWorker: () => {
				const worker = new FakeReader(workers.length + 1)
				workers.push(worker)
				return worker as unknown as Worker
			},
		},
	})
	try {
		const root = {virtualPath: '/Home', systemPath: home, ownerId: 'owner', kind: 'home' as const, searchEnabled: true}
		await index.setRoots([root])
		await index.start()
		const search = index.searchCandidates('/Home', 'photo', 10)
		const rejected = expect(search).rejects.toThrow('changed during search')
		await vi.waitFor(() => expect(workers[1]?.messages).toHaveLength(1))
		workers[1]!.snapshot()
		await index.setRoots([{...root, ownerId: 'another-account'}])
		workers[1]!.finish([{id: 1, name: 'photo.jpg', virtualPath: '/Home/photo.jpg'}])
		await rejected
	} finally {
		await index.stop()
		await temporary.destroyRoot()
	}
})
