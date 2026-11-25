import type {Database} from 'better-sqlite3'

import {soundsIn} from '../files/sounds.ts'
import {typed} from '../files/unspaced.ts'

import RoughVectors, {fileKey} from './rough-vectors.ts'

// Search finds things by what is in them: the words in a document, read off
// a picture or said in a recording, and what a picture, a video, a passage
// or a stretch of speech is about (see ../files/embeddings.ts for how the
// models read them, and ../files/embeddings-store.ts for where that is
// kept). This is the looking. Whose the things are, and whether the one
// asking may see them, is settled by whoever asks for it.

// A photo or a video's frame has to be at least this like what was asked for.
// EmbeddingGemma 2's scores are not centred on zero: a photo that has nothing
// to do with a query still scores about 0.60. Measured on 3,678 real photos
// and 35 queries with the model as LiteRT-LM runs it, 0.70 keeps what a query
// describes and drops nearly all of what it doesn't.
export const MIN_SIMILARITY = 0.7
// A passage of a document or a stretch of speech is words, like the query,
// and scores higher against it whatever either says: about 0.65 for most of
// what is said in a library, whatever is asked. So a passage has to clear a
// bar and be nearly as good as the best passage there is for the query. The
// two numbers are the ones an earlier version of search settled on from a
// labelled library. They fit what was measured here: documents score 0.72 to
// 0.74 against a description of what they say in other words and under 0.66
// against anything else, and of 457 stretches of speech the ones that answer
// a query score 0.77 to 0.85 where the best that don't are around 0.72.
export const MIN_PASSAGE_SIMILARITY = 0.706
const PASSAGE_WINDOW = 0.06
// Speech with words that sound like the ones typed is this far over that bar at most
const SOUNDS_ALIKE = 0.03
const SOUNDS_TO_FIND = 2
const SOUNDS_TO_TRUST = 4
// How many queries SQLite puts together into one (SQLITE_MAX_COMPOUND_SELECT)
const MOST_WORDS_TOGETHER = 500
// A common word is in more passages than anyone will read
const MAX_WORD_MATCHES = 2000
// About this much of a passage is shown around the words that were found in it
const SNIPPET_CHARACTERS = 160

// Why a content matched, in the order a person would trust it: words found
// in it, words said in it, then what it is about or looks like
export type ContentHit = {
	match: 'text' | 'speech' | 'visual'
	// Whether the words themselves were found, or only their meaning
	exact: boolean
	// How sure it is, from 0 to 1, that this is what was meant: all the
	// reasons there are for it together (see contentHits)
	strength: number
	snippet?: {text: string; highlights: Array<[number, number]>}
	// For a video or recording, where in it
	atMs?: number
	endMs?: number
	// For a document, the page
	page?: number
}

// The part of a passage around the first of the words found in it, with
// where each of them is
//
// `terms` are words to find as they are written, or the sounds of words to
// find by how they sound (see ../files/sounds.ts)
function snippet(passage: string, terms: string[] | Set<string>) {
	const folded = passage.toLowerCase()
	const found: Array<[number, number]> = []
	if (terms instanceof Set) {
		for (const {sound, from, to} of soundsIn(passage)) if (terms.has(sound)) found.push([from, to])
	} else {
		for (const term of terms) {
			for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + term.length)) {
				found.push([at, at + term.length])
			}
		}
	}
	found.sort((first, second) => first[0] - second[0])
	let start = Math.max(0, (found[0]?.[0] ?? 0) - SNIPPET_CHARACTERS / 4)
	// From the start of a word
	if (start > 0) start = passage.indexOf(' ', start) + 1 || start
	const text = passage.slice(start, start + SNIPPET_CHARACTERS)
	const highlights = found
		.map(([from, to]): [number, number] => [from - start, Math.min(to - start, text.length)])
		.filter(([from, to]) => from >= 0 && from < to)
	return {text, highlights}
}

type PassageRow = {
	hash: Buffer
	kind: 'document' | 'picture' | 'speech'
	at_ms: number | null
	end_ms: number | null
	page: number | null
	text: string
}

// Without `terms`, the part of the passage to show is left for whoever asks
function passageHit(row: PassageRow, exact: boolean, strength: number, terms?: string[] | Set<string>): ContentHit {
	return {
		match: row.kind === 'speech' ? 'speech' : 'text',
		exact,
		strength,
		...(terms ? {snippet: snippet(row.text, exact || terms instanceof Set ? terms : [])} : {}),
		...(row.at_ms === null ? {} : {atMs: row.at_ms}),
		...(row.end_ms === null ? {} : {endMs: row.end_ms}),
		...(row.page === null ? {} : {page: row.page}),
	}
}

