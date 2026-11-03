import {expect, beforeAll, afterAll, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

// The entire copy() API runs end-to-end here, including the not-enough-space
// case which is triggered with a genuinely small filesystem (a tmpfs mount)
// rather than mocking the disk usage check.

let umbreld: Awaited<ReturnType<typeof createTestVm>>

// Each test uses uniquely named directories so no cleanup between tests is
// needed
beforeAll(async () => {
	umbreld = await createTestVm({device: 'umbrel-home'})
	await umbreld.vm.powerOn()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
})

const guestHome = '/home/umbrel/umbrel/home'

// Create a file through the files API
async function uploadFile(path: string, content: string) {
	await umbreld.api.post(`files/upload?path=${encodeURIComponent(path)}`, {body: content})
}

// List the file names in a directory through the files API
async function listNames(path: string) {
	const listing = await umbreld.client.files.list.query({path})
	return listing.files.map((file) => file.name)
}

// Read a file's content from inside the VM (low-level assertion via SSH)
async function readGuestFile(guestPath: string) {
	return umbreld.vm.ssh(`cat '${guestPath}'`)
}

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
	// Create a symlink to the root directory (no product surface creates
	// symlinks, so seed it over SSH)
	await umbreld.vm.ssh(`ln -s / ${guestHome}/copy-source-symlink-to-root`)

	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-source-symlink-to-root/etc',
			toDirectory: '/Home',
		}),
	).rejects.toThrow('[escapes-base]')
})

test('copy() throws on symlink traversal attempt in destination path', async () => {
	// Create a symlink to the root directory
	await umbreld.vm.ssh(`ln -s / ${guestHome}/copy-destination-symlink-to-root`)

	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home',
			toDirectory: '/Home/copy-destination-symlink-to-root/etc',
		}),
	).rejects.toThrow('[escapes-base]')
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

test('copy() copies a single file to a directory', async () => {
	// Create test directory and file
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-file-test'})
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-file-test/source'})
	await uploadFile('/Home/copy-file-test/source/source.txt', '')
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-file-test/destination'})

	// Verify the directory is empty
	await expect(listNames('/Home/copy-file-test/destination')).resolves.toMatchObject([])

	// Copy the file
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-file-test/source/source.txt',
			toDirectory: '/Home/copy-file-test/destination',
		}),
	).resolves.toBe('/Home/copy-file-test/destination/source.txt')

	// Verify the copy
	await expect(listNames('/Home/copy-file-test/destination')).resolves.toMatchObject(['source.txt'])
})

test('copy() copies a single file to a directory with a trailing slash', async () => {
	// Create test directory and file
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-trailing-slash-test'})
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-trailing-slash-test/source'})
	await uploadFile('/Home/copy-trailing-slash-test/source/source.txt', '')
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-trailing-slash-test/destination'})

	// Verify the directory is empty
	await expect(listNames('/Home/copy-trailing-slash-test/destination')).resolves.toMatchObject([])

	// Copy the file
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-trailing-slash-test/source/source.txt',
			toDirectory: '/Home/copy-trailing-slash-test/destination/',
		}),
	).resolves.toBe('/Home/copy-trailing-slash-test/destination/source.txt')

	// Verify the copy
	await expect(listNames('/Home/copy-trailing-slash-test/destination')).resolves.toMatchObject(['source.txt'])
})

test('copy() handles copying files to same directory by appending numbers regardless of collision strategy', async () => {
	// Create test directory and file
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-same-dir-test'})
	await uploadFile('/Home/copy-same-dir-test/original.txt', '')

	// Copy the file to the same directory with default collision strategy
	// In same directory, this should still append numbers even though default is 'error'
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-same-dir-test/original.txt',
			toDirectory: '/Home/copy-same-dir-test',
		}),
	).resolves.toBe('/Home/copy-same-dir-test/original (2).txt')

	// Verify both files exist
	await expect(listNames('/Home/copy-same-dir-test')).resolves.toEqual(
		expect.arrayContaining(['original.txt', 'original (2).txt']),
	)

	// Try with explicit 'replace' collision strategy - should still append numbers
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-same-dir-test/original.txt',
			toDirectory: '/Home/copy-same-dir-test',
			collision: 'replace',
		}),
	).resolves.toBe('/Home/copy-same-dir-test/original (3).txt')

	// Verify all files exist
	await expect(listNames('/Home/copy-same-dir-test')).resolves.toEqual(
		expect.arrayContaining(['original.txt', 'original (2).txt', 'original (3).txt']),
	)
})

