import {expect, beforeAll, afterAll, test, vi} from 'vitest'
import {$} from 'execa'
import fse from 'fs-extra'

let getDiskUsageByPathReturnValue = null as any
vi.mock('../system/system.js', async (importOriginal) => {
	const original = (await importOriginal()) as any

	return {
		...original,
		getDiskUsageByPath: async (umbreld: any) => getDiskUsageByPathReturnValue ?? original.getDiskUsageByPath(umbreld),
	}
})

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>

beforeAll(async () => {
	umbreld = await createTestUmbreld()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
})

test('copy() throws invalid error without auth token', async () => {
	await expect(
		umbreld.unauthenticatedClient.files.copy.mutate({path: '/Home/Documents', toDirectory: '/Home/Documents-copy'}),
	).rejects.toThrow('Invalid token')
})

test('copy() throws on directory traversal attempt in source path', async () => {
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/../../../../etc',
			toDirectory: '/Home',
		}),
	).rejects.toThrow('[invalid-base]')
})

test('copy() throws on directory traversal attempt in destination path', async () => {
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home',
			toDirectory: '/Home/../../../../etc',
		}),
	).rejects.toThrow('[invalid-base]')
})

test('copy() throws on symlink traversal attempt in source path', async () => {
	// Create a symlink to the root directory
	await $`ln -s / ${umbreld.instance.dataDirectory}/home/symlink-to-root`

	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/symlink-to-root/etc',
			toDirectory: '/Home',
		}),
	).rejects.toThrow('[escapes-base]')

	// Clean up
	await fse.remove(`${umbreld.instance.dataDirectory}/home/symlink-to-root`)
})

test('copy() throws on symlink traversal attempt in destination path', async () => {
	// Create a symlink to the root directory
	await $`ln -s / ${umbreld.instance.dataDirectory}/home/symlink-to-root`

	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home',
			toDirectory: '/Home/symlink-to-root/etc',
		}),
	).rejects.toThrow('[escapes-base]')

	// Clean up
	await fse.remove(`${umbreld.instance.dataDirectory}/home/symlink-to-root`)
})

test('copy() throws on relative paths', async () => {
	await Promise.all(
		['', ' ', '.', '..', 'Home', 'Home/..', 'Home/Documents'].map(async (path) => {
			await expect(
				umbreld.client.files.copy.mutate({
					path,
					toDirectory: '/Home/Documents',
				}),
			).rejects.toThrow('[path-not-absolute]')
			await expect(
				umbreld.client.files.copy.mutate({
					path: '/Home/Documents',
					toDirectory: path,
				}),
			).rejects.toThrow('[path-not-absolute]')
		}),
	)
})

test('copy() throws on non existent source path', async () => {
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/DoesNotExist',
			toDirectory: '/Home',
		}),
	).rejects.toThrow('[invalid-base]')
})

test('copy() throws on non existent destination path', async () => {
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home',
			toDirectory: '/Home/DoesNotExist',
		}),
	).rejects.toThrow('[destination-not-exist]')
})

test('copy() throws copying to self', async () => {
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home',
			toDirectory: '/Home',
		}),
	).rejects.toThrow('[subdir-of-self]')
})

test('copy() throws copying to subdir of self', async () => {
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home',
			toDirectory: '/Home/Documents',
		}),
	).rejects.toThrow('[subdir-of-self]')
})

test('copy() throws if there is not enough free space on the destination', async () => {
	// Check copy works as expected when there is enough space
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/Documents',
			toDirectory: '/Home',
			collision: 'keep-both',
		}),
	).resolves.toBeTruthy()

	// Set up mock to return insufficient free space
	const ONE_GB = 1024 * 1024 * 1024
	getDiskUsageByPathReturnValue = {
		size: ONE_GB * 10,
		totalUsed: ONE_GB * 10,
		available: 0,
	}

	// Check copy fails when there is not enough free space
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/Documents',
			toDirectory: '/Home',
			collision: 'keep-both',
		}),
	).rejects.toThrow('[not-enough-space]')

	// Reset mock
	getDiskUsageByPathReturnValue = null

	// Check copy works as expected when there is enough space again
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/Documents',
			toDirectory: '/Home',
			collision: 'keep-both',
		}),
	).resolves.toBeTruthy()
})

