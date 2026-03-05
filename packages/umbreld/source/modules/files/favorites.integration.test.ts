import {expect, beforeEach, afterEach, describe, test} from 'vitest'

import fse from 'fs-extra'
import {delay} from 'es-toolkit'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>

// Create a new umbreld instance for each test
beforeEach(async () => (umbreld = await createTestUmbreld({autoLogin: true})))
afterEach(async () => await umbreld.cleanup())

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
		const testDirectory1 = `${umbreld.instance.dataDirectory}/home/favorites-existing-test1`
		const testDirectory2 = `${umbreld.instance.dataDirectory}/home/favorites-existing-test2`
		await fse.mkdir(testDirectory1)
		await fse.mkdir(testDirectory2)

		// Add both directories to favorites
		await umbreld.client.files.addFavorite.mutate({
			path: '/Home/favorites-existing-test1',
		})
		await umbreld.client.files.addFavorite.mutate({
			path: '/Home/favorites-existing-test2',
		})

		// Delete one directory
		await fse.remove(testDirectory1)

		// Verify only existing directory is returned in favorites
		const favorites = await umbreld.client.files.favorites.query()
		expect(favorites).not.toContain('/Home/favorites-existing-test1')
		expect(favorites).toContain('/Home/favorites-existing-test2')
	})
})

describe('#handleFileChange()', () => {
	test('automatically removes favorites when directory is deleted', async () => {
		// Create test directories
		const testDirectoryToDelete = `${umbreld.instance.dataDirectory}/home/favorites-auto-remove-test`
		const testDirectoryToKeep = `${umbreld.instance.dataDirectory}/home/favorites-keep-test`
		await fse.mkdir(testDirectoryToDelete)
		await fse.mkdir(testDirectoryToKeep)

		// Wait for the creation fs events to fire
		await delay(100)

		// Add both directories to favorites
		await umbreld.client.files.addFavorite.mutate({
			path: '/Home/favorites-auto-remove-test',
		})
		await umbreld.client.files.addFavorite.mutate({
			path: '/Home/favorites-keep-test',
		})

		// Verify directories are in favorites
		let favorites = await umbreld.client.files.favorites.query()
		expect(favorites).toContain('/Home/favorites-auto-remove-test')
		expect(favorites).toContain('/Home/favorites-keep-test')

		// Delete one directory
		await fse.remove(testDirectoryToDelete)

		// Wait for watcher to process the deletion
		await delay(100)

		// Verify deleted directory is removed from the store
		// but the kept directory remains
		// We check the store directly here because the RPC query auto
		// strips non-existent files from the result
		favorites = await umbreld.instance.store.get('files.favorites')
		expect(favorites).not.toContain('/Home/favorites-auto-remove-test')
		expect(favorites).toContain('/Home/favorites-keep-test')
	})

	test('automatically removes child favorites when parent directory is deleted', async () => {
		// Create test directories
		const parentDirectory = `${umbreld.instance.dataDirectory}/home/parent-directory`
		const childDirectory = `${parentDirectory}/child-directory`
		await fse.mkdir(parentDirectory)
		await fse.mkdir(childDirectory)

		// Wait for the creation fs events to fire
		await delay(100)

		// Add child directory to favorites
		await umbreld.client.files.addFavorite.mutate({
			path: '/Home/parent-directory/child-directory',
		})

		// Verify directories are in favorites
		let favorites = await umbreld.client.files.favorites.query()
		expect(favorites).toContain('/Home/parent-directory/child-directory')

		// Delete parent directory (which also removes the child)
		await fse.remove(parentDirectory)

		// Wait for watcher to process the deletion
		await delay(100)

		// Verify deleted directory is removed from the store
		// We check the store directly here because the RPC query auto
		// strips non-existent files from the result
		favorites = await umbreld.instance.store.get('files.favorites')
		expect(favorites).not.toContain('/Home/parent-directory/child-directory')
	})
})

describe('addFavorite()', () => {
	test('throws invalid error without auth token', async () => {
		await expect(umbreld.unauthenticatedClient.files.addFavorite.mutate({path: '/Home/Documents'})).rejects.toThrow(
			'Invalid token',
		)
	})

	test('throws on non-directory paths', async () => {
		// Create test file
		const testDirectory = `${umbreld.instance.dataDirectory}/home/favorites-test`
		await fse.mkdir(testDirectory)
		await fse.writeFile(`${testDirectory}/file.txt`, 'test content')

		// Attempt to favorite a file
		await expect(
			umbreld.client.files.addFavorite.mutate({
				path: '/Home/favorites-test/file.txt',
			}),
		).rejects.toThrow('[operation-not-allowed]')
	})

	test('successfully adds a directory to favorites', async () => {
		// Create test directory
		const testDirectory = `${umbreld.instance.dataDirectory}/home/favorites-test`
		await fse.mkdir(testDirectory)

		// Add directory to favorites
		await expect(
			umbreld.client.files.addFavorite.mutate({
				path: '/Home/favorites-test',
			}),
		).resolves.toBe(true)

		// Verify directory is in favorites
		const favorites = await umbreld.client.files.favorites.query()
		expect(favorites).toContain('/Home/favorites-test')
	})

	test('ignores duplicate favorites', async () => {
		// Create test directory
		const testDirectory = `${umbreld.instance.dataDirectory}/home/favorites-duplicate-test`
		await fse.mkdir(testDirectory)

		// Add directory to favorites twice
		await umbreld.client.files.addFavorite.mutate({
			path: '/Home/favorites-duplicate-test',
		})
		await expect(
			umbreld.client.files.addFavorite.mutate({
				path: '/Home/favorites-duplicate-test',
			}),
		).resolves.toBe(true)

		// Verify directory appears only once in favorites
		const favorites = await umbreld.client.files.favorites.query()
		const count = favorites.filter((f) => f === '/Home/favorites-duplicate-test').length
		expect(count).toBe(1)
	})
})

describe('removeFavorite()', () => {
	test('successfully removes a directory from favorites', async () => {
		// Create test directory
		const testDirectory = `${umbreld.instance.dataDirectory}/home/favorites-remove-test`
		await fse.mkdir(testDirectory)

		// Add directory to favorites
		await umbreld.client.files.addFavorite.mutate({
			path: '/Home/favorites-remove-test',
		})

		// Remove from favorites
		await expect(
			umbreld.client.files.removeFavorite.mutate({
				path: '/Home/favorites-remove-test',
			}),
		).resolves.toBe(true)

		// Verify directory is not in favorites
		const favorites = await umbreld.client.files.favorites.query()
		expect(favorites).not.toContain('/Home/favorites-remove-test')
	})

	test('returns false when removing non-existent favorite', async () => {
		await expect(
			umbreld.client.files.removeFavorite.mutate({
				path: '/Home/non-existent-favorite',
			}),
		).resolves.toBe(false)
	})
})
