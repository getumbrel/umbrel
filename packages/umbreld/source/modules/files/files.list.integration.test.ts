import {setTimeout as sleep} from 'node:timers/promises'

import {vi, expect, beforeAll, afterAll, test} from 'vitest'
import {$} from 'execa'
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

test('list() throws invalid error whithout auth token', async () => {
	await expect(umbreld.unauthenticatedClient.files.list.query({path: '/'})).rejects.toThrow('Invalid token')
})

test('list() throws on directory traversal attempt', async () => {
	await expect(umbreld.client.files.list.query({path: '/Home/../../../../etc'})).rejects.toThrow('[invalid-base]')
})

test('list() throws on symlink traversal attempt', async () => {
	// Create a symlink to the root directory in at the virtual path /Home/symlink-to-root
	await $`ln -s / ${umbreld.instance.dataDirectory}/home/symlink-to-root`
	// Ensure the symlink exists at the correct location
	await expect(umbreld.client.files.list.query({path: '/Home'})).resolves.toMatchObject({
		files: expect.arrayContaining([
			expect.objectContaining({
				name: 'symlink-to-root',
			}),
		]),
	})
	// Attempt to list it
	await expect(umbreld.client.files.list.query({path: '/Home/symlink-to-root'})).rejects.toThrow('[escapes-base]')

	// Remove the symlink
	await fse.remove(umbreld.instance.dataDirectory + '/home/symlink-to-root')
})

test('list() throws on relative paths', async () => {
	await Promise.all(
		['', ' ', '.', '..', 'Home', 'Home/..', 'Home/Documents'].map((path) =>
			expect(umbreld.client.files.list.query({path})).rejects.toThrow('[path-not-absolute]'),
		),
	)
})

test('list() throws on non existent paths', async () => {
	await Promise.all([
		expect(umbreld.client.files.list.query({path: '/DoesNotExist'})).rejects.toThrow('[invalid-base]'),
		expect(umbreld.client.files.list.query({path: '/Home/DoesNotExist'})).rejects.toThrow('[does-not-exist]'),
	])
})

test('list() lists the root directory', async () => {
	await expect(umbreld.client.files.list.query({path: '/'})).resolves.toMatchObject({
		name: '',
		path: '/',
		type: 'directory',
		size: 0,
		modified: expect.any(Number),
		operations: [],
		files: ['Apps', 'Backups', 'External', 'Home', 'Network', 'Trash'].map((name) => ({
			name,
			path: `/${name}`,
			type: 'directory',
			size: 0,
			modified: expect.any(Number),
			operations: expect.arrayContaining(['copy']),
		})),
	})
})

test('list() lists the /Home directory', async () => {
	await expect(umbreld.client.files.list.query({path: '/Home'})).resolves.toMatchObject({
		name: 'Home',
		path: '/Home',
		type: 'directory',
		size: 0,
		modified: expect.any(Number),
		operations: expect.arrayContaining(['copy']),
		files: [
			{
				name: 'Documents',
				path: '/Home/Documents',
				type: 'directory',
				size: 0,
				modified: expect.any(Number),
				operations: expect.arrayContaining(['move', 'copy']),
			},
			{
				name: 'Downloads',
				path: '/Home/Downloads',
				type: 'directory',
				size: 0,
				modified: expect.any(Number),
				operations: expect.arrayContaining(['copy']),
			},
			{
				name: 'Photos',
				path: '/Home/Photos',
				type: 'directory',
				size: 0,
				modified: expect.any(Number),
				operations: expect.arrayContaining(['move', 'copy']),
			},
			{
				name: 'Videos',
				path: '/Home/Videos',
				type: 'directory',
				size: 0,
				modified: expect.any(Number),
				operations: expect.arrayContaining(['move', 'copy']),
			},
		],
	})
})