test('copy() copies a single file to a directory', async () => {
	// Create test directory and file
	const testDirectory = `${umbreld.instance.dataDirectory}/home/copy-file-test`
	await fse.mkdir(testDirectory)
	await fse.mkdir(`${testDirectory}/source`)
	await fse.writeFile(`${testDirectory}/source/source.txt`, '')
	await fse.mkdir(`${testDirectory}/destination`)

	// Verify the directory is empty
	await expect(fse.readdir(`${testDirectory}/destination`)).resolves.toMatchObject([])

	// Copy the file
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-file-test/source/source.txt',
			toDirectory: '/Home/copy-file-test/destination',
		}),
	).resolves.toBe('/Home/copy-file-test/destination/source.txt')

	// Verify the copy
	await expect(fse.readdir(`${testDirectory}/destination`)).resolves.toMatchObject(['source.txt'])

	// Clean up
	await fse.remove(testDirectory)
})

test('copy() copies a single file to a directory with a trailing slash', async () => {
	// Create test directory and file
	const testDirectory = `${umbreld.instance.dataDirectory}/home/copy-file-test`
	await fse.mkdir(testDirectory)
	await fse.mkdir(`${testDirectory}/source`)
	await fse.writeFile(`${testDirectory}/source/source.txt`, '')
	await fse.mkdir(`${testDirectory}/destination`)

	// Verify the directory is empty
	await expect(fse.readdir(`${testDirectory}/destination`)).resolves.toMatchObject([])

	// Copy the file
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-file-test/source/source.txt',
			toDirectory: '/Home/copy-file-test/destination/',
		}),
	).resolves.toBe('/Home/copy-file-test/destination/source.txt')

	// Verify the copy
	await expect(fse.readdir(`${testDirectory}/destination`)).resolves.toMatchObject(['source.txt'])

	// Clean up
	await fse.remove(testDirectory)
})

test('copy() handles copying files to same directory by appending numbers regardless of collision strategy', async () => {
	// Create test directory and file
	const testDirectory = `${umbreld.instance.dataDirectory}/home/copy-same-dir-test`
	await fse.mkdir(testDirectory)
	await fse.writeFile(`${testDirectory}/original.txt`, '')

	// Copy the file to the same directory with default collision strategy
	// In same directory, this should still append numbers even though default is 'error'
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-same-dir-test/original.txt',
			toDirectory: '/Home/copy-same-dir-test',
		}),
	).resolves.toBe('/Home/copy-same-dir-test/original (2).txt')

	// Verify both files exist
	await expect(fse.pathExists(`${testDirectory}/original.txt`)).resolves.toBe(true)
	await expect(fse.pathExists(`${testDirectory}/original (2).txt`)).resolves.toBe(true)

	// Try with explicit 'replace' collision strategy - should still append numbers
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-same-dir-test/original.txt',
			toDirectory: '/Home/copy-same-dir-test',
			collision: 'replace',
		}),
	).resolves.toBe('/Home/copy-same-dir-test/original (3).txt')

	// Verify all files exist
	await expect(fse.pathExists(`${testDirectory}/original.txt`)).resolves.toBe(true)
	await expect(fse.pathExists(`${testDirectory}/original (2).txt`)).resolves.toBe(true)
	await expect(fse.pathExists(`${testDirectory}/original (3).txt`)).resolves.toBe(true)

	// Clean up
	await fse.remove(testDirectory)
})

test('copy() handles copying files to different directories by throwing on name conflict by default', async () => {
	// Create test directory and file
	const testDirectory = `${umbreld.instance.dataDirectory}/home/copy-conflict-test`
	await fse.mkdir(testDirectory)
	await fse.mkdir(`${testDirectory}/source`)
	await fse.writeFile(`${testDirectory}/source/file.txt`, '')

	// Create a destination file with the same name
	await fse.mkdir(`${testDirectory}/destination`)
	await fse.writeFile(`${testDirectory}/destination/file.txt`, '')

	// Try to copy the file and verify that it fails with default 'error' collision strategy
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-conflict-test/source/file.txt',
			toDirectory: '/Home/copy-conflict-test/destination',
		}),
	).rejects.toThrow('[destination-already-exists]')

	// Clean up
	await fse.remove(testDirectory)
})

