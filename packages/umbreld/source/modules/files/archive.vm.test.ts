import os from 'node:os'
import nodePath from 'node:path'

import {expect, test, beforeAll, afterAll, describe} from 'vitest'
import fse from 'fs-extra'
import AdmZip from 'adm-zip'
import {$} from 'execa'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

let umbreld: Awaited<ReturnType<typeof createTestVm>>

// Host-side scratch directory for generating archive fixture bytes that get
// uploaded into the VM through the files API
let fixtureDirectory = ''

// Each test uses uniquely named files so no cleanup between tests is needed
beforeAll(async () => {
	umbreld = await createTestVm({device: 'umbrel-home'})
	fixtureDirectory = await fse.mkdtemp(nodePath.join(os.tmpdir(), 'umbrel-archive-fixtures-'))
	await umbreld.vm.powerOn()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
	await fse.remove(fixtureDirectory)
})

const guestHome = '/home/umbrel/umbrel/home'

// Create a file through the files API
async function uploadFile(path: string, content: string | Buffer) {
	await umbreld.api.post(`files/upload?path=${encodeURIComponent(path)}`, {body: content})
}

// Download a file through the files API as a buffer
async function downloadFile(path: string) {
	const response = await umbreld.api.get(`files/download?path=${encodeURIComponent(path)}`, {responseType: 'buffer'})
	return response.body as Buffer
}

// Read a file's content from inside the VM (low-level assertion via SSH)
async function readGuestFile(guestPath: string) {
	return umbreld.vm.ssh(`cat '${guestPath}'`)
}

// Helper function to extract files from a zip buffer
function extractZipBuffer(buffer: Buffer): Record<string, string> {
	// Get zip entries
	const zip = new AdmZip(buffer)
	const zipEntries = zip.getEntries()

	// Create a map of file names to their contents
	const files: Record<string, string> = {}
	for (const entry of zipEntries) {
		if (!entry.isDirectory) {
			files[entry.entryName] = entry.getData().toString('utf8')
		}
	}

	return files
}

