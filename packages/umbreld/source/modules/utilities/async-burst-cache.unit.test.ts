import {afterEach, expect, test, vi} from 'vitest'

import AsyncBurstCache from './async-burst-cache.ts'

afterEach(() => vi.useRealTimers())

test('shares slow in-flight loads and briefly caches the resolved snapshot', async () => {
	vi.useFakeTimers()
	let resolve!: (value: number) => void
	const load = vi.fn(() => new Promise<number>((done) => (resolve = done)))
	const cache = new AsyncBurstCache(load, 1000)

	const first = cache.get()
	const concurrent = cache.get()
	vi.advanceTimersByTime(5000)
	const stillInFlight = cache.get()
	expect(load).toHaveBeenCalledOnce()

	resolve(42)
	await expect(Promise.all([first, concurrent, stillInFlight])).resolves.toStrictEqual([42, 42, 42])
	expect(await cache.get()).toBe(42)
	expect(load).toHaveBeenCalledOnce()

	vi.advanceTimersByTime(1001)
	cache.get()
	expect(load).toHaveBeenCalledTimes(2)
})

test('clear and rejected loads force the next caller to reload', async () => {
	const load = vi.fn().mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce(2).mockResolvedValueOnce(3)
	const cache = new AsyncBurstCache(load, 1000)

	await expect(cache.get()).rejects.toThrow('read failed')
	await expect(cache.get()).resolves.toBe(2)
	cache.clear()
	await expect(cache.get()).resolves.toBe(3)
	expect(load).toHaveBeenCalledTimes(3)
})

test('clearing an in-flight load cannot replace the newer snapshot when it settles', async () => {
	let resolveFirst!: (value: number) => void
	let resolveSecond!: (value: number) => void
	const load = vi
		.fn()
		.mockImplementationOnce(() => new Promise<number>((resolve) => (resolveFirst = resolve)))
		.mockImplementationOnce(() => new Promise<number>((resolve) => (resolveSecond = resolve)))
	const cache = new AsyncBurstCache(load, 1000)

	const first = cache.get()
	cache.clear()
	const second = cache.get()
	expect(load).toHaveBeenCalledTimes(2)

	resolveSecond(2)
	await expect(second).resolves.toBe(2)
	resolveFirst(1)
	await expect(first).resolves.toBe(1)

	await expect(cache.get()).resolves.toBe(2)
	expect(load).toHaveBeenCalledTimes(2)
})
