import {expect, beforeAll, afterAll, test} from 'vitest'
import {$} from 'execa'
import fse from 'fs-extra'
import AdmZip from 'adm-zip'

import createTestUmbreld from '../../../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>

let token: string

async function download(args: string) {
	return fetch(`http://localhost:${umbreld.instance.server.port}/api/files/download${args}`, {
		headers: {Cookie: `UMBREL_PROXY_TOKEN=${token}`},
	})
}

beforeAll(async () => {
	umbreld = await createTestUmbreld()
})

afterAll(async () => {
	await umbreld.cleanup()
})

// The following tests are stateful and must be run in order

// We sleep to allow time for fs events to be triggered and handled by the umbreld filewatcher

test.sequential('download() throws invalid error without auth token', async () => {
	const response = await download('?path=/Home/test-file')
	expect(response.status).toBe(401)
	expect(await response.json()).toMatchObject({error: 'unauthorized'})
})

test.sequential('login', async () => {
	token = await umbreld.instance.server.signProxyToken()
})

test.sequential('download() returns 404 for non-existent file', async () => {
	const response = await download('?path=/Home/nonexistent')
	expect(response.status).toBe(404)
	expect(await response.json()).toMatchObject({error: 'notfound'})
})

test.sequential('download() can download a single file', async () => {
	// Create a test file with content
	await fse.writeFile(`${umbreld.instance.files.homeDirectory}/test-file.txt`, 'test content')

	const response = await download('?path=/Home/test-file.txt')

	expect(response.status).toBe(200)
	expect(response.headers.get('content-type')).toBe('text/plain; charset=UTF-8')
	expect(response.headers.get('content-disposition')).toContain("attachment; filename*=UTF-8''test-file.txt")
	expect(await response.text()).toBe('test content')
})

test.sequential('download() can download multiple files as zip', async () => {
	// Create test files
	await fse.writeFile(`${umbreld.instance.files.homeDirectory}/file1.txt`, 'file1')
	await fse.writeFile(`${umbreld.instance.files.homeDirectory}/file2.txt`, 'file2')

	const response = await download('?path=/Home/file1.txt&path=/Home/file2.txt')

	expect(response.status).toBe(200)
	expect(response.headers.get('content-type')).toBe('application/zip')
	expect(response.headers.get('content-disposition')).toContain("attachment; filename*=UTF-8''umbrel-files.zip")

	const zip = new AdmZip(Buffer.from(await response.arrayBuffer()))
	const entries = zip.getEntries().map((entry) => entry.entryName)
	expect(entries).toHaveLength(2)
	expect(entries).toContain('file1.txt')
	expect(entries).toContain('file2.txt')
})

test.sequential('download() can download a directory as zip', async () => {
	// Create a test directory with files
	await fse.mkdir(`${umbreld.instance.files.homeDirectory}/test-dir`, {recursive: true})
	await fse.writeFile(`${umbreld.instance.files.homeDirectory}/test-dir/file1.txt`, 'file1')
	await fse.writeFile(`${umbreld.instance.files.homeDirectory}/test-dir/file2.txt`, 'file2')

	const response = await download('?path=/Home/test-dir')

	expect(response.status).toBe(200)
	expect(response.headers.get('content-type')).toBe('application/zip')
	expect(response.headers.get('content-disposition')).toContain("attachment; filename*=UTF-8''test-dir.zip")

	const zip = new AdmZip(Buffer.from(await response.arrayBuffer()))
	expect(zip.getEntries().map((entry) => entry.entryName)).toEqual(['test-dir/file1.txt', 'test-dir/file2.txt'])
})

test.sequential('download() returns 403 for paths with no base dir', async () => {
	const response = await download('?path=/foo/bar')

	expect(response.status).toBe(403)
	expect(await response.json()).toMatchObject({error: 'forbidden'})
})

test.sequential('download() returns 403 for directory traversal attempts', async () => {
	const response = await download('?path=/Home/../../../etc/passwd')
	expect(response.status).toBe(403)
	expect(await response.json()).toMatchObject({error: 'forbidden'})
})

test.sequential('download() returns 403 for symlink traversal attempts', async () => {
	// Create a symlink to the root directory
	await $`ln -s / ${umbreld.instance.files.homeDirectory}/symlink-to-root`

	const response = await download('?path=/Home/symlink-to-root/etc/passwd')
	expect(response.status).toBe(403)
	expect(await response.json()).toMatchObject({error: 'forbidden'})
})

test.sequential('download() errors on multiple different base dirs to avoid collisions', async () => {
	// Create test files
	await fse.mkdir(`${umbreld.instance.files.homeDirectory}/collision-1`, {recursive: true})
	await fse.writeFile(`${umbreld.instance.files.homeDirectory}/collision-1/file.txt`, 'contents')
	await fse.mkdir(`${umbreld.instance.files.homeDirectory}/collision-2`, {recursive: true})
	await fse.writeFile(`${umbreld.instance.files.homeDirectory}/collision-2/file.txt`, 'contents')

	const response = await download('?path=/Home/collision-1/file.txt&path=/Home/collision-2/file.txt')

	expect(response.status).toBe(400)
	expect(await response.json()).toMatchObject({error: 'paths must be in same directory'})
})