test('list() returns correct types for various files and directories', async () => {
	// Create a test directory with files of different types
	const mimeDir = `${umbreld.instance.dataDirectory}/home/mime-test`
	await fse.mkdir(mimeDir)

	// Create test files with different mime types
	await Promise.all([
		fse.writeFile(`${mimeDir}/text.txt`, ''),
		fse.writeFile(`${mimeDir}/image.png`, ''),
		fse.writeFile(`${mimeDir}/video.mp4`, ''),
		fse.writeFile(`${mimeDir}/unknown`, ''),
	])

	// Create a subdirectory
	const subDir = `${mimeDir}/subdir`
	await fse.mkdir(subDir)

	// Create a symlink
	const symlinkPath = `${mimeDir}/symlink-to-text`
	await fse.symlink(`${mimeDir}/text.txt`, symlinkPath)

	// Query the directory
	const mimeTypes = await umbreld.client.files.list.query({path: '/Home/mime-test'})

	// Check the types
	;[
		{name: 'text.txt', type: 'text/plain'},
		{name: 'image.png', type: 'image/png'},
		{name: 'video.mp4', type: 'video/mp4'},
		{name: 'unknown', type: 'application/octet-stream'},
		{name: 'subdir', type: 'directory'},
		{name: 'symlink-to-text', type: 'symbolic-link'},
	].forEach(({name, type}) => {
		expect(mimeTypes.files.find((file) => file.name === name)?.type).toEqual(type)
	})

	// Clean up
	await fse.remove(mimeDir)
})

test('list() shows dotfiles', async () => {
	// Create a test directory with dotfiles
	const testDirectory = `${umbreld.instance.dataDirectory}/home/dotfiles-test`
	await fse.mkdir(testDirectory)

	// Create regular files and dotfiles
	await Promise.all([
		fse.writeFile(`${testDirectory}/regular.txt`, ''),
		fse.writeFile(`${testDirectory}/.dotfile`, ''),
		fse.writeFile(`${testDirectory}/.hidden-config`, ''),
	])

	// Query the directory listing
	const listing = await umbreld.client.files.list.query({
		path: '/Home/dotfiles-test',
	})

	// Verify that dotfiles are included in the listing
	expect(listing.files).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				name: '.dotfile',
				path: '/Home/dotfiles-test/.dotfile',
			}),
			expect.objectContaining({
				name: '.hidden-config',
				path: '/Home/dotfiles-test/.hidden-config',
			}),
		]),
	)

	// Clean up
	await fse.remove(testDirectory)
})

test('list() hides .DS_Store files', async () => {
	// Create a test directory with .DS_Store file
	const testDirectory = `${umbreld.instance.dataDirectory}/home/ds-store-test`
	await fse.mkdir(testDirectory)

	// Create regular files and .DS_Store file
	await Promise.all([
		fse.writeFile(`${testDirectory}/regular.txt`, ''),
		fse.writeFile(`${testDirectory}/.DS_Store`, ''),
	])

	// Query the directory listing
	const listing = await umbreld.client.files.list.query({
		path: '/Home/ds-store-test',
	})

	// Verify that .DS_Store is not included but other files are
	expect(listing.files.map((file) => file.name)).not.toContain('.DS_Store')
	expect(listing.files.map((file) => file.name)).toContain('regular.txt')

	// Clean up
	await fse.remove(testDirectory)
})

test('list() paginates directory listings', async () => {
	// Create a test directory with 150 files
	const testDirectory = `${umbreld.instance.dataDirectory}/home/pagination-test`
	await fse.mkdir(testDirectory)

	// Create 150 files
	await Promise.all(
		Array.from({length: 150}, (_, i) => i + 1).map((i) =>
			fse.writeFile(`${testDirectory}/file${i.toString().padStart(3, '0')}.txt`, ''),
		),
	)

	// Test first page (100 files because that's the default limit)
	const firstPage = await umbreld.client.files.list.query({path: '/Home/pagination-test'})
	expect(firstPage.files).toHaveLength(100)
	expect(firstPage.files[0].name).toBe('file001.txt')
	expect(firstPage.files[99].name).toBe('file100.txt')
	expect(firstPage.totalFiles).toBe(150)
	expect(firstPage.hasMore).toBe(true)

	// Test second page (50 files)
	const secondPage = await umbreld.client.files.list.query({
		path: '/Home/pagination-test',
		lastFile: firstPage.files[99].name,
	})
	expect(secondPage.files).toHaveLength(50)
	expect(secondPage.files[0].name).toBe('file101.txt')
	expect(secondPage.files[49].name).toBe('file150.txt')
	expect(secondPage.totalFiles).toBe(150)
	expect(secondPage.hasMore).toBe(false)

	// Test third page (0 files)
	const thirdPage = await umbreld.client.files.list.query({
		path: '/Home/pagination-test',
		lastFile: secondPage.files[49].name,
	})
	expect(thirdPage.files).toHaveLength(0)
	expect(thirdPage.totalFiles).toBe(150)
	expect(thirdPage.hasMore).toBe(false)

	// Clean up
	await fse.remove(testDirectory)
})

