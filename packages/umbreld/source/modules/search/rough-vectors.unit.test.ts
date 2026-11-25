import {createHash} from 'node:crypto'
import nodeOs from 'node:os'
import nodePath from 'node:path'

import BetterSqlite3 from 'better-sqlite3'
import fse from 'fs-extra'
import {afterAll, beforeAll, expect, test} from 'vitest'

import {embeddingSimilarity} from '../files/embeddings.ts'
import EmbeddingsStore from '../files/embeddings-store.ts'

import RoughVectors, {fileKey} from './rough-vectors.ts'

// A store of embeddings that point in every direction, read as a search reads it
let directory: string
let store: EmbeddingsStore
let database: BetterSqlite3.Database
let seed = 1
const random = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31) * 2 - 1
const anything = () => Float32Array.from({length: 768}, random)
// What the store keeps of an embedding: a byte for each number
const stored = (embedding: Float32Array) => Int8Array.from(embedding, (value) => Math.round(value * 127))
// Something `likeness` like what is typed: so much of it, and the rest anything
const like = (typed: Float32Array, likeness: number) => {
	const other = anything()
	return stored(Float32Array.from(typed, (value, index) => likeness * value + (1 - likeness) * other[index]!))
}
// A file is known by the hash of what is in it
const names = new Map<string, string>()
const hash = (name: string) => {
	const hashed = createHash('sha256').update(name).digest()
	names.set(hashed.toString('hex'), name)
	return hashed
}
const name = (found: Buffer) => names.get(found.toString('hex'))!
const typed = anything()

// Every file over the bar, by comparing every embedding in full
function everything(bar: number) {
	const found = new Map<string, number>()
	const rows = database.prepare('SELECT hash, embedding FROM embeddings.vectors').all() as Array<{
		hash: Buffer
		embedding: Buffer
	}>
	for (const row of rows) {
		const score = embeddingSimilarity(typed, new Int8Array(row.embedding.buffer, row.embedding.byteOffset, 768))
		if (score >= bar) found.set(name(row.hash), Math.max(score, found.get(name(row.hash)) ?? 0))
	}
	return found
}

// ... and by comparing in full only what the rough pass picks
function picked(rough: RoughVectors, options?: {files?: number; perFile?: number}, bar = 0.5) {
	const row = database.prepare('SELECT hash, embedding FROM embeddings.vectors WHERE rowid = ?')
	const found = new Map<string, number>()
	for (const id of rough.candidates(typed, options)) {
		const at = row.get(id) as {hash: Buffer; embedding: Buffer} | undefined
		if (!at) continue
		const score = embeddingSimilarity(typed, new Int8Array(at.embedding.buffer, at.embedding.byteOffset, 768))
		if (score >= bar) found.set(name(at.hash), Math.max(score, found.get(name(at.hash)) ?? 0))
	}
	return found
}

beforeAll(async () => {
	directory = await fse.mkdtemp(nodePath.join(nodeOs.tmpdir(), 'rough-'))
	store = new EmbeddingsStore(nodePath.join(directory, 'embeddings.db'))
	// 3,000 photos of anything, 40 that are like what is typed to one degree or another ...
	for (let photo = 0; photo < 3000; photo++) store.set(hash(`photo ${photo}`), stored(anything()))
	for (let photo = 0; photo < 40; photo++) store.set(hash(`match ${photo}`), like(typed, 0.5 + photo / 100))
	// ... and a video of 200 moments, one of which is
	for (let frame = 0; frame < 200; frame++) {
		store.set(hash('video'), frame === 137 ? like(typed, 0.8) : stored(anything()), frame, frame * 1000)
	}
	database = new BetterSqlite3(':memory:')
	database.exec(`ATTACH DATABASE '${nodePath.join(directory, 'embeddings.db')}' AS embeddings`)
})

afterAll(async () => {
	database?.close()
	store?.close()
	await fse.remove(directory)
})

test('keeps nothing in memory for a library too small to need it', () => {
	const rough = new RoughVectors()
	expect(rough.refresh(database)).toBe(0)
	expect(rough.size).toBe(0)
})

