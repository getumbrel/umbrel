import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import nodePath from 'node:path'

import fse from 'fs-extra'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import type {FileChangeEvent} from './watcher.ts'

const mocks = vi.hoisted(() => {
	const command = vi.fn(() => Promise.resolve({stdout: ''}))
	const shutdownResult = {stdout: '{"shutdown-server":true}', stderr: '', exitCode: 0, timedOut: false}
	const shutdown = vi.fn(() => Promise.resolve(shutdownResult))
	return {
		command,
		shutdownResult,
		shutdown,
		execaDollar: vi.fn((first: unknown) => (Array.isArray(first) ? command() : shutdown)),
		subscribe: vi.fn(),
		close: vi.fn(),
	}
})

vi.mock('execa', () => ({$: mocks.execaDollar}))
vi.mock('./watchman.ts', async (importOriginal) => ({
	...(await importOriginal<typeof import('./watchman.ts')>()),
	default: class {
		subscribe = mocks.subscribe
		close = mocks.close
	},
}))

import Watcher from './watcher.ts'
import {WatchmanFreshInstanceError, WatchmanSubscriptionLostError} from './watchman.ts'

const cleanups: Array<() => Promise<void>> = []

beforeEach(() => {
	vi.clearAllMocks()
	mocks.shutdown.mockResolvedValue(mocks.shutdownResult)
})

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
	vi.useRealTimers()
})

test('watcher health does not fail behind a busy consumer queue', async () => {
	const root = await mkdtemp(nodePath.join(tmpdir(), 'watcher-unit-'))
	cleanups.push(() => rm(root, {recursive: true, force: true}))
	const home = nodePath.join(root, 'home')
	await fse.ensureDir(home)

	const callbacks: Array<(error: Error | null, events: FileChangeEvent[]) => void> = []
	const unsubscribe = vi.fn(async () => {})
	mocks.subscribe.mockImplementation(async (_path, callback) => {
		callbacks.push(callback)
		return {unsubscribe}
	})

	const neverSettles = new Promise<void>(() => {})
	const emitFileChanges = vi.fn(() => neverSettles)
	const onChangeBatch = vi.fn()
	const logger = {error: vi.fn(), log: vi.fn(), verbose: vi.fn()}
	const umbreld = {
		eventBus: {emitFileChanges},
		files: {
			virtualToSystemPath: vi.fn(async () => home),
			virtualToSystemPathUnsafe: vi.fn(() => home),
		},
		logger: {createChildLogger: () => logger},
	} as unknown as Umbreld
	const filesWatcher = new Watcher(umbreld, {paths: ['/Home'], onChangeBatch})
	cleanups.push(() => filesWatcher.stop())

	await filesWatcher.start()
	const sentinelPath = nodePath.join(home, '.umbrel-watcher-health-check')
	await vi.waitFor(async () => expect(await fse.pathExists(sentinelPath)).toBe(true))

	// Occupy the single dispatch queue worker indefinitely, then deliver the
	// sentinel in a later native callback. Health checks should observe the raw
	// callback rather than waiting behind consumer work.
	const busyEvents: FileChangeEvent[] = [{type: 'create', path: nodePath.join(home, 'busy-file')}]
	callbacks[0](null, busyEvents)
	await vi.waitFor(() => expect(emitFileChanges).toHaveBeenCalledOnce())
	callbacks[0](null, [{type: 'create', path: sentinelPath}])

	await vi.waitFor(() => expect(logger.verbose).toHaveBeenCalledWith('Health check passed'))
	expect(onChangeBatch).toHaveBeenNthCalledWith(1, '/Home', busyEvents)
	// Internal batch consumers stay behind the same serialized callback boundary
	// as public delivery. Only health detection bypasses that queue.
	expect(onChangeBatch).toHaveBeenCalledOnce()
	expect(mocks.subscribe).toHaveBeenCalledOnce()
	expect(logger.error).not.toHaveBeenCalledWith(expect.stringContaining('Health check failed'))

	await filesWatcher.stop()
	expect(unsubscribe).toHaveBeenCalledOnce()
})

