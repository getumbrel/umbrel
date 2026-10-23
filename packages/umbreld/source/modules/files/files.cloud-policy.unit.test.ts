import nodePath from 'node:path'

import fse from 'fs-extra'
import {afterAll, beforeAll, describe, expect, test, vi} from 'vitest'

import Files from './files.ts'
import temporaryDirectory from '../utilities/temporary-directory.ts'

function createFiles({
	authorize,
	destinations,
}: {
	authorize: (path: string, userId: string) => Promise<string>
	destinations: string[]
}) {
	const files = Object.create(Files.prototype) as Files
	const getDestinationPaths = vi.fn(() => destinations)
	const authorizePath = vi.fn(authorize)
	Object.assign(files, {
		cloud: {getDestinationPaths},
		virtualToSystemPath: authorizePath,
	})
	return {files, getDestinationPaths, authorizePath}
}

describe('Cloud Files authorization boundary', () => {
	const temporary = temporaryDirectory()

	beforeAll(temporary.createRoot)
	afterAll(temporary.destroyRoot)

	test('does not consult global Cloud destinations before authorizing a request path', async () => {
		const {files, getDestinationPaths} = createFiles({
			authorize: async () => {
				throw new Error('[forbidden]')
			},
			destinations: ['/Users/alice/Cloud'],
		})

		await expect(files.assertCloudMutablePath('/Users/alice/Cloud/report.txt', 'bob')).rejects.toThrow('[forbidden]')
		expect(getDestinationPaths).not.toHaveBeenCalled()
	})

	test('returns the Cloud read-only response after an accessible path is authorized', async () => {
		const {files, getDestinationPaths} = createFiles({
			authorize: async (path) => `/data${path}`,
			destinations: ['/Users/alice/Cloud'],
		})

		await expect(files.assertCloudMutablePath('/Users/alice/Cloud/report.txt', 'alice')).rejects.toThrow(
			'[cloud-read-only]',
		)
		expect(getDestinationPaths).toHaveBeenCalledOnce()
	})

	test('treats an existing Cloud directory as a no-op', async () => {
		const directory = await temporary.create()
		const {files, getDestinationPaths, authorizePath} = createFiles({
			authorize: async () => directory,
			destinations: ['/Home/Cloud'],
		})
		const getAllowedOperations = vi.fn(async () => ['writable'])
		Object.assign(files, {getAllowedOperations})

		await expect(files.createDirectory('/Home/Cloud')).resolves.toEqual({created: false})
		expect(authorizePath).toHaveBeenCalledOnce()
		expect(getDestinationPaths).not.toHaveBeenCalled()
		expect(getAllowedOperations).not.toHaveBeenCalled()
	})

	test('still rejects non-directories and missing paths under Cloud', async () => {
		const directory = await temporary.create()
		const file = nodePath.join(directory, 'file')
		const symlink = nodePath.join(directory, 'symlink')
		const missing = nodePath.join(directory, 'missing')
		await fse.writeFile(file, 'content')
		await fse.symlink(directory, symlink)

		for (const path of [file, symlink, missing]) {
			const {files} = createFiles({
				authorize: async () => path,
				destinations: ['/Home/Cloud'],
			})
			Object.assign(files, {getAllowedOperations: vi.fn(async () => ['writable'])})

			await expect(files.createDirectory('/Home/Cloud/item')).rejects.toThrow('[cloud-read-only]')
		}
		expect(await fse.readFile(file, 'utf8')).toBe('content')
		expect((await fse.lstat(symlink)).isSymbolicLink()).toBe(true)
		expect(await fse.pathExists(missing)).toBe(false)
	})
})
