import {expect, beforeAll, afterAll, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

let umbreld: Awaited<ReturnType<typeof createTestVm>>

// Spin up a single VM for the entire test suite to save time. Each test
// creates its own uniquely named directories so state doesn't leak between
// tests. The one check that needs pristine state (default favorites) runs
// first, before anything mutates favorites.
beforeAll(async () => {
	umbreld = await createTestVm({device: 'umbrel-home'})
	await umbreld.vm.powerOn()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
})

// Read the raw favorites from the store inside the VM. The RPC query auto
// strips non-existent paths from the result so watcher behaviour has to be
// asserted against the store itself (low-level OS fact via SSH).
async function storeContainsFavorite(path: string) {
	const store = await umbreld.vm.ssh('cat /home/umbrel/umbrel/umbrel.yaml')
	return store.includes(path)
}

describe('favorites()', () => {
	test('throws invalid error without auth token', async () => {
		await expect(umbreld.unauthenticatedClient.files.favorites.query()).rejects.toThrow('Invalid token')
	})

	test('returns default favorites on first start', async () => {
		const favorites = await umbreld.client.files.favorites.query()
		expect(favorites).toStrictEqual(['/Home/Downloads', '/Home/Documents', '/Home/Photos', '/Home/Videos'])
	})

	test('only returns existing directories', async () => {
		// Create test directories
		await umbreld.client.files.createDirectory.mutate({path: '/Home/favorites-existing-test1'})
		await umbreld.client.files.createDirectory.mutate({path: '/Home/favorites-existing-test2'})

		// Add both directories to favorites
		await umbreld.client.files.addFavorite.mutate({path: '/Home/favorites-existing-test1'})
		await umbreld.client.files.addFavorite.mutate({path: '/Home/favorites-existing-test2'})

		// Delete one directory out-of-band (outside the files API)
		await umbreld.vm.ssh('rm -rf /home/umbrel/umbrel/home/favorites-existing-test1')

		// Verify only existing directory is returned in favorites
		const favorites = await umbreld.client.files.favorites.query()
		expect(favorites).not.toContain('/Home/favorites-existing-test1')
		expect(favorites).toContain('/Home/favorites-existing-test2')
	})
})

describe('#handleFileChange()', () => {
	test('automatically removes favorites when directory is deleted', async () => {
		// Create test directories
		await umbreld.client.files.createDirectory.mutate({path: '/Home/favorites-auto-remove-test'})
		await umbreld.client.files.createDirectory.mutate({path: '/Home/favorites-keep-test'})

		// Add both directories to favorites
		await umbreld.client.files.addFavorite.mutate({path: '/Home/favorites-auto-remove-test'})
		await umbreld.client.files.addFavorite.mutate({path: '/Home/favorites-keep-test'})

		// Verify directories are in favorites
		const favorites = await umbreld.client.files.favorites.query()
		expect(favorites).toContain('/Home/favorites-auto-remove-test')
		expect(favorites).toContain('/Home/favorites-keep-test')

		// Delete one directory out-of-band so the file watcher processes it
		await umbreld.vm.ssh('rm -rf /home/umbrel/umbrel/home/favorites-auto-remove-test')

		// Wait for the watcher to remove the deleted directory from the store
		// but keep the other directory
		await pWaitFor(async () => !(await storeContainsFavorite('/Home/favorites-auto-remove-test')), {
			interval: 500,
			timeout: 30_000,
		})
		expect(await storeContainsFavorite('/Home/favorites-keep-test')).toBe(true)
	})

	test('automatically removes child favorites when parent directory is deleted', async () => {
		// Create test directories
		await umbreld.client.files.createDirectory.mutate({path: '/Home/parent-directory'})
		await umbreld.client.files.createDirectory.mutate({path: '/Home/parent-directory/child-directory'})

		// Add child directory to favorites
		await umbreld.client.files.addFavorite.mutate({path: '/Home/parent-directory/child-directory'})

		// Verify directory is in favorites
		const favorites = await umbreld.client.files.favorites.query()
		expect(favorites).toContain('/Home/parent-directory/child-directory')

		// Delete the parent directory (which also removes the child) out-of-band
		// so the file watcher processes it
		await umbreld.vm.ssh('rm -rf /home/umbrel/umbrel/home/parent-directory')

		// Wait for the watcher to remove the deleted child from the store
		await pWaitFor(async () => !(await storeContainsFavorite('/Home/parent-directory/child-directory')), {
			interval: 500,
			timeout: 30_000,
		})
	})
})

describe('addFavorite()', () => {
	test('throws invalid error without auth token', async () => {
		await expect(umbreld.unauthenticatedClient.files.addFavorite.mutate({path: '/Home/Documents'})).rejects.toThrow(
			'Invalid token',
		)
	})

	test('throws on non-directory paths', async () => {
		// Create a test file through the files API
		await umbreld.client.files.createDirectory.mutate({path: '/Home/favorites-test'})
		await umbreld.api.post('files/upload?path=/Home/favorites-test/file.txt', {body: 'test content'})

		// Attempt to favorite a file
		await expect(umbreld.client.files.addFavorite.mutate({path: '/Home/favorites-test/file.txt'})).rejects.toThrow(
			'[operation-not-allowed]',
		)
	})

	test('successfully adds a directory to favorites', async () => {
		// Add the directory created in the previous test to favorites
		await expect(umbreld.client.files.addFavorite.mutate({path: '/Home/favorites-test'})).resolves.toBe(true)

		// Verify directory is in favorites
		const favorites = await umbreld.client.files.favorites.query()
		expect(favorites).toContain('/Home/favorites-test')
	})

	test('ignores duplicate favorites', async () => {
		// Create test directory
		await umbreld.client.files.createDirectory.mutate({path: '/Home/favorites-duplicate-test'})

		// Add directory to favorites twice
		await umbreld.client.files.addFavorite.mutate({path: '/Home/favorites-duplicate-test'})
		await expect(umbreld.client.files.addFavorite.mutate({path: '/Home/favorites-duplicate-test'})).resolves.toBe(true)

		// Verify directory appears only once in favorites
		const favorites = await umbreld.client.files.favorites.query()
		const count = favorites.filter((f) => f === '/Home/favorites-duplicate-test').length
		expect(count).toBe(1)
	})
})

describe('removeFavorite()', () => {
	test('successfully removes a directory from favorites', async () => {
		// Create test directory
		await umbreld.client.files.createDirectory.mutate({path: '/Home/favorites-remove-test'})

		// Add directory to favorites
		await umbreld.client.files.addFavorite.mutate({path: '/Home/favorites-remove-test'})

		// Remove from favorites
		await expect(umbreld.client.files.removeFavorite.mutate({path: '/Home/favorites-remove-test'})).resolves.toBe(true)

		// Verify directory is not in favorites
		const favorites = await umbreld.client.files.favorites.query()
		expect(favorites).not.toContain('/Home/favorites-remove-test')
	})

	test('returns false when removing non-existent favorite', async () => {
		await expect(umbreld.client.files.removeFavorite.mutate({path: '/Home/non-existent-favorite'})).resolves.toBe(false)
	})
})