test('copy(path, {collision: "keep-both"}) keeps both files by appending numbers', async () => {
	// Create test directory and file
	const testDirectory = `${umbreld.instance.dataDirectory}/home/copy-keep-both-test`
	await fse.mkdir(testDirectory)
	await fse.mkdir(`${testDirectory}/source`)
	await fse.writeFile(`${testDirectory}/source/file.txt`, 'source content')
	await fse.mkdir(`${testDirectory}/destination`)
	await fse.writeFile(`${testDirectory}/destination/file.txt`, 'destination content')

	// Copy the file with 'keep-both' collision strategy
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-keep-both-test/source/file.txt',
			toDirectory: '/Home/copy-keep-both-test/destination',
			collision: 'keep-both',
		}),
	).resolves.toBe('/Home/copy-keep-both-test/destination/file (2).txt')

	// Verify both files exist at the destination
	await expect(fse.pathExists(`${testDirectory}/destination/file.txt`)).resolves.toBe(true)
	await expect(fse.pathExists(`${testDirectory}/destination/file (2).txt`)).resolves.toBe(true)

	// Verify the contents are preserved
	await expect(fse.readFile(`${testDirectory}/destination/file.txt`, 'utf8')).resolves.toBe('destination content')
	await expect(fse.readFile(`${testDirectory}/destination/file (2).txt`, 'utf8')).resolves.toBe('source content')

	// Clean up
	await fse.remove(testDirectory)
})

test('copy(path, {collision: "replace"}) replaces existing files', async () => {
	// Create test directory and file
	const testDirectory = `${umbreld.instance.dataDirectory}/home/copy-replace-test`
	await fse.mkdir(testDirectory)
	await fse.mkdir(`${testDirectory}/source`)
	await fse.writeFile(`${testDirectory}/source/file.txt`, 'source content')
	await fse.mkdir(`${testDirectory}/destination`)
	await fse.writeFile(`${testDirectory}/destination/file.txt`, 'destination content')

	// Copy the file with 'replace' collision strategy
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-replace-test/source/file.txt',
			toDirectory: '/Home/copy-replace-test/destination',
			collision: 'replace',
		}),
	).resolves.toBe('/Home/copy-replace-test/destination/file.txt')

	// Verify the file exists at the destination
	await expect(fse.pathExists(`${testDirectory}/destination/file.txt`)).resolves.toBe(true)

	// Verify the content is replaced
	await expect(fse.readFile(`${testDirectory}/destination/file.txt`, 'utf8')).resolves.toBe('source content')

	// Clean up
	await fse.remove(testDirectory)
})

test('copy() copies a directory with contents', async () => {
	// Create test directory structure
	const testDirectory = `${umbreld.instance.dataDirectory}/home/copy-directory-test`
	await fse.mkdir(testDirectory)
	await fse.mkdir(`${testDirectory}/source`)
	await fse.writeFile(`${testDirectory}/source/file1.txt`, 'content1')
	await fse.writeFile(`${testDirectory}/source/file2.txt`, 'content2')
	await fse.mkdir(`${testDirectory}/source/subdir`)
	await fse.writeFile(`${testDirectory}/source/subdir/file3.txt`, 'content3')
	await fse.mkdir(`${testDirectory}/destination`)

	// Verify the directory is empty
	await expect(fse.readdir(`${testDirectory}/destination`)).resolves.toMatchObject([])

	// Copy the directory
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-directory-test/source',
			toDirectory: '/Home/copy-directory-test/destination',
		}),
	).resolves.toBe('/Home/copy-directory-test/destination/source')

	// Verify the copy
	await expect(fse.readdir(`${testDirectory}/destination`)).resolves.toMatchObject(['source'])
	await expect(fse.readdir(`${testDirectory}/destination/source`)).resolves.toMatchObject([
		'file1.txt',
		'file2.txt',
		'subdir',
	])
	await expect(fse.readdir(`${testDirectory}/destination/source/subdir`)).resolves.toMatchObject(['file3.txt'])

	// Clean up
	await fse.remove(testDirectory)
})

