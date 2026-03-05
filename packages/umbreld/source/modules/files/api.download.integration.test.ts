import {expect, test, beforeEach, beforeAll, afterAll} from 'vitest'
import fse from 'fs-extra'
import AdmZip from 'adm-zip'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

// Create a new umbreld instance for each test
let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>
beforeAll(async () => {
	umbreld = await createTestUmbreld()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
})

beforeEach(async () => {
	// Clean up any files from previous tests
	await fse.emptyDir(`${umbreld.instance.dataDirectory}/home`)
})

// Helper function to extract files from a zip buffer
function extractZipBuffer(buffer: Buffer): Record<string, string> {
	// Get zip entries
	const zip = new AdmZip(buffer)
	const zipEntries = zip.getEntries()

	// Create a map of file names to their contents
	const files: Record<string, string> = {}
	for (const entry of zipEntries) files[entry.entryName] = entry.getData().toString('utf8')

	return files
}

test('GET /api/files/download throws unauthorized error whithout cookie', async () => {
	const error = await umbreld.unauthenticatedApi.get('files/download').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(401)
	expect(error.response.body).toMatchObject({error: 'unauthorized'})
})

test('GET /api/files/download throws 400 error without path parameter', async () => {
	const error = await umbreld.api.get('files/download').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: 'bad request'})
})

test('GET /api/files/download throws 404 error when file does not exist', async () => {
	const error = await umbreld.api.get('files/download?path=/Home/does-not-exist').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(404)
	expect(error.response.body).toMatchObject({error: 'not found'})
})

test('GET /api/files/download throws 404 error on directory traversal attempt', async () => {
	const error = await umbreld.api.get('files/download?path=/Home/../../../../etc/passwd').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(404)
	expect(error.response.body).toMatchObject({error: 'not found'})
})

test('GET /api/files/download throws 404 error on relative path', async () => {
	const paths = ['Home/file.txt', './Home/file.txt', '../home/file.txt', 'file.txt']

	for (const path of paths) {
		const error = await umbreld.api.get(`files/download?path=${path}`).catch((error) => error)
		expect(error).toBeInstanceOf(Error)
		expect(error.response.statusCode).toBe(404)
		expect(error.response.body).toMatchObject({error: 'not found'})
	}
})

test('GET /api/files/download throws 404 error on symlink traversal attempt', async () => {
	// Create a symlink to the root directory
	await fse.ensureSymlink('/', `${umbreld.instance.dataDirectory}/home/symlink-to-root`)

	// Attempt to access files through the symlink
	const error = await umbreld.api.get('files/download?path=/Home/symlink-to-root/etc/passwd').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(404)
	expect(error.response.body).toMatchObject({error: 'not found'})
})

test('GET /api/files/download throws 404 error when one of multiple files does not exist', async () => {
	// Create one file
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/file.txt`, 'contents')

	// Try to download it along with a non-existent file
	const error = await umbreld.api
		.get('files/download?path=/Home/file.txt&path=/Home/does-not-exist')
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(404)
	expect(error.response.body).toMatchObject({error: 'not found'})
})

test('GET /api/files/download throws 400 error when paths are in different directories', async () => {
	// Create two files in different directories
	await fse.ensureDir(`${umbreld.instance.dataDirectory}/home/dir1`)
	await fse.ensureDir(`${umbreld.instance.dataDirectory}/home/dir2`)
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/dir1/file1.txt`, 'contents1')
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/dir2/file2.txt`, 'contents2')

	// Try to download both files
	const error = await umbreld.api
		.get('files/download?path=/Home/dir1/file1.txt&path=/Home/dir2/file2.txt')
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: 'paths must be in same directory'})
})

test('GET /api/files/download downloads a file with a valid cookie', async () => {
	// Create a file
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/file.txt`, 'contents')

	// Download the file
	const response = await umbreld.api.get('files/download?path=/Home/file.txt', {responseType: 'text'})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('contents')
	expect(response.headers['content-disposition']).toBe(`attachment; filename*=UTF-8''file.txt`)
})