test('finds what comparing everything finds, by comparing a fraction of it', () => {
	const rough = new RoughVectors()
	expect(rough.refresh(database, {from: 1000})).toBe(3240)
	const all = everything(0.5)
	expect(all.size).toBe(41)
	// A tenth of the files get a proper look, and nothing over the bar is missed
	const rows = rough.candidates(typed, {files: 300})
	expect(rows.length).toBeLessThan(600)
	expect(picked(rough, {files: 300})).toEqual(all)
	// In the order they are stored
	expect(rows).toEqual([...rows].sort((first, second) => first - second))
})

test('picks files, and of a file its embeddings that look best', () => {
	const rough = new RoughVectors()
	rough.refresh(database, {from: 1000})
	// The video's one moment that matches is among the few of its 200 that are read
	const rows = rough.candidates(typed, {files: 300, perFile: 5})
	const moments = database.prepare(`SELECT rowid FROM embeddings.vectors WHERE hash = ?`).pluck().all(hash('video'))
	expect(rows.filter((row) => moments.includes(row))).toHaveLength(5)
	expect(picked(rough, {files: 300, perFile: 5}).get('video')).toBeCloseTo(everything(0.5).get('video')!, 10)
	// With one file picked, it is the one most like what was typed, and only its own rows
	const [only] = [...picked(rough, {files: 1}, -1)].sort((first, second) => second[1] - first[1])
	expect(only![0]).toBe([...everything(0.5)].sort((first, second) => second[1] - first[1])[0]![0])
})

test('takes in what is added, and is not misled by what is removed', () => {
	const rough = new RoughVectors()
	rough.refresh(database, {from: 1000, now: 0})

	// Something new that matches is picked from the next search on
	store.set(hash('new'), like(typed, 0.9))
	expect(rough.refresh(database, {from: 1000, now: 1000})).toBe(3241)
	expect(picked(rough, {files: 300}).has('new')).toBe(true)

	// Something removed is still in memory for a while, and is found to be gone when it is read
	const writer = new BetterSqlite3(nodePath.join(directory, 'embeddings.db'))
	writer.prepare('DELETE FROM vectors WHERE hash = ?').run(hash('match 39'))
	expect(rough.refresh(database, {from: 1000, now: 2000})).toBe(3241)
	expect(picked(rough, {files: 300}).has('match 39')).toBe(false)
	expect(picked(rough, {files: 300})).toEqual(everything(0.5))

	// A row given to another file is read as that file, whatever was here before
	writer.prepare('DELETE FROM vectors WHERE hash = ?').run(hash('new'))
	store.set(hash('other'), like(typed, 0.95))
	rough.refresh(database, {from: 1000, now: 3000})
	expect(picked(rough, {files: 300})).toEqual(everything(0.5))
	expect(picked(rough, {files: 300}).has('other')).toBe(true)

	// ... and what is in memory is put right once it has waited
	expect(rough.refresh(database, {from: 1000, now: 60_000})).toBe(3240)
	expect(picked(rough, {files: 300})).toEqual(everything(0.5))
	writer.close()
})

test('goes through the passages of documents and of speech the same way, and not the lines read off pictures', () => {
	// 600 documents of 4 passages about anything; one whose third passage says what is typed; and the lines of a
	// picture, which have no embedding
	for (let document = 0; document < 600; document++) {
		const passages = Array.from({length: 4}, (_, page) => ({
			text: `page ${page}`,
			page: page + 1,
			embedding: stored(anything()),
		}))
		store.setPassages(hash(`document ${document}`), 'document', passages)
	}
	store.setPassages(
		hash('letter'),
		'document',
		Array.from({length: 40}, (_, page) => ({
			text: `page ${page}`,
			page: page + 1,
			embedding: page === 2 ? like(typed, 0.8) : stored(anything()),
		})),
	)
	store.setPassages(hash('talk'), 'speech', [{text: 'said', atMs: 0, endMs: 1000, embedding: like(typed, 0.7)}])
	store.setPassages(hash('sign'), 'picture', [{text: 'CAR WASH', box: {x: 0, y: 0, width: 1, height: 1}}])

	const rough = new RoughVectors('passages')
	expect(rough.refresh(database, {from: 1000})).toBe(600 * 4 + 40 + 1)
	const row = database.prepare('SELECT hash, page, embedding FROM embeddings.passages WHERE id = ?')
	const found = new Map<string, {score: number; page: number | null}>()
	const rows = rough.candidates(typed, {files: 60, perFile: 5})
	for (const id of rows) {
		const at = row.get(id) as {hash: Buffer; page: number | null; embedding: Buffer}
		const score = embeddingSimilarity(typed, new Int8Array(at.embedding.buffer, at.embedding.byteOffset, 768))
		if (score >= 0.5 && score > (found.get(name(at.hash))?.score ?? 0)) found.set(name(at.hash), {score, page: at.page})
	}
	// A tenth of the files, five passages of each: the two that say it are among them, the letter at its page
	expect(rows.length).toBeLessThanOrEqual(60 * 5)
	expect([...found.keys()].sort()).toEqual(['letter', 'talk'])
	expect(found.get('letter')!.page).toBe(3)
})