// Results are ordered by how sure it is that each is what was meant, and
// every reason there is to think so is put on that one scale, from 0 to 1.
// What kind of reason it is does not decide the order: how strong it is does.
//
//   looks    A photo or a frame that is like what was typed: from 0.35 at
//            the bar to 0.95 at STRONG_SIMILARITY. A word alone scores less
//            than a description does: of 93,000 photos and frames, the best
//            for "car", "dog" and "beach" scored 0.75 to 0.78, and a few
//            hundred were over 0.70.
//   meaning  A passage of a document or of speech that says what was typed
//            in other words: the same, from its own bar.
//   words    The words themselves: by how much of the text they are. A sign
//            that says "CAR WASH" is about a car; a page of a hundred words
//            with "car" in it once is not much. (Of the pictures in that
//            library with "car" written on them, half had over 80 words.)
//            All of them together and in order is as good as sure.
//            And the fewer things there are with the words, the surer each
//            is: a number that is on one picture in the library is that
//            picture, however much else is written on it, where "car" on a
//            hundred pictures says little about any one of them.
//   said     The same in speech, held a little less sure: a recogniser
//            mishears.
//
// Reasons of different kinds for the same thing add up, as chances that are
// not each other's do: a photo of an apple with "apple" written on it is
// surer than either alone. The numbers are a first setting, to be put right
// against searches with known answers.
const STRONG_SIMILARITY = 0.76
const STRONG_PASSAGE_SIMILARITY = 0.79
const SAID = 0.7
const PHRASE = 0.85
// With this many things that have the words, each is half way to sure
const FEW = 10
const SURE = 0.95
// Each further passage of a document or recording that has the words
const MORE_PASSAGES = 0.9
const part = (value: number) => Math.max(0, Math.min(1, value))
const looks = (score: number) => 0.35 + 0.6 * part((score - MIN_SIMILARITY) / (STRONG_SIMILARITY - MIN_SIMILARITY))
const means = (score: number) =>
	0.35 + 0.6 * part((score - MIN_PASSAGE_SIMILARITY) / (STRONG_PASSAGE_SIMILARITY - MIN_PASSAGE_SIMILARITY))

// How sure the words typed make a text that has them, by its letters: all of
// it when they are half the text or more. `holders` is how many things have
// the words: the fewer, the nearer each is to as sure as its kind can be.
// `weight` is what a kind is held at beside words that are written: said
// ones are held at SAID.
function wordsStrength(words: string[], typedTerms: string[], unspaced: Set<string>, holders: number, weight: number) {
	const terms = typedTerms.map(plain)
	let letters = 0
	let found = 0
	for (const word of words) {
		letters += word.length
		// A run of a script written without spaces has what was typed inside it
		const term = terms.find((term, index) => word === term || (unspaced.has(typedTerms[index]!) && word.includes(term)))
		if (term) found += Math.min(word.length, term.length)
	}
	if (letters === 0) return 0
	const share = 0.15 + 0.8 * Math.sqrt(part((2 * found) / letters))
	// One after another, as typed
	const phrase = terms.length > 1 && ` ${words.join(' ')} `.includes(` ${terms.join(' ')} `)
	return rarer((phrase ? Math.max(share, PHRASE) : share) * weight, weight, holders)
}

// How sure something found by words is, given how few things have them: the
// fewer, the nearer to the surest its kind can be, which is a little under the
// surest there is
function rarer(strength: number, weight: number, holders: number) {
	const surest = SURE - (1 - weight) / 5
	return strength + (surest - strength) * (FEW / (FEW + holders))
}

// Without accents, as the index of words finds them
const plain = (word: string) => word.normalize('NFKD').replace(/\p{M}/gu, '')

// What is kept in memory of a store's embeddings, for each connection to it
// (see rough-vectors.ts): of what photos and video frames show, and of what
// passages say. A connection is one reader thread's, and searches are only
// ever given to the one that is not kept for quick reads, so there is one of
// each.
const rough = new WeakMap<Database, {vectors: RoughVectors; passages: RoughVectors; own: Map<string, Own>}>()
function roughVectors(database: Database) {
	if (!rough.has(database)) {
		rough.set(database, {vectors: new RoughVectors('vectors'), passages: new RoughVectors('passages'), own: new Map()})
	}
	return rough.get(database)!
}

