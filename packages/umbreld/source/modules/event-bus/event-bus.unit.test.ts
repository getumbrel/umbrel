import {afterEach, describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import EventBus from './event-bus.ts'

afterEach(() => vi.useRealTimers())

function createEventBus({isVerbose = false} = {}) {
	const logger = {log: vi.fn(), verbose: vi.fn(), error: vi.fn(), isVerbose}
	const umbreld = {
		logger: {createChildLogger: () => logger},
	} as unknown as Umbreld

	return {eventBus: new EventBus(umbreld), logger}
}

describe('emitFileChanges()', () => {
	const events = Array.from({length: 25}, (_, index) => ({type: 'create' as const, path: `/tmp/${index}`}))

	test('delivers each batch to every listener in one call', async () => {
		const {eventBus} = createEventBus()
		const first = vi.fn()
		const second = vi.fn()
		eventBus.onFileChanges(first)
		eventBus.onFileChanges(second)

		await eventBus.emitFileChanges(events)

		expect(first.mock.calls).toStrictEqual([[events]])
		expect(second.mock.calls).toStrictEqual([[events]])
	})

	test('delivers every event of a batch to streams, in order', async () => {
		const {eventBus} = createEventBus()
		const stream = eventBus.stream('files:watcher:change')

		await eventBus.emitFileChanges(events)

		const received = []
		for await (const event of stream) if (received.push(event) === events.length) break
		expect(received).toStrictEqual(events)
	})

	test('treats a single emitted file change as a batch of one', async () => {
		const {eventBus} = createEventBus()
		const listener = vi.fn()
		eventBus.onFileChanges(listener)
		const stream = eventBus.stream('files:watcher:change')

		await eventBus.emit('files:watcher:change', {type: 'delete', path: '/tmp/a'})

		expect(listener.mock.calls).toStrictEqual([[[{type: 'delete', path: '/tmp/a'}]]])
		await expect(stream.next()).resolves.toStrictEqual({done: false, value: {type: 'delete', path: '/tmp/a'}})
	})

	test('stops delivering to a listener once it unsubscribes', async () => {
		const {eventBus} = createEventBus()
		const listener = vi.fn()
		const unsubscribe = eventBus.onFileChanges(listener)
		unsubscribe()

		await eventBus.emitFileChanges(events)

		expect(listener).not.toHaveBeenCalled()
	})

	test('logs a failing listener without affecting the others', async () => {
		const {eventBus, logger} = createEventBus()
		const healthy = vi.fn()
		eventBus.onFileChanges(() => {
			throw new Error('boom')
		})
		eventBus.onFileChanges(async () => Promise.reject(new Error('async boom')))
		eventBus.onFileChanges(healthy)

		await eventBus.emitFileChanges(events)

		expect(healthy).toHaveBeenCalledOnce()
		expect(logger.error).toHaveBeenCalledTimes(2)
	})

	test("doesn't let a listener that never settles hold up later batches", async () => {
		vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
		const {eventBus, logger} = createEventBus()
		let release!: () => void
		let settled = false
		const listener = vi.fn((batch: readonly {path: string}[]) => {
			if (batch[0].path === '/tmp/slow') {
				return new Promise<void>((resolve) => (release = resolve)).then(() => {
					settled = true
				})
			}
		})
		eventBus.onFileChanges(listener)

		const slow = eventBus.emitFileChanges([{type: 'create', path: '/tmp/slow'}], {timeoutMs: 1000})
		await vi.advanceTimersByTimeAsync(1000)
		await slow
		await eventBus.emitFileChanges([{type: 'create', path: '/tmp/next'}], {timeoutMs: 1000})

		expect(listener).toHaveBeenCalledTimes(2)
		expect(settled).toBe(false)
		expect(logger.error.mock.calls).toStrictEqual([
			['File change listeners exceeded 1000ms; continuing with later batches'],
		])
		release()
		await vi.waitFor(() => expect(settled).toBe(true))
	})

	test('delivers a large batch in order, a chunk at a time', async () => {
		const {eventBus} = createEventBus()
		const chunks: number[] = []
		const delivered: string[] = []
		eventBus.onFileChanges((batch) => {
			chunks.push(batch.length)
			for (const {path} of batch) delivered.push(path)
		})
		const stream = eventBus.stream('files:watcher:change')
		const large = Array.from({length: 10_000}, (_, index) => ({type: 'create' as const, path: `/tmp/${index}`}))

		await eventBus.emitFileChanges(large)

		expect(chunks).toStrictEqual([4096, 4096, 1808])
		expect(delivered).toStrictEqual(large.map(({path}) => path))
		const streamed = []
		for await (const event of stream) if (streamed.push(event) === large.length) break
		expect(streamed).toStrictEqual(large)
	})

	test('lets the event loop run between chunks of a large batch', async () => {
		const {eventBus} = createEventBus()
		let chunks = 0
		eventBus.onFileChanges(() => {
			const until = performance.now() + 20
			while (performance.now() < until) {}
			chunks++
		})
		let chunksWhenTimerFired: number | undefined
		setTimeout(() => (chunksWhenTimerFired = chunks), 0)

		await eventBus.emitFileChanges(Array.from({length: 10 * 4096}, (_, index) => ({type: 'create', path: `/${index}`})))

		expect(chunks).toBe(10)
		expect(chunksWhenTimerFired).toBeLessThan(10)
	})

	test('rejects invalid timeouts without delivering anything', async () => {
		const {eventBus} = createEventBus()
		const listener = vi.fn()
		eventBus.onFileChanges(listener)

		await expect(eventBus.emitFileChanges(events, {timeoutMs: 0})).rejects.toThrow('timeout must be positive')
		expect(listener).not.toHaveBeenCalled()
	})
})

describe('stream()', () => {
	test('delivers every event in order to a subscriber that falls behind', async () => {
		const {eventBus} = createEventBus()
		const stream = eventBus.stream('files:watcher:change')
		for (let i = 0; i < 5000; i++) await eventBus.emit('files:watcher:change', {type: 'create', path: `/f${i}`})

		const received: string[] = []
		for await (const event of stream) {
			received.push(event.path)
			if (received.length === 5000) break
		}

		expect(received).toEqual(Array.from({length: 5000}, (_, i) => `/f${i}`))
	})

	test('drains a large backlog in linear time', async () => {
		const {eventBus} = createEventBus()
		const stream = eventBus.stream('files:watcher:change')
		const emits = Array.from({length: 200_000}, (_, i) =>
			eventBus.emit('files:watcher:change', {type: 'delete', path: `/f${i}`}),
		)
		await Promise.all(emits)

		const start = performance.now()
		let count = 0
		for await (const _ of stream) if (++count === 200_000) break
		// Dequeuing with Array#shift took several seconds for this backlog
		expect(performance.now() - start).toBeLessThan(1000)
	})

	test('waits for events that arrive after the subscriber caught up', async () => {
		const {eventBus} = createEventBus()
		const stream = eventBus.stream('files:watcher:change')
		const next = stream.next()
		await eventBus.emit('files:watcher:change', {type: 'update', path: '/late'})

		await expect(next).resolves.toEqual({done: false, value: {type: 'update', path: '/late'}})
	})

	test('stops and unsubscribes when aborted, even with events pending', async () => {
		const {eventBus} = createEventBus()
		const controller = new AbortController()
		const stream = eventBus.stream('files:watcher:change', {signal: controller.signal})
		await eventBus.emit('files:watcher:change', {type: 'create', path: '/pending'})
		const waiting = eventBus.stream('files:watcher:change', {signal: controller.signal})
		const blocked = waiting.next()

		controller.abort()

		await expect(stream.next()).resolves.toEqual({done: true, value: undefined})
		await expect(blocked).resolves.toEqual({done: true, value: undefined})
		// Nothing is still listening, so later events aren't buffered anywhere
		await eventBus.emit('files:watcher:change', {type: 'create', path: '/after'})
		await expect(stream.next()).resolves.toEqual({done: true, value: undefined})
	})

	test('unsubscribes when the consumer stops iterating', async () => {
		const {eventBus} = createEventBus()
		const stream = eventBus.stream('files:watcher:change')
		await eventBus.emit('files:watcher:change', {type: 'create', path: '/a'})
		for await (const _ of stream) break

		await expect(stream.next()).resolves.toEqual({done: true, value: undefined})
	})
})

describe('emit()', () => {
	test("doesn't build a log line per event unless verbose logging is on", async () => {
		const quiet = createEventBus()
		await quiet.eventBus.emit('files:watcher:change', {type: 'create', path: '/a'})
		expect(quiet.logger.verbose).not.toHaveBeenCalled()

		const verbose = createEventBus({isVerbose: true})
		await verbose.eventBus.emit('files:watcher:change', {type: 'create', path: '/a'})
		expect(verbose.logger.verbose).toHaveBeenCalledWith('files:watcher:change {"type":"create","path":"/a"}')
	})
})

describe('long bursts', () => {
	const busyWait = (ms: number) => {
		const until = performance.now() + ms
		while (performance.now() < until) {}
	}

	test('let the event loop run while a subscriber drains a backlog', async () => {
		const {eventBus} = createEventBus()
		const stream = eventBus.stream('files:watcher:change')
		await Promise.all(
			Array.from({length: 20_000}, (_, i) => eventBus.emit('files:watcher:change', {type: 'create', path: `/f${i}`})),
		)
		let received = 0
		let receivedWhenTimerFired: number | undefined
		setTimeout(() => (receivedWhenTimerFired = received), 0)

		for await (const _ of stream) {
			busyWait(0.05)
			if (++received === 20_000) break
		}

		expect(receivedWhenTimerFired).toBeLessThan(20_000)
	})
})

describe('on() and once()', () => {
	test('refuse file changes, which only onFileChanges() and stream() deliver', () => {
		const {eventBus} = createEventBus()

		// @ts-expect-error File changes aren't delivered through the emitter
		expect(() => eventBus.on('files:watcher:change', () => {})).toThrow('onFileChanges()')
		// @ts-expect-error File changes aren't delivered through the emitter
		expect(() => eventBus.once('files:watcher:change')).toThrow('onFileChanges()')
	})

	test('still deliver other events', async () => {
		const {eventBus} = createEventBus()
		const listener = vi.fn()
		eventBus.on('notifications:change', listener)
		const once = eventBus.once('notifications:change')

		await eventBus.emit('notifications:change')

		expect(listener).toHaveBeenCalledOnce()
		await expect(once).resolves.toBeUndefined()
	})
})
