import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import getDirectorySize from '../utilities/get-directory-size.js'
import App from './app.js'

vi.mock('../utilities/get-directory-size.js', () => ({default: vi.fn()}))

beforeEach(() => {
	vi.mocked(getDirectorySize).mockReset()
})
afterEach(() => vi.useRealTimers())

function fixture() {
	const error = vi.fn()
	const virtualToSystemPath = vi.fn(
		async (path: string): Promise<string> =>
			path === '/Apps/example-app'
				? '/tmp/umbreld-app-disk-usage-test/app-data/example-app'
				: '/mnt/external/app-data/example-app',
	)
	const umbreld = {
		dataDirectory: '/tmp/umbreld-app-disk-usage-test',
		logger: {createChildLogger: () => ({error})},
		files: {virtualToSystemPath},
	} as unknown as Umbreld
	const app = new App(umbreld, 'example-app')
	vi.spyOn(app, 'getDataRootLocation').mockResolvedValue(null)
	return {app, error, virtualToSystemPath}
}

test('measures app disk usage live on each request without using the index or a cache', async () => {
	const {app} = fixture()
	vi.mocked(getDirectorySize).mockResolvedValueOnce(123).mockResolvedValueOnce(456)

	await expect(app.getDiskUsage()).resolves.toBe(123)
	await expect(app.getDiskUsage()).resolves.toBe(456)
	expect(getDirectorySize).toHaveBeenCalledTimes(2)
	expect(getDirectorySize).toHaveBeenCalledWith(app.dataDirectory)
})

test('retries transient failures while measuring an active app', async () => {
	vi.useFakeTimers()
	const {app} = fixture()
	vi.mocked(getDirectorySize).mockRejectedValueOnce(new Error('file moved')).mockResolvedValueOnce(123)
	const usage = app.getDiskUsage()
	await vi.runAllTimersAsync()

	await expect(usage).resolves.toBe(123)
	expect(getDirectorySize).toHaveBeenCalledTimes(2)
})

test('keeps the original zero result after two retries fail', async () => {
	vi.useFakeTimers()
	const {app, error} = fixture()
	vi.mocked(getDirectorySize).mockRejectedValue(new Error('unavailable'))
	const usage = app.getDiskUsage()
	await vi.runAllTimersAsync()

	await expect(usage).resolves.toBe(0)
	expect(getDirectorySize).toHaveBeenCalledTimes(3)
	expect(error).toHaveBeenCalledWith('Failed to get disk usage for app example-app', expect.any(Error))
})

test('includes relocated app data in the live measurement', async () => {
	const {app, virtualToSystemPath} = fixture()
	vi.mocked(app.getDataRootLocation).mockResolvedValue({path: '/External/drive/app-data/example-app'})
	vi.mocked(getDirectorySize).mockImplementation(async (path) => (path === app.dataDirectory ? 123 : 456))

	await expect(app.getDiskUsage()).resolves.toBe(579)
	expect(virtualToSystemPath).toHaveBeenCalledWith('/External/drive/app-data/example-app', '0')
	expect(getDirectorySize).toHaveBeenCalledWith('/mnt/external/app-data/example-app')
})

test('preserves internal usage when external app storage is unavailable', async () => {
	const {app, virtualToSystemPath} = fixture()
	vi.mocked(app.getDataRootLocation).mockResolvedValue({path: '/External/drive/app-data/example-app'})
	virtualToSystemPath.mockImplementation(async (path) => {
		if (path.startsWith('/External/')) throw new Error('drive disconnected')
		return app.dataDirectory
	})
	vi.mocked(getDirectorySize).mockResolvedValue(123)

	await expect(app.getDiskUsage()).resolves.toBe(123)
	expect(getDirectorySize).toHaveBeenCalledOnce()
})
