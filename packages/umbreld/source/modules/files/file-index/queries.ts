import type DatabaseTypes from 'better-sqlite3'
import {fuzzy} from 'fast-fuzzy'
import {foldSearchName} from './migrations.js'
import {isReservedMemberTrashPath, joinVirtualPath} from './paths.js'
import type {FileIndexRoot, SearchCandidate, IndexedDirectorySize} from '../file-index-engine.js'

type Database = DatabaseTypes.Database
type SearchRow = {id: number; name: string; relative_path: string}
type FtsVocabularyRow = {term: string; doc: number}
type DirectorySizeRequest = {virtualPath: string; rootId: number; relativePath: string; reservedTrash: boolean}
const SEARCH_MATCH_THRESHOLD = 0.66
const MAX_MATCHES_DURING_SEARCH = 10_000
const MIN_TRIGRAM_QUERY_LENGTH = 3
const MIN_FUZZY_TRIGRAM_QUERY_LENGTH = 6
const MIN_FTS_CANDIDATES = 1_000
const MAX_SHORT_QUERY_CANDIDATES = 1_000
const FTS_CANDIDATES_PER_RESULT = 4
const MAX_FTS_CANDIDATES = 10_000
const MAX_RARE_TRIGRAMS = 6

export const fileIndexQueries = {
	searchCandidates(
		database: Database,
		root: FileIndexRoot & {id?: number},
		query: string,
		maxResults: number,
	): SearchCandidate[] {
		const rootId = root.id!
		const foldedQuery = foldSearchName(query)
		let matches = new Map<number, SearchCandidate & {exact: boolean; score: number}>()
		const bestMatches = () =>
			[...matches.values()]
				.sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || a.id - b.id)
				.slice(0, maxResults)

		for (const rows of searchRowPhases(database, rootId, query, maxResults)) {
			for (const row of rows) {
				if (isReservedMemberTrashPath(root, row.relative_path)) continue
				const exact = foldSearchName(row.name) === foldedQuery
				const score = exact ? 1 : fuzzy(query, row.name)
				if (!exact && score <= SEARCH_MATCH_THRESHOLD) continue
				const id = Number(row.id)
				const existing = matches.get(id)
				if (existing && (existing.exact || (!exact && existing.score >= score))) continue
				matches.set(id, {
					id,
					name: row.name,
					virtualPath: joinVirtualPath(root.virtualPath, row.relative_path),
					exact,
					score,
				})
				if (matches.size >= MAX_MATCHES_DURING_SEARCH) {
					matches = new Map(bestMatches().map((match) => [match.id, match]))
				}
			}
		}
		return bestMatches().map(({id, name, virtualPath}) => ({id, name, virtualPath}))
	},
	directorySizes(database: Database, requests: DirectorySizeRequest[]): IndexedDirectorySize[] {
		const directory = database.prepare(`SELECT type FROM entries WHERE root_id = ? AND relative_path = ?`)
		const rootSize = database.prepare(
			`SELECT COALESCE(SUM(size), 0) AS size
				FROM (
					SELECT MAX(size) AS size
					FROM entries
					WHERE root_id = ? AND type = 'file'
						AND (? = 0 OR (relative_path != 'Trash' AND relative_path NOT GLOB 'Trash/*'))
					GROUP BY CASE
						WHEN device = '' OR inode = '' THEN 'entry:' || id
						ELSE 'inode:' || device || ':' || inode
					END
				)`,
		)
		const subtreeSize = database.prepare(
			`SELECT COALESCE(SUM(size), 0) AS size
				FROM (
					SELECT MAX(size) AS size
					FROM entries
					WHERE root_id = ? AND type = 'file'
						AND relative_path >= ? AND relative_path < ?
					GROUP BY CASE
						WHEN device = '' OR inode = '' THEN 'entry:' || id
						ELSE 'inode:' || device || ':' || inode
					END
				)`,
		)

		const sizes: IndexedDirectorySize[] = []
		for (const {virtualPath, rootId, relativePath, reservedTrash} of requests) {
			if (relativePath) {
				const row = directory.get(rootId, relativePath) as {type: string} | undefined
				if (row?.type !== 'directory') continue
			}

			const row = (
				relativePath
					? subtreeSize.get(rootId, `${relativePath}/`, `${relativePath}0`)
					: rootSize.get(rootId, Number(reservedTrash))
			) as {size: number}
			sizes.push({virtualPath, size: Number(row.size)})
		}
		return sizes
	},
}

function queryTrigrams(query: string) {
	const characters = Array.from(query)
	// FTS5's trigram tokenizer cannot index shorter terms.
	if (characters.length < MIN_TRIGRAM_QUERY_LENGTH) return

	// Quote grams individually so punctuation is always treated as indexed text.
	// Search phases decide how strictly those terms are combined.
	const trigrams = new Set<string>()
	for (let index = 0; index <= characters.length - 3; index++) {
		trigrams.add(characters.slice(index, index + 3).join(''))
	}
	return [...trigrams]
}

function quoteFtsTerm(term: string) {
	return `"${term.replaceAll('"', '""')}"`
}

function ftsConjunction(terms: string[]) {
	return terms.map(quoteFtsTerm).join(' AND ')
}

function relaxedFtsExpression(terms: string[], omittedCount: number) {
	const expressions: string[] = []
	const omitted: number[] = []
	const chooseOmitted = (start: number) => {
		if (omitted.length === omittedCount) {
			const omittedSet = new Set(omitted)
			expressions.push(`(${ftsConjunction(terms.filter((_, index) => !omittedSet.has(index)))})`)
			return
		}
		for (let index = start; index < terms.length; index++) {
			omitted.push(index)
			chooseOmitted(index + 1)
			omitted.pop()
		}
	}
	chooseOmitted(0)
	return expressions.join(' OR ')
}

