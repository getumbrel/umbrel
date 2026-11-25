import {afterEach, describe, expect, test, vi} from 'vitest'

import {ThumbnailQueue} from './thumbnail-queue'

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve))

afterEach(() => vi.useRealTimers())

describe('ThumbnailQueue', () => {
	test('admits visible work nearest the viewport middle before overscan regardless of registration order', async () => {
		const queue = new ThumbnailQueue({capacity: 2})
		queue.visible = () => ({start: 10, end: 14})
		const granted: number[] = []
		for (const index of [7, 8, 9, 10, 11, 12, 13, 14, 15])
			queue.enqueue(
				() => index,
				() => granted.push(index),
			)

		await flush()

		expect(granted).toEqual([12, 11])
	})

	test('reads what is visible whenever a slot frees', async () => {
		const queue = new ThumbnailQueue({capacity: 1})
		let focal = 0
		queue.visible = () => ({start: focal, end: focal})
		const granted: number[] = []
		const first = queue.enqueue(
			() => 0,
			() => granted.push(0),
		)
		queue.enqueue(
			() => 10,
			() => granted.push(10),
		)
		queue.enqueue(
			() => 20,
			() => granted.push(20),
		)
		await flush()
		expect(granted).toEqual([0])

		focal = 20
		first.settle()

		expect(granted).toEqual([0, 20])
	})

	test('drops waiting work and frees granted work exactly once', async () => {
		const queue = new ThumbnailQueue({capacity: 1})
		const granted: number[] = []
		const first = queue.enqueue(
			() => 0,
			() => granted.push(0),
		)
		const removed = queue.enqueue(
			() => 1,
			() => granted.push(1),
		)
		queue.enqueue(
			() => 2,
			() => granted.push(2),
		)
		removed.release()
		await flush()

		first.release()
		first.release()

		expect(granted).toEqual([0, 2])
	})

	test('holds waiting work back while nothing is said to be visible, and admits it on resume', async () => {
		const queue = new ThumbnailQueue({capacity: 2})
		let visible: {start: number; end: number} | null = null
		queue.visible = () => visible
		const granted: number[] = []
		for (const index of [0, 1, 2])
			queue.enqueue(
				() => index,
				() => granted.push(index),
			)
		await flush()
		expect(granted).toEqual([])

		visible = {start: 1, end: 2}
		queue.resume()

		expect(granted).toEqual([1, 2])
	})

	test('is idle once nothing is waiting or in flight', async () => {
		const queue = new ThumbnailQueue({capacity: 1})
		await queue.idle()
		const first = queue.enqueue(
			() => 0,
			() => {},
		)
		const second = queue.enqueue(
			() => 1,
			() => {},
		)
		await flush()
		let idle = false
		void queue.idle().then(() => (idle = true))

		first.settle()
		await flush()
		expect(idle).toBe(false)

		second.release()
		await flush()
		expect(idle).toBe(true)
	})

	test('remembers what has loaded', () => {
		const queue = new ThumbnailQueue()
		expect(queue.remembers('/thumb/a')).toBe(false)
		queue.remember('/thumb/a')
		expect(queue.remembers('/thumb/a')).toBe(true)
	})

	test('a stalled image cannot hold a slot forever', async () => {
		vi.useFakeTimers()
		const queue = new ThumbnailQueue({capacity: 1, stallMs: 100})
		const granted: number[] = []
		queue.enqueue(
			() => 0,
			() => granted.push(0),
		)
		queue.enqueue(
			() => 1,
			() => granted.push(1),
		)
		await flush()

		await vi.advanceTimersByTimeAsync(100)

		expect(granted).toEqual([0, 1])
	})
})
