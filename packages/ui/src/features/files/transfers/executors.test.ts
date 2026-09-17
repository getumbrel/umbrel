import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {laneFor, prepareDirectories, storageRoot, UPLOAD_NETWORK_ERROR, uploadExecutor} from './executors'
import type {TransferProgressUpdate} from './transfer-queue'
import type {TransferBatch, TransferItem} from './types'

vi.mock('@/modules/auth/http-auth', () => ({
	dashboardAuthHeaders: () => ({Authorization: 'Bearer token'}),
	authorizedHttpUrl: async (url: string) => `${url}&token=t`,
}))
const mocks = vi.hoisted(() => ({fetch: vi.fn(), createDirectory: vi.fn()}))
vi.mock('@/trpc/trpc', () => ({trpcClient: {files: {createDirectory: {mutate: mocks.createDirectory}}}}))

class FakeXHR {
	static instances: FakeXHR[] = []
	upload: {onprogress?: (event: {lengthComputable: boolean; loaded: number; total: number}) => void} = {}
	onload?: () => void
	onerror?: () => void
	onabort?: () => void
	status = 0
	url = ''
	headers: Record<string, string> = {}
	sent: unknown
	responseText = ''

	constructor() {
		FakeXHR.instances.push(this)
	}
	open(_method: string, url: string) {
		this.url = url
	}
	setRequestHeader(name: string, value: string) {
		this.headers[name] = value
	}
	send(body: unknown) {
		this.sent = body
	}
	abort() {
		this.onabort?.()
	}
	respond(status: number, body = '') {
		this.status = status
		this.responseText = body
		this.onload?.()
	}
}

const last = () => FakeXHR.instances.at(-1)!
const file = new File([new Uint8Array(100)], 'a.txt', {type: 'text/plain'})
const item: TransferItem = {
	id: 'transfer-1',
	batchId: 'batch-1',
	kind: 'upload',
	lane: 'upload',
	name: 'a.txt',
	type: 'text/plain',
	size: 100,
	path: '/Home/Docs/a.txt',
	destinationDirectory: '/Home/Docs',
	state: 'running',
	progress: 0,
	transferredBytes: 0,
	bytesPerSecond: 0,
	attempts: 1,
}

// Folders created are remembered per batch object, so every run is its own drop
const makeBatch = (id = 'batch-1'): TransferBatch => ({
	id,
	kind: 'upload',
	destinationDirectory: '/Home/Docs',
	createdAt: 0,
	itemIds: [item.id],
})

function run(collision: 'error' | 'replace' | 'keep-both' = 'error', target: TransferItem = item) {
	const controller = new AbortController()
	const updates: TransferProgressUpdate[] = []
	const outcome = uploadExecutor(target, {
		collision,
		file,
		batch: makeBatch(),
		signal: controller.signal,
		onProgress: (u) => updates.push(u),
	})
	return {outcome, updates, controller}
}

