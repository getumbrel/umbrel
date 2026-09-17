import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {TransferQueue, type TransferAttempt, type TransferExecutor, type TransferOutcome} from './transfer-queue'
import type {TransferItem, TransferState} from './types'

// A hand-cranked executor: every attempt parks until the test settles it, so
// the queue's scheduling is observable one step at a time
type Attempt = {item: TransferItem; options: TransferAttempt; resolve: (outcome: TransferOutcome) => void}

function createHarness({honourAbort = true} = {}) {
	const attempts: Attempt[] = []
	const execute: TransferExecutor = (item, options) =>
		new Promise((resolve) => {
			attempts.push({item, options, resolve})
			if (honourAbort) options.signal.addEventListener('abort', () => resolve({type: 'cancelled'}), {once: true})
		})
	const queue = new TransferQueue({
		execute,
		laneFor: (item) => (item.kind === 'upload' ? 'upload' : item.kind === 'move' ? 'instant' : 'streamed'),
		concurrency: {upload: 2, instant: 1, streamed: 1},
		cancellableWhileRunning: (item) => item.kind === 'upload',
	})
	const started = () => attempts.map((attempt) => attempt.item.name)
	const settle = async (name: string, outcome: TransferOutcome) => {
		const attempt = attempts.find((candidate) => candidate.item.name === name && !('done' in candidate))
		if (!attempt) throw new Error(`no running attempt for ${name}`)
		Object.assign(attempt, {done: true})
		attempt.resolve(outcome)
		await flush()
	}
	const state = (id: string) => queue.snapshot().items.get(id)?.state
	return {queue, attempts, started, settle, state}
}

// The executor's promise settles through a couple of microtask hops
async function flush() {
	for (let i = 0; i < 6; i++) await Promise.resolve()
}

const file = (name: string, size = 10) =>
	new File([new Uint8Array(size)], name, {type: name.endsWith('.png') ? 'image/png' : 'text/plain'})
const entry = (name: string, path = `/Home/${name}`) => ({name, path, type: 'file', size: 10})

const revoked: string[] = []