test('copy() handles copying files to different directories by throwing on name conflict by default', async () => {
	// Create test directory and file
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-conflict-test'})
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-conflict-test/source'})
	await uploadFile('/Home/copy-conflict-test/source/file.txt', '')

	// Create a destination file with the same name
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-conflict-test/destination'})
	await uploadFile('/Home/copy-conflict-test/destination/file.txt', '')

	// Try to copy the file and verify that it fails with default 'error' collision strategy
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-conflict-test/source/file.txt',
			toDirectory: '/Home/copy-conflict-test/destination',
		}),
	).rejects.toThrow('[destination-already-exists]')
})

test('copy(path, {collision: "keep-both"}) keeps both files by appending numbers', async () => {
	// Create test directory and file
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-keep-both-test'})
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-keep-both-test/source'})
	await uploadFile('/Home/copy-keep-both-test/source/file.txt', 'source content')
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-keep-both-test/destination'})
	await uploadFile('/Home/copy-keep-both-test/destination/file.txt', 'destination content')

	// Copy the file with 'keep-both' collision strategy
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-keep-both-test/source/file.txt',
			toDirectory: '/Home/copy-keep-both-test/destination',
			collision: 'keep-both',
		}),
	).resolves.toBe('/Home/copy-keep-both-test/destination/file (2).txt')

	// Verify both files exist at the destination with their contents preserved
	await expect(readGuestFile(`${guestHome}/copy-keep-both-test/destination/file.txt`)).resolves.toBe(
		'destination content',
	)
	await expect(readGuestFile(`${guestHome}/copy-keep-both-test/destination/file (2).txt`)).resolves.toBe(
		'source content',
	)
})

test('copy(path, {collision: "replace"}) replaces existing files', async () => {
	// Create test directory and file
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-replace-test'})
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-replace-test/source'})
	await uploadFile('/Home/copy-replace-test/source/file.txt', 'source content')
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-replace-test/destination'})
	await uploadFile('/Home/copy-replace-test/destination/file.txt', 'destination content')

	// Copy the file with 'replace' collision strategy
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-replace-test/source/file.txt',
			toDirectory: '/Home/copy-replace-test/destination',
			collision: 'replace',
		}),
	).resolves.toBe('/Home/copy-replace-test/destination/file.txt')

	// Verify the content is replaced
	await expect(readGuestFile(`${guestHome}/copy-replace-test/destination/file.txt`)).resolves.toBe('source content')
})

test('copy() copies a directory with contents', async () => {
	// Create test directory structure
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-directory-test'})
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-directory-test/source'})
	await uploadFile('/Home/copy-directory-test/source/file1.txt', 'content1')
	await uploadFile('/Home/copy-directory-test/source/file2.txt', 'content2')
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-directory-test/source/subdir'})
	await uploadFile('/Home/copy-directory-test/source/subdir/file3.txt', 'content3')
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-directory-test/destination'})

	// Verify the directory is empty
	await expect(listNames('/Home/copy-directory-test/destination')).resolves.toMatchObject([])

	// Copy the directory
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-directory-test/source',
			toDirectory: '/Home/copy-directory-test/destination',
		}),
	).resolves.toBe('/Home/copy-directory-test/destination/source')

	// Verify the copy (sorted so the assertion doesn't depend on listing order)
	await expect(listNames('/Home/copy-directory-test/destination')).resolves.toMatchObject(['source'])
	const copiedNames = await listNames('/Home/copy-directory-test/destination/source')
	expect(copiedNames.sort()).toMatchObject(['file1.txt', 'file2.txt', 'subdir'])
	await expect(listNames('/Home/copy-directory-test/destination/source/subdir')).resolves.toMatchObject(['file3.txt'])
})