// The executor opens its request only once the folders are in place; yield
// until it has, each folder level costing a few microtask hops
const opened = async () => {
	const before = FakeXHR.instances.length
	for (let i = 0; i < 60 && FakeXHR.instances.length === before; i++) await Promise.resolve()
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.stubGlobal('XMLHttpRequest', FakeXHR)
	vi.stubGlobal('fetch', mocks.fetch)
	mocks.fetch.mockReset()
	mocks.createDirectory.mockReset().mockResolvedValue({created: true})
	FakeXHR.instances = []
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe('uploadExecutor', () => {
	test('posts the file to the upload endpoint with the path and strategy', async () => {
		run('keep-both')
		await opened()
		expect(last().url).toBe('/api/files/upload?path=%2FHome%2FDocs%2Fa.txt&collision=keep-both')
		expect(last().headers.Authorization).toBe('Bearer token')
		expect(last().sent).toBe(file)
	})

	test('reports the stored path, which a keep-both may have renamed', async () => {
		const {outcome} = run('keep-both')
		await opened()
		last().respond(200, JSON.stringify({path: '/Home/Docs/a (2).txt'}))
		await expect(outcome).resolves.toEqual({type: 'completed', path: '/Home/Docs/a (2).txt'})
	})

	test('a name collision is a conflict, other rejections are failures with their code', async () => {
		const conflict = run()
		await opened()
		last().respond(400, JSON.stringify({error: '[destination-already-exists]'}))
		await expect(conflict.outcome).resolves.toEqual({type: 'conflict'})

		const failure = run()
		await opened()
		last().respond(507, JSON.stringify({error: '[not-enough-space]'}))
		await expect(failure.outcome).resolves.toEqual({type: 'failed', error: '[not-enough-space]'})
	})

	test('progress marks the moment every byte has been handed to the network', async () => {
		const {updates} = run()
		await opened()
		last().upload.onprogress?.({lengthComputable: true, loaded: 40, total: 100})
		last().upload.onprogress?.({lengthComputable: true, loaded: 100, total: 100})
		expect(updates.map((u) => [u.transferredBytes, u.progress, u.allBytesSent])).toEqual([
			[40, 40, false],
			[100, 100, true],
		])
	})

	test('speed is sampled over time from the start of the request, not per event', async () => {
		const {updates} = run()
		await opened()
		last().upload.onprogress?.({lengthComputable: true, loaded: 10, total: 100})
		expect(updates.at(-1)?.bytesPerSecond).toBe(0)
		vi.advanceTimersByTime(1_000)
		last().upload.onprogress?.({lengthComputable: true, loaded: 60, total: 100})
		expect(updates.at(-1)?.bytesPerSecond).toBe(60)
	})

	test('an abort through the signal settles as cancelled', async () => {
		const {outcome, controller} = run()
		await opened()
		controller.abort()
		await expect(outcome).resolves.toEqual({type: 'cancelled'})
	})

	test('a network error is a conflict when the destination turns out to exist', async () => {
		// The server's early 400 + close can reach the browser as a reset. The
		// view endpoint authorizes GET only, so the probe asks for one byte.
		const cancel = vi.fn(async () => {})
		mocks.fetch.mockResolvedValue({status: 206, body: {cancel}})
		const {outcome} = run()
		await opened()
		last().onerror?.()
		await expect(outcome).resolves.toEqual({type: 'conflict'})
		expect(mocks.fetch).toHaveBeenCalledWith(
			'/api/files/view?path=%2FHome%2FDocs%2Fa.txt&token=t',
			expect.objectContaining({headers: {Range: 'bytes=0-0'}}),
		)
		expect(cancel).toHaveBeenCalled()

		// An empty file cannot satisfy the range, but it is there
		mocks.fetch.mockResolvedValue({status: 416, body: null})
		const empty = run()
		await opened()
		last().onerror?.()
		await expect(empty.outcome).resolves.toEqual({type: 'conflict'})

		// A folder of that name cannot be viewed, but it is there too
		mocks.fetch.mockResolvedValue({status: 400, body: null})
		const folder = run()
		await opened()
		last().onerror?.()
		await expect(folder.outcome).resolves.toEqual({type: 'conflict'})
	})

	test('a cancel ends the lookup at once instead of waiting for it', async () => {
		mocks.fetch.mockImplementation(() => new Promise(() => {}))
		const {outcome, controller} = run()
		await opened()
		last().onerror?.()
		await Promise.resolve()
		controller.abort()
		await expect(outcome).resolves.toEqual({type: 'cancelled'})
		expect(mocks.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({signal: controller.signal}))
	})

	test('a network error stays a network error when nothing landed, when unsure, or for a replace', async () => {
		mocks.fetch.mockResolvedValue({status: 404, body: null})
		const missing = run()
		await opened()
		last().onerror?.()
		await expect(missing.outcome).resolves.toEqual({type: 'failed', error: UPLOAD_NETWORK_ERROR})

		mocks.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
		const unsure = run()
		await opened()
		last().onerror?.()
		await expect(unsure.outcome).resolves.toEqual({type: 'failed', error: UPLOAD_NETWORK_ERROR})

		mocks.fetch.mockClear()
		const replace = run('replace')
		await opened()
		last().onerror?.()
		await expect(replace.outcome).resolves.toEqual({type: 'failed', error: UPLOAD_NETWORK_ERROR})
		expect(mocks.fetch).not.toHaveBeenCalled()
	})
})

describe('folder uploads', () => {
	const nested: TransferItem = {
		...item,
		id: 'transfer-2',
		path: '/Home/Docs/Trip/Day 1/photo.jpg',
		destinationDirectory: '/Home/Docs/Trip/Day 1',
	}

	test('creates the missing folders shallow first, through createDirectory, before sending', async () => {
		const {outcome} = run('error', nested)
		await opened()
		expect(mocks.createDirectory.mock.calls.map(([input]) => input.path)).toEqual([
			'/Home/Docs/Trip',
			'/Home/Docs/Trip/Day 1',
		])
		expect(last().url).toContain(encodeURIComponent('/Home/Docs/Trip/Day 1/photo.jpg'))
		last().respond(200, JSON.stringify({path: nested.path}))
		await expect(outcome).resolves.toEqual({type: 'completed', path: nested.path})
	})

	test('a file dropped straight into the target creates nothing', async () => {
		run()
		await opened()
		expect(mocks.createDirectory).not.toHaveBeenCalled()
	})

	test('uploads into the same new folder share one creation', async () => {
		mocks.createDirectory.mockReset().mockResolvedValue({created: true})
		const signal = new AbortController().signal
		const batch = makeBatch()
		await Promise.all([
			prepareDirectories('/Home', '/Home/A/B', {batch, signal}),
			prepareDirectories('/Home', '/Home/A/C', {batch, signal}),
		])
		expect(mocks.createDirectory.mock.calls.map(([input]) => input.path)).toEqual(['/Home/A', '/Home/A/B', '/Home/A/C'])
	})

	test('a later drop into the same place creates its folders again', async () => {
		mocks.createDirectory.mockReset().mockResolvedValue({created: true})
		const signal = new AbortController().signal
		const batch = makeBatch()
		await prepareDirectories('/Home', '/Home/A', {batch, signal})
		// Same batch: nothing more to do. A new batch: the folder may be gone by now.
		await prepareDirectories('/Home', '/Home/A', {batch, signal})
		expect(mocks.createDirectory).toHaveBeenCalledTimes(1)
		await prepareDirectories('/Home', '/Home/A', {batch: makeBatch('batch-2'), signal})
		expect(mocks.createDirectory).toHaveBeenCalledTimes(2)
	})

	test('a cancel during folder preparation frees the upload at once and creates nothing deeper', async () => {
		mocks.createDirectory.mockReset().mockImplementation(() => new Promise(() => {}))
		const {outcome, controller} = run('error', nested)
		await Promise.resolve()
		controller.abort()
		await expect(outcome).resolves.toEqual({type: 'cancelled'})
		expect(mocks.createDirectory.mock.calls.map(([input]) => input.path)).toEqual(['/Home/Docs/Trip'])
		expect(FakeXHR.instances).toHaveLength(0)
	})

	test("a folder the server refuses fails the upload with the server's reason, and is retried next time", async () => {
		mocks.createDirectory.mockReset().mockRejectedValue(new Error('[operation-not-allowed]'))
		const refused: TransferItem = {
			...nested,
			id: 'transfer-3',
			path: '/Home/Docs/Nope/x',
			destinationDirectory: '/Home/Docs/Nope',
		}
		await expect(run('error', refused).outcome).resolves.toEqual({type: 'failed', error: '[operation-not-allowed]'})
		expect(FakeXHR.instances).toHaveLength(0)
		mocks.createDirectory.mockResolvedValue({created: true})
		run('error', refused)
		await opened()
		expect(mocks.createDirectory).toHaveBeenCalledTimes(2)
		expect(FakeXHR.instances).toHaveLength(1)
	})
})

describe('lanes', () => {
	test('everything internal is one device; each drive and share is its own', () => {
		expect(storageRoot('/Home/Docs')).toBe('internal')
		expect(storageRoot('/Users/luna/Photos')).toBe('internal')
		expect(storageRoot('/External/Backup Drive/x')).toBe('External/Backup Drive')
		expect(storageRoot('/Network/nas.local/Media/x')).toBe('Network/nas.local/Media')
	})

	test('a move within one device is instant; anything else streams', () => {
		expect(laneFor({kind: 'move', sourcePath: '/Home/a', destinationDirectory: '/Home/Archive'})).toBe('instant')
		expect(laneFor({kind: 'move', sourcePath: '/Home/a', destinationDirectory: '/External/Drive'})).toBe('streamed')
		expect(laneFor({kind: 'copy', sourcePath: '/Home/a', destinationDirectory: '/Home/Archive'})).toBe('streamed')
		expect(laneFor({kind: 'upload', destinationDirectory: '/Home'})).toBe('upload')
	})
})
