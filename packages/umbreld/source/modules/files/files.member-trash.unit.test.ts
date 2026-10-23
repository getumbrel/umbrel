import nodePath from 'node:path'

import fse from 'fs-extra'
import {afterAll, beforeAll, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import temporaryDirectory from '../utilities/temporary-directory.ts'
import Files from './files.ts'

const temporary = temporaryDirectory()

beforeAll(temporary.createRoot)
afterAll(temporary.destroyRoot)

test('reserves the top-level Trash name in member homes', async () => {
	const dataDirectory = await temporary.create()
	const memberHome = nodePath.join(dataDirectory, 'members/alice/home')
	const memberTrash = nodePath.join(dataDirectory, 'members/alice/trash')
	const source = nodePath.join(memberHome, 'folder')
	const documents = nodePath.join(memberHome, 'Documents')
	await Promise.all([fse.ensureDir(source), fse.ensureDir(documents), fse.ensureDir(memberTrash)])

	const files = new Files({
		dataDirectory,
		logger: {createChildLogger: () => ({})},
		eventBus: {emit: vi.fn()},
	} as unknown as Umbreld)
	Object.assign(files, {
		getAllowedOperations: vi.fn(async () => ['rename', 'writable']),
		isCloudPathOverlap: vi.fn(() => false),
		chownSystemPath: vi.fn(async () => {}),
		fileIndex: {reconcilePath: vi.fn(async () => {})},
	})

	await expect(files.createDirectory('/Users/alice/Trash', 'alice')).rejects.toThrow('[operation-not-allowed]')
	await expect(files.createDirectory('/Users/alice/Documents/Trash', 'alice')).resolves.toMatchObject({created: true})
	await expect(files.rename('/Users/alice/folder', 'Trash', 'alice')).rejects.toThrow('[operation-not-allowed]')

	await expect(fse.pathExists(source)).resolves.toBe(true)
	await expect(fse.pathExists(nodePath.join(memberHome, 'Trash'))).resolves.toBe(false)
	await expect(fse.pathExists(nodePath.join(documents, 'Trash'))).resolves.toBe(true)
	await expect(fse.readdir(memberTrash)).resolves.toStrictEqual([])
})