test('holds what was typed against every embedding one way, or against those of the files it is kept to', () => {
	const best = (compared: Array<{hash: Buffer; score: number}>) => {
		const found = new Map<string, number>()
		for (const {hash, score} of compared) found.set(name(hash), Math.max(score, found.get(name(hash)) ?? 0))
		return found
	}
	const all = everything(0.5)
	expect(all.size).toBeGreaterThan(30)

	// A small library: every embedding compared, and nothing kept in memory
	const rough = new RoughVectors()
	expect(best(rough.compare(database, typed, {bar: 0.5}))).toEqual(all)
	expect(rough.size).toBe(0)
	// A large one: roughly first, and the same found
	expect(best(rough.compare(database, typed, {bar: 0.5, from: 1000, files: 300}))).toEqual(all)
	expect(rough.size).toBeGreaterThan(3000)

	// Kept to a few files, theirs are all compared and nobody else's
	const few = ['match 3', 'match 30', 'photo 7', 'video'].map(hash)
	expect([...best(rough.compare(database, typed, {bar: 0.5, only: few})).keys()].sort()).toEqual([
		'match 3',
		'match 30',
		'video',
	])
	expect(best(rough.compare(database, typed, {bar: 0.5, only: few})).get('video')).toBeCloseTo(all.get('video')!, 10)
	expect(rough.compare(database, typed, {bar: 0.5, only: []})).toEqual([])

	// Kept to more files than are looked at in full, the rough pass is of those files alone
	const many = [
		...Array.from({length: 2000}, (_, photo) => hash(`photo ${photo}`)),
		...['match 5', 'match 25', 'video'].map(hash),
	]
	const within = best(rough.compare(database, typed, {bar: 0.5, only: many, from: 1000, files: 300}))
	expect([...within.keys()].sort()).toEqual(['match 25', 'match 5', 'video'])
	expect(within.get('match 25')).toBeCloseTo(all.get('match 25')!, 10)
})

test('keeps to a list of files kept from before, and to whatever was stored after it was made', () => {
	const rough = new RoughVectors()
	const found = (options: {within?: {keys: Set<number>; after: number}; from?: number; files?: number}) =>
		[...new Set(rough.compare(database, typed, {bar: 0.5, ...options}).map(({hash}) => name(hash)))].sort()
	const all = everything(0.5)
	expect(all.has('match 20') && all.has('match 22')).toBe(true)

	// Of everyone's files, the five that look best get the full look, and these two are not among them
	expect(found({from: 1000, files: 5})).not.toContain('match 20')
	// Of the files of someone who has these two and a photo of something else, they are
	const within = {
		keys: new Set(['match 20', 'match 22', 'photo 3'].map((file) => fileKey(hash(file)))),
		after: rough.newest(database),
	}
	expect(found({within, from: 1000, files: 5})).toEqual(['match 20', 'match 22'])

	// What is stored after the list was made is not on it, and is looked at all the same
	store.set(hash('arrival'), like(typed, 0.9))
	expect(found({within, from: 1000, files: 5})).toEqual(['arrival', 'match 20', 'match 22'])
	// ... as in a library small enough to compare every embedding of
	expect(
		[...new Set(new RoughVectors().compare(database, typed, {bar: 0.5, within}).map(({hash}) => name(hash)))].sort(),
	).toEqual(['arrival', 'match 20', 'match 22'])
})