test('copy() copies a directory with contents with a trailing slash', async () => {
	// Create test directory structure
	const testDirectory = `${umbreld.instance.dataDirectory}/home/copy-directory-test`
	await fse.mkdir(testDirectory)
	await fse.mkdir(`${testDirectory}/source`)
	await fse.writeFile(`${testDirectory}/source/file1.txt`, 'content1')
	await fse.writeFile(`${testDirectory}/source/file2.txt`, 'content2')
	await fse.mkdir(`${testDirectory}/source/subdir`)
	await fse.writeFile(`${testDirectory}/source/subdir/file3.txt`, 'content3')
	await fse.mkdir(`${testDirectory}/destination`)

	// Verify the directory is empty
	await expect(fse.readdir(`${testDirectory}/destination`)).resolves.toMatchObject([])

	// Copy the directory
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-directory-test/source',
			toDirectory: '/Home/copy-directory-test/destination/',
		}),
	).resolves.toBe('/Home/copy-directory-test/destination/source')

	// Verify the copy
	await expect(fse.readdir(`${testDirectory}/destination`)).resolves.toMatchObject(['source'])
	await expect(fse.readdir(`${testDirectory}/destination/source`)).resolves.toMatchObject([
		'file1.txt',
		'file2.txt',
		'subdir',
	])
	await expect(fse.readdir(`${testDirectory}/destination/source/subdir`)).resolves.toMatchObject(['file3.txt'])

	// Clean up
	await fse.remove(testDirectory)
})

test('copy() handles copying directories to same parent directory by appending numbers regardless of collision strategy', async () => {
	// Create test directory with subdirectory
	const testDirectory = `${umbreld.instance.dataDirectory}/home/copy-same-dir-test-directory`
	await fse.mkdir(testDirectory)
	await fse.mkdir(`${testDirectory}/original`)
	await fse.writeFile(`${testDirectory}/original/file.txt`, 'content')

	// Copy the directory to the same parent directory with default collision strategy
	// In same directory, this should still append numbers even though default is 'error'
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-same-dir-test-directory/original',
			toDirectory: '/Home/copy-same-dir-test-directory',
		}),
	).resolves.toBe('/Home/copy-same-dir-test-directory/original (2)')

	// Verify both directories exist with their contents
	await expect(fse.pathExists(`${testDirectory}/original`)).resolves.toBe(true)
	await expect(fse.pathExists(`${testDirectory}/original/file.txt`)).resolves.toBe(true)
	await expect(fse.pathExists(`${testDirectory}/original (2)`)).resolves.toBe(true)
	await expect(fse.pathExists(`${testDirectory}/original (2)/file.txt`)).resolves.toBe(true)

	// Try with explicit 'replace' collision strategy - should still append numbers
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-same-dir-test-directory/original',
			toDirectory: '/Home/copy-same-dir-test-directory',
			collision: 'replace',
		}),
	).resolves.toBe('/Home/copy-same-dir-test-directory/original (3)')

	// Verify all directories exist with their contents
	await expect(fse.pathExists(`${testDirectory}/original`)).resolves.toBe(true)
	await expect(fse.pathExists(`${testDirectory}/original/file.txt`)).resolves.toBe(true)
	await expect(fse.pathExists(`${testDirectory}/original (2)`)).resolves.toBe(true)
	await expect(fse.pathExists(`${testDirectory}/original (2)/file.txt`)).resolves.toBe(true)
	await expect(fse.pathExists(`${testDirectory}/original (3)`)).resolves.toBe(true)
	await expect(fse.pathExists(`${testDirectory}/original (3)/file.txt`)).resolves.toBe(true)

	// Clean up
	await fse.remove(testDirectory)
})

test('copy() handles copying directories to a different directory by throwing on name conflict by default', async () => {
	// Create test directory structure
	const testDirectory = `${umbreld.instance.dataDirectory}/home/copy-dir-conflict-test`
	await fse.mkdir(testDirectory)
	await fse.mkdir(`${testDirectory}/source`)
	await fse.writeFile(`${testDirectory}/source/file.txt`, 'source content')

	// Create a destination directory with the same name
	await fse.mkdir(`${testDirectory}/destination`)
	await fse.mkdir(`${testDirectory}/destination/source`)
	await fse.writeFile(`${testDirectory}/destination/source/file.txt`, 'destination content')

	// Try to copy the directory and verify that it fails with default 'error' collision strategy
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-dir-conflict-test/source',
			toDirectory: '/Home/copy-dir-conflict-test/destination',
		}),
	).rejects.toThrow('[destination-already-exists]')

	// Verify destination content remains unchanged
	await expect(fse.readFile(`${testDirectory}/destination/source/file.txt`, 'utf8')).resolves.toBe(
		'destination content',
	)

	// Clean up
	await fse.remove(testDirectory)
})

