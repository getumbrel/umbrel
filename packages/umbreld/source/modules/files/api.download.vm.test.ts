import {expect, test, beforeAll, afterAll} from 'vitest'
import AdmZip from 'adm-zip'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

let umbreld: Awaited<ReturnType<typeof createTestVm>>

// Each test uses uniquely named files so no cleanup between tests is needed
beforeAll(async () => {
	umbreld = await createTestVm({device: 'umbrel-home'})
	await umbreld.vm.powerOn()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
})

// Create a file through the files API
async function uploadFile(path: string, content: string | Buffer) {
	await umbreld.api.post(`files/upload?path=${encodeURIComponent(path)}`, {body: content})
}

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

test('GET /api/files/download throws unauthorized error without a credential', async () => {
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
	// Create a symlink to the root directory (no product surface creates
	// symlinks, so seed it over SSH)
	await umbreld.vm.ssh('ln -s / /home/umbrel/umbrel/home/download-symlink-to-root')

	// Attempt to access files through the symlink
	const error = await umbreld.api
		.get('files/download?path=/Home/download-symlink-to-root/etc/passwd')
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(404)
	expect(error.response.body).toMatchObject({error: 'not found'})
})

test('GET /api/files/download throws 404 error when one of multiple files does not exist', async () => {
	// Create one file
	await uploadFile('/Home/download-partial.txt', 'contents')

	// Try to download it along with a non-existent file
	const error = await umbreld.api
		.get('files/download?path=/Home/download-partial.txt&path=/Home/does-not-exist')
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(404)
	expect(error.response.body).toMatchObject({error: 'not found'})
})

test('GET /api/files/download throws 400 error when paths are in different directories', async () => {
	// Create two files in different directories
	await umbreld.client.files.createDirectory.mutate({path: '/Home/download-dir1'})
	await umbreld.client.files.createDirectory.mutate({path: '/Home/download-dir2'})
	await uploadFile('/Home/download-dir1/file1.txt', 'contents1')
	await uploadFile('/Home/download-dir2/file2.txt', 'contents2')

	// Try to download both files
	const error = await umbreld.api
		.get('files/download?path=/Home/download-dir1/file1.txt&path=/Home/download-dir2/file2.txt')
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: 'paths must be in same directory'})
})

test('GET /api/files/download downloads a file with the HTTP API token and browser cookie', async () => {
	// Create a file
	await uploadFile('/Home/download-file.txt', 'contents')

	// Download the file
	const response = await umbreld.api.get('files/download?path=/Home/download-file.txt', {responseType: 'text'})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('contents')
	expect(response.headers['content-disposition']).toBe(`attachment; filename*=UTF-8''download-file.txt`)
	expect(response.headers['content-type']).toBe('application/octet-stream')
	expect(response.headers['x-content-type-options']).toBe('nosniff')
})

test('GET /api/files/download downloads a file with special characters in name', async () => {
	// Create a file with special characters in the name
	const fileName = 'file with spaces & special chars 漢字.txt'
	await uploadFile(`/Home/${fileName}`, 'special contents')

	// Download the file
	const response = await umbreld.api.get(`files/download?path=/Home/${encodeURIComponent(fileName)}`, {
		responseType: 'text',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('special contents')
	expect(response.headers['content-disposition']).toBe(`attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
	expect(response.headers['content-type']).toBe('application/octet-stream')
	expect(response.headers['x-content-type-options']).toBe('nosniff')
})

test('GET /api/files/download creates a zip archive for multiple files', async () => {
	// Create multiple files
	await umbreld.client.files.createDirectory.mutate({path: '/Home/download-multi'})
	await uploadFile('/Home/download-multi/file1.txt', 'contents1')
	await uploadFile('/Home/download-multi/file2.txt', 'contents2')

	// Download the files
	const response = await umbreld.api.get(
		'files/download?path=/Home/download-multi/file1.txt&path=/Home/download-multi/file2.txt',
		{
			responseType: 'buffer',
		},
	)

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
	await umbreld.client.files.createDirectory.mutate({path: '/Home/testdir'})
	await uploadFile('/Home/testdir/file1.txt', 'contents1')
	await uploadFile('/Home/testdir/file2.txt', 'contents2')
	await umbreld.client.files.createDirectory.mutate({path: '/Home/testdir/subdir'})
	await uploadFile('/Home/testdir/subdir/file3.txt', 'contents3')

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

test('GET /api/files/download handles empty directories correctly', async () => {
	// Create an empty directory
	await umbreld.client.files.createDirectory.mutate({path: '/Home/empty-dir'})

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
	await uploadFile('/Home/empty-file.txt', '')

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
	await uploadFile('/Home/binary-download.bin', binaryData)

	// Download the file
	const response = await umbreld.api.get('files/download?path=/Home/binary-download.bin', {
		responseType: 'buffer',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(Buffer.from(response.body)).toEqual(binaryData)
	expect(response.headers['content-disposition']).toBe(`attachment; filename*=UTF-8''binary-download.bin`)
})
