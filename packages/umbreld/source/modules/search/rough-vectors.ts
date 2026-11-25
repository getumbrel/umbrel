import type {Database} from 'better-sqlite3'

import {embeddingSimilarity} from '../files/embeddings.ts'

// What was typed is held against the embeddings the models have made in one
// way, whatever they are of: what photos and video frames show, or what
// passages of documents and of speech say (see `compare`). It can be kept to
// the embeddings of some files, as a search of an album is.
//
// Where there are many, they are gone through twice. First roughly: what was
// typed is held against a small part of every embedding that is kept in
// memory (30 MB for a hundred thousand, with which file each is of). Then the
// embeddings of the files that picks are read from the database and compared
// in full, as every one of them used to be. What a result scores is exactly
// what it scored before: the rough pass only decides which files get the look.
//
// What was typed is not made smaller itself, which tells far more. How each
// number below was measured is on the pull request that added this.
const DIMENSIONS = 768
// What is kept of an embedding: the first 512 of its numbers, at 4 bits each.
// The first numbers say most of what all of them do, and 16 steps place one
// nearly as well as the 256 it is stored in. Of 24 ways to keep one, from a
// bit of every number to every number whole, this found the most for its
// size: every one of a search's best 1,000 among 930,000 photos and frames,
// and 99.97% among 376,000 passages, where a bit of every number found 98.7%
// and 98.5%.
const KEPT_NUMBERS = 512
const CODE_BYTES = KEPT_NUMBERS / 2
// A number is kept as which of 16 steps it is nearest, each three eighths of
// what a number of that embedding usually is
const STEP = 0.375
const step = (value: number) => Math.max(0, Math.min(15, Math.floor(value / STEP + 8)))
const stands = (code: number) => (code - 7.5) * STEP
// How many files get the look. With 10,000, 120 searches of a library of
// 93,000 embeddings each found every one of their results, and searches of
// 376,000 passages 99.97% of their best 1,000; with 5,000, 99.66% of those.
export const ROUGH_FILES = 10_000
// ... and how many of one file's embeddings, the ones that look best: a video
// has one for each of many moments. With 20 every video over the bar was
// found in 24 searches; with 5, one in fifty was not.
export const ROUGH_PER_FILE = 20
// Fewer embeddings than this are as quick to compare one by one, with nothing
// kept in memory: the files picked would be most of them
export const ROUGH_FROM = 20_000
// Something removed leaves a part here that belongs to nothing, which costs a
// look that finds nothing. They are cleared out no more often than this.
const REBUILD_WAIT_MS = 30_000

type Row = [id: number, hash: Buffer, embedding: Buffer]

// An embedding that is like what was typed: which row it is, the file it is
// of, and how like, as the cosine of the two in full
export type Compared = {id: number; hash: Buffer; score: number}

// A file, by the start of its hash: files are told apart by 48 bits of 256
export const fileKey = (hash: Buffer) => hash.readUIntBE(0, 6)

// The files a comparison is kept to when they are too many to read one by
// one: which they are, and the row after which whatever was stored is newer
// than the list of them and is looked at whoever's it is
export type Within = {keys: Set<number>; after: number}

// Where a kind of embedding is kept: the table, what numbers its rows, and
// which of its rows have one
const KEPT = {
	// What photos and video frames show
	vectors: {table: 'embeddings.vectors', id: 'rowid', having: ''},
	// What passages of documents and of speech say. The lines read off a
	// picture are passages too, with no embedding.
	passages: {table: 'embeddings.passages', id: 'id', having: 'embedding IS NOT NULL'},
}

export default class RoughVectors {
	#kept: (typeof KEPT)[keyof typeof KEPT]

	constructor(kind: keyof typeof KEPT = 'vectors') {
		this.#kept = KEPT[kind]
	}

	// What is kept of each embedding, and how long what that stands for is
	#codes = new Uint8Array(0)
	#lengths = new Float32Array(0)
	// The row each embedding is, and which file it is of
	#rows = new Float64Array(0)
	#files = new Int32Array(0)
	#size = 0
	// A file's number, by its key
	#fileNumbers = new Map<number, number>()
	// What the store was when this was last put right, and the last row seen
	#version?: number
	#last = 0
	#rebuiltAt = 0

	get size() {
		return this.#size
	}

