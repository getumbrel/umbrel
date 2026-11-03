import {expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import {OWNER_USER_ID} from '../user/constants.ts'
import Search from './search.ts'

function testSearch({available = true, indexFails = false}: {available?: boolean; indexFails?: boolean} = {}) {
	const searchCandidates = vi.fn(async (virtualRoot: string) => {
		if (indexFails) throw new Error('database read failed')
		return [{id: 1, name: 'vacation-photo.jpg', virtualPath: `${virtualRoot}/Photos/vacation-photo.jpg`}]
	})
	const virtualToSystemPath = vi.fn(async (path: string) => `/data${path.toLowerCase()}`)
	const status = vi.fn(async (systemPath: string) => ({name: systemPath.split('/').at(-1), path: systemPath}))
	const umbreld = {
		files: {
			fileIndex: {available, searchCandidates},
			virtualToSystemPath,
			status,
		},
	} as unknown as Umbreld
	return {
		search: new Search(umbreld),
		searchCandidates,
		virtualToSystemPath,
		status,
	}
}

test('uses indexed candidates and re-authorizes every result', async () => {
	const {search, searchCandidates, virtualToSystemPath, status} = testSearch()

	await expect(search.search('vacation', 10, OWNER_USER_ID)).resolves.toStrictEqual([
		{name: 'vacation-photo.jpg', path: '/data/home/photos/vacation-photo.jpg'},
	])

	expect(searchCandidates).toHaveBeenCalledWith('/Home', 'vacation', 10)
	expect(virtualToSystemPath).toHaveBeenCalledWith('/Home/Photos/vacation-photo.jpg', OWNER_USER_ID)
	expect(status).toHaveBeenCalledWith('/data/home/photos/vacation-photo.jpg', OWNER_USER_ID)
})

test('uses indexed candidates for a member without requiring a ready root', async () => {
	const {search, searchCandidates, status} = testSearch()

	await expect(search.search('vacation', 10, 'alice')).resolves.toStrictEqual([
		{name: 'vacation-photo.jpg', path: '/data/users/alice/photos/vacation-photo.jpg'},
	])

	expect(searchCandidates).toHaveBeenCalledWith('/Users/alice', 'vacation', 10)
	expect(status).toHaveBeenCalledWith('/data/users/alice/photos/vacation-photo.jpg', 'alice')
})

test('surfaces an unavailable index instead of returning an authoritative empty result', async () => {
	const {search, searchCandidates} = testSearch({available: false})

	await expect(search.search('vacation', 10)).rejects.toThrow('File index is unavailable')

	expect(searchCandidates).not.toHaveBeenCalled()
})

test('surfaces indexed read failures instead of returning an authoritative empty result', async () => {
	const {search} = testSearch({indexFails: true})

	await expect(search.search('vacation', 10)).rejects.toThrow('database read failed')
})
