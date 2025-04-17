import {expect, beforeAll, afterAll, afterEach, test, vi} from 'vitest'
import fse from 'fs-extra'
import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>

beforeAll(async () => {
	umbreld = await createTestUmbreld()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
})

afterEach(async () => {
	// Restore any mocks
	vi.restoreAllMocks()

	// Clean up any test files that might have been created
	const trashDir = `${umbreld.instance.dataDirectory}/trash`
	const trashMetaDir = `${umbreld.instance.dataDirectory}/trash-meta`
	for (const file of await fse.readdir(trashDir)) await fse.remove(`${trashDir}/${file}`)
	for (const file of await fse.readdir(trashMetaDir)) await fse.remove(`${trashMetaDir}/${file}`)
})

test('delete() throws invalid error without auth token', async () => {
	await expect(umbreld.unauthenticatedClient.files.delete.mutate({path: '/Trash/test-file.txt'})).rejects.toThrow(
		'Invalid token',
	)
})

test('delete() successfully deletes a file in trash', async () => {
	// Create a file in trash
	const trashDir = `${umbreld.instance.dataDirectory}/trash`
	const metaDir = `${umbreld.instance.dataDirectory}/trash-meta`
	await fse.writeFile(`${trashDir}/test-file.txt`, 'test content')
	await fse.writeFile(`${metaDir}/test-file.txt.json`, JSON.stringify({path: '/Home/test-file.txt'}))

	// Verify the file exists in trash
	await expect(fse.pathExists(`${trashDir}/test-file.txt`)).resolves.toBe(true)
	await expect(fse.pathExists(`${metaDir}/test-file.txt.json`)).resolves.toBe(true)

	// Delete the file
	await umbreld.client.files.delete.mutate({path: '/Trash/test-file.txt'})

	// Verify the file is deleted
	await expect(fse.pathExists(`${trashDir}/test-file.txt`)).resolves.toBe(false)
	// Note: The metadata file is not automatically deleted by the delete operation
	await expect(fse.pathExists(`${metaDir}/test-file.txt.json`)).resolves.toBe(true)
})

test('delete() successfully deletes a directory in trash', async () => {
	// Create a directory in trash
	const trashDir = `${umbreld.instance.dataDirectory}/trash`
	const metaDir = `${umbreld.instance.dataDirectory}/trash-meta`

	// Create a directory with nested files
	await fse.mkdir(`${trashDir}/test-dir`, {recursive: true})
	await fse.mkdir(`${trashDir}/test-dir/nested`, {recursive: true})
	await fse.writeFile(`${trashDir}/test-dir/file1.txt`, 'content 1')
	await fse.writeFile(`${trashDir}/test-dir/nested/file2.txt`, 'content 2')
	await fse.writeFile(`${metaDir}/test-dir.json`, JSON.stringify({path: '/Home/test-dir'}))

	// Verify the directory exists in trash
	await expect(fse.pathExists(`${trashDir}/test-dir`)).resolves.toBe(true)
	await expect(fse.pathExists(`${metaDir}/test-dir.json`)).resolves.toBe(true)

	// Delete the directory
	await umbreld.client.files.delete.mutate({path: '/Trash/test-dir'})

	// Verify the directory is deleted
	await expect(fse.pathExists(`${trashDir}/test-dir`)).resolves.toBe(false)
	// Note: The metadata file is not automatically deleted by the delete operation
	await expect(fse.pathExists(`${metaDir}/test-dir.json`)).resolves.toBe(true)
})

test('delete() silently succeeds when trying to delete a non-existent file', async () => {
	// Attempt to delete a non-existent file
	await expect(umbreld.client.files.delete.mutate({path: '/Trash/non-existent-file.txt'})).resolves.toBe(true)
})

test('delete() throws error when trying to delete a file outside of trash', async () => {
	// Create a test file outside of trash
	const homeDir = `${umbreld.instance.dataDirectory}/home`
	await fse.ensureDir(homeDir)
	await fse.writeFile(`${homeDir}/protected-file.txt`, 'protected content')

	// Verify the file exists
	await expect(fse.pathExists(`${homeDir}/protected-file.txt`)).resolves.toBe(true)

	// Attempt to delete the file outside of trash
	await expect(umbreld.client.files.delete.mutate({path: '/Home/protected-file.txt'})).rejects.toThrow()

	// Verify the file still exists
	await expect(fse.pathExists(`${homeDir}/protected-file.txt`)).resolves.toBe(true)

	// Clean up
	await fse.remove(`${homeDir}/protected-file.txt`)
})