test('copy() copies a directory with contents with a trailing slash', async () => {
	// Create test directory structure
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-dir-trailing-slash-test'})
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-dir-trailing-slash-test/source'})
	await uploadFile('/Home/copy-dir-trailing-slash-test/source/file1.txt', 'content1')
	await uploadFile('/Home/copy-dir-trailing-slash-test/source/file2.txt', 'content2')
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-dir-trailing-slash-test/source/subdir'})
	await uploadFile('/Home/copy-dir-trailing-slash-test/source/subdir/file3.txt', 'content3')
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-dir-trailing-slash-test/destination'})

	// Verify the directory is empty
	await expect(listNames('/Home/copy-dir-trailing-slash-test/destination')).resolves.toMatchObject([])

	// Copy the directory
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-dir-trailing-slash-test/source',
			toDirectory: '/Home/copy-dir-trailing-slash-test/destination/',
		}),
	).resolves.toBe('/Home/copy-dir-trailing-slash-test/destination/source')

	// Verify the copy (sorted so the assertion doesn't depend on listing order)
	await expect(listNames('/Home/copy-dir-trailing-slash-test/destination')).resolves.toMatchObject(['source'])
	const copiedNames = await listNames('/Home/copy-dir-trailing-slash-test/destination/source')
	expect(copiedNames.sort()).toMatchObject(['file1.txt', 'file2.txt', 'subdir'])
	await expect(listNames('/Home/copy-dir-trailing-slash-test/destination/source/subdir')).resolves.toMatchObject([
		'file3.txt',
	])
})

test('copy() handles copying directories to same parent directory by appending numbers regardless of collision strategy', async () => {
	// Create test directory with subdirectory
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-same-dir-test-directory'})
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-same-dir-test-directory/original'})
	await uploadFile('/Home/copy-same-dir-test-directory/original/file.txt', 'content')

	// Copy the directory to the same parent directory with default collision strategy
	// In same directory, this should still append numbers even though default is 'error'
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-same-dir-test-directory/original',
			toDirectory: '/Home/copy-same-dir-test-directory',
		}),
	).resolves.toBe('/Home/copy-same-dir-test-directory/original (2)')

	// Verify both directories exist with their contents
	await expect(listNames('/Home/copy-same-dir-test-directory')).resolves.toEqual(
		expect.arrayContaining(['original', 'original (2)']),
	)
	await expect(listNames('/Home/copy-same-dir-test-directory/original (2)')).resolves.toContain('file.txt')

	// Try with explicit 'replace' collision strategy - should still append numbers
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-same-dir-test-directory/original',
			toDirectory: '/Home/copy-same-dir-test-directory',
			collision: 'replace',
		}),
	).resolves.toBe('/Home/copy-same-dir-test-directory/original (3)')

	// Verify all directories exist with their contents
	await expect(listNames('/Home/copy-same-dir-test-directory')).resolves.toEqual(
		expect.arrayContaining(['original', 'original (2)', 'original (3)']),
	)
	await expect(listNames('/Home/copy-same-dir-test-directory/original (3)')).resolves.toContain('file.txt')
})

test('copy() handles copying directories to a different directory by throwing on name conflict by default', async () => {
	// Create test directory structure
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-dir-conflict-test'})
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-dir-conflict-test/source'})
	await uploadFile('/Home/copy-dir-conflict-test/source/file.txt', 'source content')

	// Create a destination directory with the same name
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-dir-conflict-test/destination'})
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-dir-conflict-test/destination/source'})
	await uploadFile('/Home/copy-dir-conflict-test/destination/source/file.txt', 'destination content')

	// Try to copy the directory and verify that it fails with default 'error' collision strategy
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-dir-conflict-test/source',
			toDirectory: '/Home/copy-dir-conflict-test/destination',
		}),
	).rejects.toThrow('[destination-already-exists]')

	// Verify destination content remains unchanged
	await expect(readGuestFile(`${guestHome}/copy-dir-conflict-test/destination/source/file.txt`)).resolves.toBe(
		'destination content',
	)
})

