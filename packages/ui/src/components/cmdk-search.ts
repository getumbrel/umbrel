import type {ReactNode} from 'react'

// A command palette row. Sources (apps, settings, machines…) produce these and
// `rankCmdkEntries` picks the ones to show for a query. Matching happens here,
// in plain JS, so cmdk itself never scores anything: it only receives the
// already-ranked rows and handles keyboard navigation and selection.
export type CmdkEntry = {
	// Unique across every source, prefixed by the source: 'app:bitcoin', 'settings:wifi'
	id: string
	title: string
	// Dimmed text after the title, e.g. "in Settings"
	subtitle?: string
	// Extra copy the entry should be found by: descriptions, aliases, nested settings copy
	keywords?: string[]
	// Shown without a query, in source order
	default?: boolean
	// Rendered but not selectable, e.g. an app that is still installing
	disabled?: boolean
	icon?: string | ReactNode
	// Square app artwork opts into a framed tile; other artwork renders bare
	iconVariant?: 'bare' | 'tile'
	onSelect?: () => void
}

export function normalizeSearchText(value: string) {
	return value
		.trim()
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
}

// How well a title (and its keywords) match a query, on one scale every
// source shares — the local entries, the App Store's index, file names — so
// results from different places can be compared. Best first. Ties keep the
// order they came in, so sources list by priority (system actions, settings,
// installed apps, shortcuts, app store).
export const CMDK_MATCH = {
	exact: 7,
	prefix: 6,
	wordPrefix: 5,
	substring: 4,
	keywordWordPrefix: 3,
	keywordSubstring: 2,
	subsequence: 1,
	none: 0,
} as const

export type CmdkMatcher = (title: string, keywords?: readonly string[]) => number

// Null for an empty query: nothing matches nothing
export function createCmdkMatcher(query: string): CmdkMatcher | null {
	const normalizedQuery = normalizeSearchText(query)
	if (!normalizedQuery) return null
	// The query at the start of a word: "fi" in "Wi-Fi", "mcp" in "AI agents (MCP)"
	const wordStart = new RegExp(`(?:^|[^\\p{L}\\p{N}])${normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u')

	return (rawTitle, rawKeywords) => {
		const title = normalizeSearchText(rawTitle)
		if (title === normalizedQuery) return CMDK_MATCH.exact
		if (title.startsWith(normalizedQuery)) return CMDK_MATCH.prefix
		if (wordStart.test(title)) return CMDK_MATCH.wordPrefix
		if (title.includes(normalizedQuery)) return CMDK_MATCH.substring

		const keywords = rawKeywords?.map(normalizeSearchText) ?? []
		if (keywords.some((keyword) => wordStart.test(keyword))) return CMDK_MATCH.keywordWordPrefix
		if (keywords.some((keyword) => keyword.includes(normalizedQuery))) return CMDK_MATCH.keywordSubstring

		// Compact queries like "chpass" → "Change password". Only for titles and
		// only from three characters, otherwise everything matches.
		if (normalizedQuery.length >= 3 && isSubsequence(normalizedQuery, title)) return CMDK_MATCH.subsequence
		return CMDK_MATCH.none
	}
}

function isSubsequence(query: string, text: string) {
	let matched = 0
	for (let i = 0; i < text.length && matched < query.length; i++) {
		if (text[i] === query[matched]) matched++
	}
	return matched === query.length
}

export function rankCmdkEntries(entries: CmdkEntry[], query: string, limit: number): CmdkEntry[] {
	return rankCmdkEntriesScored(entries, query, limit).map(({entry}) => entry)
}

export function rankCmdkEntriesScored(
	entries: CmdkEntry[],
	query: string,
	limit: number,
): {entry: CmdkEntry; score: number}[] {
	const matcher = createCmdkMatcher(query)
	if (!matcher) return []
	return entries
		.map((entry) => ({entry, score: matcher(entry.title, entry.keywords)}))
		.filter(({score}) => score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
}

// Results from one source, best match first; ties keep the source's own order
export function sortByMatch<T>(items: readonly T[], matchOf: (item: T) => number): T[] {
	return items
		.map((item, index) => ({item, index, match: matchOf(item)}))
		.sort((a, b) => b.match - a.match || a.index - b.index)
		.map(({item}) => item)
}

// Whichever source holds the best match leads; between equals, the source
// with the lower priority number (the more direct kind of result) comes first
export function orderSectionsByMatch<T extends {bestMatch: number; priority: number}>(sections: readonly T[]): T[] {
	return [...sections].sort((a, b) => b.bestMatch - a.bestMatch || a.priority - b.priority)
}