test('list() paginates directory listings with a custom limit', async () => {
	// Create a test directory with 150 files
	const testDirectory = `${umbreld.instance.dataDirectory}/home/custom-limit-test`
	await fse.mkdir(testDirectory)

	// Create 150 files
	await Promise.all(
		Array.from({length: 150}, (_, i) => i + 1).map((i) =>
			fse.writeFile(`${testDirectory}/file${i.toString().padStart(3, '0')}.txt`, ''),
		),
	)

	// Test with a custom limit of 42 files
	const customLimit = 42
	const result = await umbreld.client.files.list.query({
		path: '/Home/custom-limit-test',
		limit: customLimit,
	})

	// Verify exact number of files matches the custom limit
	expect(result.files).toHaveLength(customLimit)
	expect(result.files[0].name).toBe('file001.txt')
	expect(result.files[customLimit - 1].name).toBe(`file${customLimit.toString().padStart(3, '0')}.txt`)
	expect(result.totalFiles).toBe(150)
	expect(result.hasMore).toBe(true)

	// Clean up
	await fse.remove(testDirectory)
})

test("list() truncates a listing if it's larger than the max listing size", async () => {
	const maxListingSize = 10000
	// Create a test directory with just under the max listing size
	const testDirectory = `${umbreld.instance.dataDirectory}/home/max-listing-size`
	await fse.mkdir(testDirectory)
	await Promise.all(
		Array.from({length: maxListingSize - 1}, (_, i) => i + 1).map((i) =>
			fse.writeFile(`${testDirectory}/file${i.toString()}.txt`, ''),
		),
	)

	// Test results are not truncated
	await expect(umbreld.client.files.list.query({path: '/Home/max-listing-size'})).resolves.not.toHaveProperty(
		'truncatedAt',
	)

	// Create one more file
	await fse.writeFile(`${testDirectory}/file${maxListingSize}.txt`, '')

	// Test results are truncated
	await expect(umbreld.client.files.list.query({path: '/Home/max-listing-size'})).resolves.toHaveProperty(
		'truncatedAt',
		maxListingSize,
	)

	// Clean up
	await fse.remove(testDirectory)
})

test('list() sorts by name', async () => {
	// Create a test directory with files - using unique path
	const testDirectory = `${umbreld.instance.dataDirectory}/home/sort-by-name-test`
	await fse.mkdir(testDirectory)

	// Create test files with different names
	await Promise.all([
		fse.writeFile(`${testDirectory}/b.txt`, ''),
		fse.writeFile(`${testDirectory}/c.txt`, ''),
		fse.writeFile(`${testDirectory}/a.txt`, ''),
	])

	// Test ascending sort
	const ascending = await umbreld.client.files.list.query({
		path: '/Home/sort-by-name-test',
		sortBy: 'name',
		sortOrder: 'ascending',
	})
	expect(ascending.files.map((f) => f.name)).toEqual(['a.txt', 'b.txt', 'c.txt'])

	// Test descending sort
	const descending = await umbreld.client.files.list.query({
		path: '/Home/sort-by-name-test',
		sortBy: 'name',
		sortOrder: 'descending',
	})
	expect(descending.files.map((f) => f.name)).toEqual(['c.txt', 'b.txt', 'a.txt'])

	// Clean up
	await fse.remove(testDirectory)
})