	// Every embedding of this kind that is at least `bar` like what was typed,
	// or only those of the files in `only`, or `within` a list of files kept
	// from before. A few files' embeddings are read and compared, every one.
	// So is a small library's. A large one is gone through roughly first (see
	// the top of this file), within those files if any were given, and what
	// that picks is compared the same way.
	compare(
		database: Database,
		query: Float32Array,
		{
			bar,
			only,
			within,
			files = ROUGH_FILES,
			perFile = ROUGH_PER_FILE,
			from,
			now,
		}: {
			bar: number
			only?: Buffer[]
			within?: Within
			files?: number
			perFile?: number
			from?: number
			now?: number
		},
	) {
		const {table, id, having} = this.#kept
		const found: Compared[] = []
		const hold = (row: number, hash: Buffer, embedding: Buffer) => {
			const stored = new Int8Array(embedding.buffer, embedding.byteOffset, embedding.length)
			const score = embeddingSimilarity(query, stored)
			if (score >= bar) found.push({id: row, hash, score})
		}
		const rows = `SELECT ${id}, hash, embedding FROM ${table}`
		if (only && only.length <= files) {
			const of = database.prepare(`${rows} WHERE hash = ? ${having && `AND ${having}`}`).raw()
			for (const hash of only) for (const row of of.iterate(hash) as IterableIterator<Row>) hold(...row)
			return found
		}
		const among = within ?? (only && {keys: new Set(only.map(fileKey)), after: Infinity})
		const may = (row: Row) => !among || row[0] > among.after || among.keys.has(fileKey(row[1]))
		if (this.refresh(database, {from, now}) === 0) {
			const all = database.prepare(`${rows} ${having && `WHERE ${having}`}`).raw()
			for (const row of all.iterate() as IterableIterator<Row>) if (may(row)) hold(...row)
			return found
		}
		const one = database.prepare(`${rows} WHERE ${id} = ? ${having && `AND ${having}`}`).raw()
		for (const picked of this.candidates(query, {files, perFile, allowed: among})) {
			// What is there now, whatever was when it was picked
			const row = one.get(picked) as Row | undefined
			if (row && may(row)) hold(...row)
		}
		return found
	}

	// The row stored last, of all there are of this kind
	newest(database: Database) {
		const {table, id} = this.#kept
		return database.prepare(`SELECT COALESCE(MAX(${id}), 0) FROM ${table}`).pluck().get() as number
	}

