import {setTimeout as sleep} from 'node:timers/promises'
import nodePath from 'node:path'
import {Writable} from 'node:stream'
import {once} from 'node:events'

import {vi, expect, beforeAll, afterAll, test, beforeEach, afterEach} from 'vitest'
import fse from 'fs-extra'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>
beforeAll(async () => {
	umbreld = await createTestUmbreld()
	await umbreld.registerAndLogin()
})
afterAll(() => umbreld.cleanup())
beforeEach(() => fse.emptyDir(`${umbreld.instance.dataDirectory}/home`))
afterEach(() => vi.restoreAllMocks())

test('POST /api/files/upload throws unauthorized error without cookie', async () => {
	const error = await umbreld.unauthenticatedApi
		.post('files/upload?path=/Home/test-file.txt', {body: 'test content'})
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(401)
	expect(error.response.body).toMatchObject({error: 'unauthorized'})
})

test('POST /api/files/upload throws 400 error without path parameter', async () => {
	const error = await umbreld.api.post('files/upload', {body: 'test content'}).catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: 'path is required'})
})

test('POST /api/files/upload throws 400 error on directory traversal attempt', async () => {
	const error = await umbreld.api
		.post('files/upload?path=/Home/../../../../etc/dangerous-file.txt', {body: 'malicious content'})
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: 'invalid path'})
})

test('POST /api/files/upload throws 400 error on relative path', async () => {
	const paths = ['Home/file.txt', './Home/file.txt', '../home/file.txt', 'file.txt']

	for (const path of paths) {
		const error = await umbreld.api.post(`files/upload?path=${path}`, {body: 'test content'}).catch((error) => error)
		expect(error).toBeInstanceOf(Error)
		expect(error.response.statusCode).toBe(400)
		expect(error.response.body).toMatchObject({error: 'invalid path'})
	}
})

test('POST /api/files/upload throws 400 error on symlink traversal attempt', async () => {
	// Create a symlink to the root directory
	await fse.ensureSymlink('/', `${umbreld.instance.dataDirectory}/home/symlink-to-root`)

	// Attempt to upload a file through the symlink
	const error = await umbreld.api
		.post('files/upload?path=/Home/symlink-to-root/etc/dangerous-file.txt', {body: 'malicious content'})
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: 'invalid path'})

	// Clean up
	await fse.remove(`${umbreld.instance.dataDirectory}/home/symlink-to-root`)
})

