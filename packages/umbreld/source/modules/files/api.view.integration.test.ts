import {expect, beforeAll, afterAll, test, beforeEach} from 'vitest'
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

beforeEach(async () => {
	// Clean up any files from previous tests
	await fse.emptyDir(`${umbreld.instance.dataDirectory}/home`)
})

test('GET /api/files/view throws unauthorized error without cookie', async () => {
	const error = await umbreld.unauthenticatedApi.get('files/view').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(401)
	expect(error.response.body).toMatchObject({error: 'unauthorized'})
})

test('GET /api/files/view throws 404 error without path parameter', async () => {
	const error = await umbreld.api.get('files/view').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: 'path is required'})
})

test('GET /api/files/view throws 404 error when file does not exist', async () => {
	const error = await umbreld.api.get('files/view?path=/Home/does-not-exist').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(404)
	expect(error.response.body).toMatchObject({error: 'not found'})
})

test('GET /api/files/view throws 404 error on directory traversal attempt', async () => {
	const error = await umbreld.api.get('files/view?path=/Home/../../../../etc/passwd').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(404)
	expect(error.response.body).toMatchObject({error: 'not found'})
})

test('GET /api/files/view throws 404 error on relative path', async () => {
	const paths = ['Home/file.txt', './Home/file.txt', '../home/file.txt', 'file.txt']

	for (const path of paths) {
		const error = await umbreld.api.get(`files/view?path=${path}`).catch((error) => error)
		expect(error).toBeInstanceOf(Error)
		expect(error.response.statusCode).toBe(404)
		expect(error.response.body).toMatchObject({error: 'not found'})
	}
})

test('GET /api/files/view throws 404 error on symlink traversal attempt', async () => {
	// Create a symlink to the root directory
	await fse.ensureSymlink('/', `${umbreld.instance.dataDirectory}/home/symlink-to-root`)

	// Attempt to access files through the symlink
	const error = await umbreld.api.get('files/view?path=/Home/symlink-to-root/etc/passwd').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(404)
	expect(error.response.body).toMatchObject({error: 'not found'})

	// Clean up
	await fse.remove(`${umbreld.instance.dataDirectory}/home/symlink-to-root`)
})

test('GET /api/files/view throws 404 error when trying to view a directory', async () => {
	// Create a directory
	await fse.ensureDir(`${umbreld.instance.dataDirectory}/home/test-dir`)

	// Try to view the directory
	const error = await umbreld.api.get('files/view?path=/Home/test-dir').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: 'cannot view a directory'})
})

test('GET /api/files/view serves a file with a valid cookie', async () => {
	// Create a file
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/file.txt`, 'contents')

	// View the file
	const response = await umbreld.api.get('files/view?path=/Home/file.txt', {
		responseType: 'text',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('contents')
	// View doesn't set Content-Disposition header as it's for viewing, not downloading
})

test('GET /api/files/view handles files with special characters in name', async () => {
	// Create a file with special characters in the name
	const fileName = 'file with spaces & special chars 漢字.txt'
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/${fileName}`, 'special contents')

	// View the file
	const response = await umbreld.api.get(`files/view?path=/Home/${encodeURIComponent(fileName)}`, {
		responseType: 'text',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('special contents')
})

test('GET /api/files/view handles files with URL-encoded characters in path', async () => {
	// Create a file with characters that need URL encoding
	const filename = 'file+with?query&params.txt'
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/${filename}`, 'url encoded content')

	// View the file using URL encoded path
	const response = await umbreld.api.get(`files/view?path=/Home/${encodeURIComponent(filename)}`, {
		responseType: 'text',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('url encoded content')
})

test('GET /api/files/view handles files with zero content correctly', async () => {
	// Create an empty file
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/empty-file.txt`, '')

	// View the file
	const response = await umbreld.api.get('files/view?path=/Home/empty-file.txt', {
		responseType: 'text',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('')
})

test('GET /api/files/view handles binary files correctly', async () => {
	// Create a small binary file
	const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd, 0xfc])
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/binary-file.bin`, binaryData)

	// View the file
	const response = await umbreld.api.get('files/view?path=/Home/binary-file.bin', {
		responseType: 'buffer',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(Buffer.from(response.body)).toEqual(binaryData)
})
