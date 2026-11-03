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

test('createDirectory() throws invalid error without auth token', async () => {
	await expect(
		umbreld.unauthenticatedClient.files.createDirectory.mutate({path: '/Home/new-directory'}),
	).rejects.toThrow('Invalid token')
})

test('createDirectory() throws on directory traversal attempt', async () => {
	await expect(umbreld.client.files.createDirectory.mutate({path: '/Home/../../../../etc/new-dir'})).rejects.toThrow(
		'[invalid-base]',
	)
})

test('createDirectory() throws on symlink traversal attempt', async () => {
	// Create a symlink to the root directory (no product surface creates
	// symlinks, so seed it over SSH)
	await umbreld.vm.ssh('ln -s / /home/umbrel/umbrel/home/symlink-to-root')

	// Attempt to create directory through symlink
	await expect(umbreld.client.files.createDirectory.mutate({path: '/Home/symlink-to-root/new-dir'})).rejects.toThrow(
		'[escapes-base]',
	)
})

test('createDirectory() throws on relative paths', async () => {
	await Promise.all(
		['', ' ', '.', '..', 'Home', 'Home/new-dir', 'Home/../new-dir'].map((path) =>
			expect(umbreld.client.files.createDirectory.mutate({path})).rejects.toThrow('[path-not-absolute]'),
		),
	)
})

test('createDirectory() throws on invalid base directory', async () => {
	await expect(umbreld.client.files.createDirectory.mutate({path: '/Invalid/test-directory'})).rejects.toThrow(
		'[invalid-base]',
	)
})

test("createDirectory() throws when containing directory doesn't exist", async () => {
	await expect(umbreld.client.files.createDirectory.mutate({path: '/Home/parent/child/grandchild'})).rejects.toThrow(
		'[parent-not-exist]',
	)
})

test('createDirectory() throws when creating directory inside a file', async () => {
	// Create the file through the files API
	await umbreld.api.post('files/upload?path=/Home/file.txt', {body: 'test'})

	// Attempt to create a directory inside the file
	await expect(umbreld.client.files.createDirectory.mutate({path: '/Home/file.txt/new-dir'})).rejects.toThrow(
		'[parent-not-directory]',
	)
})

test('createDirectory() creates directory in /Home', async () => {
	const path = '/Home/test-directory'

	// Create directory
	await expect(umbreld.client.files.createDirectory.mutate({path})).resolves.toEqual({
		created: true,
		identity: {
			device: expect.any(Number),
			inode: expect.any(Number),
			birthtimeMs: expect.any(Number),
		},
	})

	// Verify directory exists
	const listing = await umbreld.client.files.list.query({path: '/Home'})
	expect(listing.files).toContainEqual(
		expect.objectContaining({
			name: 'test-directory',
			path,
			type: 'directory',
		}),
	)
})

test('createDirectory() reports an existing directory as not created', async () => {
	const path = '/Home/existing-directory'

	// Create directory first time
	await umbreld.client.files.createDirectory.mutate({path})

	// Try creating same directory again
	await expect(umbreld.client.files.createDirectory.mutate({path})).resolves.toEqual({created: false})
})

test('cleanupCreatedDirectory() removes only the matching empty directory', async () => {
	const path = '/Home/cleanup-created-directory'
	const creation = await umbreld.client.files.createDirectory.mutate({path})
	expect(creation.created).toBe(true)
	if (!creation.created) return

	// The identity returned by the creating request authorizes empty cleanup.
	await expect(umbreld.client.files.cleanupCreatedDirectory.mutate({path, identity: creation.identity})).resolves.toBe(
		true,
	)
	const listing = await umbreld.client.files.list.query({path: '/Home'})
	expect(listing.files.some((file) => file.path === path)).toBe(false)
})

test('cleanupCreatedDirectory() leaves a directory that gained user content', async () => {
	const path = '/Home/cleanup-directory-with-content'
	const creation = await umbreld.client.files.createDirectory.mutate({path})
	expect(creation.created).toBe(true)
	if (!creation.created) return
	await umbreld.api.post(`files/upload?path=${path}/keep.txt`, {body: 'keep me'})

	await expect(umbreld.client.files.cleanupCreatedDirectory.mutate({path, identity: creation.identity})).resolves.toBe(
		false,
	)
	const listing = await umbreld.client.files.list.query({path})
	expect(listing.files.map(({name}) => name)).toContain('keep.txt')
})

test('createDirectory() creates directory with correct permissions', async () => {
	// Create directory
	await umbreld.client.files.createDirectory.mutate({path: '/Home/permissions-test'})

	// Check ownership is the umbrel user and group (low-level OS fact via SSH)
	const stat = await umbreld.vm.ssh('stat --format "%u %g" /home/umbrel/umbrel/home/permissions-test')
	expect(stat.trim()).toBe('1000 1000')
})
