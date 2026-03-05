import {expect, beforeAll, afterAll, describe, test} from 'vitest'
import fse from 'fs-extra'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>

// Spin up a single Umbreld instance for the entire test suite to save time.
// Each test creates its own unique files so state leakage across tests does
// not affect expectations.
beforeAll(async () => {
	umbreld = await createTestUmbreld()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
})

describe('files.search()', () => {
	test('throws "Invalid token" error without auth token', async () => {
		await expect(umbreld.unauthenticatedClient.files.search.query({query: 'anything'})).rejects.toThrow('Invalid token')
	})

	test('finds files that match the query', async () => {
		// Create a unique directory with some files to search for
		const testDir = `${umbreld.instance.dataDirectory}/home/search-find-test`
		await fse.mkdir(testDir)

		// Create test files
		await Promise.all([
			fse.writeFile(`${testDir}/hello-world.txt`, 'hello world'),
			fse.writeFile(`${testDir}/hello-mars.txt`, 'hello mars'),
			fse.writeFile(`${testDir}/unrelated.txt`, 'nothing to see here'),
		])

		// Perform the search
		const results = await umbreld.client.files.search.query({query: 'hello-world'})

		// Expect the specific file to be returned
		expect(results).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'hello-world.txt',
					path: '/Home/search-find-test/hello-world.txt',
				}),
			]),
		)

		// Ensure unrelated file is not returned
		expect(results.some((file) => file.name === 'unrelated.txt')).toBe(false)
	})

	test('fuzzy matches against filename', async () => {
		// Create a unique directory with some files to search for
		const testDir = `${umbreld.instance.dataDirectory}/home/search-fuzzy-test`
		await fse.mkdir(testDir)

		// Create test files
		await fse.writeFile(`${testDir}/bitcoin.pdf`, '')

		// Perform the search
		const results = await umbreld.client.files.search.query({query: 'bit corn'})

		// Expect the specific file to be returned
		expect(results).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'bitcoin.pdf',
					path: '/Home/search-fuzzy-test/bitcoin.pdf',
				}),
			]),
		)
	})

	test('respects maxResults', async () => {
		const limitDir = `${umbreld.instance.dataDirectory}/home/search-limit-test`
		await fse.mkdir(limitDir)

		// Create more than 10 files that will all match the query
		const fileCreationPromises = []
		for (let i = 0; i < 20; i++) {
			fileCreationPromises.push(fse.writeFile(`${limitDir}/alpha-${i}.txt`, String(i)))
		}
		await Promise.all(fileCreationPromises)

		const results = await umbreld.client.files.search.query({query: 'alpha', maxResults: 5})

		expect(results.length).toBe(5)
	})

	test('returns an empty array when there are no matches', async () => {
		const results = await umbreld.client.files.search.query({query: 'completely-nonexistent-query'})
		expect(results).toStrictEqual([])
	})

	test('throws when maxResults is unsafely large', async () => {
		const maxAllowedValue = 1000

		// Works for max value
		await expect(
			umbreld.client.files.search.query({
				query: 'completely-nonexistent-query',
				maxResults: maxAllowedValue,
			}),
		).resolves.toStrictEqual([])

		// Throws for one over max value
		await expect(
			umbreld.client.files.search.query({query: 'completely-nonexistent-query', maxResults: maxAllowedValue + 1}),
		).rejects.toThrow('too_big')
	})
})
