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
	// Nuke trash state after each test
	const trashDir = `${umbreld.instance.dataDirectory}/trash`
	const trashMetaDir = `${umbreld.instance.dataDirectory}/trash-meta`
	for (const file of await fse.readdir(trashDir)) await fse.remove(`${trashDir}/${file}`)
	for (const file of await fse.readdir(trashMetaDir)) await fse.remove(`${trashMetaDir}/${file}`)
})

test('emptyTrash() throws invalid error without auth token', async () => {
	await expect(umbreld.unauthenticatedClient.files.emptyTrash.mutate()).rejects.toThrow('Invalid token')
})

test('emptyTrash() successfully empties an empty trash', async () => {
	// Verify trash is empty
	const trashDir = `${umbreld.instance.dataDirectory}/trash`
	const trashFiles = await fse.readdir(trashDir)
	expect(trashFiles.length).toBe(0)

	// Empty the trash
	const result = await umbreld.client.files.emptyTrash.mutate()

	// Verify the result
	expect(result).toBe(true)
})

test('emptyTrash() successfully empties trash with a single file', async () => {
	// Create a file in trash with metadata
	const trashDir = `${umbreld.instance.dataDirectory}/trash`
	const metaDir = `${umbreld.instance.dataDirectory}/trash-meta`
	await fse.writeFile(`${trashDir}/test-file.txt`, 'test content')
	await fse.writeFile(`${metaDir}/test-file.txt.json`, JSON.stringify({path: '/Home/test-file.txt'}))

	// Verify the file exists in trash
	await expect(fse.pathExists(`${trashDir}/test-file.txt`)).resolves.toBe(true)
	await expect(fse.pathExists(`${metaDir}/test-file.txt.json`)).resolves.toBe(true)

	// Empty the trash
	const result = await umbreld.client.files.emptyTrash.mutate()

	// Verify the result
	expect(result).toBe(true)

	// Verify the file is removed from trash
	await expect(fse.pathExists(`${trashDir}/test-file.txt`)).resolves.toBe(false)
	await expect(fse.pathExists(`${metaDir}/test-file.txt.json`)).resolves.toBe(false)
})

test('emptyTrash() successfully empties trash with multiple files', async () => {
	// Create multiple files in trash with metadata
	const trashDir = `${umbreld.instance.dataDirectory}/trash`
	const metaDir = `${umbreld.instance.dataDirectory}/trash-meta`

	const numberOfFiles = 1000

	// Create the files
	for (let i = 1; i <= numberOfFiles; i++) {
		await fse.writeFile(`${trashDir}/file${i}.txt`, `content ${i}`)
		await fse.writeFile(`${metaDir}/file${i}.txt.json`, JSON.stringify({path: `/Home/file${i}.txt`}))
	}

	// Verify the files exist in trash
	for (let i = 1; i <= numberOfFiles; i++) {
		await expect(fse.pathExists(`${trashDir}/file${i}.txt`)).resolves.toBe(true)
		await expect(fse.pathExists(`${metaDir}/file${i}.txt.json`)).resolves.toBe(true)
	}

	// Empty the trash
	const startTime = Date.now()
	const result = await umbreld.client.files.emptyTrash.mutate()
	const endTime = Date.now()
	const duration = endTime - startTime

	// Check empty trash wasn't unreasonably slow
	expect(duration).toBeLessThan(1000)

	// Verify the result
	expect(result).toBe(true)

	// Verify the files are removed from trash
	for (let i = 1; i <= numberOfFiles; i++) {
		await expect(fse.pathExists(`${trashDir}/file${i}.txt`)).resolves.toBe(false)
		await expect(fse.pathExists(`${metaDir}/file${i}.txt.json`)).resolves.toBe(false)
	}
})

test('emptyTrash() successfully empties trash with directories', async () => {
	// Create a directory structure in trash with metadata
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

	// Empty the trash
	const result = await umbreld.client.files.emptyTrash.mutate()

	// Verify the result
	expect(result).toBe(true)

	// Verify the directory is removed from trash
	await expect(fse.pathExists(`${trashDir}/test-dir`)).resolves.toBe(false)
	await expect(fse.pathExists(`${metaDir}/test-dir.json`)).resolves.toBe(false)
})

test('emptyTrash() handles missing metadata files', async () => {
	// Create files in trash without metadata
	const trashDir = `${umbreld.instance.dataDirectory}/trash`

	// Create files without metadata
	await fse.writeFile(`${trashDir}/no-meta1.txt`, 'content 1')
	await fse.writeFile(`${trashDir}/no-meta2.txt`, 'content 2')

	// Verify the files exist in trash
	await expect(fse.pathExists(`${trashDir}/no-meta1.txt`)).resolves.toBe(true)
	await expect(fse.pathExists(`${trashDir}/no-meta2.txt`)).resolves.toBe(true)

	// Empty the trash
	const result = await umbreld.client.files.emptyTrash.mutate()

	// Verify the result
	expect(result).toBe(true)

	// Verify the files are removed from trash
	await expect(fse.pathExists(`${trashDir}/no-meta1.txt`)).resolves.toBe(false)
	await expect(fse.pathExists(`${trashDir}/no-meta2.txt`)).resolves.toBe(false)
})