test('copy(path, {collision: "keep-both"}) keeps both directories by appending numbers', async () => {
	// Create test directory structure
	const testDirectory = `${umbreld.instance.dataDirectory}/home/copy-dir-keep-both-test`
	await fse.mkdir(testDirectory)
	await fse.mkdir(`${testDirectory}/docs`)
	await fse.writeFile(`${testDirectory}/docs/file.txt`, 'source content')
	await fse.mkdir(`${testDirectory}/destination`)
	await fse.mkdir(`${testDirectory}/destination/docs`)
	await fse.writeFile(`${testDirectory}/destination/docs/file.txt`, 'destination content')

	// Copy the directory with 'keep-both' collision strategy
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-dir-keep-both-test/docs',
			toDirectory: '/Home/copy-dir-keep-both-test/destination',
			collision: 'keep-both',
		}),
	).resolves.toBe('/Home/copy-dir-keep-both-test/destination/docs (2)')

	// Verify both directories exist at the destination
	await expect(fse.pathExists(`${testDirectory}/destination/docs`)).resolves.toBe(true)
	await expect(fse.pathExists(`${testDirectory}/destination/docs (2)`)).resolves.toBe(true)

	// Verify the contents are preserved in both directories
	await expect(fse.readFile(`${testDirectory}/destination/docs/file.txt`, 'utf8')).resolves.toBe('destination content')
	await expect(fse.readFile(`${testDirectory}/destination/docs (2)/file.txt`, 'utf8')).resolves.toBe('source content')

	// Clean up
	await fse.remove(testDirectory)
})

test('copy(path, {collision: "replace"}) completely replaces existing directories', async () => {
	// Create test directory structure
	const testDirectory = `${umbreld.instance.dataDirectory}/home/copy-dir-replace-test`
	await fse.mkdir(testDirectory)
	await fse.mkdir(`${testDirectory}/docs`)
	await fse.writeFile(`${testDirectory}/docs/file1.txt`, 'file 1 source content')
	await fse.writeFile(`${testDirectory}/docs/file2.txt`, 'file 2 source content')
	await fse.mkdir(`${testDirectory}/destination`)
	await fse.mkdir(`${testDirectory}/destination/docs`)
	await fse.writeFile(`${testDirectory}/destination/docs/file1.txt`, 'file 1 destination content')
	await fse.writeFile(`${testDirectory}/destination/docs/file3.txt`, 'file 3 destination content')

	// Copy the directory with 'replace' collision strategy
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-dir-replace-test/docs',
			toDirectory: '/Home/copy-dir-replace-test/destination',
			collision: 'replace',
		}),
	).resolves.toBe('/Home/copy-dir-replace-test/destination/docs')

	// Verify the directory exists at the destination
	await expect(fse.pathExists(`${testDirectory}/destination/docs`)).resolves.toBe(true)

	// Verify source content is now at the destination
	await expect(fse.readFile(`${testDirectory}/destination/docs/file1.txt`, 'utf8')).resolves.toBe(
		'file 1 source content',
	)
	await expect(fse.readFile(`${testDirectory}/destination/docs/file2.txt`, 'utf8')).resolves.toBe(
		'file 2 source content',
	)

	// Verify file3.txt no longer exists (since it was only in the destination)
	await expect(fse.pathExists(`${testDirectory}/destination/docs/file3.txt`)).resolves.toBe(false)

	// Clean up
	await fse.remove(testDirectory)
})

test('copy() throws on too many duplicate names from existing paths', async () => {
	// Create test directory and files
	const testDirectory = `${umbreld.instance.dataDirectory}/home/copy-existing-test`
	await fse.mkdir(testDirectory)
	await fse.writeFile(`${testDirectory}/source.txt`, '')

	// Copy the file to create the maximum number of copies
	const maxPossibleCopies = 100
	for (let i = 2; i <= maxPossibleCopies; i++) {
		await expect(
			umbreld.client.files.copy.mutate({
				path: '/Home/copy-existing-test/source.txt',
				toDirectory: '/Home/copy-existing-test',
			}),
		).resolves.toBe(`/Home/copy-existing-test/source (${i}).txt`)
	}

	// Verify the copies
	await expect(fse.readdir(`${testDirectory}`)).resolves.toMatchObject(
		expect.arrayContaining([
			'source.txt',
			...Array.from({length: maxPossibleCopies - 2}).map((_, index) => `source (${index + 2}).txt`),
		]),
	)

	// Check creating one more fails
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-existing-test/source.txt',
			toDirectory: `/Home/copy-existing-test`,
		}),
	).rejects.toThrow('[unique-name-index-exceeded]')
})

