import {describe, expect, it} from 'vitest'

import type {SearchResult} from '@/features/search/types'

import {
	bestSearchGrade,
	CMDK_MATCH,
	createCmdkMatcher,
	gradeSearchResult,
	normalizeSearchText,
	orderSectionsByMatch,
	rankCmdkEntries,
	sortByMatch,
	splitSearchResults,
	type CmdkEntry,
} from './cmdk-search'

const noop = () => {}

function entry(id: string, title: string, keywords?: string[]): CmdkEntry {
	return {id, title, keywords, onSelect: noop}
}

const ids = (entries: CmdkEntry[]) => entries.map(({id}) => id)

describe('rankCmdkEntries', () => {
	it('returns nothing for an empty query', () => {
		expect(rankCmdkEntries([entry('a', 'Files')], '   ', 25)).toEqual([])
	})

	it('ranks title matches by tier: exact, prefix, word prefix, substring', () => {
		const entries = [
			entry('substring', 'Profile'),
			entry('word-prefix', 'Wi-Fi'),
			entry('prefix', 'File sharing'),
			entry('exact', 'Fi'),
		]

		expect(ids(rankCmdkEntries(entries, 'fi', 25))).toEqual(['exact', 'prefix', 'word-prefix', 'substring'])
	})

	it('treats punctuation and brackets as word boundaries', () => {
		const entries = [entry('substring', 'Simcp'), entry('word-prefix', 'AI agents (MCP)')]

		expect(ids(rankCmdkEntries(entries, 'mcp', 25))).toEqual(['word-prefix', 'substring'])
		expect(ids(rankCmdkEntries(entries, '(mcp)', 25))).toEqual(['word-prefix'])
	})

	it('ranks any title match above keyword matches, and keyword prefixes above substrings', () => {
		const entries = [
			entry('keyword-substring', 'Advanced settings', ['Discover devices with mDNS']),
			entry('keyword-prefix', 'Network', ['DNS server']),
			entry('title', 'External DNS'),
		]

		expect(ids(rankCmdkEntries(entries, 'dns', 25))).toEqual(['title', 'keyword-prefix', 'keyword-substring'])
	})

	it('keeps entry order within a tier', () => {
		const entries = [entry('first', 'Backups'), entry('second', 'Backrest'), entry('third', 'Backdrop')]

		expect(ids(rankCmdkEntries(entries, 'back', 25))).toEqual(['first', 'second', 'third'])
	})

	it('matches compact queries against titles as a last resort', () => {
		const entries = [entry('password', 'Change password'), entry('name', 'Change name')]

		expect(ids(rankCmdkEntries(entries, 'chpass', 25))).toEqual(['password'])
		// Too short to be meaningful as a subsequence
		expect(ids(rankCmdkEntries(entries, 'cp', 25))).toEqual([])
	})

	it('ignores accents and case in both the query and the entries', () => {
		const entries = [entry('advanced', 'Advanced settings', ['Nom d’hôte sécurisé'])]

		expect(ids(rankCmdkEntries(entries, 'hote securise', 25))).toEqual(['advanced'])
		expect(ids(rankCmdkEntries(entries, 'HÔTE', 25))).toEqual(['advanced'])
	})

	it('caps the number of results after ranking, so the best match is never cut off', () => {
		const entries = [...Array.from({length: 40}, (_, i) => entry(`app-${i}`, `Webapp ${i}`)), entry('exact', 'App')]

		const results = ids(rankCmdkEntries(entries, 'app', 25))
		expect(results).toHaveLength(25)
		expect(results[0]).toBe('exact')
	})
})

describe('normalizeSearchText', () => {
	it('lowercases, trims, and strips accents', () => {
		expect(normalizeSearchText('  Nom d’hôte Sécurisé ')).toBe('nom d’hote securise')
	})
})

describe('createCmdkMatcher', () => {
	it('grades one title on the shared scale', () => {
		const match = createCmdkMatcher('download')!
		expect(match('Downloads')).toBe(CMDK_MATCH.prefix)
		expect(match('Just. Download.')).toBe(CMDK_MATCH.wordPrefix)
		expect(match('Advanced settings', ['Change download folder'])).toBe(CMDK_MATCH.keywordWordPrefix)
		expect(match('Bazarr', ['Fetches undownloaded subtitles'])).toBe(CMDK_MATCH.keywordSubstring)
		expect(match('Troubleshoot')).toBe(CMDK_MATCH.none)
		expect(createCmdkMatcher('downloads')!('Downloads')).toBe(CMDK_MATCH.exact)
	})

	it('is null for an empty query', () => {
		expect(createCmdkMatcher('  ')).toBeNull()
	})
})

describe('sortByMatch', () => {
	it('puts the best match first and keeps source order between equals', () => {
		const match = createCmdkMatcher('down')!
		const names = ['Downtify', 'MeTube', 'Downloads', 'SABnzbd']
		expect(sortByMatch(names, (name) => match(name))).toEqual(['Downtify', 'Downloads', 'MeTube', 'SABnzbd'])
	})
})

