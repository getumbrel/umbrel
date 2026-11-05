import {expect, test, vi} from 'vitest'

import Files from './files.ts'

test('runs Rewind copies inside coordinated Cloud restore handling', async () => {
	const files = Object.create(Files.prototype) as Files
	const rewindRestoreToken = Symbol('rewind-restore')
	const restoreForRewind = vi.fn(async ({restore}: {restore: (token: symbol) => Promise<void>}) =>
		restore(rewindRestoreToken),
	)
	Object.assign(files, {cloud: {restoreForRewind}})
	const copy = vi.spyOn(files, 'copy').mockResolvedValue('/Home/Documents/report.txt')
	const workItems = [
		{
			path: '/Backups/2026-07-26T00:00:00.000Z/Home/Documents/report.txt',
			toDirectory: '/Home/Documents',
			collision: 'replace' as const,
		},
	]

	await expect(files.restoreFromRewind(workItems, ['22222222-2222-4222-8222-222222222222'], '0')).resolves.toBe(true)
	expect(restoreForRewind).toHaveBeenCalledWith({
		userId: '0',
		confirmedSyncIds: ['22222222-2222-4222-8222-222222222222'],
		targetPaths: ['/Home/Documents/report.txt'],
		restore: expect.any(Function),
	})
	expect(copy).toHaveBeenCalledWith(workItems[0].path, workItems[0].toDirectory, {
		collision: 'replace',
		userId: '0',
		rewindRestoreToken,
	})
})

test('rejects non-Rewind sources before coordinating Cloud definitions', async () => {
	const files = Object.create(Files.prototype) as Files
	const restoreForRewind = vi.fn()
	Object.assign(files, {cloud: {restoreForRewind}})

	await expect(
		files.restoreFromRewind(
			[{path: '/Home/report.txt', toDirectory: '/Home/Documents', collision: 'replace'}],
			[],
			'0',
		),
	).rejects.toThrow('[operation-not-allowed]')
	expect(restoreForRewind).not.toHaveBeenCalled()
})
