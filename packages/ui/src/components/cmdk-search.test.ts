import {describe, expect, it} from 'vitest'

import {
	CMDK_MATCH,
	createCmdkMatcher,
	normalizeSearchText,
	orderSectionsByMatch,
	rankCmdkEntries,
	sortByMatch,
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