function rareTrigrams(database: Database, trigrams: string[]) {
	return trigrams
		.map((term, index) => {
			const variants = [...new Set([term, term.toLowerCase(), term.toUpperCase()])].filter(
				(variant) => Array.from(variant).length === MIN_TRIGRAM_QUERY_LENGTH,
			)
			const placeholders = variants.map(() => '?').join(', ')
			const row = database
				.prepare(
					`SELECT term, doc FROM entry_names_fts_vocab
					WHERE term IN (${placeholders})
					ORDER BY doc, term
					LIMIT 1`,
				)
				.get(...variants) as FtsVocabularyRow | undefined
			return {index, row}
		})
		.filter((candidate): candidate is {index: number; row: FtsVocabularyRow} => candidate.row !== undefined)
		.sort((left, right) => left.row.doc - right.row.doc || left.index - right.index)
		.slice(0, MAX_RARE_TRIGRAMS)
		.map(({row}) => row.term)
}

function ftsRows(database: Database, rootId: number, expression: string, limit: number) {
	return database
		.prepare(
			`SELECT entries.id, entries.name, entries.relative_path
			FROM entry_names_fts
			JOIN entries ON entries.id = entry_names_fts.rowid
			WHERE entry_names_fts MATCH ?
				AND entries.root_id = ?
				AND entries.hidden = 0
			LIMIT ?`,
		)
		.iterate(expression, rootId, limit) as Iterable<SearchRow>
}

function ftsSubstringRows(database: Database, rootId: number, query: string, limit: number) {
	return database
		.prepare(
			`SELECT entries.id, entries.name, entries.relative_path
			FROM entry_names_fts
			JOIN entries ON entries.id = entry_names_fts.rowid
			WHERE entry_names_fts.search_name LIKE ?
				AND entries.root_id = ?
				AND entries.hidden = 0
			LIMIT ?`,
		)
		.iterate(`%${query}%`, rootId, limit) as Iterable<SearchRow>
}

function shortSubstringRows(database: Database, rootId: number, foldedQuery: string) {
	return database
		.prepare(
			`SELECT id, name, relative_path
			FROM entries
			WHERE root_id = ?
				AND hidden = 0
				AND instr(search_name_folded, ?) > 0
			LIMIT ?`,
		)
		.iterate(rootId, foldedQuery, MAX_SHORT_QUERY_CANDIDATES) as Iterable<SearchRow>
}

function exactNameRows(database: Database, rootId: number, foldedQuery: string, limit: number) {
	return database
		.prepare(
			`SELECT id, name, relative_path
			FROM entries
			WHERE root_id = ?
				AND hidden = 0
				AND search_name_folded = ?
			LIMIT ?`,
		)
		.iterate(rootId, foldedQuery, limit) as Iterable<SearchRow>
}

function* searchRowPhases(
	database: Database,
	rootId: number,
	query: string,
	maxResults: number,
): Generator<Iterable<SearchRow>> {
	const normalizedQuery = query.normalize('NFC')
	const foldedQuery = foldSearchName(query)
	if (!foldedQuery) return
	const candidateLimit = Math.min(
		MAX_FTS_CANDIDATES,
		Math.max(MIN_FTS_CANDIDATES, maxResults * FTS_CANDIDATES_PER_RESULT),
	)
	// Exact whole-name matches use a separate B-tree lookup so they cannot be
	// displaced by an FTS candidate limit or by equally scored substrings.
	yield exactNameRows(database, rootId, foldedQuery, candidateLimit)

	const trigrams = queryTrigrams(normalizedQuery)
	// FTS5 cannot represent one- and two-character terms. Keep those searches
	// useful with a bounded literal substring scan over the folded filename.
	if (!trigrams) {
		yield shortSubstringRows(database, rootId, foldedQuery)
		return
	}

	// FTS5's trigram tokenizer accelerates LIKE and verifies that the complete
	// query is contiguous before LIMIT is applied. This prevents non-contiguous
	// trigram decoys from displacing a stronger substring candidate. LIKE's two
	// wildcard characters are intentionally left to the MATCH phases below.
	if (!normalizedQuery.includes('%') && !normalizedQuery.includes('_')) {
		yield ftsSubstringRows(database, rootId, normalizedQuery, candidateLimit)
	}

	// The full conjunction is a cheap exact-substring-like path and avoids
	// ranking large posting-list unions for ordinary searches.
	yield ftsRows(database, rootId, ftsConjunction(trigrams), candidateLimit)
	// One edit can replace every trigram in a five-character query. Keep these
	// searches fast and exact instead of pretending the index can provide
	// reliable typo recall or falling back to a million-row scan.
	if (Array.from(normalizedQuery).length < MIN_FUZZY_TRIGRAM_QUERY_LENGTH) return

	// If the strict query produced no fuzzy matches, progressively relax a
	// small set of the rarest surviving grams. This keeps typo lookup narrow
	// while allowing locally damaged trigrams to be omitted.
	const anchors = rareTrigrams(database, trigrams)
	if (anchors.length === 0) return
	yield ftsRows(database, rootId, ftsConjunction(anchors), candidateLimit)

	const omittedCounts = new Set<number>()
	if (anchors.length >= 3) omittedCounts.add(1)
	if (anchors.length >= 4) omittedCounts.add(2)
	if (anchors.length >= 5) omittedCounts.add(anchors.length - 2)
	if (trigrams.length <= 5 && anchors.length >= 2) omittedCounts.add(anchors.length - 1)
	for (const omittedCount of omittedCounts) {
		yield ftsRows(database, rootId, relaxedFtsExpression(anchors, omittedCount), candidateLimit)
	}
}