describe('Watchman recovery', () => {
	const interval = 5 * 60 * 1000
	const timeout = 30 * 1000

	beforeEach(() => vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']}))

	async function fixture(paths = ['/Home']) {
		const root = await mkdtemp(nodePath.join(tmpdir(), 'watcher-recovery-'))
		cleanups.push(() => rm(root, {recursive: true, force: true}))
		const systemPath = (path: string) => nodePath.join(root, path.slice(1))
		await Promise.all(paths.map((path) => fse.ensureDir(systemPath(path))))
		const subscriptions: Array<{
			path: string
			callback: (error: Error | null, events: FileChangeEvent[]) => void
			unsubscribe: ReturnType<typeof vi.fn>
		}> = []
		const failures = new Map<string, string>()
		mocks.subscribe.mockImplementation(async (path, callback) => {
			if (failures.has(path)) throw new Error(failures.get(path))
			const subscription = {path, callback, unsubscribe: vi.fn(async () => {})}
			subscriptions.push(subscription)
			return subscription
		})
		const logger = {error: vi.fn(), log: vi.fn(), verbose: vi.fn()}
		const onRestart = vi.fn()
		const emitFileChanges = vi.fn(async () => {})
		const watcher = new Watcher(
			{
				files: {
					virtualToSystemPath: async (path: string) => systemPath(path),
					virtualToSystemPathUnsafe: systemPath,
				},
				eventBus: {emitFileChanges},
				logger: {createChildLogger: () => logger},
			} as unknown as Umbreld,
			{paths, onRestart},
		)
		cleanups.push(() => watcher.stop())
		const sentinel = nodePath.join(systemPath('/Home'), '.umbrel-watcher-health-check')
		const waitForProbe = () => vi.waitFor(async () => expect(await fse.readFile(sentinel, 'utf8')).not.toBe(''))
		const deliverSentinel = () => {
			const home = subscriptions.filter(({path}) => path === systemPath('/Home')).at(-1)!
			home.callback(null, [{type: 'update', path: sentinel}])
		}
		return {
			watcher,
			subscriptions,
			failures,
			systemPath,
			sentinel,
			waitForProbe,
			deliverSentinel,
			logger,
			onRestart,
			emitFileChanges,
		}
	}

	test('restarts the daemon and requires a fresh event before requesting a catch-up scan', async () => {
		const f = await fixture()
		await f.watcher.start()
		await f.waitForProbe()
		await vi.advanceTimersByTimeAsync(timeout)
		await vi.waitFor(() => expect(f.subscriptions).toHaveLength(2))
		await f.waitForProbe()
		expect(f.subscriptions[0].unsubscribe).toHaveBeenCalledOnce()
		expect(mocks.shutdown).toHaveBeenCalledOnce()
		expect(f.subscriptions[0].unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.close.mock.invocationCallOrder[0],
		)
		// The connection is retired before the restart, not left for the retry pass
		expect(mocks.close.mock.invocationCallOrder[0]).toBeLessThan(mocks.shutdown.mock.invocationCallOrder[0])
		expect(mocks.shutdown.mock.invocationCallOrder[0]).toBeLessThan(mocks.subscribe.mock.invocationCallOrder[1])
		expect(mocks.execaDollar).toHaveBeenCalledWith({timeout: 5000, preferLocal: false, reject: false})
		expect(f.onRestart).not.toHaveBeenCalled()

		// Neither a late callback from the old subscription nor sentinel cleanup
		// proves that the new subscription can observe a write.
		f.subscriptions[0].callback(null, [{type: 'update', path: f.sentinel}])
		f.subscriptions[1].callback(null, [{type: 'delete', path: f.sentinel}])
		await vi.advanceTimersByTimeAsync(100)
		expect(f.onRestart).not.toHaveBeenCalled()
		f.deliverSentinel()
		await vi.waitFor(() => expect(f.onRestart).toHaveBeenCalledOnce())

		const event: FileChangeEvent = {type: 'create', path: f.systemPath('/Home/after.txt')}
		f.subscriptions[1].callback(null, [event])
		await vi.waitFor(() => expect(f.emitFileChanges).toHaveBeenCalledWith([event]))
		await vi.advanceTimersToNextTimerAsync()
		await f.waitForProbe()
		f.deliverSentinel()
		await vi.waitFor(() => expect(f.logger.verbose).toHaveBeenCalledTimes(2))
		expect(mocks.shutdown).toHaveBeenCalledOnce()
		expect(f.onRestart).toHaveBeenCalledOnce()
	})

	test.each([
		{failure: 'all roots', failedPaths: ['/Home', '/Trash']},
		{failure: 'Trash only', failedPaths: ['/Trash']},
	])('retries unavailable roots ($failure) without restarting healthy watches', async ({failedPaths}) => {
		const f = await fixture(['/Home', '/Trash'])
		for (const path of failedPaths) f.failures.set(f.systemPath(path), 'directory unavailable')
		await f.watcher.start()
		for (let attempt = 0; attempt < 3; attempt++) {
			if (failedPaths.includes('/Home')) {
				await vi.waitFor(() =>
					expect(f.logger.error).toHaveBeenCalledWith(
						'Watcher health check failed; will retry at the next interval',
						expect.objectContaining({message: 'Cannot verify event delivery without a Home subscription'}),
					),
				)
			} else {
				await f.waitForProbe()
				f.deliverSentinel()
				await vi.waitFor(() => expect(f.logger.verbose).toHaveBeenCalledTimes(attempt + 1))
			}
			expect(mocks.shutdown).not.toHaveBeenCalled()
			expect(f.onRestart).not.toHaveBeenCalled()
			for (const subscription of f.subscriptions) expect(subscription.unsubscribe).not.toHaveBeenCalled()
			if (attempt < 2) {
				f.logger.error.mockClear()
				await vi.advanceTimersToNextTimerAsync()
			}
		}
		f.failures.clear()
		await vi.advanceTimersToNextTimerAsync()
		await vi.waitFor(() => expect(f.watcher.subscriptions.size).toBe(2))
		await f.waitForProbe()
		expect(f.onRestart).not.toHaveBeenCalled()
		f.deliverSentinel()
		await vi.waitFor(() => expect(f.onRestart).toHaveBeenCalledOnce())
		expect(mocks.shutdown).not.toHaveBeenCalled()
	})

	test('restarts an explicitly poisoned daemon even when no initial subscription succeeded', async () => {
		const f = await fixture(['/Home', '/Trash'])
		for (const path of ['/Home', '/Trash']) {
			f.failures.set(
				f.systemPath(path),
				'A non-recoverable condition has triggered. All requests will continue to fail',
			)
		}
		mocks.shutdown.mockImplementationOnce(async () => {
			f.failures.clear()
			return mocks.shutdownResult
		})
		await f.watcher.start()
		await vi.waitFor(() => expect(f.watcher.subscriptions.size).toBe(2))
		await f.waitForProbe()
		expect(f.onRestart).not.toHaveBeenCalled()
		f.deliverSentinel()
		await vi.waitFor(() => expect(f.onRestart).toHaveBeenCalledOnce())
		expect(mocks.shutdown).toHaveBeenCalledOnce()
	})

	test('retries roots whose first subscription after a restart used the retired daemon connection', async () => {
		const f = await fixture(['/Home', '/Trash'])
		await f.watcher.start()
		await f.waitForProbe()
		f.deliverSentinel()
		await vi.waitFor(() => expect(f.logger.verbose).toHaveBeenCalledOnce())
		const poison = new Error('A non-recoverable condition has triggered. All requests will continue to fail')
		for (const subscription of f.subscriptions) subscription.unsubscribe.mockRejectedValue(poison)
		// The first request after the restart can still fail, for example on a
		// connection to the old daemon that hasn't been noticed as closed yet.
		mocks.shutdown.mockImplementationOnce(async () => {
			mocks.subscribe.mockRejectedValueOnce(new Error('Socket ended unexpectedly'))
			return mocks.shutdownResult
		})
		f.subscriptions[1].callback(poison, [])
		await vi.advanceTimersToNextTimerAsync()
		await vi.waitFor(() => expect(f.watcher.subscriptions.size).toBe(2))
		await f.waitForProbe()
		f.deliverSentinel()
		await vi.waitFor(() => expect(f.onRestart).toHaveBeenCalledOnce())
		expect(mocks.shutdown).toHaveBeenCalledOnce()
	})

	test('silent replacement subscriptions do not trigger scans and can recover on a later check', async () => {
		const f = await fixture()
		await f.watcher.start()
		await f.waitForProbe()
		await vi.advanceTimersByTimeAsync(timeout)
		await vi.waitFor(() => expect(f.subscriptions).toHaveLength(2))
		await f.waitForProbe()
		await vi.advanceTimersByTimeAsync(timeout)
		await vi.waitFor(() =>
			expect(f.logger.error).toHaveBeenCalledWith(
				'Watcher health check failed; will retry at the next interval',
				expect.objectContaining({message: 'Restarted Watchman did not deliver a sentinel event'}),
			),
		)
		expect(f.onRestart).not.toHaveBeenCalled()
		expect(mocks.shutdown).toHaveBeenCalledOnce()
		await vi.advanceTimersToNextTimerAsync()
		await f.waitForProbe()
		f.deliverSentinel()
		await vi.waitFor(() => expect(f.onRestart).toHaveBeenCalledOnce())
	})

	test('does not overlap recovery attempts and restores roots added during the restart', async () => {
		const f = await fixture()
		let finishShutdown!: () => void
		mocks.shutdown.mockImplementationOnce(
			() => new Promise((resolve) => (finishShutdown = () => resolve(mocks.shutdownResult))),
		)
		await f.watcher.start()
		await f.waitForProbe()
		await vi.advanceTimersByTimeAsync(timeout)
		await vi.waitFor(() => expect(mocks.shutdown).toHaveBeenCalledOnce())
		await fse.ensureDir(f.systemPath('/Trash'))
		await f.watcher.addPath('/Trash')
		await vi.advanceTimersByTimeAsync(interval * 2)
		expect(mocks.shutdown).toHaveBeenCalledOnce()
		expect(f.subscriptions).toHaveLength(1)
		finishShutdown()
		await vi.waitFor(() => expect(f.watcher.subscriptions.size).toBe(2))
		await f.waitForProbe()
		f.deliverSentinel()
		await vi.waitFor(() => expect(f.onRestart).toHaveBeenCalledOnce())
	})

	test('a failed root added during verification does not block catch-up for restored roots', async () => {
		const f = await fixture()
		await f.watcher.start()
		await f.waitForProbe()
		await vi.advanceTimersByTimeAsync(timeout)
		await vi.waitFor(() => expect(f.subscriptions).toHaveLength(2))
		await f.waitForProbe()
		await fse.ensureDir(f.systemPath('/Trash'))
		f.failures.set(f.systemPath('/Trash'), 'subscription failed')
		await f.watcher.addPath('/Trash')
		f.deliverSentinel()
		await vi.waitFor(() => expect(f.onRestart).toHaveBeenCalledOnce())
		expect(f.logger.error).toHaveBeenCalledWith(
			'Some directories remain unwatched; will retry their subscriptions at the next interval',
		)
		await vi.advanceTimersToNextTimerAsync()
		await f.waitForProbe()
		f.deliverSentinel()
		await vi.waitFor(() => expect(f.logger.verbose).toHaveBeenCalledTimes(2))
		expect(mocks.shutdown).toHaveBeenCalledOnce()
		expect(f.onRestart).toHaveBeenCalledOnce()
		f.failures.clear()
		await vi.advanceTimersToNextTimerAsync()
		await f.waitForProbe()
		f.deliverSentinel()
		await vi.waitFor(() => expect(f.onRestart).toHaveBeenCalledTimes(2))
		expect(mocks.shutdown).toHaveBeenCalledOnce()
	})

	test('a failed shutdown command does not resubscribe to the broken daemon or request a scan', async () => {
		const f = await fixture()
		mocks.shutdown.mockRejectedValueOnce(new Error('command timed out'))
		await f.watcher.start()
		await f.waitForProbe()
		await vi.advanceTimersByTimeAsync(timeout)
		await vi.waitFor(() =>
			expect(f.logger.error).toHaveBeenCalledWith(
				'Watcher health check failed; will retry at the next interval',
				expect.objectContaining({message: 'command timed out'}),
			),
		)
		expect(f.subscriptions).toHaveLength(1)
		expect(f.onRestart).not.toHaveBeenCalled()
		await vi.advanceTimersToNextTimerAsync()
		await vi.waitFor(() => expect(f.subscriptions).toHaveLength(2))
		await f.waitForProbe()
		f.deliverSentinel()
		await vi.waitFor(() => expect(f.onRestart).toHaveBeenCalledOnce())
	})

	test('an already stopped daemon does not prevent recovery or get spawned just for shutdown', async () => {
		const f = await fixture()
		mocks.shutdown.mockResolvedValueOnce({...mocks.shutdownResult, exitCode: 1, stdout: ''})
		await f.watcher.start()
		await f.waitForProbe()
		await vi.advanceTimersByTimeAsync(timeout)
		await vi.waitFor(() => expect(f.subscriptions).toHaveLength(2))
		await f.waitForProbe()
		f.deliverSentinel()
		await vi.waitFor(() => expect(f.onRestart).toHaveBeenCalledOnce())
		expect(mocks.shutdown).toHaveBeenCalledWith(['watchman --no-spawn --no-local shutdown-server'])
	})

	test.each([
		{name: 'timeout', result: {exitCode: 1, stdout: '', stderr: '', timedOut: true}},
		{name: 'command error', result: {exitCode: 1, stdout: '', stderr: 'permission denied', timedOut: false}},
		{name: 'JSON error', result: {exitCode: 0, stdout: '{"error":"shutdown failed"}', stderr: '', timedOut: false}},
	])('does not accept a shutdown $name as an absent daemon', async ({result}) => {
		const f = await fixture()
		mocks.shutdown.mockResolvedValueOnce(result)
		await f.watcher.start()
		await f.waitForProbe()
		await vi.advanceTimersByTimeAsync(timeout)
		await vi.waitFor(() =>
			expect(f.logger.error).toHaveBeenCalledWith(
				'Watcher health check failed; will retry at the next interval',
				expect.any(Error),
			),
		)
		expect(f.subscriptions).toHaveLength(1)
		expect(f.onRestart).not.toHaveBeenCalled()
	})

	test('shutdown cancels an outstanding probe and prevents later recovery', async () => {
		const f = await fixture()
		await f.watcher.start()
		await f.waitForProbe()
		await f.watcher.stop()
		await vi.advanceTimersByTimeAsync(interval * 2)
		expect(f.subscriptions).toHaveLength(1)
		expect(mocks.shutdown).toHaveBeenCalledOnce()
		expect(f.onRestart).not.toHaveBeenCalled()
		expect(await fse.pathExists(f.sentinel)).toBe(false)
	})

	test('shutdown during daemon restart prevents replacement subscriptions', async () => {
		const f = await fixture()
		let finishShutdown!: () => void
		mocks.shutdown.mockImplementationOnce(
			() => new Promise((resolve) => (finishShutdown = () => resolve(mocks.shutdownResult))),
		)
		await f.watcher.start()
		await f.waitForProbe()
		await vi.advanceTimersByTimeAsync(timeout)
		await vi.waitFor(() => expect(mocks.shutdown).toHaveBeenCalledOnce())
		const stopped = f.watcher.stop()
		finishShutdown()
		await stopped
		await vi.advanceTimersByTimeAsync(interval)
		expect(f.subscriptions).toHaveLength(1)
		expect(f.onRestart).not.toHaveBeenCalled()
		expect(f.watcher.subscriptions.size).toBe(0)
	})

	test('resubscribes a lost root after a short delay and rescans once events are verified', async () => {
		const f = await fixture(['/Home', '/Trash'])
		await f.watcher.start()
		await f.waitForProbe()
		f.deliverSentinel()
		await vi.waitFor(() => expect(f.logger.verbose).toHaveBeenCalledOnce())

		f.subscriptions[1].callback(new WatchmanSubscriptionLostError('Lost Watchman subscription'), [])
		expect(f.watcher.subscriptions.has('/Trash')).toBe(false)
		// Not straight away, so a daemon that keeps failing can't cause a tight loop
		await vi.advanceTimersByTimeAsync(4000)
		expect(f.subscriptions).toHaveLength(2)

		await vi.advanceTimersByTimeAsync(1000)
		await vi.waitFor(() => expect(f.subscriptions).toHaveLength(3))
		expect(f.subscriptions[2].path).toBe(f.systemPath('/Trash'))
		await f.waitForProbe()
		f.deliverSentinel()
		await vi.waitFor(() => expect(f.onRestart).toHaveBeenCalledOnce())
		// Recovering one root doesn't restart the daemon or disturb the others
		expect(mocks.shutdown).not.toHaveBeenCalled()
		expect(f.subscriptions[0].unsubscribe).not.toHaveBeenCalled()
	})

	test('resubscribes quickly only once per health check interval', async () => {
		const f = await fixture(['/Home', '/Trash'])
		await f.watcher.start()
		await f.waitForProbe()
		f.deliverSentinel()
		await vi.waitFor(() => expect(f.logger.verbose).toHaveBeenCalledOnce())
		const lose = () => f.subscriptions.at(-1)!.callback(new WatchmanSubscriptionLostError('Lost'), [])

		lose()
		await vi.advanceTimersByTimeAsync(5000)
		await vi.waitFor(() => expect(f.subscriptions).toHaveLength(3))
		await f.waitForProbe()
		f.deliverSentinel()
		await vi.waitFor(() => expect(f.logger.verbose).toHaveBeenCalledTimes(2))

		// A root that keeps failing waits for the regular health check
		lose()
		await vi.advanceTimersByTimeAsync(10_000)
		expect(f.subscriptions).toHaveLength(3)
		await vi.advanceTimersByTimeAsync(interval - 15_000)
		await vi.waitFor(() => expect(f.subscriptions).toHaveLength(4))
		await f.waitForProbe()
		f.deliverSentinel()
		await vi.waitFor(() => expect(f.logger.verbose).toHaveBeenCalledTimes(3))

		// The next interval allows a quick resubscribe again
		lose()
		await vi.advanceTimersByTimeAsync(5000)
		await vi.waitFor(() => expect(f.subscriptions).toHaveLength(5))
		expect(mocks.shutdown).not.toHaveBeenCalled()
	})

	test('does not rescan for a lost root that cannot be resubscribed', async () => {
		const f = await fixture(['/Home', '/Trash'])
		await f.watcher.start()
		await f.waitForProbe()
		f.deliverSentinel()
		await vi.waitFor(() => expect(f.logger.verbose).toHaveBeenCalledOnce())

		// For example, Watchman cancels the subscription because its root was deleted
		mocks.subscribe.mockRejectedValueOnce(new Error('No such file or directory'))
		f.subscriptions[1].callback(new WatchmanSubscriptionLostError('Lost Watchman subscription'), [])
		await vi.advanceTimersByTimeAsync(5000)
		await f.waitForProbe()
		f.deliverSentinel()
		await vi.waitFor(() => expect(f.logger.verbose).toHaveBeenCalledTimes(2))
		expect(f.watcher.subscriptions.has('/Trash')).toBe(false)
		expect(f.onRestart).not.toHaveBeenCalled()
		expect(mocks.shutdown).not.toHaveBeenCalled()
	})

	test('rescans on a fresh instance without dropping the subscription', async () => {
		const f = await fixture()
		await f.watcher.start()
		await f.waitForProbe()
		f.deliverSentinel()
		await vi.waitFor(() => expect(f.logger.verbose).toHaveBeenCalledOnce())

		const dispatchedBefore = f.emitFileChanges.mock.calls.length
		f.subscriptions[0].callback(new WatchmanFreshInstanceError('Watchman reported a fresh instance'), [])

		expect(f.onRestart).toHaveBeenCalledOnce()
		expect(f.watcher.subscriptions.has('/Home')).toBe(true)
		expect(f.emitFileChanges).toHaveBeenCalledTimes(dispatchedBefore)
		await vi.advanceTimersByTimeAsync(10_000)
		expect(f.subscriptions).toHaveLength(1)
	})

	test('ignores lost subscriptions reported after stopping', async () => {
		const f = await fixture()
		await f.watcher.start()
		await f.waitForProbe()
		await f.watcher.stop()

		f.subscriptions[0].callback(new WatchmanSubscriptionLostError('Lost Watchman subscription'), [])
		await vi.advanceTimersByTimeAsync(interval)

		expect(f.subscriptions).toHaveLength(1)
		expect(f.onRestart).not.toHaveBeenCalled()
	})
})