test('GET /api/files/download downloads a file with special characters in name', async () => {
	// Create a file with special characters in the name
	const fileName = 'file with spaces & special chars 漢字.txt'
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/${fileName}`, 'special contents')

	// Download the file
	const response = await umbreld.api.get(`files/download?path=/Home/${encodeURIComponent(fileName)}`, {
		responseType: 'text',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('special contents')
	expect(response.headers['content-disposition']).toBe(`attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
})

test('GET /api/files/download creates a zip archive for multiple files', async () => {
	// Create multiple files
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/file1.txt`, 'contents1')
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/file2.txt`, 'contents2')

	// Download the files
	const response = await umbreld.api.get('files/download?path=/Home/file1.txt&path=/Home/file2.txt', {
		responseType: 'buffer',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.headers['content-type']).toBe('application/zip')
	expect(response.headers['content-disposition']).toBe(`attachment; filename*=UTF-8''umbrel-files.zip`)

	// Extract and verify the zip contents
	const files = await extractZipBuffer(response.body)
	expect(files['file1.txt']).toBe('contents1')
	expect(files['file2.txt']).toBe('contents2')
})

test('GET /api/files/download creates a zip archive for a directory', async () => {
	// Create a directory with files
	await fse.ensureDir(`${umbreld.instance.dataDirectory}/home/testdir`)
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/testdir/file1.txt`, 'contents1')
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/testdir/file2.txt`, 'contents2')
	await fse.ensureDir(`${umbreld.instance.dataDirectory}/home/testdir/subdir`)
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/testdir/subdir/file3.txt`, 'contents3')

	// Download the directory
	const response = await umbreld.api.get('files/download?path=/Home/testdir', {
		responseType: 'buffer',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.headers['content-type']).toBe('application/zip')
	expect(response.headers['content-disposition']).toBe(`attachment; filename*=UTF-8''testdir.zip`)

	// Extract and verify the zip contents
	const files = await extractZipBuffer(response.body)
	expect(files['testdir/file1.txt']).toBe('contents1')
	expect(files['testdir/file2.txt']).toBe('contents2')
	expect(files['testdir/subdir/file3.txt']).toBe('contents3')
})

test('GET /api/files/download handles files with spaces and special characters', async () => {
	// Create a file with special characters in the name
	const filename = 'file with spaces & special chars 漢字.txt'
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/${filename}`, 'special content')

	// Download the file
	const response = await umbreld.api.get(`files/download?path=/Home/${encodeURIComponent(filename)}`, {
		responseType: 'text',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('special content')
	expect(response.headers['content-disposition']).toBe(`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
})

test('GET /api/files/download handles empty directories correctly', async () => {
	// Create an empty directory
	await fse.ensureDir(`${umbreld.instance.dataDirectory}/home/empty-dir`)

	// Download the directory
	const response = await umbreld.api.get('files/download?path=/Home/empty-dir', {
		responseType: 'buffer',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.headers['content-type']).toBe('application/zip')
	expect(response.headers['content-disposition']).toBe(`attachment; filename*=UTF-8''empty-dir.zip`)

	// Extract and verify the zip contents - should be an empty folder
	const files = await extractZipBuffer(response.body)
	expect(Object.keys(files).length).toBe(0) // No files in the empty directory
})

test('GET /api/files/download handles files with zero content correctly', async () => {
	// Create an empty file
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/empty-file.txt`, '')

	// Download the file
	const response = await umbreld.api.get('files/download?path=/Home/empty-file.txt')

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('')
	expect(response.headers['content-disposition']).toBe(`attachment; filename*=UTF-8''empty-file.txt`)
})

test('GET /api/files/download handles binary files correctly', async () => {
	// Create a small binary file
	const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd, 0xfc])
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/binary-file.bin`, binaryData)

	// Download the file
	const response = await umbreld.api.get('files/download?path=/Home/binary-file.bin', {
		responseType: 'buffer',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(Buffer.from(response.body)).toEqual(binaryData)
	expect(response.headers['content-disposition']).toBe(`attachment; filename*=UTF-8''binary-file.bin`)
})