test('list() sorts by modified time', async () => {
	// Create a test directory with files - using unique path
	const testDirectory = `${umbreld.instance.dataDirectory}/home/sort-by-modified-test`
	await fse.mkdir(testDirectory)

	// Create files with different modified times
	await fse.writeFile(`${testDirectory}/oldest.txt`, '')
	await sleep(100)
	await fse.writeFile(`${testDirectory}/middle.txt`, '')
	await sleep(100)
	await fse.writeFile(`${testDirectory}/newest.txt`, '')

	// Test ascending sort (oldest first)
	const ascending = await umbreld.client.files.list.query({
		path: '/Home/sort-by-modified-test',
		sortBy: 'modified',
		sortOrder: 'ascending',
	})
	expect(ascending.files.map((f) => f.name)).toEqual(['oldest.txt', 'middle.txt', 'newest.txt'])

	// Test descending sort (newest first)
	const descending = await umbreld.client.files.list.query({
		path: '/Home/sort-by-modified-test',
		sortBy: 'modified',
		sortOrder: 'descending',
	})
	expect(descending.files.map((f) => f.name)).toEqual(['newest.txt', 'middle.txt', 'oldest.txt'])

	// Clean up
	await fse.remove(testDirectory)
})

test('list() sorts by size', async () => {
	// Create a test directory with files - using unique path
	const testDirectory = `${umbreld.instance.dataDirectory}/home/sort-by-size-test`
	await fse.mkdir(testDirectory)

	// Create files with different sizes
	await fse.writeFile(`${testDirectory}/small.txt`, 'a')
	await fse.writeFile(`${testDirectory}/medium.txt`, 'aaa')
	await fse.writeFile(`${testDirectory}/large.txt`, 'aaaaa')

	// Test ascending sort (smallest first)
	const ascending = await umbreld.client.files.list.query({
		path: '/Home/sort-by-size-test',
		sortBy: 'size',
		sortOrder: 'ascending',
	})
	expect(ascending.files.map((f) => f.name)).toEqual(['small.txt', 'medium.txt', 'large.txt'])

	// Test descending sort (largest first)
	const descending = await umbreld.client.files.list.query({
		path: '/Home/sort-by-size-test',
		sortBy: 'size',
		sortOrder: 'descending',
	})
	expect(descending.files.map((f) => f.name)).toEqual(['large.txt', 'medium.txt', 'small.txt'])

	// Clean up
	await fse.remove(testDirectory)
})

test('list() sorts by type', async () => {
	// Create a test directory with files - using unique path
	const testDirectory = `${umbreld.instance.dataDirectory}/home/sort-by-type-test`
	await fse.mkdir(testDirectory)

	// Create files with different types
	await fse.writeFile(`${testDirectory}/document.txt`, '')
	await fse.writeFile(`${testDirectory}/image.png`, '')
	await fse.writeFile(`${testDirectory}/archive.zip`, '')

	// Test ascending sort
	const ascending = await umbreld.client.files.list.query({
		path: '/Home/sort-by-type-test',
		sortBy: 'type',
		sortOrder: 'ascending',
	})
	expect(ascending.files.map((f) => f.name)).toEqual(['archive.zip', 'image.png', 'document.txt'])

	// Test descending sort
	const descending = await umbreld.client.files.list.query({
		path: '/Home/sort-by-type-test',
		sortBy: 'type',
		sortOrder: 'descending',
	})
	expect(descending.files.map((f) => f.name)).toEqual(['document.txt', 'image.png', 'archive.zip'])

	// Clean up
	await fse.remove(testDirectory)
})

