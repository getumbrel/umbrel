import {describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import Files from './files.ts'

const mountedFolder = '/Home/Media/Transmission'

function folderAccessRelation(path: string) {
	if (path === mountedFolder) return 'folder-root' as const
	if (mountedFolder.startsWith(`${path}/`)) return 'contains-folder-root' as const
	if (path.startsWith(`${mountedFolder}/`)) return 'inside-folder-root' as const
	return null
}

function createFiles() {
	return new Files({
		dataDirectory: '/tmp/umbreld-files-app-folder-protection-test',
		logger: {createChildLogger: () => ({})},
		eventBus: {emit: vi.fn()},
		apps: {
			getDataRootPathRelation: vi.fn(() => null),
			getFolderAccessPathRelation: vi.fn(folderAccessRelation),
			isInstalled: vi.fn(async () => false),
		},
		machines: {exists: vi.fn(async () => false)},
	} as unknown as Umbreld)
}

describe('Files app folder protection', () => {
	test.each(['/Home/Media', mountedFolder])(
		'protects mounted folder boundary %s from destructive operations',
		async (path) => {
			const operations = await createFiles().getAllowedOperations(path)

			expect(operations).not.toEqual(expect.arrayContaining(['move', 'rename', 'trash', 'delete']))
			expect(operations).toContain('writable')
		},
	)

	test.each(['/Home/Media/Transmission/downloads', '/Home/Media/Jellyfin'])(
		'leaves mounted folder contents and unrelated siblings mutable at %s',
		async (path) => {
			const operations = await createFiles().getAllowedOperations(path)

			expect(operations).toEqual(expect.arrayContaining(['move', 'rename', 'trash', 'writable']))
		},
	)
})
