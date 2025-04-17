import {expect, beforeAll, afterAll, test} from 'vitest'
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
	// Create a symlink to the root directory
	await $`ln -s / ${umbreld.instance.dataDirectory}/home/symlink-to-root`

	// Attempt to create directory through symlink
	await expect(umbreld.client.files.createDirectory.mutate({path: '/Home/symlink-to-root/new-dir'})).rejects.toThrow(
		'[escapes-base]',
	)

	// Clean up
	await fse.remove(umbreld.instance.dataDirectory + '/home/symlink-to-root')
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
	const path = '/Home/parent/child/grandchild'

	// Create nested directories
	await expect(umbreld.client.files.createDirectory.mutate({path})).rejects.toThrow('[parent-not-exist]')
})

test('createDirectory() throws when creating directory inside a file', async () => {
	const path = '/Home/file.txt/new-dir'

	// Create file
	await fse.writeFile(umbreld.instance.dataDirectory + '/home/file.txt', 'test')

	// Create nested directories
	await expect(umbreld.client.files.createDirectory.mutate({path})).rejects.toThrow('[parent-not-directory]')
})

test('createDirectory() creates directory in /Home', async () => {
	const path = '/Home/test-directory'

	// Create directory
	await expect(umbreld.client.files.createDirectory.mutate({path})).resolves.toBe(true)

	// Verify directory exists
	const listing = await umbreld.client.files.list.query({path: '/Home'})
	expect(listing.files).toContainEqual(
		expect.objectContaining({
			name: 'test-directory',
			path,
			type: 'directory',
		}),
	)

	// Clean up
	await fse.remove(umbreld.instance.dataDirectory + '/home/test-directory')
})

test('createDirectory() returns true for existing directories', async () => {
	const path = '/Home/existing-directory'

	// Create directory first time
	await umbreld.client.files.createDirectory.mutate({path})

	// Try creating same directory again
	await expect(umbreld.client.files.createDirectory.mutate({path})).resolves.toBe(true)

	// Clean up
	await fse.remove(umbreld.instance.dataDirectory + '/home/existing-directory')
})

test('createDirectory() creates directory with correct permissions', async () => {
	const path = '/Home/permissions-test'

	// Create directory
	await umbreld.client.files.createDirectory.mutate({path})

	// Check permissions
	const stats = await fse.stat(umbreld.instance.dataDirectory + '/home/permissions-test')
	expect(stats.uid).toBe(1000) // Check owner is umbrel user
	expect(stats.gid).toBe(1000) // Check group is umbrel group

	// Clean up
	await fse.remove(umbreld.instance.dataDirectory + '/home/permissions-test')
})