test('list() sorts files numerically by name', async () => {
	// Create a test directory with files named numerically
	const testDirectory = `${umbreld.instance.dataDirectory}/home/numeric-sort-test`
	await fse.mkdir(testDirectory)

	// Create files with numeric names
	await fse.writeFile(`${testDirectory}/0.txt`, '')
	await fse.writeFile(`${testDirectory}/1.txt`, '')
	await fse.writeFile(`${testDirectory}/2.txt`, '')
	await fse.writeFile(`${testDirectory}/3.txt`, '')
	await fse.writeFile(`${testDirectory}/4.txt`, '')
	await fse.writeFile(`${testDirectory}/5.txt`, '')
	await fse.writeFile(`${testDirectory}/6.txt`, '')
	await fse.writeFile(`${testDirectory}/7.txt`, '')
	await fse.writeFile(`${testDirectory}/8.txt`, '')
	await fse.writeFile(`${testDirectory}/9.txt`, '')
	await fse.writeFile(`${testDirectory}/10.txt`, '')

	// Test ascending sort by name
	const ascending = await umbreld.client.files.list.query({
		path: '/Home/numeric-sort-test',
		sortBy: 'name',
		sortOrder: 'ascending',
	})
	expect(ascending.files.map((f) => f.name)).toEqual([
		'0.txt',
		'1.txt',
		'2.txt',
		'3.txt',
		'4.txt',
		'5.txt',
		'6.txt',
		'7.txt',
		'8.txt',
		'9.txt',
		'10.txt',
	])

	// Test descending sort by name
	const descending = await umbreld.client.files.list.query({
		path: '/Home/numeric-sort-test',
		sortBy: 'name',
		sortOrder: 'descending',
	})
	expect(descending.files.map((f) => f.name)).toEqual([
		'10.txt',
		'9.txt',
		'8.txt',
		'7.txt',
		'6.txt',
		'5.txt',
		'4.txt',
		'3.txt',
		'2.txt',
		'1.txt',
		'0.txt',
	])

	// Clean up
	await fse.remove(testDirectory)
})

test('list() falls back to name sorting when numeric values are equal', async () => {
	// Create a test directory with files - using unique path
	const testDirectory = `${umbreld.instance.dataDirectory}/home/sort-fallback-test`
	await fse.mkdir(testDirectory)

	// Create files with the same size but different names
	await fse.writeFile(`${testDirectory}/0.txt`, 'same size')
	await fse.writeFile(`${testDirectory}/1.txt`, 'same size')
	await fse.writeFile(`${testDirectory}/2.txt`, 'same size')
	await fse.writeFile(`${testDirectory}/3.txt`, 'same size')
	await fse.writeFile(`${testDirectory}/4.txt`, 'same size')
	await fse.writeFile(`${testDirectory}/5.txt`, 'same size')
	await fse.writeFile(`${testDirectory}/6.txt`, 'same size')
	await fse.writeFile(`${testDirectory}/7.txt`, 'same size')
	await fse.writeFile(`${testDirectory}/8.txt`, 'same size')
	await fse.writeFile(`${testDirectory}/9.txt`, 'same size')
	await fse.writeFile(`${testDirectory}/10.txt`, 'same size')

	// Test ascending sort by size, should fall back to name
	const ascending = await umbreld.client.files.list.query({
		path: '/Home/sort-fallback-test',
		sortBy: 'size',
		sortOrder: 'ascending',
	})
	expect(ascending.files.map((f) => f.name)).toEqual([
		'0.txt',
		'1.txt',
		'2.txt',
		'3.txt',
		'4.txt',
		'5.txt',
		'6.txt',
		'7.txt',
		'8.txt',
		'9.txt',
		'10.txt',
	])

	// Test descending sort by size, should fall back to name
	const descending = await umbreld.client.files.list.query({
		path: '/Home/sort-fallback-test',
		sortBy: 'size',
		sortOrder: 'descending',
	})
	expect(descending.files.map((f) => f.name)).toEqual([
		'10.txt',
		'9.txt',
		'8.txt',
		'7.txt',
		'6.txt',
		'5.txt',
		'4.txt',
		'3.txt',
		'2.txt',
		'1.txt',
		'0.txt',
	])

	// Clean up
	await fse.remove(testDirectory)
})

test('list() reports size as zero for directories', async () => {
	// Create a test directory with a subdirectory and files - using unique path
	const testDirectory = `${umbreld.instance.dataDirectory}/home/dir-size-test`
	await fse.mkdir(testDirectory)
	await fse.mkdir(`${testDirectory}/subdir`)

	// Add files to the subdirectory
	await fse.writeFile(`${testDirectory}/subdir/file1.txt`, 'content1')
	await fse.writeFile(`${testDirectory}/subdir/file2.txt`, 'content2')

	// Query the directory listing
	const listing = await umbreld.client.files.list.query({
		path: '/Home/dir-size-test',
	})

	// Check that the directory size is reported as zero
	const subdir = listing.files.find((f) => f.name === 'subdir')
	expect(subdir).toBeDefined()
	expect(subdir!.size).toBe(0)

	// Clean up
	await fse.remove(testDirectory)
})