// On a device with more than one account, what is like what was typed is
// looked for among the files of the one asking. The files that get a full
// look are a number of the best (see ROUGH_FILES), and they would otherwise
// be the best of everyone's: next to a large library, most of what someone
// with a small one would find was not among them.
//
// Which files are theirs is asked of the index, which goes through every
// file they have (55 ms for 47,000 files, and 2 MB to keep), so the answer is
// kept for this long. Nothing that arrives meanwhile is left out for it:
// whatever was stored after the list was made is looked at whoever's it is,
// and whose each thing found is is asked of the index as ever.
const OWN_FILES_KEPT_MS = 30_000
type Own = {keys: Set<number>; after: {vectors: number; passages: number}; until: number}
function ownFiles(database: Database, accountId: string, now = Date.now()) {
	// With one account there is nobody else's to tell them from
	if ((database.prepare('SELECT COUNT(DISTINCT owner_id) FROM index_roots').pluck().get() as number) < 2) return
	const kept = roughVectors(database)
	let own = kept.own.get(accountId)
	if (!own || own.until <= now) {
		// A list nobody has searched by since it ran out is no use to anyone
		for (const [account, list] of kept.own) if (list.until <= now) kept.own.delete(account)
		// What is newest first: a file that arrives between the two is then on the list as well
		const after = {vectors: kept.vectors.newest(database), passages: kept.passages.newest(database)}
		const keys = new Set<number>()
		const hashes = database
			.prepare(
				`SELECT contents.blake3 FROM entries JOIN index_roots ON index_roots.id = entries.root_id
				JOIN contents ON contents.id = entries.content_id WHERE index_roots.owner_id = ?`,
			)
			.pluck()
			.iterate(accountId) as IterableIterator<Buffer>
		for (const hash of hashes) keys.add(fileKey(hash))
		kept.own.set(accountId, (own = {keys, after, until: now + OWN_FILES_KEPT_MS}))
	}
	return own
}

// One reason for a content, with what there is to show for it worked out
// only if it turns out to be the best one
type Reason = Omit<ContentHit, 'snippet'> & {shown?: () => ContentHit['snippet']; passage?: number}