describe('archive()', () => {
	test('throws unauthorized error without auth token', async () => {
		await expect(umbreld.unauthenticatedClient.files.archive.mutate({paths: ['/Home/test.txt']})).rejects.toThrow(
			'Invalid token',
		)
	})

	test('throws error on directory traversal attempt', async () => {
		await expect(
			umbreld.client.files.archive.mutate({
				paths: ['/Home/../../../../etc/passwd'],
			}),
		).rejects.toThrow()
	})

	test('throws error on non-existent path', async () => {
		await expect(
			umbreld.client.files.archive.mutate({
				paths: ['/Home/nonexistent-file.txt'],
			}),
		).rejects.toThrow()
	})

	test('throws error on relative paths', async () => {
		await Promise.all(
			['', ' ', '.', '..', 'Home', 'Home/file.txt'].map(async (path) => {
				await expect(
					umbreld.client.files.archive.mutate({
						paths: [path],
					}),
				).rejects.toThrow()
			}),
		)
	})

	test('throws error when paths are in different directories', async () => {
		// Create test directories and files
		await umbreld.client.files.createDirectory.mutate({path: '/Home/archive-dir1'})
		await umbreld.client.files.createDirectory.mutate({path: '/Home/archive-dir2'})
		await uploadFile('/Home/archive-dir1/file1.txt', 'content1')
		await uploadFile('/Home/archive-dir2/file2.txt', 'content2')

		// Try to archive files from different directories
		await expect(
			umbreld.client.files.archive.mutate({
				paths: ['/Home/archive-dir1/file1.txt', '/Home/archive-dir2/file2.txt'],
			}),
		).rejects.toThrow('paths must be in same directory')
	})

	test('successfully creates a zip archive from a single file', async () => {
		// Create a test file
		await uploadFile('/Home/archive-single-test.txt', 'test content')

		// Archive the file
		const zipPath = await umbreld.client.files.archive.mutate({
			paths: ['/Home/archive-single-test.txt'],
		})

		// Check archive file exists with the right contents by downloading it
		// back through the files API
		expect(zipPath).toBe('/Home/archive-single-test.txt.zip')
		const files = extractZipBuffer(await downloadFile(zipPath))
		expect(files['archive-single-test.txt']).toBe('test content')
	})

	test('successfully creates a zip archive from multiple files', async () => {
		// Create test files
		await umbreld.client.files.createDirectory.mutate({path: '/Home/archive-multi'})
		await uploadFile('/Home/archive-multi/file1.txt', 'content1')
		await uploadFile('/Home/archive-multi/file2.txt', 'content2')

		// Archive the files
		const zipPath = await umbreld.client.files.archive.mutate({
			paths: ['/Home/archive-multi/file1.txt', '/Home/archive-multi/file2.txt'],
		})

		// Check archive file exists with the right contents
		expect(zipPath).toBe('/Home/archive-multi/Archive.zip')
		const files = extractZipBuffer(await downloadFile(zipPath))
		expect(files['file1.txt']).toBe('content1')
		expect(files['file2.txt']).toBe('content2')
	})

	test('successfully creates a zip archive from a directory', async () => {
		// Create a test directory with files
		await umbreld.client.files.createDirectory.mutate({path: '/Home/archive-test-dir'})
		await uploadFile('/Home/archive-test-dir/file1.txt', 'content1')
		await uploadFile('/Home/archive-test-dir/file2.txt', 'content2')
		await umbreld.client.files.createDirectory.mutate({path: '/Home/archive-test-dir/subdir'})
		await uploadFile('/Home/archive-test-dir/subdir/file3.txt', 'content3')

		// Archive the directory
		const zipPath = await umbreld.client.files.archive.mutate({
			paths: ['/Home/archive-test-dir'],
		})

		// Check archive file exists with the right contents
		expect(zipPath).toBe('/Home/archive-test-dir.zip')
		const files = extractZipBuffer(await downloadFile(zipPath))
		expect(files['archive-test-dir/file1.txt']).toBe('content1')
		expect(files['archive-test-dir/file2.txt']).toBe('content2')
		expect(files['archive-test-dir/subdir/file3.txt']).toBe('content3')
	})

	test('creates a uniquely named zip archive when a file with the same name already exists', async () => {
		// Create a test file
		await uploadFile('/Home/unique-test.txt', 'test content')

		// Create a zip file that would conflict with the generated name
		await uploadFile('/Home/unique-test.txt.zip', 'existing zip')

		// Archive the file
		const zipPath = await umbreld.client.files.archive.mutate({
			paths: ['/Home/unique-test.txt'],
		})

		// Expect a unique name (with (2) appended)
		expect(zipPath).toBe('/Home/unique-test.txt (2).zip')
		const files = extractZipBuffer(await downloadFile(zipPath))
		expect(files['unique-test.txt']).toBe('test content')

		// Original zip file should remain untouched
		await expect(readGuestFile(`${guestHome}/unique-test.txt.zip`)).resolves.toBe('existing zip')
	})

	test('handles files with special characters in name', async () => {
		// Create a file with special characters
		const fileName = 'special & chars 漢字.txt'
		await uploadFile(`/Home/${fileName}`, 'special content')

		// Archive the file
		const zipPath = await umbreld.client.files.archive.mutate({
			paths: [`/Home/${fileName}`],
		})

		// Check archive file exists with the right contents
		expect(zipPath).toBe(`/Home/${fileName}.zip`)
		const files = extractZipBuffer(await downloadFile(zipPath))
		expect(files[fileName]).toBe('special content')
	})

	test('handles empty directories correctly', async () => {
		// Create an empty directory
		await umbreld.client.files.createDirectory.mutate({path: '/Home/archive-empty-dir'})

		// Archive the directory
		const zipPath = await umbreld.client.files.archive.mutate({
			paths: ['/Home/archive-empty-dir'],
		})

		// An empty directory creates an empty zip with no entries
		expect(zipPath).toBe('/Home/archive-empty-dir.zip')
		const zip = new AdmZip(await downloadFile(zipPath))
		expect(zip.getEntries().length).toBe(0)
	})
})