test('delete() can delete a nested file in trash', async () => {
	// Create a directory structure in trash
	const trashDir = `${umbreld.instance.dataDirectory}/trash`
	const metaDir = `${umbreld.instance.dataDirectory}/trash-meta`

	// Create a directory with nested files
	await fse.mkdir(`${trashDir}/test-dir`, {recursive: true})
	await fse.mkdir(`${trashDir}/test-dir/nested`, {recursive: true})
	await fse.writeFile(`${trashDir}/test-dir/file1.txt`, 'content 1')
	await fse.writeFile(`${trashDir}/test-dir/nested/file2.txt`, 'content 2')
	await fse.writeFile(`${metaDir}/test-dir.json`, JSON.stringify({path: '/Home/test-dir'}))

	// Verify the nested file exists
	await expect(fse.pathExists(`${trashDir}/test-dir/nested/file2.txt`)).resolves.toBe(true)

	// Delete the nested file
	await umbreld.client.files.delete.mutate({path: '/Trash/test-dir/nested/file2.txt'})

	// Verify the nested file is deleted but the directory structure remains
	await expect(fse.pathExists(`${trashDir}/test-dir/nested/file2.txt`)).resolves.toBe(false)
	await expect(fse.pathExists(`${trashDir}/test-dir/nested`)).resolves.toBe(true)
	await expect(fse.pathExists(`${trashDir}/test-dir/file1.txt`)).resolves.toBe(true)
})

test('delete() handles errors gracefully', async () => {
	// Create a test file in trash
	const trashDir = `${umbreld.instance.dataDirectory}/trash`
	const metaDir = `${umbreld.instance.dataDirectory}/trash-meta`
	await fse.writeFile(`${trashDir}/test-file.txt`, 'test content')
	await fse.writeFile(`${metaDir}/test-file.txt.json`, JSON.stringify({path: '/Home/test-file.txt'}))

	// Mock the remove function to simulate a failure
	vi.spyOn(fse, 'remove').mockImplementation(async (path: string) => {
		throw new Error('Simulated removal error')
	})

	// Attempt to delete the file
	await expect(umbreld.client.files.delete.mutate({path: '/Trash/test-file.txt'})).resolves.toBe(false)

	// Verify the file still exists
	await expect(fse.pathExists(`${trashDir}/test-file.txt`)).resolves.toBe(true)
})

test('delete() can handle files with special characters in the name', async () => {
	// Create a file with special characters in the name
	const trashDir = `${umbreld.instance.dataDirectory}/trash`
	const metaDir = `${umbreld.instance.dataDirectory}/trash-meta`
	const specialFileName = 'special-!@#$%^&*()_+.txt'

	await fse.writeFile(`${trashDir}/${specialFileName}`, 'special content')
	await fse.writeFile(`${metaDir}/${specialFileName}.json`, JSON.stringify({path: `/Home/${specialFileName}`}))

	// Verify the file exists
	await expect(fse.pathExists(`${trashDir}/${specialFileName}`)).resolves.toBe(true)

	// Delete the file
	await umbreld.client.files.delete.mutate({path: `/Trash/${specialFileName}`})

	// Verify the file is deleted
	await expect(fse.pathExists(`${trashDir}/${specialFileName}`)).resolves.toBe(false)
})

// Directory traversal tests
test('delete() throws on directory traversal attempt', async () => {
	await expect(
		umbreld.client.files.delete.mutate({
			path: '/Trash/../../../../etc/passwd',
		}),
	).rejects.toThrow('[operation-not-allowed]')
})

test('delete() throws on relative path traversal attempt', async () => {
	await expect(
		umbreld.client.files.delete.mutate({
			path: '/Trash/../Home/important-file.txt',
		}),
	).rejects.toThrow('[operation-not-allowed]')
})

test('delete() throws on symlink traversal attempt', async () => {
	// Create a symlink in trash that points outside the trash directory
	const trashDir = `${umbreld.instance.dataDirectory}/trash`
	await fse.ensureDir(trashDir)

	// Create a target file that we'll try to delete through the symlink
	const targetDir = `${umbreld.instance.dataDirectory}/symlink-target`
	await fse.ensureDir(targetDir)
	await fse.writeFile(`${targetDir}/important-file.txt`, 'important content')

	// Create a symlink in trash pointing to the target directory
	await fse.symlink(targetDir, `${trashDir}/symlink-to-outside`)

	// Attempt to delete a file through the symlink
	await expect(
		umbreld.client.files.delete.mutate({
			path: '/Trash/symlink-to-outside/important-file.txt',
		}),
	).rejects.toThrow('[escapes-base]')

	// Verify the target file still exists
	await expect(fse.pathExists(`${targetDir}/important-file.txt`)).resolves.toBe(true)

	// Clean up
	await fse.remove(targetDir)
	await fse.remove(`${trashDir}/symlink-to-outside`)
})
