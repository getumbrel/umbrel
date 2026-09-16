import nodePath from 'node:path'
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'

import {execa} from 'execa'
import {expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

test.runIf(process.platform === 'linux')(
	'watches Files roots without watching a large mutable app runtime tree',
	async () => {
		const directory = await mkdtemp(nodePath.join(tmpdir(), 'app-watch-'))
		const previousPath = process.env.PATH
		const {stdout: binary} = await execa('which', ['watchman'])
		const binDirectory = nodePath.join(directory, 'bin')
		await mkdir(binDirectory)
		const wrapper = nodePath.join(binDirectory, 'watchman')
		// Parcel discovers Watchman through PATH. Give this test its own daemon,
		// socket, log and state file so it cannot touch an existing system daemon.
		await writeFile(
			wrapper,
			`#!/bin/sh\nexec ${quote(binary)} --sockname=${quote(nodePath.join(directory, 'socket'))} --statefile=${quote(nodePath.join(directory, 'state'))} --logfile=${quote(nodePath.join(directory, 'log'))} --pidfile=${quote(nodePath.join(directory, 'pid'))} "$@"\n`,
			{mode: 0o755},
		)
		process.env.PATH = `${binDirectory}:${previousPath}`
		const {default: Files} = await import('./files.js')
		const watchman = async (...args: string[]) => {
			const result = JSON.parse((await execa(wrapper, ['--no-pretty', ...args])).stdout)
			if (result.error) throw new Error(result.error)
			return result
		}
		const dataDirectory = nodePath.join(directory, 'data')
		const apps = nodePath.join(dataDirectory, 'app-data')
		const home = nodePath.join(dataDirectory, 'home')
		const changes: string[] = []
		const umbreld = {
			dataDirectory,
			eventBus: {
				emit: vi.fn(),
				emitFileChanges: async (events: Array<{path: string}>) => {
					changes.push(...events.map(({path}) => path))
				},
			},
			logger: {createChildLogger: () => ({log: vi.fn(), error: vi.fn(), verbose: vi.fn()})},
		} as unknown as Umbreld
		umbreld.files = new Files(umbreld)
		vi.spyOn(umbreld.files.fileIndex, 'noteWatcherChanges').mockImplementation(() => {})
		const watcher = umbreld.files.watcher

		try {
			await Promise.all(
				['home', 'trash', 'machines', 'app-data'].map((path) =>
					mkdir(nodePath.join(dataDirectory, path), {recursive: true}),
				),
			)
			await watcher.start()
			const {roots} = await watchman('watch-list')
			expect(roots).toContain(home)
			expect(roots).not.toContain(apps)
			expect(watcher.subscriptions.has('/Apps')).toBe(false)

			// A Home event must still flow through the real Parcel/Watchman pipeline.
			const before = nodePath.join(home, 'before.txt')
			await writeFile(before, 'visible')
			await vi.waitFor(() => expect(changes).toContain(before), {timeout: 40_000, interval: 100})

			const runtime = nodePath.join(apps, 'portainer', 'data', 'docker', 'data', 'overlay2')
			for (let layer = 0; layer < 1000; layer++) {
				const layerPath = nodePath.join(runtime, String(layer))
				await mkdir(layerPath, {recursive: true})
				await Promise.all(
					Array.from({length: 100}, (_, entry) => writeFile(nodePath.join(layerPath, `${entry}.json`), '')),
				)
			}
			await rm(runtime, {recursive: true})
			const after = nodePath.join(home, 'after.txt')
			await writeFile(after, 'still visible')
			await vi.waitFor(() => expect(changes).toContain(after), {timeout: 5000, interval: 100})
			expect(changes.some((path) => path.startsWith(`${apps}/`))).toBe(false)
			await watcher.stop()
			// A daemon restart must still watch only the supported Files roots.
			expect((await watchman('watch-list')).roots).not.toContain(apps)
		} finally {
			await watcher.stop()
			await execa(wrapper, ['shutdown-server']).catch(() => {})
			process.env.PATH = previousPath
			await rm(directory, {recursive: true, force: true})
		}
	},
)