describe('unarchive()', () => {
	test('throws unauthorized error without auth token', async () => {
		await expect(umbreld.unauthenticatedClient.files.unarchive.mutate({path: '/Home/test.zip'})).rejects.toThrow(
			'Invalid token',
		)
	})

	test('throws error on directory traversal attempt', async () => {
		await expect(
			umbreld.client.files.unarchive.mutate({
				path: '/Home/../../../../etc/passwd.zip',
			}),
		).rejects.toThrow()
	})

	test('throws error on non-existent path', async () => {
		await expect(
			umbreld.client.files.unarchive.mutate({
				path: '/Home/nonexistent-file.zip',
			}),
		).rejects.toThrow()
	})

	test('throws error on relative paths', async () => {
		await Promise.all(
			['', ' ', '.', '..', 'Home', 'Home/file.zip'].map(async (path) => {
				await expect(
					umbreld.client.files.unarchive.mutate({
						path,
					}),
				).rejects.toThrow()
			}),
		)
	})

	test('throws error on unsupported file format', async () => {
		// Create a file with unsupported extension
		await uploadFile('/Home/unarchive-test.txt', 'This is not an archive')

		// Try to extract it
		await expect(
			umbreld.client.files.unarchive.mutate({
				path: '/Home/unarchive-test.txt',
			}),
		).rejects.toThrow('[operation-not-allowed]')
	})

	test('extracts a zip archive correctly', async () => {
		// Create a test zip with actual zip format and upload it
		const zip = new AdmZip()
		zip.addFile('file1.txt', Buffer.from('content1', 'utf8'))
		zip.addFile('file2.txt', Buffer.from('content2', 'utf8'))
		zip.addFile('subdir/file3.txt', Buffer.from('content3', 'utf8'))
		await uploadFile('/Home/test-extract.zip', zip.toBuffer())

		// Extract the archive
		const extractPath = await umbreld.client.files.unarchive.mutate({
			path: '/Home/test-extract.zip',
		})

		// Verify extracted folder path
		expect(extractPath).toBe('/Home/test-extract')

		// Verify extracted contents
		await expect(readGuestFile(`${guestHome}/test-extract/file1.txt`)).resolves.toBe('content1')
		await expect(readGuestFile(`${guestHome}/test-extract/file2.txt`)).resolves.toBe('content2')
		await expect(readGuestFile(`${guestHome}/test-extract/subdir/file3.txt`)).resolves.toBe('content3')
	})

	test('creates a unique directory name if target already exists', async () => {
		// Create a directory that would conflict with the extraction path
		await umbreld.client.files.createDirectory.mutate({path: '/Home/conflict-test'})
		await uploadFile('/Home/conflict-test/existing-file.txt', 'existing content')

		// Create a test zip file
		const zip = new AdmZip()
		zip.addFile('new-file.txt', Buffer.from('new content', 'utf8'))
		await uploadFile('/Home/conflict-test.zip', zip.toBuffer())

		// Extract the archive
		const extractPath = await umbreld.client.files.unarchive.mutate({
			path: '/Home/conflict-test.zip',
		})

		// Verify extracted folder gets a unique name
		expect(extractPath).toBe('/Home/conflict-test (2)')

		// Verify both directories exist with correct content
		await expect(readGuestFile(`${guestHome}/conflict-test/existing-file.txt`)).resolves.toBe('existing content')
		await expect(readGuestFile(`${guestHome}/conflict-test (2)/new-file.txt`)).resolves.toBe('new content')
	})

	test('handles files with special characters in name', async () => {
		// Create a zip file with special characters in name
		const fileName = 'special & chars 漢字.zip'
		const zip = new AdmZip()
		zip.addFile('test.txt', Buffer.from('special content', 'utf8'))
		await uploadFile(`/Home/${fileName}`, zip.toBuffer())

		// Extract the archive
		const extractPath = await umbreld.client.files.unarchive.mutate({
			path: `/Home/${fileName}`,
		})

		// Verify extracted folder path (base name without extension)
		expect(extractPath).toBe('/Home/special & chars 漢字')

		// Verify extracted content
		await expect(readGuestFile(`${guestHome}/special & chars 漢字/test.txt`)).resolves.toBe('special content')
	})

	// Test each archive type
	const archiveTypes = [
		{extension: '.tar', command: 'tar --create --file'},
		{extension: '.tar.gz', command: 'tar --create --gzip --file'},
		{extension: '.tgz', command: 'tar --create --gzip --file'},
		{extension: '.tar.bz2', command: 'tar --create --bzip2 --file'},
		{extension: '.tar.xz', command: 'tar --create --xz --file'},
		{
			extension: '.zip',
			command: 'zip -r',
			archive:
				'UEsDBAoAAAAAABKRdFo3fMmGFAAAABQAAAANABwAdGVzdC1maWxlLnR4dFVUCQADo1ncZ6NZ3Gd1eAsAAQQAAAAABAAAAABhcmNoaXZlIHRlc3QgY29udGVudFBLAQIeAwoAAAAAABKRdFo3fMmGFAAAABQAAAANABgAAAAAAAEAAACkgQAAAAB0ZXN0LWZpbGUudHh0VVQFAAOjWdxndXgLAAEEAAAAAAQAAAAAUEsFBgAAAAABAAEAUwAAAFsAAAAAAA==',
		},
		{
			extension: '.7z',
			command: '7z a',
			archive:
				'N3q8ryccAARJrGAoGAAAAAAAAABiAAAAAAAAAOWGm00BABNhcmNoaXZlIHRlc3QgY29udGVudAABBAYAAQkYAAcLAQABISEBAAwUAAgKATd8yYYAAAUBGQwAAAAAAAAAAAAAAAARHQB0AGUAcwB0AC0AZgBpAGwAZQAuAHQAeAB0AAAAFAoBAABqURnDmdsBFQYBACCApIEAAA==',
		},
		{
			extension: '.rar',
			command: 'rar a',
			archive:
				'UmFyIRoHAQAzkrXlCgEFBgAFAQGAgAB/pngvIwIClAAGlACkgwIpWdxnN3zJhoAAAQ10ZXN0LWZpbGUudHh0YXJjaGl2ZSB0ZXN0IGNvbnRlbnQdd1ZRAwUEAA==',
		},
	]
	for (const type of archiveTypes) {
		test(`extracts a ${type.extension} archive correctly`, async () => {
			let archiveBuffer: Buffer
			if (type.archive) {
				// We include pre-created base64 archives for types we don't have tooling installed for
				archiveBuffer = Buffer.from(type.archive, 'base64')
			} else {
				// For other types, we create the archive on the fly in a host-side
				// scratch directory and upload it
				const sourceDir = `${fixtureDirectory}/archive-test${type.extension}-source`
				const archiveFile = `${fixtureDirectory}/archive-test${type.extension}`
				await fse.ensureDir(sourceDir)
				await fse.writeFile(`${sourceDir}/test-file.txt`, 'archive test content')
				await $({
					cwd: sourceDir,
					env: {COPYFILE_DISABLE: '1'},
				})`${type.command.split(' ')} ${archiveFile} .`
				archiveBuffer = await fse.readFile(archiveFile)
			}

			// Upload the archive into the VM through the files API. Each type
			// gets its own directory so the extraction paths don't collide.
			const directory = `/Home/unarchive${type.extension.replaceAll('.', '-')}`
			await umbreld.client.files.createDirectory.mutate({path: directory})
			await uploadFile(`${directory}/archive-test${type.extension}`, archiveBuffer)

			// Extract the archive through the API
			const extractPath = await umbreld.client.files.unarchive.mutate({
				path: `${directory}/archive-test${type.extension}`,
			})

			// Verify extracted folder path
			// Common expected path is the archive name without extension
			expect(extractPath).toBe(`${directory}/archive-test`)

			// Verify the extracted file contains the expected content
			const listing = await umbreld.client.files.list.query({path: `${directory}/archive-test`})
			expect(listing.files.map((file) => file.name)).toStrictEqual(['test-file.txt'])
			await expect(
				readGuestFile(`${guestHome}/unarchive${type.extension.replaceAll('.', '-')}/archive-test/test-file.txt`),
			).resolves.toBe('archive test content')
		})
	}
})