// Every content that holds what is searched for, by its hash, with the best
// reason it does and how sure all its reasons make it. `embedding` is what
// was typed as the model reads it; without it only the words themselves are
// looked for. Passages are only ever held against the account's own: what
// someone else has, and how well it matches, changes nothing of what is found.
// `sounded` is what was typed as it is spelt in Latin letters, where it was
// typed in a script that speech is not kept in (see ../files/sounds.ts).
export function contentHits(
	database: Database,
	accountId: string,
	text: string,
	embedding?: Float32Array,
	sounded = text,
	// The files a search is kept to, by their hashes: what a view of Photos
	// holds. What is like what was typed is only looked for among them.
	only?: Buffer[],
) {
	const owned = database.prepare(
		`SELECT 1 FROM contents JOIN entries ON entries.content_id = contents.id
		JOIN index_roots ON index_roots.id = entries.root_id
		WHERE contents.blake3 = ? AND index_roots.owner_id = ? LIMIT 1`,
	)
	const reasons = new Map<string, Reason[]>()
	const keep = (hash: Buffer, reason: Reason) => {
		const key = hash.toString('hex')
		const before = reasons.get(key)
		if (before) before.push(reason)
		else reasons.set(key, [reason])
	}
	// The words typed are looked for in the index of words, and what is in a
	// script written without spaces in the index of its pairs of characters
	// (see ../files/unspaced.ts): a passage has to have all of both
	const {words, runs, terms} = typed(text)
	const unspaced = new Set(terms.filter((term) => !words.includes(term)))
	const ownsPassage = `EXISTS (
		SELECT 1 FROM contents JOIN entries ON entries.content_id = contents.id
		JOIN index_roots ON index_roots.id = entries.root_id
		WHERE contents.blake3 = passages.hash AND index_roots.owner_id = ?
	)`
	const lines = database
		.prepare(`SELECT text FROM embeddings.passages WHERE hash = ? AND kind = 'picture' ORDER BY seq`)
		.pluck()
	// All that is written on a picture: it is one text, kept a line at a time
	const pictures = new Map<string, string>()
	const writtenOn = (hash: Buffer) => {
		const key = hash.toString('hex')
		if (!pictures.has(key)) pictures.set(key, (lines.all(hash) as string[]).join(' '))
		return pictures.get(key)!
	}
	// The words of a text, worked out once however often it is found
	const read = new Map<string, string[]>()
	const wordsOf = (text: string) => {
		if (!read.has(text)) read.set(text, typed(text).terms.map(plain))
		return read.get(text)!
	}
	if (terms.length > 0) {
		const quoted = words.map((word) => `"${word}"`)
		const asked = [
			...(quoted.length > 0 ? [{index: 'passages_fts', query: quoted.join(' ')}] : []),
			...(runs.length > 0 ? [{index: 'passages_pairs', query: runs.join(' ')}] : []),
		]
		const [first, second] = asked
		// Best match first
		const rows = database
			.prepare(
				`SELECT passages.id, passages.hash, passages.kind, passages.at_ms, passages.end_ms, passages.page, passages.text
				FROM embeddings.${first!.index}
				JOIN embeddings.passages ON passages.id = ${first!.index}.rowid
				WHERE ${first!.index} MATCH ?
					${second ? `AND passages.id IN (SELECT rowid FROM embeddings.${second.index} WHERE ${second.index} MATCH ?)` : ''}
					AND ${ownsPassage}
				ORDER BY bm25(${first!.index}) LIMIT ${MAX_WORD_MATCHES}`,
			)
			.all(...asked.map(({query}) => query), accountId) as Array<PassageRow & {id: number}>
		// A picture with each of the words on some line of it is found too.
		// Each is asked for once, and no more of them than SQLite will put
		// together in one query.
		const each = [
			...[...new Set(quoted)].map((query) => ({index: 'passages_fts', query})),
			...[...new Set(runs)].map((query) => ({index: 'passages_pairs', query})),
		].slice(0, MOST_WORDS_TOGETHER)
		const across =
			each.length < 2
				? []
				: (database
						.prepare(
							`SELECT hash FROM (${each
								.map(
									({index}) => `SELECT passages.hash FROM embeddings.${index}
										JOIN embeddings.passages ON passages.id = ${index}.rowid
										WHERE ${index} MATCH ? AND passages.kind = 'picture'`,
								)
								.join(' INTERSECT ')}) AS passages
							WHERE ${ownsPassage} LIMIT ${MAX_WORD_MATCHES}`,
						)
						.pluck()
						.all(...each.map(({query}) => query), accountId) as Buffer[])
		// How many things have the words: the fewer, the surer each is
		const holders = new Set([...rows.map(({hash}) => hash), ...across].map((hash) => hash.toString('hex'))).size
		for (const row of rows) {
			// A line of a picture is part of what is written on it
			const within = row.kind === 'picture' ? writtenOn(row.hash) : row.text
			const strength = wordsStrength(wordsOf(within), terms, unspaced, holders, row.kind === 'speech' ? SAID : 1)
			keep(row.hash, {
				...passageHit(row, true, strength),
				passage: row.id,
				shown: () => snippet(row.text, terms),
			})
		}
		for (const hash of across) {
			keep(hash, {
				match: 'text',
				exact: true,
				strength: wordsStrength(wordsOf(writtenOn(hash)), terms, unspaced, holders, 1),
				shown: () => snippet(writtenOn(hash), terms),
			})
		}
	}
	// Speech that was written down in other letters than it was said in is
	// also found by how the words typed sound. Said in the order they were
	// typed, that is nearly as good as the words themselves. Anywhere in a
	// passage, or a single word, it is a likeness.
	//
	// A sound is a few consonants, and a short word's is one that half of
	// what is said has ("he", "hai"): a search that sounds like fewer than
	// SOUNDS_TO_FIND letters is not looked for this way, and one that sounds
	// like fewer than SOUNDS_TO_TRUST is a likeness even in order.
	const heard = soundsIn(sounded).map(({sound}) => sound)
	const letters = heard.join('').length
	if (letters >= SOUNDS_TO_FIND && heard.length === (sounded.match(/[\p{L}\p{N}]+/gu) ?? []).length) {
		const sounding = database.prepare(
			`SELECT passages.hash, passages.kind, passages.at_ms, passages.end_ms, passages.page, passages.text
			FROM embeddings.passages_sounds
			JOIN embeddings.passages ON passages.id = passages_sounds.rowid
			WHERE passages_sounds MATCH ? AND ${ownsPassage} ORDER BY bm25(passages_sounds) LIMIT ${MAX_WORD_MATCHES}`,
		)
		const sounds = new Set(heard)
		const inOrder =
			heard.length > 1 && letters >= SOUNDS_TO_TRUST
				? (sounding.all(`"${heard.join(' ')}"`, accountId) as PassageRow[])
				: []
		const sayers = new Set(inOrder.map(({hash}) => hash.toString('hex'))).size
		for (const row of inOrder) {
			const strength = rarer(PHRASE * SAID, SAID, sayers)
			keep(row.hash, {...passageHit(row, true, strength), shown: () => snippet(row.text, sounds)})
		}
		const anywhere = sounding.all(heard.map((sound) => `"${sound}"`).join(' '), accountId) as PassageRow[]
		for (const [index, row] of anywhere.entries()) {
			const likeness = means(MIN_PASSAGE_SIMILARITY + SOUNDS_ALIKE * (1 - index / anywhere.length))
			keep(row.hash, {...passageHit(row, false, likeness), shown: () => snippet(row.text, sounds)})
		}
	}
	// A number or a code is not something a picture shows or a passage is
	// about: what was typed is only held against what things are like when
	// there is a word in it
	if (embedding && terms.some((term) => !/\p{N}/u.test(term))) {
		// Every kind of embedding is held against what was typed the same way
		// (see rough-vectors.ts), and what is over its bar is then read
		const kept = roughVectors(database)
		// A view of Photos is the asker's already
		const own = only ? undefined : ownFiles(database, accountId)
		const within = (kind: 'vectors' | 'passages') => own && {keys: own.keys, after: own.after[kind]}
		const passage = database.prepare(
			`SELECT hash, kind, at_ms, end_ms, page, text FROM embeddings.passages WHERE id = ?`,
		)
		const close = kept.passages
			.compare(database, embedding, {bar: MIN_PASSAGE_SIMILARITY, only, within: within('passages')})
			.filter(({hash}) => owned.get(hash, accountId))
		const best = close.reduce((best, {score}) => Math.max(best, score), 0)
		for (const {id, score} of close) {
			if (score < best - PASSAGE_WINDOW) continue
			const row = passage.get(id) as PassageRow | undefined
			if (row) keep(row.hash, {...passageHit(row, false, means(score)), shown: () => snippet(row.text, [])})
		}
		// A video is as good a match as its best frame, and is where that frame is
		const moment = database.prepare('SELECT at_ms FROM embeddings.vectors WHERE rowid = ?').pluck()
		const shown = kept.vectors.compare(database, embedding, {bar: MIN_SIMILARITY, only, within: within('vectors')})
		for (const {id, hash, score} of shown) {
			const at = moment.get(id) as number | null | undefined
			keep(hash, {match: 'visual', exact: false, strength: looks(score), ...(at == null ? {} : {atMs: at})})
		}
	}
	// What is shown is the strongest reason. How sure it is goes by the
	// strongest of each kind together, and for words in a document or a
	// recording by how many of its passages have them.
	const hits = new Map<string, ContentHit>()
	for (const [key, found] of reasons) {
		let unsure = 1
		for (const match of ['text', 'speech', 'visual'] as const) {
			const kind = found.filter((reason) => reason.match === match)
			if (kind.length === 0) continue
			const strongest = Math.max(...kind.map(({strength}) => strength))
			const more = new Set(kind.flatMap(({exact, passage}) => (exact && passage ? [passage] : []))).size
			unsure *= (1 - strongest) * MORE_PASSAGES ** Math.min(4, Math.max(0, more - 1))
		}
		const {shown, passage, ...best} = found.reduce((best, reason) => (reason.strength > best.strength ? reason : best))
		const snippet = shown?.()
		hits.set(key, {...best, strength: 1 - unsure, ...(snippet ? {snippet} : {})})
	}
	return hits
}