test('copy() copies symlinks as symlinks', async () => {
	// Create test directory and files
	const testDirectory = `${umbreld.instance.dataDirectory}/home/copy-symlink-test`
	await fse.mkdir(testDirectory)
	await fse.mkdir(`${testDirectory}/source`)
	await fse.writeFile(`${testDirectory}/source/file.txt`, 'content')
	await fse.symlink(`${testDirectory}/source/file.txt`, `${testDirectory}/source/link`)
	await fse.mkdir(`${testDirectory}/destination`)

	// Copy the symlink
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-symlink-test/source/link',
			toDirectory: '/Home/copy-symlink-test/destination',
		}),
	).resolves.toBe('/Home/copy-symlink-test/destination/link')

	// Verify the symlink was copied correctly
	const isSymlink = await fse.lstat(`${testDirectory}/destination/link`).then((stats) => stats.isSymbolicLink())
	expect(isSymlink).toBe(true)

	// Verify the symlink points to the correct target
	const linkTarget = await fse.readlink(`${testDirectory}/destination/link`)
	expect(linkTarget).toBe(`${testDirectory}/source/file.txt`)

	// Verify reading through the symlink works
	const content = await fse.readFile(`${testDirectory}/destination/link`, 'utf8')
	expect(content).toBe('content')

	// Clean up
	await fse.remove(testDirectory)
})

test('copy() copies files inside a symlink', async () => {
	// Create test directory and files
	const testDirectory = `${umbreld.instance.dataDirectory}/home/copy-symlink-test`
	await fse.mkdir(testDirectory)
	await fse.mkdir(`${testDirectory}/source`)
	await fse.writeFile(`${testDirectory}/source/file.txt`, 'content')
	await fse.symlink(`${testDirectory}/source`, `${testDirectory}/symlink`)
	await fse.mkdir(`${testDirectory}/destination`)

	// Copy the file
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-symlink-test/symlink/file.txt',
			toDirectory: '/Home/copy-symlink-test/destination',
		}),
	).resolves.toBe('/Home/copy-symlink-test/destination/file.txt')

	// Verify the copy
	await expect(fse.readdir(`${testDirectory}/destination`)).resolves.toMatchObject(['file.txt'])

	// Clean up
	await fse.remove(testDirectory)
})

test('copy() preserves file permissions, ownership and timestamps', async () => {
	// Create test directory and file
	const testDirectory = `${umbreld.instance.dataDirectory}/home/copy-permissions-test`
	await fse.mkdir(testDirectory)
	await fse.mkdir(`${testDirectory}/source`)
	const sourceFile = `${testDirectory}/source/file.txt`
	await fse.writeFile(sourceFile, 'test content')
	await fse.mkdir(`${testDirectory}/destination`)

	// Set specific permissions (0o644 = rw-r--r--) and timestamps
	const originalPermissions = 0o644
	await fse.chmod(sourceFile, originalPermissions)

	// Set specific ownership (use umbrel user ID from files class)
	const uid = 1234
	const gid = 1234
	await fse.chown(sourceFile, uid, gid)

	// Set a specific timestamp (1 day ago)
	const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
	await fse.utimes(sourceFile, pastDate, pastDate)

	// Get original stats for later comparison
	const originalStats = await fse.stat(sourceFile)

	// Copy the file
	const result = await umbreld.client.files.copy.mutate({
		path: '/Home/copy-permissions-test/source/file.txt',
		toDirectory: '/Home/copy-permissions-test/destination',
	})
	expect(result).toBe('/Home/copy-permissions-test/destination/file.txt')

	// Get stats of the copied file
	const copiedFile = `${testDirectory}/destination/file.txt`
	const copiedStats = await fse.stat(copiedFile)

	// Verify the permissions are preserved
	expect(copiedStats.mode).toBe(originalStats.mode)

	// Verify ownership is preserved
	expect(copiedStats.uid).toBe(originalStats.uid)
	expect(copiedStats.gid).toBe(originalStats.gid)

	// Verify the timestamps are preserved
	expect(copiedStats.mtime.getTime()).toBe(originalStats.mtime.getTime())

	// Clean up
	await fse.remove(testDirectory)
})