test('POST /api/files/upload successfully uploads a file with valid cookie and returns success response', async () => {
	// Upload a file
	const response = await umbreld.api.post('files/upload?path=/Home/new-file.txt', {
		body: 'uploaded content',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toEqual({path: '/Home/new-file.txt'})

	// Verify the file was created
	const exists = await fse.pathExists(`${umbreld.instance.dataDirectory}/home/new-file.txt`)
	expect(exists).toBe(true)

	// Verify the content
	const content = await fse.readFile(`${umbreld.instance.dataDirectory}/home/new-file.txt`, 'utf8')
	expect(content).toBe('uploaded content')
})

test('POST /api/files/upload creates parent directories if they do not exist', async () => {
	// Upload a file to a path with non-existent directories
	const response = await umbreld.api.post('files/upload?path=/Home/new-dir/sub-dir/new-file.txt', {
		body: 'nested content',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)

	// Verify the directories and file were created
	const exists = await fse.pathExists(`${umbreld.instance.dataDirectory}/home/new-dir/sub-dir/new-file.txt`)
	expect(exists).toBe(true)

	// Verify the content
	const content = await fse.readFile(`${umbreld.instance.dataDirectory}/home/new-dir/sub-dir/new-file.txt`, 'utf8')
	expect(content).toBe('nested content')
})

test('POST /api/files/upload handles files with special characters in name', async () => {
	// File name with special characters
	const fileName = 'file with spaces & special chars 漢字.txt'

	// Upload the file
	const response = await umbreld.api.post(`files/upload?path=/Home/${encodeURIComponent(fileName)}`, {
		body: 'special content',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)

	// Verify the file was created
	const exists = await fse.pathExists(`${umbreld.instance.dataDirectory}/home/${fileName}`)
	expect(exists).toBe(true)

	// Verify the content
	const content = await fse.readFile(`${umbreld.instance.dataDirectory}/home/${fileName}`, 'utf8')
	expect(content).toBe('special content')
})

test('POST /api/files/upload handles files with URL-encoded characters in path', async () => {
	// File name with characters that need URL encoding
	const filename = 'file+with?query&params.txt'

	// Upload the file
	const response = await umbreld.api.post(`files/upload?path=/Home/${encodeURIComponent(filename)}`, {
		body: 'url encoded content',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)

	// Verify the file was created
	const exists = await fse.pathExists(`${umbreld.instance.dataDirectory}/home/${filename}`)
	expect(exists).toBe(true)

	// Verify the content
	const content = await fse.readFile(`${umbreld.instance.dataDirectory}/home/${filename}`, 'utf8')
	expect(content).toBe('url encoded content')
})

test('POST /api/files/upload handles empty files correctly', async () => {
	// Upload an empty file
	const response = await umbreld.api.post('files/upload?path=/Home/empty-file.txt', {body: ''})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)

	// Verify the file was created
	const exists = await fse.pathExists(`${umbreld.instance.dataDirectory}/home/empty-file.txt`)
	expect(exists).toBe(true)

	// Verify the content is empty
	const content = await fse.readFile(`${umbreld.instance.dataDirectory}/home/empty-file.txt`, 'utf8')
	expect(content).toBe('')
})

test('POST /api/files/upload handles binary data correctly', async () => {
	// Binary data as base64
	const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd, 0xfc]).toString('base64')

	// Upload binary file
	const response = await umbreld.api.post('files/upload?path=/Home/binary-file.bin', {
		body: binaryData,
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)

	// Verify the file was created
	const exists = await fse.pathExists(`${umbreld.instance.dataDirectory}/home/binary-file.bin`)
	expect(exists).toBe(true)

	// Verify the content
	const content = await fse.readFile(`${umbreld.instance.dataDirectory}/home/binary-file.bin`)
	expect(content).toEqual(Buffer.from(binaryData))
})

test('POST /api/files/upload handles write errors correctly', async () => {
	// Create a test file to verify it gets cleaned up
	const systemPath = `${umbreld.instance.dataDirectory}/home/should-fail.txt`
	const temporarySystemPath = `${systemPath}.umbrel-upload`
	await fse.ensureDir(nodePath.dirname(systemPath))

	// Mock a writable stream that will immediately fail when written to
	vi.spyOn(fse, 'createWriteStream').mockImplementation((path) => {
		const mockStream = new Writable({
			write: (chunk, encoding, callback) => callback(new Error('Simulated disk full error')),
		}) as any
		mockStream.path = path
		return mockStream
	})

	// Try to upload a file - this should trigger the simulated error
	const error = await umbreld.api
		.post('files/upload?path=/Home/should-fail.txt', {body: 'This upload should fail due to a simulated disk error'})
		.catch((err) => err)

	// Verify the error response
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(500)
	expect(error.response.body).toEqual({error: 'error writing file'})

	// Verify the file was cleaned up (doesn't exist)
	await expect(fse.pathExists(systemPath)).resolves.toBe(false)
	await expect(fse.pathExists(temporarySystemPath)).resolves.toBe(false)
})

test('POST /api/files/upload correctly handles streaming data in chunks', async () => {
	// Test file path
	const filePath = '/Home/streaming-test.txt'
	const systemPath = `${umbreld.instance.dataDirectory}/home/streaming-test.txt`
	const directory = nodePath.dirname(systemPath)
	const fileName = nodePath.basename(systemPath)
	const temporarySystemPath = nodePath.join(directory, `.${fileName}.umbrel-upload`)

	// Get a stream for the request
	const uploadStream = umbreld.api.stream.post(`files/upload?path=${filePath}`)

	// Check file doesn't yet exist
	await expect(fse.pathExists(systemPath)).resolves.toBe(false)
	await expect(fse.pathExists(temporarySystemPath)).resolves.toBe(false)

	// Chunks of data to pipe to the upload stream
	const chunks = [
		Buffer.from('First chunk of data - '),
		Buffer.from('Second chunk of data - '),
		Buffer.from('Third chunk of data - '),
	]

	for (const chunk of chunks) {
		// Write the chunk to the upload stream
		uploadStream.write(chunk)

		// Wait to let the chunk be processed
		await sleep(100)

		// Check only temporary file exists
		await expect(fse.pathExists(temporarySystemPath)).resolves.toBe(true)
		await expect(fse.pathExists(systemPath)).resolves.toBe(false)

		// Check the temporary file contains the current chunk
		await expect(fse.readFile(temporarySystemPath, 'utf8')).resolves.toContain(chunk.toString())
	}

	// End the stream
	uploadStream.end()

	// Check response is ok
	const [response] = await once(uploadStream, 'response')
	expect(response.statusCode).toBe(200)

	// Check if the file was moved to the final path
	await expect(fse.pathExists(temporarySystemPath)).resolves.toBe(false)
	await expect(fse.pathExists(systemPath)).resolves.toBe(true)

	// Check the content of the final file
	await expect(fse.readFile(systemPath, 'utf8')).resolves.toBe(chunks.join(''))
})

test('POST /api/files/upload cleans up temporary files when client aborts partially uploaded file', async () => {
	// Test file path
	const filePath = '/Home/aborted-upload.txt'
	const systemPath = `${umbreld.instance.dataDirectory}/home/aborted-upload.txt`
	const directory = nodePath.dirname(systemPath)
	const fileName = nodePath.basename(systemPath)
	const temporarySystemPath = nodePath.join(directory, `.${fileName}.umbrel-upload`)

	// Get a stream for the request
	const uploadStream = umbreld.api.stream.post(`files/upload?path=${filePath}`)

	// Check files don't exist yet
	await expect(fse.pathExists(systemPath)).resolves.toBe(false)
	await expect(fse.pathExists(temporarySystemPath)).resolves.toBe(false)

	// Write the chunk to the upload stream
	uploadStream.write(Buffer.from('First chunk'))

	// Wait to verify the temporary file was created
	await sleep(100)

	// Verify temporary file exists but not the final file
	await expect(fse.pathExists(temporarySystemPath)).resolves.toBe(true)
	await expect(fse.pathExists(systemPath)).resolves.toBe(false)

	// Now abort the request
	uploadStream.destroy()

	// Wait for backend to handle the abortion
	await sleep(100)

	// Verify temporary file is left partiall uploaded
	await expect(fse.pathExists(temporarySystemPath)).resolves.toBe(false)
	await expect(fse.pathExists(systemPath)).resolves.toBe(false)
})

test('POST /api/files/upload with collision=error (default) throws 400 when file already exists', async () => {
	// Create a file
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/collision-test.txt`, 'original content')

	// Try to upload to the same path
	const error = await umbreld.api
		.post('files/upload?path=/Home/collision-test.txt', {body: 'new content'})
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: '[destination-already-exists]'})

	// Verify the file wasn't changed
	const content = await fse.readFile(`${umbreld.instance.dataDirectory}/home/collision-test.txt`, 'utf8')
	expect(content).toBe('original content')
})

test('POST /api/files/upload with collision=error throws 400 when explicitly set and file already exists', async () => {
	// Create a file
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/explicit-error-test.txt`, 'original content')

	// Try to upload to the same path with explicit error strategy
	const error = await umbreld.api
		.post('files/upload?path=/Home/explicit-error-test.txt&collision=error', {body: 'new content'})
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: '[destination-already-exists]'})

	// Verify the file wasn't changed
	const content = await fse.readFile(`${umbreld.instance.dataDirectory}/home/explicit-error-test.txt`, 'utf8')
	expect(content).toBe('original content')
})