// Best first: by how sure each is
export function rankHits<T extends {hit: ContentHit}>(found: T[]) {
	return found.sort((first, second) => second.hit.strength - first.hit.strength)
}

// What the models found in one content, for whoever is looking at it: the
// text read off a picture or out of a document, where each line of a
// picture's is (its four corners from the top left, clockwise, as fractions
// of the picture), and what is said in a recording
export function contentInsights(database: Database, hash: Buffer) {
	const rows = database
		.prepare(
			`SELECT kind, at_ms, end_ms, x, y, width, height, text FROM embeddings.passages
			WHERE hash = ? ORDER BY kind, seq`,
		)
		.all(hash) as Array<PassageRow & {x: number | null; y: number | null; width: number | null; height: number | null}>
	const written = rows.filter(({kind}) => kind !== 'speech')
	const lines = written.filter(({kind}) => kind === 'picture')
	const said = rows.filter(({kind}) => kind === 'speech')
	return {
		...(written.length > 0 ? {text: written.map(({text}) => text).join('\n')} : {}),
		...(lines.length > 0 && lines.length === written.length
			? {
					textQuads: lines.map(({x, y, width, height}) => {
						const [left, top, right, bottom] = [x!, y!, x! + width!, y! + height!]
						return [left, top, right, top, right, bottom, left, bottom]
					}),
				}
			: {}),
		...(said.length > 0
			? {transcript: said.map(({at_ms, end_ms, text}) => ({startMs: at_ms ?? 0, endMs: end_ms ?? 0, text}))}
			: {}),
	}
}
