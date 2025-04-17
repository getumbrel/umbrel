import {expect, test, beforeEach, beforeAll, afterAll, describe} from 'vitest'
import fse from 'fs-extra'
import nodePath from 'node:path'
import AdmZip from 'adm-zip'
import {$} from 'execa'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

// Create a new umbreld instance for tests
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
		await fse.ensureDir(`${umbreld.instance.dataDirectory}/home/dir1`)
		await fse.ensureDir(`${umbreld.instance.dataDirectory}/home/dir2`)
		await fse.writeFile(`${umbreld.instance.dataDirectory}/home/dir1/file1.txt`, 'content1')
		await fse.writeFile(`${umbreld.instance.dataDirectory}/home/dir2/file2.txt`, 'content2')

		// Try to archive files from different directories
		await expect(
			umbreld.client.files.archive.mutate({
				paths: ['/Home/dir1/file1.txt', '/Home/dir2/file2.txt'],
			}),
		).rejects.toThrow('paths must be in same directory')
	})

	test('successfully creates a zip archive from a single file', async () => {
		// Create a test file
		await fse.writeFile(`${umbreld.instance.dataDirectory}/home/test-file.txt`, 'test content')

		// Archive the file
		const zipPath = await umbreld.client.files.archive.mutate({
			paths: ['/Home/test-file.txt'],
		})

		// Check archive file exists
		expect(zipPath).toBe('/Home/test-file.txt.zip')
		const zipFile = `${umbreld.instance.dataDirectory}/home/test-file.txt.zip`
		await expect(fse.pathExists(zipFile)).resolves.toBe(true)

		// Check archive contents
		const zipBuffer = await fse.readFile(zipFile)
		const files = extractZipBuffer(zipBuffer)
		expect(files['test-file.txt']).toBe('test content')
	})

	test('successfully creates a zip archive from multiple files', async () => {
		// Create test files
		await fse.writeFile(`${umbreld.instance.dataDirectory}/home/file1.txt`, 'content1')
		await fse.writeFile(`${umbreld.instance.dataDirectory}/home/file2.txt`, 'content2')

		// Archive the files
		const zipPath = await umbreld.client.files.archive.mutate({
			paths: ['/Home/file1.txt', '/Home/file2.txt'],
		})

		// Check archive file exists
		expect(zipPath).toBe('/Home/Archive.zip')
		const zipFile = `${umbreld.instance.dataDirectory}/home/Archive.zip`
		await expect(fse.pathExists(zipFile)).resolves.toBe(true)

		// Check archive contents
		const zipBuffer = await fse.readFile(zipFile)
		const files = extractZipBuffer(zipBuffer)
		expect(files['file1.txt']).toBe('content1')
		expect(files['file2.txt']).toBe('content2')
	})

	test('successfully creates a zip archive from a directory', async () => {
		// Create a test directory with files
		await fse.ensureDir(`${umbreld.instance.dataDirectory}/home/test-dir`)
		await fse.writeFile(`${umbreld.instance.dataDirectory}/home/test-dir/file1.txt`, 'content1')
		await fse.writeFile(`${umbreld.instance.dataDirectory}/home/test-dir/file2.txt`, 'content2')
		await fse.ensureDir(`${umbreld.instance.dataDirectory}/home/test-dir/subdir`)
		await fse.writeFile(`${umbreld.instance.dataDirectory}/home/test-dir/subdir/file3.txt`, 'content3')

		// Archive the directory
		const zipPath = await umbreld.client.files.archive.mutate({
			paths: ['/Home/test-dir'],
		})

		// Check archive file exists
		expect(zipPath).toBe('/Home/test-dir.zip')
		const zipFile = `${umbreld.instance.dataDirectory}/home/test-dir.zip`
		await expect(fse.pathExists(zipFile)).resolves.toBe(true)

		// Check archive contents
		const zipBuffer = await fse.readFile(zipFile)
		const files = extractZipBuffer(zipBuffer)
		expect(files['test-dir/file1.txt']).toBe('content1')
		expect(files['test-dir/file2.txt']).toBe('content2')
		expect(files['test-dir/subdir/file3.txt']).toBe('content3')
	})

	test('creates a uniquely named zip archive when a file with the same name already exists', async () => {
		// Create a test file
		await fse.writeFile(`${umbreld.instance.dataDirectory}/home/unique-test.txt`, 'test content')

		// Create a zip file that would conflict with the generated name
		await fse.writeFile(`${umbreld.instance.dataDirectory}/home/unique-test.txt.zip`, 'existing zip')

		// Archive the file
		const zipPath = await umbreld.client.files.archive.mutate({
			paths: ['/Home/unique-test.txt'],
		})

		// Expect a unique name (with (2) appended)
		expect(zipPath).toBe('/Home/unique-test.txt (2).zip')
		const zipFile = `${umbreld.instance.dataDirectory}/home/unique-test.txt (2).zip`
		await expect(fse.pathExists(zipFile)).resolves.toBe(true)

		// Check archive contents
		const zipBuffer = await fse.readFile(zipFile)
		const files = extractZipBuffer(zipBuffer)
		expect(files['unique-test.txt']).toBe('test content')

		// Original zip file should remain untouched
		const originalZipContent = await fse.readFile(`${umbreld.instance.dataDirectory}/home/unique-test.txt.zip`, 'utf8')
		expect(originalZipContent).toBe('existing zip')
	})

	test('handles files with special characters in name', async () => {
		// Create a file with special characters
		const fileName = 'special & chars 漢字.txt'
		await fse.writeFile(`${umbreld.instance.dataDirectory}/home/${fileName}`, 'special content')

		// Archive the file
		const zipPath = await umbreld.client.files.archive.mutate({
			paths: [`/Home/${fileName}`],
		})

		// Check archive file exists
		expect(zipPath).toBe(`/Home/${fileName}.zip`)
		const zipFile = `${umbreld.instance.dataDirectory}/home/${fileName}.zip`
		await expect(fse.pathExists(zipFile)).resolves.toBe(true)

		// Check archive contents
		const zipBuffer = await fse.readFile(zipFile)
		const files = extractZipBuffer(zipBuffer)
		expect(files[fileName]).toBe('special content')
	})

	test('handles empty directories correctly', async () => {
		// Create an empty directory
		await fse.ensureDir(`${umbreld.instance.dataDirectory}/home/empty-dir`)

		// Archive the directory
		const zipPath = await umbreld.client.files.archive.mutate({
			paths: ['/Home/empty-dir'],
		})

		// Check archive file exists
		expect(zipPath).toBe('/Home/empty-dir.zip')
		const zipFile = `${umbreld.instance.dataDirectory}/home/empty-dir.zip`
		await expect(fse.pathExists(zipFile)).resolves.toBe(true)

		// An empty directory creates an empty zip with no entries
		const zipBuffer = await fse.readFile(zipFile)
		const zip = new AdmZip(zipBuffer)
		const entries = zip.getEntries()
		expect(entries.length).toBe(0)
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
		await fse.writeFile(`${umbreld.instance.dataDirectory}/home/test.txt`, 'This is not an archive')

		// Try to extract it
		await expect(
			umbreld.client.files.unarchive.mutate({
				path: '/Home/test.txt',
			}),
		).rejects.toThrow('[operation-not-allowed]')
	})

	// The following tests require unar to be installed
	test('extracts a zip archive correctly', async () => {
		// Create a test zip file with actual zip format
		const zipFile = `${umbreld.instance.dataDirectory}/home/test-extract.zip`
		const zip = new AdmZip()
		zip.addFile('file1.txt', Buffer.from('content1', 'utf8'))
		zip.addFile('file2.txt', Buffer.from('content2', 'utf8'))
		zip.addFile('subdir/file3.txt', Buffer.from('content3', 'utf8'))
		await fse.writeFile(zipFile, zip.toBuffer())

		// Confirm the file exists
		await expect(fse.pathExists(zipFile)).resolves.toBe(true)

		// Extract the archive
		const extractPath = await umbreld.client.files.unarchive.mutate({
			path: '/Home/test-extract.zip',
		})

		// Verify extracted folder path
		expect(extractPath).toBe('/Home/test-extract')
		const extractDir = `${umbreld.instance.dataDirectory}/home/test-extract`

		// Verify extracted contents
		await expect(fse.readFile(`${extractDir}/file1.txt`, 'utf8')).resolves.toBe('content1')
		await expect(fse.readFile(`${extractDir}/file2.txt`, 'utf8')).resolves.toBe('content2')
		await expect(fse.readFile(`${extractDir}/subdir/file3.txt`, 'utf8')).resolves.toBe('content3')
	})

	test('creates a unique directory name if target already exists', async () => {
		// Create a directory that would conflict with the extraction path
		await fse.ensureDir(`${umbreld.instance.dataDirectory}/home/conflict-test`)
		await fse.writeFile(`${umbreld.instance.dataDirectory}/home/conflict-test/existing-file.txt`, 'existing content')

		// Create a test zip file
		const zipFile = `${umbreld.instance.dataDirectory}/home/conflict-test.zip`
		const zip = new AdmZip()
		zip.addFile('new-file.txt', Buffer.from('new content', 'utf8'))
		await fse.writeFile(zipFile, zip.toBuffer())

		// Extract the archive
		const extractPath = await umbreld.client.files.unarchive.mutate({
			path: '/Home/conflict-test.zip',
		})

		// Verify extracted folder gets a unique name
		expect(extractPath).toBe('/Home/conflict-test (2)')

		// Verify both directories exist with correct content
		await expect(
			fse.readFile(`${umbreld.instance.dataDirectory}/home/conflict-test/existing-file.txt`, 'utf8'),
		).resolves.toBe('existing content')
		await expect(
			fse.readFile(`${umbreld.instance.dataDirectory}/home/conflict-test (2)/new-file.txt`, 'utf8'),
		).resolves.toBe('new content')
	})

	test('handles files with special characters in name', async () => {
		// Create a zip file with special characters in name
		const fileName = 'special & chars 漢字.zip'
		const zipFile = `${umbreld.instance.dataDirectory}/home/${fileName}`

		const zip = new AdmZip()
		zip.addFile('test.txt', Buffer.from('special content', 'utf8'))
		await fse.writeFile(zipFile, zip.toBuffer())

		// Extract the archive
		const extractPath = await umbreld.client.files.unarchive.mutate({
			path: `/Home/${fileName}`,
		})

		// Verify extracted folder path (base name without extension)
		expect(extractPath).toBe('/Home/special & chars 漢字')

		// Verify extracted content
		const extractedFile = `${umbreld.instance.dataDirectory}/home/special & chars 漢字/test.txt`
		await expect(fse.readFile(extractedFile, 'utf8')).resolves.toBe('special content')
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
			const sourceDir = `${umbreld.instance.dataDirectory}/home/archive-test`
			const archiveFile = `${umbreld.instance.dataDirectory}/home/archive-test${type.extension}`

			if (type.archive) {
				// We include pre-created base64 archives for types we don't have tooling installed for
				await fse.writeFile(archiveFile, Buffer.from(type.archive, 'base64'))
			} else {
				// For other types, we create the archive on the fly

				// Create a test directory and file
				await fse.ensureDir(sourceDir)
				await fse.writeFile(`${sourceDir}/test-file.txt`, 'archive test content')

				// Create the archive
				await $({cwd: sourceDir})`${type.command.split(' ')} ${archiveFile} .`

				// Delete the original files
				await fse.remove(sourceDir)
			}

			// Verify the archive was created
			await expect(fse.pathExists(archiveFile)).resolves.toBe(true)

			// Verify the original files do not exist
			await expect(fse.pathExists(sourceDir)).resolves.toBe(false)

			// Extract the archive through the API
			const extractPath = await umbreld.client.files.unarchive.mutate({
				path: `/Home/archive-test${type.extension}`,
			})

			// Verify extracted folder path
			// Common expected path is the archive name without extension
			expect(extractPath).toBe(`/Home/archive-test`)

			// Verify the extracted file contains the expected content
			await expect(fse.pathExists(sourceDir)).resolves.toBe(true)
			await expect(fse.readdir(sourceDir)).resolves.toStrictEqual(['test-file.txt'])
			await expect(fse.readFile(`${sourceDir}/test-file.txt`, 'utf8')).resolves.toBe('archive test content')
		})
	}
})
