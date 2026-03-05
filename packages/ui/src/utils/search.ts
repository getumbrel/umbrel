import Fuse from 'fuse.js'

const fuseOptions = {
	// https://www.fusejs.io/api/options.html
	isCaseSensitive: false,
	includeScore: false,
	includeMatches: false,
	minMatchCharLength: 2,
	shouldSort: true,
	findAllMatches: false,
	location: 0,
	threshold: 0.3,
	distance: 100,
	ignoreLocation: false,
	useExtendedSearch: false,
	ignoreFieldNorm: false,
	fieldNormWeight: 1,
}

export type SearchKey = {
	name: string
	weight: number
}

export function createSearch<T>(items: T[], keys: SearchKey[]) {
	const fuse = new Fuse<T>(items, {
		...fuseOptions,
		keys,
	})
	return (pattern: string, limit = 60) => {
		const normalizedPattern = pattern.trim().replace(/\s+/g, ' ')
		const results = fuse.search(normalizedPattern, {limit})
		return results.map((result) => result.item)
	}
}
