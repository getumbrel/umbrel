import {expect, beforeAll, afterAll, describe, test} from 'vitest'
import pRetry from 'p-retry'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

let umbreld: Awaited<ReturnType<typeof createTestVm>>

// Spin up a single VM for the entire test suite to save time. Each test
// creates its own unique files so state leakage across tests does not affect
// expectations.
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
	await umbreld.api.post(`files/upload?path=${encodeURIComponent(path)}`, {body: content})
}

describe('files.search()', () => {
	test('throws "Invalid token" error without auth token', async () => {
		await expect(umbreld.unauthenticatedClient.files.search.query({query: 'anything'})).rejects.toThrow('Invalid token')
	})

	test('finds files that match the query', async () => {
		// Create a unique directory with some files to search for
		await umbreld.client.files.createDirectory.mutate({path: '/Home/search-find-test'})

		// Create test files
		await Promise.all([
			uploadFile('/Home/search-find-test/hello-world.txt', 'hello world'),
			uploadFile('/Home/search-find-test/hello-mars.txt', 'hello mars'),
			uploadFile('/Home/search-find-test/unrelated.txt', 'nothing to see here'),
		])

		// Uploads are indexed asynchronously, so wait for the search to see them
		await pRetry(
			async () => {
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
			},
			{retries: 20, minTimeout: 100, maxTimeout: 500},
		)
	})

	test('matches separators and spelling mistakes against filenames', async () => {
		// Create a unique directory with a file to search for
		await umbreld.client.files.createDirectory.mutate({path: '/Home/search-fuzzy-test'})
		await uploadFile('/Home/search-fuzzy-test/bitcoin.pdf', '')

		// Both a separator mismatch and a transposition should find the file.
		for (const query of ['bit corn', 'bitocin']) {
			await pRetry(
				async () => {
					const results = await umbreld.client.files.search.query({query})
					expect(results).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								name: 'bitcoin.pdf',
								path: '/Home/search-fuzzy-test/bitcoin.pdf',
							}),
						]),
					)
				},
				{retries: 20, minTimeout: 100, maxTimeout: 500},
			)
		}
	})

	test('normalizes Unicode filenames without breaking non-Latin case folding', async () => {
		await umbreld.client.files.createDirectory.mutate({path: '/Home/search-unicode-test'})
		const decomposedCafe = 'café-codex.txt'.normalize('NFD')
		const decomposedKorean = '한글-codex.txt'.normalize('NFD')
		await Promise.all([
			uploadFile(`/Home/search-unicode-test/${decomposedCafe}`, ''),
			uploadFile(`/Home/search-unicode-test/${decomposedKorean}`, ''),
			uploadFile('/Home/search-unicode-test/İstanbul-codex.txt', ''),
			uploadFile('/Home/search-unicode-test/ᎠᎡᎢ-codex.txt', ''),
		])

		for (const [query, expectedName] of [
			['café-codex', decomposedCafe],
			['한글-codex.txt', decomposedKorean],
			['İSTAN', 'İstanbul-codex.txt'],
			['ᎠᎡᎢ', 'ᎠᎡᎢ-codex.txt'],
		] as const) {
			await pRetry(
				async () => {
					const results = await umbreld.client.files.search.query({query})
					expect(results.map(({name}) => name)).toContain(expectedName)
				},
				{retries: 20, minTimeout: 100, maxTimeout: 500},
			)
		}
	})

	test('finds an exact two-character filename without scanning all entries', async () => {
		await uploadFile('/Home/xy', '')

		await pRetry(
			async () => {
				const results = await umbreld.client.files.search.query({query: 'xy'})
				expect(results.map(({name}) => name)).toContain('xy')
			},
			{retries: 20, minTimeout: 100, maxTimeout: 500},
		)
	})

	test('ranks candidates globally across strict and typo-tolerant phases', async () => {
		await Promise.all([uploadFile('/Home/abcxef', ''), uploadFile('/Home/abcdcdef', '')])

		await pRetry(
			async () => {
				const results = await umbreld.client.files.search.query({query: 'abcdef', maxResults: 1})
				expect(results).toMatchObject([{name: 'abcxef'}])
			},
			{retries: 20, minTimeout: 100, maxTimeout: 500},
		)
	})

	test('respects maxResults', async () => {
		await umbreld.client.files.createDirectory.mutate({path: '/Home/search-limit-test'})

		// Create more than 10 files that will all match the query
		for (let i = 0; i < 20; i++) {
			// QEMU's userspace HTTP forward is not a useful part of this assertion
			// and becomes unreliable when opening 20 upload connections at once.
			await uploadFile(`/Home/search-limit-test/alpha-${i}.txt`, String(i))
		}

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

	test('rejects malformed search input', async () => {
		await expect(umbreld.client.files.search.query({query: 'abc\0def'})).rejects.toThrow(
			'Search query cannot contain NUL',
		)
		await expect(umbreld.client.files.search.query({query: 'anything', maxResults: 250.5})).rejects.toThrow()
	})
})
