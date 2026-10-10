import {describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import Files from './files.js'

const files = new Files({
	dataDirectory: '/tmp/umbreld-files-storage-test',
	logger: {createChildLogger: () => ({})},
	eventBus: {emit: vi.fn()},
} as unknown as Umbreld)

describe('Files storage classification', () => {
	test.each([
		'/Home/file.txt',
		'/Trash/file.txt',
		'/Apps/app/data/file.txt',
		'/Machines/machine/disk.img',
		'/Backups/backup/file.txt',
		'/Users/alice/file.txt',
		'/Users/alice/Trash/file.txt',
	])('classifies %s as internal storage', (virtualPath) => {
		expect(files.isInternalStorageVirtualPath(virtualPath)).toBe(true)
	})

	test.each(['/External/USB/file.txt', '/Network/nas/share/file.txt', '/Raid/umbrel-md/file.txt'])(
		'classifies %s as mounted storage',
		(virtualPath) => {
			expect(files.isInternalStorageVirtualPath(virtualPath)).toBe(false)
		},
	)

	test('defaults newly registered Files bases to internal storage', () => {
		files.baseDirectories.set('/FutureStorage', '/tmp/umbreld-files-storage-test/future')
		try {
			expect(files.isInternalStorageVirtualPath('/FutureStorage/file.txt')).toBe(true)
		} finally {
			files.baseDirectories.delete('/FutureStorage')
		}
	})

	test('rejects paths outside the Files namespace', () => {
		expect(() => files.isInternalStorageVirtualPath('/FutureMountedStorage/file.txt')).toThrow('[invalid-base]')
	})
})