beforeEach(() => {
	vi.useFakeTimers()
	vi.stubGlobal('URL', {
		createObjectURL: (blob: File) => `blob:${blob.name}`,
		revokeObjectURL: (url: string) => revoked.push(url),
	})
	revoked.length = 0
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe('scheduling', () => {
	test('runs at most two uploads at once across batches and starts the next as one settles', async () => {
		const {queue, started, settle} = createHarness()
		queue.enqueueUploads([file('a'), file('b'), file('c')], '/Home')
		queue.enqueueUploads([file('d')], '/Home/Photos')
		expect(started()).toEqual(['a', 'b'])

		await settle('a', {type: 'completed', path: '/Home/a'})
		expect(started()).toEqual(['a', 'b', 'c'])
		await settle('b', {type: 'completed', path: '/Home/b'})
		expect(started()).toEqual(['a', 'b', 'c', 'd'])
	})

	test('a second drop joins the queue without disturbing the first batch', () => {
		const {queue} = createHarness()
		const first = queue.enqueueUploads([file('a'), file('b'), file('c')], '/Home')
		const second = queue.enqueueUploads([file('d')], '/Home')
		const snapshot = queue.snapshot()
		expect(snapshot.batches.map((batch) => batch.id)).toEqual([first.batchId, second.batchId])
		expect(snapshot.batches[0].itemIds).toEqual(first.itemIds)
		expect(snapshot.items.get(first.itemIds[2])?.state).toBe('queued')
	})

	test('copies and moves stream one at a time, in their own lanes', async () => {
		const {queue, started, settle} = createHarness()
		queue.enqueueServer('copy', [entry('x'), entry('y')], '/Home/Archive')
		queue.enqueueServer('move', [entry('z')], '/Home/Archive')
		// One streamed copy, and the rename-style move alongside it
		expect(started()).toEqual(['x', 'z'])
		await settle('x', {type: 'completed', path: '/Home/Archive/x'})
		expect(started()).toEqual(['x', 'z', 'y'])
	})

	test('an empty drop enqueues nothing', () => {
		const {queue} = createHarness()
		expect(queue.enqueueUploads([], '/Home')).toEqual({batchId: null, itemIds: []})
		expect(queue.snapshot().batches).toEqual([])
	})

	test('a folder drop keeps relative paths, whether dropped or picked from a directory input', () => {
		const {queue, attempts} = createHarness()
		const dropped = Object.assign(file('photo.jpg'), {path: 'Trip/Day 1/photo.jpg'})
		const picked = new File([new Uint8Array(1)], 'clip.mov')
		Object.defineProperty(picked, 'webkitRelativePath', {value: 'Trip/Day 2/clip.mov'})
		const [droppedId, pickedId] = queue.enqueueUploads([dropped, picked], '/Home/Pictures').itemIds
		expect(queue.snapshot().items.get(droppedId)).toMatchObject({
			path: '/Home/Pictures/Trip/Day 1/photo.jpg',
			destinationDirectory: '/Home/Pictures/Trip/Day 1',
		})
		expect(queue.snapshot().items.get(pickedId)).toMatchObject({
			path: '/Home/Pictures/Trip/Day 2/clip.mov',
			destinationDirectory: '/Home/Pictures/Trip/Day 2',
		})
		expect(attempts[0].options.file).toBe(dropped)
	})
})

describe('cancellation', () => {
	test('a cancelled queued item never starts', async () => {
		const {queue, started, settle, state} = createHarness()
		const {itemIds} = queue.enqueueUploads([file('a'), file('b'), file('c')], '/Home')
		expect(queue.cancel(itemIds[2])).toBe(true)
		expect(state(itemIds[2])).toBe('cancelled')
		await settle('a', {type: 'completed', path: '/Home/a'})
		await settle('b', {type: 'completed', path: '/Home/b'})
		expect(started()).toEqual(['a', 'b'])
	})

	test('a running upload aborts through its signal and settles as cancelled', async () => {
		const {queue, attempts, state} = createHarness()
		const {itemIds} = queue.enqueueUploads([file('a')], '/Home')
		expect(queue.cancel(itemIds[0])).toBe(true)
		expect(state(itemIds[0])).toBe('cancelling')
		expect(attempts[0].options.signal.aborted).toBe(true)
		await flush()
		expect(state(itemIds[0])).toBe('cancelled')
	})

	test('a cancel that raced the server success reports the success', async () => {
		// The server had already published when the abort arrived
		const {queue, attempts, state} = createHarness({honourAbort: false})
		const {itemIds} = queue.enqueueUploads([file('a')], '/Home')
		queue.cancel(itemIds[0])
		attempts[0].resolve({type: 'completed', path: '/Home/a'})
		await flush()
		expect(state(itemIds[0])).toBe('completed')
		expect(queue.snapshot().items.get(itemIds[0])?.resultPath).toBe('/Home/a')
	})

	test('once every byte has left the browser the item is finishing and cannot be cancelled', () => {
		const {queue, attempts, state} = createHarness()
		const {itemIds} = queue.enqueueUploads([file('a', 100)], '/Home')
		attempts[0].options.onProgress({transferredBytes: 100, progress: 100, allBytesSent: true})
		expect(state(itemIds[0])).toBe('finishing')
		expect(queue.isCancellable(itemIds[0])).toBe(false)
		expect(queue.cancel(itemIds[0])).toBe(false)
	})

	test('a running copy is not cancellable, a queued one is', () => {
		const {queue, state} = createHarness()
		const {itemIds} = queue.enqueueServer('copy', [entry('x'), entry('y')], '/Home/Archive')
		expect(queue.isCancellable(itemIds[0])).toBe(false)
		expect(queue.cancel(itemIds[0])).toBe(false)
		expect(queue.cancel(itemIds[1])).toBe(true)
		expect(state(itemIds[0])).toBe('running')
		expect(state(itemIds[1])).toBe('cancelled')
	})

	test('cancelling a batch leaves finished items and other batches alone', async () => {
		const {queue, settle, state} = createHarness()
		const first = queue.enqueueUploads([file('a'), file('b'), file('c')], '/Home')
		const second = queue.enqueueUploads([file('d')], '/Home')
		await settle('a', {type: 'completed', path: '/Home/a'})
		// a landed, so b and c hold the two slots and d waits
		expect(queue.cancelBatch(first.batchId!)).toBe(2)
		expect(first.itemIds.map(state)).toEqual(['completed', 'cancelling', 'cancelling'])
		expect(state(second.itemIds[0])).toBe('queued')
		await flush()
		expect(first.itemIds.map(state)).toEqual(['completed', 'cancelled', 'cancelled'])
		expect(state(second.itemIds[0])).toBe('running')
	})

	test('cancel all covers what exists now, not what arrives later', async () => {
		const {queue, state} = createHarness()
		const first = queue.enqueueUploads([file('a'), file('b'), file('c')], '/Home')
		expect(queue.cancelAll()).toBe(3)
		// The aborted uploads settle through their own handlers before their slots free up
		await flush()
		const later = queue.enqueueUploads([file('d')], '/Home')
		expect(first.itemIds.map(state)).toEqual(['cancelled', 'cancelled', 'cancelled'])
		expect(state(later.itemIds[0])).toBe('running')
	})
})

describe('conflicts', () => {
	test('a conflict parks the item until the user decides, then re-runs it with the decision', async () => {
		const {queue, attempts, settle, state} = createHarness()
		const {itemIds} = queue.enqueueUploads([file('a')], '/Home')
		await settle('a', {type: 'conflict'})
		expect(state(itemIds[0])).toBe('needs-attention')
		expect(queue.resolveConflict(itemIds[0], 'keep-both')).toBe(true)
		await flush()
		expect(state(itemIds[0])).toBe('running')
		expect(attempts.at(-1)?.options.collision).toBe('keep-both')
	})

	test('the resolved item goes ahead of work that has not started', async () => {
		const {queue, started, settle} = createHarness()
		const {itemIds} = queue.enqueueUploads([file('a'), file('b'), file('c'), file('d')], '/Home')
		await settle('a', {type: 'conflict'})
		// c took a's slot; a's answer must come before d
		expect(started()).toEqual(['a', 'b', 'c'])
		queue.resolveConflict(itemIds[0], 'replace')
		await settle('b', {type: 'completed', path: '/Home/b'})
		expect(started()).toEqual(['a', 'b', 'c', 'a'])
	})

	test('a conflict frees the slot so the batch keeps moving', async () => {
		const {queue, started, settle} = createHarness()
		queue.enqueueUploads([file('a'), file('b'), file('c')], '/Home')
		await settle('a', {type: 'conflict'})
		expect(started()).toEqual(['a', 'b', 'c'])
	})

	test('apply to remaining settles waiting conflicts and decides later ones without asking', async () => {
		const {queue, attempts, settle, state} = createHarness()
		const {itemIds} = queue.enqueueUploads([file('a'), file('b'), file('c')], '/Home')
		await settle('a', {type: 'conflict'})
		await settle('b', {type: 'conflict'})
		queue.resolveConflict(itemIds[0], 'skip', true)
		expect(state(itemIds[0])).toBe('skipped')
		expect(state(itemIds[1])).toBe('skipped')
		expect(queue.snapshot().batches[0].collisionDecision).toBe('skip')
		await settle('c', {type: 'conflict'})
		expect(state(itemIds[2])).toBe('skipped')
		expect(attempts).toHaveLength(3)
	})

	test('a batch decision does not leak into another batch', async () => {
		const {queue, settle, state} = createHarness()
		const first = queue.enqueueUploads([file('a')], '/Home')
		const second = queue.enqueueUploads([file('b')], '/Home')
		await settle('a', {type: 'conflict'})
		queue.resolveConflict(first.itemIds[0], 'replace', true)
		await settle('b', {type: 'conflict'})
		expect(state(second.itemIds[0])).toBe('needs-attention')
	})

	test('an answer for an item cancelled meanwhile is ignored', async () => {
		const {queue, attempts, settle, state} = createHarness()
		const {itemIds} = queue.enqueueUploads([file('a')], '/Home')
		await settle('a', {type: 'conflict'})
		queue.cancel(itemIds[0])
		expect(queue.resolveConflict(itemIds[0], 'replace')).toBe(false)
		expect(state(itemIds[0])).toBe('cancelled')
		expect(attempts).toHaveLength(1)
	})

	test('a dismissed dialog keeps the item waiting until it is reopened', async () => {
		const {queue, settle} = createHarness()
		const {itemIds} = queue.enqueueUploads([file('a')], '/Home')
		await settle('a', {type: 'conflict'})
		queue.dismissConflict(itemIds[0])
		expect(queue.snapshot().items.get(itemIds[0])?.conflict).toEqual({dismissed: true})
		queue.reopenConflict(itemIds[0])
		expect(queue.snapshot().items.get(itemIds[0])?.conflict).toEqual({dismissed: false})
	})
})

describe('failures and retirement', () => {
	test('a failed batch stays until retried or dismissed', async () => {
		const {queue, attempts, settle, state} = createHarness()
		const {batchId, itemIds} = queue.enqueueUploads([file('a')], '/Home')
		await settle('a', {type: 'failed', error: '[not-enough-space]'})
		expect(state(itemIds[0])).toBe('failed')
		vi.advanceTimersByTime(10_000)
		expect(queue.snapshot().batches).toHaveLength(1)

		expect(queue.retryFailed(batchId!)).toBe(1)
		expect(state(itemIds[0])).toBe('running')
		expect(attempts.at(-1)?.options.collision).toBe('error')
		await settle('a', {type: 'completed', path: '/Home/a'})
		vi.advanceTimersByTime(2_000)
		expect(queue.snapshot().batches).toHaveLength(0)
	})

	test('a batch retires shortly after its last item lands, releasing payloads', async () => {
		const {queue, settle} = createHarness()
		const {itemIds} = queue.enqueueUploads([file('a.png', 5)], '/Home')
		expect(queue.thumbnailUrl(itemIds[0])).toBe('blob:a.png')
		await settle('a.png', {type: 'completed', path: '/Home/a.png'})
		expect(revoked).toEqual(['blob:a.png'])
		expect(queue.snapshot().items.get(itemIds[0])?.settledAt).toBe(Date.now())
		expect(queue.snapshot().batches).toHaveLength(1)
		vi.advanceTimersByTime(1_700)
		expect(queue.snapshot().batches).toHaveLength(0)
	})

	test('dismissing a failed item lets its batch retire', async () => {
		const {queue, settle} = createHarness()
		const {itemIds} = queue.enqueueUploads([file('a'), file('b')], '/Home')
		await settle('a', {type: 'failed', error: '[upload-failed]'})
		await settle('b', {type: 'completed', path: '/Home/b'})
		queue.dismiss(itemIds[0])
		vi.advanceTimersByTime(1_700)
		expect(queue.snapshot().batches).toHaveLength(0)
	})

	test('a thrown executor error is a failure, not a hang', async () => {
		const queue = new TransferQueue({
			execute: () => Promise.reject(new Error('[operation-not-allowed]')),
			laneFor: () => 'upload',
			concurrency: {upload: 2, instant: 1, streamed: 1},
			cancellableWhileRunning: () => true,
		})
		const {itemIds} = queue.enqueueUploads([file('a')], '/Home')
		await flush()
		expect(queue.snapshot().items.get(itemIds[0])).toMatchObject({state: 'failed', error: '[operation-not-allowed]'})
	})
})

describe('bookkeeping', () => {
	test('transition listeners hear every state change after the snapshot reflects it', async () => {
		const {queue, settle} = createHarness()
		const seen: Array<[TransferState, TransferState]> = []
		queue.onTransition((item, previous) => {
			seen.push([previous, item.state])
			expect(queue.snapshot().items.get(item.id)?.state).toBe(item.state)
		})
		queue.enqueueUploads([file('a')], '/Home')
		await settle('a', {type: 'completed', path: '/Home/a'})
		expect(seen).toEqual([
			['queued', 'running'],
			['running', 'completed'],
		])
	})

	test('progress ticks are throttled, but the finishing edge is never dropped', () => {
		const {queue, attempts} = createHarness()
		const {itemIds} = queue.enqueueUploads([file('a', 100)], '/Home')
		const item = () => queue.snapshot().items.get(itemIds[0])!
		attempts[0].options.onProgress({transferredBytes: 10, progress: 10})
		attempts[0].options.onProgress({transferredBytes: 20, progress: 20})
		expect(item().transferredBytes).toBe(10)
		vi.advanceTimersByTime(250)
		attempts[0].options.onProgress({transferredBytes: 30, progress: 30})
		expect(item().transferredBytes).toBe(30)
		attempts[0].options.onProgress({transferredBytes: 100, progress: 100, allBytesSent: true})
		expect(item()).toMatchObject({state: 'finishing', transferredBytes: 100})
	})

	test('the snapshot is stable between changes', () => {
		const {queue} = createHarness()
		queue.enqueueUploads([file('a')], '/Home')
		const before = queue.snapshot()
		expect(queue.snapshot()).toBe(before)
		queue.enqueueUploads([file('b')], '/Home')
		expect(queue.snapshot()).not.toBe(before)
	})

	test('reset aborts running work and forgets everything', () => {
		const {queue, attempts} = createHarness()
		queue.enqueueUploads([file('a'), file('b'), file('c')], '/Home')
		queue.reset()
		expect(attempts[0].options.signal.aborted).toBe(true)
		expect(queue.snapshot()).toMatchObject({batches: []})
		expect(queue.snapshot().items.size).toBe(0)
	})
})

describe('listing acknowledgement', () => {
	test('a completed upload the server has listed is marked, and only then', async () => {
		const {queue, settle} = createHarness()
		const {itemIds} = queue.enqueueUploads([file('a')], '/Home')
		queue.acknowledgeListed(itemIds)
		expect(queue.snapshot().items.get(itemIds[0])?.listed).toBeUndefined()
		await settle('a', {type: 'completed', path: '/Home/a'})
		queue.acknowledgeListed(itemIds)
		expect(queue.snapshot().items.get(itemIds[0])?.listed).toBe(true)
	})
})

describe('large batches', () => {
	test('cancelling thousands of queued items is one pass, and the batch retires', async () => {
		const {queue, attempts} = createHarness()
		const files = Array.from({length: 5_000}, (_, i) => file(`f${i}`))
		const {batchId, itemIds} = queue.enqueueUploads(files, '/Home')
		expect(queue.snapshot().batches[0].itemIds).toHaveLength(5_000)
		const started = performance.now()
		expect(queue.cancelAll()).toBe(5_000)
		expect(performance.now() - started).toBeLessThan(1_000)
		expect(queue.snapshot().items.get(itemIds[4_999])?.state).toBe('cancelled')
		expect(queue.snapshot().items.get(itemIds[0])?.state).toBe('cancelling')
		await flush()
		expect(attempts.every((attempt) => attempt.options.signal.aborted)).toBe(true)
		vi.advanceTimersByTime(500)
		expect(queue.snapshot().batches.find((batch) => batch.id === batchId)).toBeUndefined()
	})
})