test('list() reports correct size for files in bytes', async () => {
	// Create a test directory with files - using unique path
	const testDirectory = `${umbreld.instance.dataDirectory}/home/file-size-test`
	await fse.mkdir(testDirectory)

	// Create files with specific sizes
	await fse.writeFile(`${testDirectory}/file1.txt`, '12345') // 5 bytes
	await fse.writeFile(`${testDirectory}/file2.txt`, '1234567890') // 10 bytes

	// Query the directory listing
	const listing = await umbreld.client.files.list.query({
		path: '/Home/file-size-test',
	})

	// Check that file sizes are reported correctly
	const file1 = listing.files.find((f) => f.name === 'file1.txt')
	expect(file1).toBeDefined()
	expect(file1!.size).toBe(5)

	const file2 = listing.files.find((f) => f.name === 'file2.txt')
	expect(file2).toBeDefined()
	expect(file2!.size).toBe(10)

	// Clean up
	await fse.remove(testDirectory)
})

test('list() reports correct modified time for a single file', async () => {
	// Create a test directory - using unique path
	const testDirectory = `${umbreld.instance.dataDirectory}/home/modified-time-test`
	await fse.mkdir(testDirectory)

	// Get the time before creating the file
	const beforeCreation = Date.now()
	await sleep(100)

	// Create a file
	await fse.writeFile(`${testDirectory}/file1.txt`, 'content1')

	// Get the time after creating the file
	await sleep(100)
	const afterCreation = Date.now()

	// Query the directory listing
	const listing = await umbreld.client.files.list.query({
		path: '/Home/modified-time-test',
	})

	// Check that the file modified time is reported correctly
	const file = listing.files.find((f) => f.name === 'file1.txt')
	expect(file).toBeDefined()
	expect(file!.modified).toBeGreaterThanOrEqual(beforeCreation)
	expect(file!.modified).toBeLessThanOrEqual(afterCreation)

	// Clean up
	await fse.remove(testDirectory)
})

test('list() handles unreadable files gracefully without killing the entire listing', async () => {
	// Create a test directory - using unique path
	const testDirectory = `${umbreld.instance.dataDirectory}/home/unreadable-files-test`
	await fse.mkdir(testDirectory)

	// Create a readable file
	await fse.writeFile(`${testDirectory}/readable.txt`, 'readable content')

	// Create an unreadable file
	await fse.writeFile(`${testDirectory}/unreadable.txt`, 'unreadable content')

	// Mock fse.lstat to throw an error for the unreadable file
	const originalLstat = fse.lstat
	vi.spyOn(fse, 'lstat').mockImplementation(async (path: fse.PathLike) => {
		// Mock a stat failure if reading the unreadable file
		if (path.toString().endsWith('/unreadable.txt')) throw new Error('Permission denied')

		// Else pass through to the original logic
		return originalLstat(path)
	})

	// Query the directory listing
	await expect(
		umbreld.client.files.list.query({
			path: '/Home/unreadable-files-test',
		}),
	).resolves.toMatchObject({
		files: [
			expect.objectContaining({
				name: 'readable.txt',
				path: '/Home/unreadable-files-test/readable.txt',
				type: 'text/plain',
				size: 16,
				modified: expect.any(Number),
			}),
		],
	})

	// Restore the original lstat implementation
	vi.restoreAllMocks()

	// Check the mock is removed
	// Query the directory listing
	await expect(
		umbreld.client.files.list.query({
			path: '/Home/unreadable-files-test',
		}),
	).resolves.toMatchObject({
		files: expect.arrayContaining([
			expect.objectContaining({
				name: 'unreadable.txt',
				type: 'text/plain',
			}),
		]),
	})

	// Clean up
	await fse.remove(testDirectory)
})