describe('orderSectionsByMatch', () => {
	it('leads with the source holding the best match, then by priority', () => {
		const sections = [
			{id: 'hits', bestMatch: CMDK_MATCH.keywordWordPrefix, priority: 0},
			{id: 'apps', bestMatch: CMDK_MATCH.wordPrefix, priority: 2},
			{id: 'files', bestMatch: CMDK_MATCH.prefix, priority: 1},
			{id: 'photos', bestMatch: CMDK_MATCH.wordPrefix, priority: 3},
		]
		expect(orderSectionsByMatch(sections).map(({id}) => id)).toEqual(['files', 'apps', 'photos', 'hits'])
	})
})

// A search result as the backend sends it; `photo` set puts it in the library
function result(name: string, overrides: Partial<SearchResult> & {inLibrary?: boolean} = {}): SearchResult {
	const {inLibrary, ...rest} = overrides
	return {
		id: name,
		kind: 'file',
		match: 'name',
		score: 1,
		file: {name, path: `/Home/${name}`, type: 'application/octet-stream', size: 1, modified: 0, operations: []},
		...(inLibrary && {
			photo: {id: name, kind: 'photo', takenAt: 0, width: 4, height: 3, isFavorite: false},
		}),
		...rest,
	}
}

const names = (results: SearchResult[]) => results.map(({id}) => id)

describe('splitSearchResults', () => {
	const results = [
		result('beach.jpg', {kind: 'photo', match: 'visual', score: 0.9, inLibrary: true}),
		result('beach-house.pdf', {kind: 'document', match: 'text', score: 0.8}),
		result('surf.mp4', {kind: 'video', match: 'speech', score: 0.7, inLibrary: true}),
		result('scan.png', {kind: 'photo', match: 'visual', score: 0.6}),
		result('Beach', {score: 0.5}),
	]

	it('deals library items to tiles and the rest to rows, each in ranked order', () => {
		const {photos, files} = splitSearchResults(results)
		expect(names(photos)).toEqual(['beach.jpg', 'surf.mp4'])
		// A picture outside the library is a file like any other
		expect(names(files)).toEqual(['beach-house.pdf', 'scan.png', 'Beach'])
	})
})

describe('gradeSearchResult', () => {
	const match = createCmdkMatcher('ikea')

	it('grades a name match like any title, and never above a local entry of the same tier', () => {
		expect(gradeSearchResult(result('ikea', {score: 1}), match)).toBe(CMDK_MATCH.exact)
		const prefix = gradeSearchResult(result('ikea-receipt.pdf', {score: 0.6}), match)
		expect(prefix).toBeLessThan(CMDK_MATCH.prefix)
		expect(prefix).toBeGreaterThan(CMDK_MATCH.wordPrefix)
		// The server matched it, so it is at least a fuzzy hit
		expect(gradeSearchResult(result('receipt.pdf', {score: 1}), match)).toBe(CMDK_MATCH.subsequence)
	})

	it('grades a match inside a file with keyword hits, above fuzzy ones', () => {
		const text = gradeSearchResult(result('scan-0042.pdf', {match: 'text', score: 1}), match)
		expect(text).toBe(CMDK_MATCH.keywordWordPrefix)
		expect(gradeSearchResult(result('clip.mp4', {match: 'speech', score: 0.4}), match)).toBeLessThan(text)
		expect(gradeSearchResult(result('clip.mp4', {match: 'visual', score: 0}), match)).toBeGreaterThan(
			CMDK_MATCH.keywordSubstring,
		)
	})

	it('lets the backend score order two server sections of the same tier', () => {
		const photos = bestSearchGrade([result('a.jpg', {match: 'visual', score: 0.9})], match)
		const files = bestSearchGrade([result('b.pdf', {match: 'text', score: 0.7})], match)
		const sections = [
			{id: 'files', bestMatch: files, priority: 1},
			{id: 'photos', bestMatch: photos, priority: 3},
		]
		expect(orderSectionsByMatch(sections).map(({id}) => id)).toEqual(['photos', 'files'])
	})

	it('puts an exact hit inside a document ahead of weak local matches, so Enter opens it', () => {
		const iban = bestSearchGrade([result('statement.pdf', {match: 'text', score: 1})], createCmdkMatcher('DE89 3704'))
		const sections = [
			{id: 'hits', bestMatch: CMDK_MATCH.keywordSubstring, priority: 0},
			{id: 'files', bestMatch: iban, priority: 1},
		]
		expect(orderSectionsByMatch(sections)[0].id).toBe('files')
		// …while a local entry whose title says it still leads
		expect(
			orderSectionsByMatch([
				{id: 'files', bestMatch: iban, priority: 1},
				{id: 'hits', bestMatch: CMDK_MATCH.prefix, priority: 0},
			])[0].id,
		).toBe('hits')
	})

	it('is none for an empty section', () => {
		expect(bestSearchGrade([], match)).toBe(CMDK_MATCH.none)
	})
})