test('emptyTrash() handles metadata files without corresponding trash files', async () => {
	// Create metadata files without corresponding trash files
	const metaDir = `${umbreld.instance.dataDirectory}/trash-meta`

	// Create metadata files without trash files
	await fse.writeFile(`${metaDir}/orphaned1.txt.json`, JSON.stringify({path: '/Home/orphaned1.txt'}))
	await fse.writeFile(`${metaDir}/orphaned2.txt.json`, JSON.stringify({path: '/Home/orphaned2.txt'}))

	// Verify the metadata files exist
	await expect(fse.pathExists(`${metaDir}/orphaned1.txt.json`)).resolves.toBe(true)
	await expect(fse.pathExists(`${metaDir}/orphaned2.txt.json`)).resolves.toBe(true)

	// Empty the trash
	const result = await umbreld.client.files.emptyTrash.mutate()

	// Verify the result
	expect(result).toBe(true)

	// Verify the metadata files are removed
	await expect(fse.pathExists(`${metaDir}/orphaned1.txt.json`)).resolves.toBe(false)
	await expect(fse.pathExists(`${metaDir}/orphaned2.txt.json`)).resolves.toBe(false)
})

test('emptyTrash() handles mixed content types', async () => {
	// Create a mix of files, directories, and metadata
	const trashDir = `${umbreld.instance.dataDirectory}/trash`
	const metaDir = `${umbreld.instance.dataDirectory}/trash-meta`

	// Create regular files with metadata
	await fse.writeFile(`${trashDir}/file1.txt`, 'content 1')
	await fse.writeFile(`${metaDir}/file1.txt.json`, JSON.stringify({path: '/Home/file1.txt'}))

	// Create directory with metadata
	await fse.mkdir(`${trashDir}/dir1`, {recursive: true})
	await fse.writeFile(`${trashDir}/dir1/nested.txt`, 'nested content')
	await fse.writeFile(`${metaDir}/dir1.json`, JSON.stringify({path: '/Home/dir1'}))

	// Create file without metadata
	await fse.writeFile(`${trashDir}/no-meta.txt`, 'no meta content')

	// Create metadata without file
	await fse.writeFile(`${metaDir}/orphaned.txt.json`, JSON.stringify({path: '/Home/orphaned.txt'}))

	// Empty the trash
	const result = await umbreld.client.files.emptyTrash.mutate()

	// Verify the result
	expect(result).toBe(true)

	// Verify everything is removed
	await expect(fse.pathExists(`${trashDir}/file1.txt`)).resolves.toBe(false)
	await expect(fse.pathExists(`${metaDir}/file1.txt.json`)).resolves.toBe(false)
	await expect(fse.pathExists(`${trashDir}/dir1`)).resolves.toBe(false)
	await expect(fse.pathExists(`${metaDir}/dir1.json`)).resolves.toBe(false)
	await expect(fse.pathExists(`${trashDir}/no-meta.txt`)).resolves.toBe(false)
	await expect(fse.pathExists(`${metaDir}/orphaned.txt.json`)).resolves.toBe(false)
})

test('emptyTrash() reports failures correctly', async () => {
	// Create a test file that we'll make unremovable
	const trashDir = `${umbreld.instance.dataDirectory}/trash`
	const metaDir = `${umbreld.instance.dataDirectory}/trash-meta`

	// Create a regular file that can be deleted
	await fse.writeFile(`${trashDir}/good-file.txt`, 'good content')
	await fse.writeFile(`${metaDir}/good-file.txt.json`, JSON.stringify({path: '/Home/good-file.txt'}))

	// Create a file that will cause an error when deleted
	await fse.writeFile(`${trashDir}/bad-file.txt`, 'bad content')
	await fse.writeFile(`${metaDir}/bad-file.txt.json`, JSON.stringify({path: '/Home/bad-file.txt'}))

	// Mock the remove function to simulate a failure for the bad file
	const originalRemove = fse.remove
	vi.spyOn(fse, 'remove').mockImplementation(async (path: string) => {
		if (path.includes('bad-file')) {
			throw new Error('Simulated removal error')
		}
		return originalRemove(path)
	})

	try {
		// Empty the trash
		const result = await umbreld.client.files.emptyTrash.mutate()

		// Verify the result
		expect(result).toBe(false)

		// Verify the good file is removed
		await expect(fse.pathExists(`${trashDir}/good-file.txt`)).resolves.toBe(false)
		await expect(fse.pathExists(`${metaDir}/good-file.txt.json`)).resolves.toBe(false)

		// The bad file should still exist
		await expect(fse.pathExists(`${trashDir}/bad-file.txt`)).resolves.toBe(true)
		await expect(fse.pathExists(`${metaDir}/bad-file.txt.json`)).resolves.toBe(true)
	} finally {
		// Restore the original mocks
		vi.restoreAllMocks()

		// Clean up the bad file manually
		await originalRemove(`${trashDir}/bad-file.txt`)
		await originalRemove(`${metaDir}/bad-file.txt.json`)
	}
})