test('POST /api/files/upload with collision=keep-both creates uniquely named file when file already exists', async () => {
	// Create a file
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/keep-both-test.txt`, 'original content')

	// Upload to the same path with keep-both strategy
	const response = await umbreld.api.post('files/upload?path=/Home/keep-both-test.txt&collision=keep-both', {
		body: 'new content',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toEqual({path: '/Home/keep-both-test (2).txt'})

	// Verify both files exist with correct content
	const originalContent = await fse.readFile(`${umbreld.instance.dataDirectory}/home/keep-both-test.txt`, 'utf8')
	expect(originalContent).toBe('original content')

	const newContent = await fse.readFile(`${umbreld.instance.dataDirectory}/home/keep-both-test (2).txt`, 'utf8')
	expect(newContent).toBe('new content')
})

test('POST /api/files/upload with collision=keep-both increments number for multiple collisions', async () => {
	// Create a file and its first duplicate
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/multiple-test.txt`, 'original content')
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/multiple-test (2).txt`, 'first duplicate')

	// Upload to the same path with keep-both strategy
	const response = await umbreld.api.post('files/upload?path=/Home/multiple-test.txt&collision=keep-both', {
		body: 'second duplicate',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toEqual({path: '/Home/multiple-test (3).txt'})

	// Verify all files exist with correct content
	const originalContent = await fse.readFile(`${umbreld.instance.dataDirectory}/home/multiple-test.txt`, 'utf8')
	expect(originalContent).toBe('original content')

	const firstDuplicate = await fse.readFile(`${umbreld.instance.dataDirectory}/home/multiple-test (2).txt`, 'utf8')
	expect(firstDuplicate).toBe('first duplicate')

	const secondDuplicate = await fse.readFile(`${umbreld.instance.dataDirectory}/home/multiple-test (3).txt`, 'utf8')
	expect(secondDuplicate).toBe('second duplicate')
})

test('POST /api/files/upload with collision=replace overwrites existing file', async () => {
	// Create a file
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/replace-test.txt`, 'original content')

	// Upload to the same path with replace strategy
	const response = await umbreld.api.post('files/upload?path=/Home/replace-test.txt&collision=replace', {
		body: 'replacement content',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toEqual({path: '/Home/replace-test.txt'})

	// Verify file exists with new content
	const content = await fse.readFile(`${umbreld.instance.dataDirectory}/home/replace-test.txt`, 'utf8')
	expect(content).toBe('replacement content')
})

test('POST /api/files/upload with invalid collision parameter returns 400 error', async () => {
	const error = await umbreld.api
		.post('files/upload?path=/Home/invalid-collision-test.txt&collision=invalid', {body: 'test content'})
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: 'invalid collision parameter'})
})
