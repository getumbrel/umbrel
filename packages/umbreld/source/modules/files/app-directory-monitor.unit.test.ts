import nodePath from 'node:path'
import {mkdtemp, mkdir, rename, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'

import {afterEach, expect, test, vi} from 'vitest'

import AppDirectoryMonitor from './app-directory-monitor.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
	for (const cleanup of cleanups.reverse()) await cleanup()
	cleanups.length = 0
})

async function fixture(paths = ['/Apps/app/shared']) {
	const root = await mkdtemp(nodePath.join(tmpdir(), 'app-directory-monitor-'))
	cleanups.push(() => rm(root, {recursive: true, force: true}))
	const systemPath = vi.fn((path: string) => nodePath.join(root, path))
	const directory = systemPath('/Apps/app/shared')
	await mkdir(directory, {recursive: true})
	const onDelete = vi.fn(async (path: string) => {
		paths = paths.filter((candidate) => candidate !== path)
	})
	const monitor = new AppDirectoryMonitor({
		listPaths: async () => paths,
		systemPath,
		onDelete,
		logger: {error: vi.fn()},
		intervalMs: 20,
	})
	cleanups.push(() => monitor.stop())
	await monitor.start()
	return {
		monitor,
		root,
		directory,
		onDelete,
		systemPath,
		setPaths: (next: string[]) => {
			paths = next
		},
	}
}

test('polls only explicitly selected app directories and ignores changes beneath them', async () => {
	const {monitor, directory, onDelete, systemPath} = await fixture([
		'/Apps/app/shared',
		'/Home/Documents',
		'/AppsLike/app',
	])
	await mkdir(nodePath.join(directory, 'overlay2'))
	await writeFile(nodePath.join(directory, 'overlay2', 'layer'), 'container churn')
	await monitor.refresh()
	expect(onDelete).not.toHaveBeenCalled()
	expect(systemPath.mock.calls.every(([path]) => path === '/Apps/app/shared')).toBe(true)
})

test('detects directory replacement between polls, including removal of a parent', async () => {
	const {directory, onDelete} = await fixture()
	await rename(nodePath.dirname(directory), `${nodePath.dirname(directory)}-old`)
	await mkdir(directory, {recursive: true})
	await vi.waitFor(() => expect(onDelete).toHaveBeenCalledWith('/Apps/app/shared'))
	expect(onDelete).toHaveBeenCalledOnce()
})

test('drops missing saved paths on startup and starts monitoring newly added paths', async () => {
	const {monitor, root, onDelete, setPaths} = await fixture(['/Apps/app/missing'])
	expect(onDelete).toHaveBeenCalledWith('/Apps/app/missing')
	const added = nodePath.join(root, 'Apps/app/added')
	await mkdir(added)
	setPaths(['/Apps/app/added'])
	await monitor.refresh()
	await rm(added, {recursive: true})
	await monitor.refresh()
	expect(onDelete).toHaveBeenCalledWith('/Apps/app/added')
})

test('stops polling and releases identities on shutdown', async () => {
	const {monitor, directory, onDelete} = await fixture()
	await monitor.stop()
	await rm(directory, {recursive: true})
	await monitor.refresh()
	expect(onDelete).not.toHaveBeenCalled()
})