	// Brings what is in memory up to what the store has, and says how many
	// embeddings that is: none for a library too small to need it.
	refresh(database: Database, {from = ROUGH_FROM, now = Date.now()} = {}) {
		// Changes whenever anyone else writes to the store
		const version = database.pragma('embeddings.data_version', {simple: true}) as number
		if (version === this.#version) return this.#size
		const {table, id, having} = this.#kept
		const {count, last} = database
			.prepare(`SELECT COUNT(*) AS count, COALESCE(MAX(${id}), 0) AS last FROM ${table} ${having && `WHERE ${having}`}`)
			.get() as {count: number; last: number}
		if (count < from) {
			this.#clear()
			// Asked again while it stays this small: it is one quick count
			this.#version = undefined
			return 0
		}
		if (last > this.#last) {
			if (this.#size === 0) this.#reserve(count)
			const added = database
				.prepare(
					`SELECT ${id}, hash, embedding FROM ${table} WHERE ${id} > ? ${having && `AND ${having}`} ORDER BY ${id}`,
				)
				.raw()
				.iterate(this.#last) as IterableIterator<Row>
			for (const row of added) this.#add(...row)
		}
		// More here than there: something was removed, and its part is still
		// here. They do no harm (see candidates), so they wait. Fewer, with
		// nothing new: a passage that was already there has its embedding now
		// (see nextUnembedded in the store), and is found by it after the wait.
		if (this.#size !== count && now - this.#rebuiltAt >= REBUILD_WAIT_MS) {
			this.#clear()
			this.#reserve(count)
			const all = database
				.prepare(`SELECT ${id}, hash, embedding FROM ${table} ${having && `WHERE ${having}`} ORDER BY ${id}`)
				.raw()
				.iterate() as IterableIterator<Row>
			for (const row of all) this.#add(...row)
			this.#rebuiltAt = now
		}
		// Left to be looked at again while parts of what is gone remain
		this.#version = this.#size === count ? version : undefined
		return this.#size
	}

	#clear() {
		this.#codes = new Uint8Array(0)
		this.#lengths = new Float32Array(0)
		this.#rows = new Float64Array(0)
		this.#files = new Int32Array(0)
		this.#size = 0
		this.#fileNumbers.clear()
		this.#last = 0
	}

	// Room for this many embeddings, and what is here carried over
	#reserve(room: number) {
		const grown = <T extends Uint8Array | Float64Array | Float32Array | Int32Array>(from: T, to: T) => (
			to.set(from), to
		)
		this.#codes = grown(this.#codes.subarray(0, this.#size * CODE_BYTES), new Uint8Array(room * CODE_BYTES))
		this.#lengths = grown(this.#lengths.subarray(0, this.#size), new Float32Array(room))
		this.#rows = grown(this.#rows.subarray(0, this.#size), new Float64Array(room))
		this.#files = grown(this.#files.subarray(0, this.#size), new Int32Array(room))
	}

	#add(id: number, hash: Buffer, embedding: Buffer) {
		if (embedding.length !== DIMENSIONS) return
		// A library that is growing is given an eighth more room each time it runs out
		if (this.#size === this.#rows.length) this.#reserve(Math.max(1024, this.#size + (this.#size >> 3)))
		// A stored number is a signed byte
		const number = (index: number) => (embedding[index]! << 24) >> 24
		let squares = 0
		for (let index = 0; index < KEPT_NUMBERS; index++) squares += number(index) ** 2
		const usual = Math.sqrt(squares / KEPT_NUMBERS) || 1
		// Two numbers to a byte
		let stood = 0
		for (let index = 0, at = this.#size * CODE_BYTES; index < KEPT_NUMBERS; index += 2, at++) {
			const first = step(number(index) / usual)
			const second = step(number(index + 1) / usual)
			this.#codes[at] = first | (second << 4)
			stood += stands(first) ** 2 + stands(second) ** 2
		}
		this.#lengths[this.#size] = Math.sqrt(stood) || 1
		const file = fileKey(hash)
		let of = this.#fileNumbers.get(file)
		if (of === undefined) this.#fileNumbers.set(file, (of = this.#fileNumbers.size))
		this.#rows[this.#size] = id
		this.#files[this.#size] = of
		this.#last = Math.max(this.#last, id)
		this.#size++
	}

	// The rows worth comparing in full with what was typed: of the `files`
	// files whose best embedding looks most like it, the `perFile` embeddings
	// of each that look best, in the order they are stored. A row named here
	// may have gone since, or be another file's now: whoever reads it takes
	// what is there. With `allowed`, only files with those keys are picked,
	// and the files of whatever was stored after the list of them was made.
	candidates(
		query: Float32Array,
		{files = ROUGH_FILES, perFile = ROUGH_PER_FILE, allowed}: {files?: number; perFile?: number; allowed?: Within} = {},
	) {
		const size = this.#size
		// Which files may be picked, by their number
		let may: Uint8Array | undefined
		if (allowed) {
			may = new Uint8Array(this.#fileNumbers.size)
			// Whichever is fewer is gone through: the files allowed, or the files here
			if (allowed.keys.size <= this.#fileNumbers.size) {
				for (const key of allowed.keys) {
					const number = this.#fileNumbers.get(key)
					if (number !== undefined) may[number] = 1
				}
			} else {
				for (const [key, number] of this.#fileNumbers) if (allowed.keys.has(key)) may[number] = 1
			}
			// Rows are kept in the order they were stored
			for (let row = size - 1; row >= 0 && this.#rows[row]! > allowed.after; row--) may[this.#files[row]!] = 1
		}
		const rough = new Float32Array(size)
		const best = new Float32Array(this.#fileNumbers.size).fill(-Infinity)
		// For each byte kept, what every value of it adds up to for what was
		// typed: an embedding is then one look-up for each byte
		const table = new Float32Array(CODE_BYTES * 256)
		for (let byte = 0; byte < CODE_BYTES; byte++) {
			for (let value = 0; value < 256; value++) {
				table[(byte << 8) | value] = query[byte * 2]! * stands(value & 15) + query[byte * 2 + 1]! * stands(value >> 4)
			}
		}
		const codes = this.#codes
		for (let row = 0, at = 0; row < size; row++, at += CODE_BYTES) {
			const file = this.#files[row]!
			if (may && may[file] === 0) continue
			let sum = 0
			for (let byte = 0; byte < CODE_BYTES; byte++) sum += table[(byte << 8) | codes[at + byte]!]!
			// As a share of how long what is kept is, so that none looks more like it for being longer
			const like = sum / this.#lengths[row]!
			rough[row] = like
			if (like > best[file]!) best[file] = like
		}
		// What the least of the files picked looks like
		const least = best.length > files ? Float32Array.from(best).sort()[best.length - files]! : -Infinity
		const picked = new Map<number, number[]>()
		for (let row = 0; row < size; row++) {
			const file = this.#files[row]!
			if (best[file]! < least || (may && may[file] === 0)) continue
			const of = picked.get(file)
			if (of) of.push(row)
			else picked.set(file, [row])
		}
		const rows: number[] = []
		for (const of of picked.values()) {
			if (of.length > perFile) of.sort((first, second) => rough[second]! - rough[first]!).length = perFile
			for (const row of of) rows.push(this.#rows[row]!)
		}
		return rows.sort((first, second) => first - second)
	}
}
