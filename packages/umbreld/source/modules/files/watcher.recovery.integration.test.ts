import nodePath from 'node:path'
import {access, mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'

import {execa} from 'execa'
import {expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import Watcher from './watcher.js'

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

test.runIf(process.platform === 'linux')('recovers events from a poisoned Watchman daemon at runtime', async () => {
	const directory = await mkdtemp(nodePath.join(tmpdir(), 'watcher-recovery-'))
	const previousPath = process.env.PATH
	const {stdout: binary} = await execa('which', ['watchman'])
	const binDirectory = nodePath.join(directory, 'bin')
	const pidFile = nodePath.join(directory, 'pid')
	await mkdir(binDirectory)
	const wrapper = nodePath.join(binDirectory, 'watchman')
	// Keep every Watchman command, including Parcel discovery and recovery,
	// on a private daemon. Never poison or stop the host's Watchman instance.
	await writeFile(
		wrapper,
		`#!/bin/sh\nexec ${quote(binary)} --sockname=${quote(nodePath.join(directory, 'socket'))} --statefile=${quote(nodePath.join(directory, 'state'))} --logfile=${quote(nodePath.join(directory, 'log'))} --pidfile=${quote(pidFile)} "$@"\n`,
		{mode: 0o755},
	)
	process.env.PATH = `${binDirectory}:${previousPath}`
	const command = async (...args: string[]) => {
		const result = JSON.parse((await execa(wrapper, ['--no-pretty', ...args], {timeout: 5000})).stdout)
		if (result.error) throw new Error(result.error)
		return result
	}
	const systemPath = (path: string) => nodePath.join(directory, path.slice(1))
	let sentinelDirectory = systemPath('/Home')
	const changes: string[] = []
	const logger = {log: vi.fn(), error: vi.fn(), verbose: vi.fn()}
	const onRestart = vi.fn()
	const watcher = new Watcher(
		{
			files: {virtualToSystemPathUnsafe: systemPath, virtualToSystemPath: async () => sentinelDirectory},
			eventBus: {
				emitFileChanges: async (events: Array<{path: string}>) => {
					changes.push(...events.map(({path}) => path))
				},
			},
			logger: {createChildLogger: () => logger},
		} as unknown as Umbreld,
		{paths: ['/Home', '/Trash'], onRestart},
	)

	// Advance only the five-minute scheduling interval. Sentinel timeouts,
	// filesystem I/O, Parcel callbacks and daemon shutdown all remain real.
	vi.useFakeTimers({toFake: ['setInterval', 'clearInterval']})
	try {
		await Promise.all(['/Home', '/Trash', '/unwatched'].map((path) => mkdir(systemPath(path))))
		await watcher.start()
		await vi.waitFor(() => expect(logger.verbose).toHaveBeenCalledWith('Health check passed'), {
			timeout: 90_000,
			interval: 100,
		})
		const before = systemPath('/Home/before.txt')
		await writeFile(before, 'before failure')
		await vi.waitFor(() => expect(changes).toContain(before), {timeout: 5000, interval: 100})
		const previousPid = await readFile(pidFile, 'utf8')
		// An unavailable member root must not interrupt healthy Home/Trash watches.
		const memberRoot = '/Members/alice/Home'
		await watcher.addPath(memberRoot)
		const previousChecks = logger.verbose.mock.calls.length
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
		await vi.waitFor(() => expect(logger.verbose).toHaveBeenCalledTimes(previousChecks + 1), {timeout: 5000})
		expect(await readFile(pidFile, 'utf8')).toBe(previousPid)
		expect(watcher.subscriptions.has(memberRoot)).toBe(false)
		const restartsBeforeRetry = onRestart.mock.calls.length
		await mkdir(systemPath(memberRoot), {recursive: true})
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
		await vi.waitFor(() => expect(onRestart).toHaveBeenCalledTimes(restartsBeforeRetry + 1), {timeout: 5000})
		expect(watcher.subscriptions.has(memberRoot)).toBe(true)
		expect(await readFile(pidFile, 'utf8')).toBe(previousPid)
		const previousRestarts = onRestart.mock.calls.length

		// Poison does not guarantee existing subscriptions stop delivering events.
		// Put one probe outside the watched tree to inject a missing sentinel, while
		// keeping all daemon commands, subscriptions and subsequent events real.
		expect((await command('debug-poison', systemPath('/Trash'))).poison).toContain(
			'A non-recoverable condition has triggered',
		)
		await expect(command('watch', systemPath('/Home'))).rejects.toThrow('A non-recoverable condition has triggered')
		sentinelDirectory = systemPath('/unwatched')
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
		await vi.waitFor(() => access(nodePath.join(sentinelDirectory, '.umbrel-watcher-health-check')), {
			timeout: 5000,
			interval: 100,
		})
		sentinelDirectory = systemPath('/Home')
		await vi.waitFor(() => expect(onRestart).toHaveBeenCalledTimes(previousRestarts + 1), {
			timeout: 90_000,
			interval: 100,
		})

		expect(await readFile(pidFile, 'utf8')).not.toBe(previousPid)
		expect((await command('watch-list')).roots.sort()).toEqual(['/Home', '/Trash', memberRoot].map(systemPath).sort())
		for (const path of ['/Home/after.txt', '/Trash/after.txt', `${memberRoot}/after.txt`]) {
			await writeFile(systemPath(path), 'after recovery')
			await vi.waitFor(() => expect(changes).toContain(systemPath(path)), {timeout: 5000, interval: 100})
		}
		await watcher.stop()
		const daemonStatus = () => execa(wrapper, ['--no-spawn', '--no-local', 'get-pid'], {timeout: 5000, reject: false})
		await vi.waitFor(async () => expect((await daemonStatus()).exitCode).toBe(1), {timeout: 5000})
		// Repeated shutdown must handle an absent daemon without spawning one.
		await watcher.stop()
		expect((await daemonStatus()).exitCode).toBe(1)
	} finally {
		await watcher.stop()
		await execa(wrapper, ['--no-spawn', 'shutdown-server'], {timeout: 5000}).catch(() => {})
		vi.useRealTimers()
		process.env.PATH = previousPath
		await rm(directory, {recursive: true, force: true})
	}
})
