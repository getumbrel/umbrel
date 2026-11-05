import {expect, beforeAll, afterAll, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

let umbreld: Awaited<ReturnType<typeof createTestVm>>

beforeAll(async () => {
	umbreld = await createTestVm({device: 'umbrel-home'})
	await umbreld.vm.powerOn()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
})

// Create a file through the files API
async function uploadFile(path: string, content: string) {
	await umbreld.api.post(`files/upload?path=${path}`, {body: content})
}

// List the file names in a directory through the files API
async function listNames(path: string) {
	const listing = await umbreld.client.files.list.query({path})
	return listing.files.map((file) => file.name)
}

test('rename() throws invalid error without auth token', async () => {
	await expect(
		umbreld.unauthenticatedClient.files.rename.mutate({path: '/Home/Documents', newName: 'Documents-copy'}),
	).rejects.toThrow('Invalid token')
})

test('rename() throws when newName is empty', async () => {
	await umbreld.client.files.createDirectory.mutate({path: '/Home/rename-test-empty'})
	await uploadFile('/Home/rename-test-empty/empty.txt', 'content empty')

	await expect(
		umbreld.client.files.rename.mutate({
			path: '/Home/rename-test-empty/empty.txt',
			newName: '',
		}),
	).rejects.toThrow('String must contain')
})

test('rename() throws on protected paths', async () => {
	// /Home/Downloads is protected and exists by default on a fresh install
	await expect(
		umbreld.client.files.rename.mutate({
			path: '/Home/Downloads',
			newName: 'DownloadsRenamed',
		}),
	).rejects.toThrow('[operation-not-allowed]')
})

test('rename() throws when source file/directory does not exist', async () => {
	// Create a valid directory but do not create the file to be renamed.
	await umbreld.client.files.createDirectory.mutate({path: '/Home/rename-nonexistent'})

	await expect(
		umbreld.client.files.rename.mutate({
			path: '/Home/rename-nonexistent/nonexistent.txt',
			newName: 'shouldNotMatter.txt',
		}),
	).rejects.toThrow('[source-not-exists]')
})

test('rename() throws when the source virtual path is not absolute', async () => {
	// Passing a non-absolute path should throw an error during conversion.
	await expect(
		umbreld.client.files.rename.mutate({
			path: 'Home/relative/file.txt',
			newName: 'renamed.txt',
		}),
	).rejects.toThrow('[path-not-absolute]')
})

test('rename() throws when destination already exists', async () => {
	await umbreld.client.files.createDirectory.mutate({path: '/Home/rename-test-unique'})

	// Create a file at the destination name that should conflict.
	await uploadFile('/Home/rename-test-unique/target.txt', 'conflict')

	// Create the file that we want to rename.
	await uploadFile('/Home/rename-test-unique/original.txt', 'original content')

	await expect(
		umbreld.client.files.rename.mutate({
			path: '/Home/rename-test-unique/original.txt',
			newName: 'target.txt',
		}),
	).rejects.toThrow('[destination-already-exists]')
})

test('rename() throws on filename traversal attack', async () => {
	await umbreld.client.files.createDirectory.mutate({path: '/Home/rename-test-invalid'})

	// Create a source file that will be attempted to be renamed.
	await uploadFile('/Home/rename-test-invalid/original.txt', 'some content')

	await expect(
		umbreld.client.files.rename.mutate({
			path: '/Home/rename-test-invalid/original.txt',
			newName: 'traversal/attack.txt',
		}),
	).rejects.toThrow('[invalid-filename]')
	await expect(
		umbreld.client.files.rename.mutate({
			path: '/Home/rename-test-invalid/original.txt',
			newName: 'traversal/../attack.txt',
		}),
	).rejects.toThrow('[invalid-filename]')
})

test('rename() throws on invalid characters in filename', async () => {
	// Reuse the source file from the traversal test's directory
	await expect(
		umbreld.client.files.rename.mutate({
			path: '/Home/rename-test-invalid/original.txt',
			newName: 'invalid:name.txt',
		}),
	).rejects.toThrow('[invalid-filename]')
})

test('rename() renames a file successfully', async () => {
	await umbreld.client.files.createDirectory.mutate({path: '/Home/rename-test-file'})
	await uploadFile('/Home/rename-test-file/original.txt', 'hello world')

	const result = await umbreld.client.files.rename.mutate({
		path: '/Home/rename-test-file/original.txt',
		newName: 'renamed.txt',
	})
	expect(result).toBe('/Home/rename-test-file/renamed.txt')

	// Check the original file is gone and the renamed file exists
	const names = await listNames('/Home/rename-test-file')
	expect(names).not.toContain('original.txt')
	expect(names).toContain('renamed.txt')
})

test('rename() renames a directory successfully', async () => {
	await umbreld.client.files.createDirectory.mutate({path: '/Home/rename-test-dir'})
	await umbreld.client.files.createDirectory.mutate({path: '/Home/rename-test-dir/original_dir'})

	// Create a file inside the directory
	await uploadFile('/Home/rename-test-dir/original_dir/file.txt', 'content')

	const result = await umbreld.client.files.rename.mutate({
		path: '/Home/rename-test-dir/original_dir',
		newName: 'renamed_dir',
	})
	expect(result).toBe('/Home/rename-test-dir/renamed_dir')

	// Verify the renamed directory exists and the file inside is still present
	expect(await listNames('/Home/rename-test-dir')).toContain('renamed_dir')
	expect(await listNames('/Home/rename-test-dir/renamed_dir')).toContain('file.txt')
})

test('rename() returns the same path when newName is identical to current name', async () => {
	await umbreld.client.files.createDirectory.mutate({path: '/Home/rename-test-same'})
	await uploadFile('/Home/rename-test-same/same.txt', 'content same')

	const result = await umbreld.client.files.rename.mutate({
		path: '/Home/rename-test-same/same.txt',
		newName: 'same.txt',
	})
	// No change is needed so the original virtual path is returned.
	expect(result).toBe('/Home/rename-test-same/same.txt')
	expect(await listNames('/Home/rename-test-same')).toContain('same.txt')
})

test('rename() renames a symlink without altering its target', async () => {
	await umbreld.client.files.createDirectory.mutate({path: '/Home/rename-test-symlink'})

	// Create a target file
	await uploadFile('/Home/rename-test-symlink/target.txt', 'link content')

	// Create a symlink pointing to the target file (no product surface creates
	// symlinks, so seed it over SSH)
	const guestDir = '/home/umbrel/umbrel/home/rename-test-symlink'
	await umbreld.vm.ssh(`ln -s ${guestDir}/target.txt ${guestDir}/link`)

	const result = await umbreld.client.files.rename.mutate({
		path: '/Home/rename-test-symlink/link',
		newName: 'link-renamed',
	})
	expect(result).toBe('/Home/rename-test-symlink/link-renamed')

	// Verify it's still a symlink pointing at the same target (low-level OS
	// facts via SSH)
	const linkType = await umbreld.vm.ssh(`stat --format %F ${guestDir}/link-renamed`)
	expect(linkType.trim()).toBe('symbolic link')
	const linkTarget = await umbreld.vm.ssh(`readlink ${guestDir}/link-renamed`)
	expect(linkTarget.trim()).toBe(`${guestDir}/target.txt`)
})