test('copy(path, {collision: "keep-both"}) keeps both directories by appending numbers', async () => {
	// Create test directory structure
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-dir-keep-both-test'})
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-dir-keep-both-test/docs'})
	await uploadFile('/Home/copy-dir-keep-both-test/docs/file.txt', 'source content')
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-dir-keep-both-test/destination'})
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-dir-keep-both-test/destination/docs'})
	await uploadFile('/Home/copy-dir-keep-both-test/destination/docs/file.txt', 'destination content')

	// Copy the directory with 'keep-both' collision strategy
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-dir-keep-both-test/docs',
			toDirectory: '/Home/copy-dir-keep-both-test/destination',
			collision: 'keep-both',
		}),
	).resolves.toBe('/Home/copy-dir-keep-both-test/destination/docs (2)')

	// Verify the contents are preserved in both directories
	await expect(readGuestFile(`${guestHome}/copy-dir-keep-both-test/destination/docs/file.txt`)).resolves.toBe(
		'destination content',
	)
	await expect(readGuestFile(`${guestHome}/copy-dir-keep-both-test/destination/docs (2)/file.txt`)).resolves.toBe(
		'source content',
	)
})

test('copy(path, {collision: "replace"}) completely replaces existing directories', async () => {
	// Create test directory structure
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-dir-replace-test'})
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-dir-replace-test/docs'})
	await uploadFile('/Home/copy-dir-replace-test/docs/file1.txt', 'file 1 source content')
	await uploadFile('/Home/copy-dir-replace-test/docs/file2.txt', 'file 2 source content')
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-dir-replace-test/destination'})
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-dir-replace-test/destination/docs'})
	await uploadFile('/Home/copy-dir-replace-test/destination/docs/file1.txt', 'file 1 destination content')
	await uploadFile('/Home/copy-dir-replace-test/destination/docs/file3.txt', 'file 3 destination content')

	// Copy the directory with 'replace' collision strategy
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-dir-replace-test/docs',
			toDirectory: '/Home/copy-dir-replace-test/destination',
			collision: 'replace',
		}),
	).resolves.toBe('/Home/copy-dir-replace-test/destination/docs')

	// Verify source content is now at the destination
	await expect(readGuestFile(`${guestHome}/copy-dir-replace-test/destination/docs/file1.txt`)).resolves.toBe(
		'file 1 source content',
	)
	await expect(readGuestFile(`${guestHome}/copy-dir-replace-test/destination/docs/file2.txt`)).resolves.toBe(
		'file 2 source content',
	)

	// Verify file3.txt no longer exists (since it was only in the destination)
	await expect(listNames('/Home/copy-dir-replace-test/destination/docs')).resolves.not.toContain('file3.txt')
})

test('copy() throws on too many duplicate names from existing paths', async () => {
	// Create test directory and files
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-existing-test'})
	await uploadFile('/Home/copy-existing-test/source.txt', '')

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
	await expect(listNames('/Home/copy-existing-test')).resolves.toEqual(
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
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-symlink-test'})
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-symlink-test/source'})
	await uploadFile('/Home/copy-symlink-test/source/file.txt', 'content')
	await umbreld.vm.ssh(
		`ln -s ${guestHome}/copy-symlink-test/source/file.txt ${guestHome}/copy-symlink-test/source/link`,
	)
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-symlink-test/destination'})

	// Copy the symlink
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-symlink-test/source/link',
			toDirectory: '/Home/copy-symlink-test/destination',
		}),
	).resolves.toBe('/Home/copy-symlink-test/destination/link')

	// Verify the symlink was copied as a symlink pointing at the same target
	// (low-level OS facts via SSH)
	const linkType = await umbreld.vm.ssh(`stat --format %F '${guestHome}/copy-symlink-test/destination/link'`)
	expect(linkType.trim()).toBe('symbolic link')
	const linkTarget = await umbreld.vm.ssh(`readlink '${guestHome}/copy-symlink-test/destination/link'`)
	expect(linkTarget.trim()).toBe(`${guestHome}/copy-symlink-test/source/file.txt`)

	// Verify reading through the symlink works
	await expect(readGuestFile(`${guestHome}/copy-symlink-test/destination/link`)).resolves.toBe('content')
})

test('copy() copies files inside a symlink', async () => {
	// Create test directory and files
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-inside-symlink-test'})
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-inside-symlink-test/source'})
	await uploadFile('/Home/copy-inside-symlink-test/source/file.txt', 'content')
	await umbreld.vm.ssh(
		`ln -s ${guestHome}/copy-inside-symlink-test/source ${guestHome}/copy-inside-symlink-test/symlink`,
	)
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-inside-symlink-test/destination'})

	// Copy the file
	await expect(
		umbreld.client.files.copy.mutate({
			path: '/Home/copy-inside-symlink-test/symlink/file.txt',
			toDirectory: '/Home/copy-inside-symlink-test/destination',
		}),
	).resolves.toBe('/Home/copy-inside-symlink-test/destination/file.txt')

	// Verify the copy
	await expect(listNames('/Home/copy-inside-symlink-test/destination')).resolves.toMatchObject(['file.txt'])
})

test('copy() preserves file permissions, ownership and timestamps', async () => {
	// Create test directory and file
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-permissions-test'})
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-permissions-test/source'})
	await uploadFile('/Home/copy-permissions-test/source/file.txt', 'test content')
	await umbreld.client.files.createDirectory.mutate({path: '/Home/copy-permissions-test/destination'})

	// Set specific permissions, ownership (arbitrary non-umbrel ids, needs
	// root) and timestamps on the source file
	const sourceFile = `${guestHome}/copy-permissions-test/source/file.txt`
	await umbreld.vm.sshAsRoot(
		`chmod 644 '${sourceFile}' && chown 1234:1234 '${sourceFile}' && touch -d '2024-01-01 12:00:00' '${sourceFile}'`,
	)

	// Get original stats for later comparison (mode, uid, gid, mtime)
	const originalStats = await umbreld.vm.ssh(`stat --format '%a %u %g %y' '${sourceFile}'`)

	// Copy the file
	const result = await umbreld.client.files.copy.mutate({
		path: '/Home/copy-permissions-test/source/file.txt',
		toDirectory: '/Home/copy-permissions-test/destination',
	})
	expect(result).toBe('/Home/copy-permissions-test/destination/file.txt')

	// Verify the permissions, ownership and timestamps are preserved
	const copiedFile = `${guestHome}/copy-permissions-test/destination/file.txt`
	const copiedStats = await umbreld.vm.ssh(`stat --format '%a %u %g %y' '${copiedFile}'`)
	expect(copiedStats.trim()).toBe(originalStats.trim())
	expect(originalStats.trim()).toContain('644 1234 1234')
})

test('copy() throws when there is not enough free space on the destination', async () => {
	// Create a source file
	await uploadFile('/Home/not-enough-space-test/file.txt', 'test content')

	// Mount a small tmpfs as the destination so it genuinely has less free
	// space than copy() requires (the source size plus a 1GB safety buffer)
	const guestDestination = `${guestHome}/not-enough-space-test/destination`
	await umbreld.vm.sshAsRoot(
		`mkdir -p '${guestDestination}' && mount -t tmpfs -o size=100m tmpfs '${guestDestination}'`,
	)

	try {
		// Check the copy fails when there is not enough free space
		await expect(
			umbreld.client.files.copy.mutate({
				path: '/Home/not-enough-space-test/file.txt',
				toDirectory: '/Home/not-enough-space-test/destination',
				collision: 'keep-both',
			}),
		).rejects.toThrow('[not-enough-space]')

		// Replace the small filesystem with one large enough for the copy and
		// check the same copy succeeds
		await umbreld.vm.sshAsRoot(`umount '${guestDestination}' && mount -t tmpfs -o size=2g tmpfs '${guestDestination}'`)
		await expect(
			umbreld.client.files.copy.mutate({
				path: '/Home/not-enough-space-test/file.txt',
				toDirectory: '/Home/not-enough-space-test/destination',
				collision: 'keep-both',
			}),
		).resolves.toBe('/Home/not-enough-space-test/destination/file.txt')
		await expect(readGuestFile(`${guestDestination}/file.txt`)).resolves.toBe('test content')
	} finally {
		// Remove the tmpfs mount
		await umbreld.vm.sshAsRoot(`umount '${guestDestination}'`)
	}
})
