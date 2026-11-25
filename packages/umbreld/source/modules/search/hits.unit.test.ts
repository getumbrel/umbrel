import nodeOs from 'node:os'
import nodePath from 'node:path'

import BetterSqlite3 from 'better-sqlite3'
import fse from 'fs-extra'
import {afterAll, beforeAll, expect, test, vi} from 'vitest'

import EmbeddingsStore from '../files/embeddings-store.ts'

import {contentHits, rankHits} from './hits.ts'
import {nameStrength} from './names.ts'

// What the models have read of a few files that are all one account's
let directory: string
let database: BetterSqlite3.Database
const hash = (name: string) => Buffer.from(name.padEnd(32, ' '))
const box = {x: 0, y: 0, width: 1, height: 0.1}
// What a picture shows, as like what is typed (see `typed`) as `similarity` says
const shows = (similarity: number) =>
	Int8Array.from({length: 768}, (_, index) =>
		Math.round(127 * (index === 0 ? similarity : index === 1 ? Math.sqrt(1 - similarity ** 2) : 0)),
	)
const typed = Float32Array.from({length: 768}, (_, index) => (index === 0 ? 1 : 0))
const page = (words: number, ...among: string[]) =>
	[...among, ...Array.from({length: words - among.length}, () => 'lorem')].join(' ')

beforeAll(async () => {
	directory = await fse.mkdtemp(nodePath.join(nodeOs.tmpdir(), 'hits-'))
	const store = new EmbeddingsStore(nodePath.join(directory, 'embeddings.db'))
	const pictures: Record<string, string[]> = {
		// A receipt, with what was bought and where on different lines
		receipt: ['Coffee and cake', 'Total 7.50', 'Berlin Hauptbahnhof'],
		// ... and a sign with both on one
		sign: ['Coffee in Berlin'],
		menu: ['Catalogue of cakes'],
		poster: ['Lost cat'],
		shirt: ['東京タワー', 'Coffee'],
		// A sign that is about a car, and screenshots of pages that mention one,
		// as a library has many of. One has an order's number on it too.
		carwash: ['CAR WASH'],
		screenshot: [page(60, 'the', 'car'), page(40, 'order', '8420921596')],
		...Object.fromEntries(Array.from({length: 30}, (_, index) => [`page ${index}`, [page(100, 'a', 'car')]])),
		// A photo of a car with a number plate, and one of an apple with a sticker on it
		plate: ['B MW 1234'],
		sticker: ['Apple', 'New Zealand'],
	}
	for (const [name, lines] of Object.entries(pictures)) {
		store.setPassages(
			hash(name),
			'picture',
			lines.map((text) => ({text, box})),
		)
	}
	// Photos by how like what is typed they look: clearly, barely, and not
	for (const [name, similarity] of Object.entries({
		plate: 0.75,
		sticker: 0.75,
		clearly: 0.75,
		barely: 0.705,
		not: 0.6,
	})) {
		store.set(hash(name), shows(similarity))
	}
	store.setPassages(hash('letter'), 'document', [
		{text: 'The invoice is attached.', page: 1},
		{text: 'Berlin, in May', page: 2},
	])
	store.setPassages(hash('book'), 'document', [
		{text: page(200, 'apple'), page: 1},
		{text: page(200, 'apple'), page: 2},
		{text: page(200, 'apple'), page: 3},
	])
	store.setPassages(hash('note'), 'document', [{text: page(200, 'apple'), page: 1}])
	store.setPassages(hash('memo'), 'speech', [{text: 'the cat sat on the invoice', atMs: 0, endMs: 2000}])
	store.close()

	database = new BetterSqlite3(':memory:')
	database.exec(`
		ATTACH DATABASE '${nodePath.join(directory, 'embeddings.db')}' AS embeddings;
		CREATE TABLE contents (id INTEGER PRIMARY KEY, blake3 BLOB NOT NULL);
		CREATE TABLE index_roots (id INTEGER PRIMARY KEY, owner_id TEXT NOT NULL);
		CREATE TABLE entries (content_id INTEGER NOT NULL, root_id INTEGER NOT NULL);
		INSERT INTO index_roots VALUES (1, 'owner'), (2, 'someone else');
	`)
	for (const name of [...Object.keys(pictures), 'clearly', 'barely', 'not', 'letter', 'book', 'note', 'memo']) {
		const {lastInsertRowid} = database.prepare('INSERT INTO contents(blake3) VALUES (?)').run(hash(name))
		database.prepare('INSERT INTO entries VALUES (?, 1)').run(lastInsertRowid)
	}
})

afterAll(async () => {
	database?.close()
	await fse.remove(directory)
})

// What is found for what was typed, surest first: by its words alone, or also by what it is like
function hits(
	text: string,
	{looks = false, accountId = 'owner', only}: {looks?: boolean; accountId?: string; only?: Buffer[]} = {},
) {
	const found = [...contentHits(database, accountId, text, looks ? typed : undefined, text, only)].map(
		([key, hit]) => ({
			name: Buffer.from(key, 'hex').toString().trim(),
			hit,
		}),
	)
	return rankHits(found)
}
const found = (...asked: Parameters<typeof hits>) => hits(...asked).map(({name}) => name)
const strength = (name: string, ...asked: Parameters<typeof hits>) =>
	hits(...asked).find((hit) => hit.name === name)!.hit.strength

test('is surer of words the more of a text they are, where many things have them', () => {
	// The sign is about a car. The pages only mention one.
	expect(found('car')[0]).toBe('carwash')
	expect(found('car')).toHaveLength(32)
	expect(strength('carwash', 'car')).toBeGreaterThan(0.8)
	expect(strength('screenshot', 'car')).toBeLessThan(0.5)
})

test('puts a photo that clearly shows what was typed above a text that mentions it, and a sign about it above both', () => {
	expect(found('car', {looks: true}).slice(0, 4)).toEqual(['carwash', 'plate', 'sticker', 'clearly'])
	// ... and one that only just looks like one is no surer than a page that mentions it
	expect(strength('barely', 'car', {looks: true})).toBeLessThan(0.5)
	// One that does not look like it is not found at all
	expect(found('car', {looks: true})).not.toContain('not')
})

test('looks for what is like what was typed only among the files a search is kept to', () => {
	// An album with one photo of a car in it, and one of something else
	const album = [hash('clearly'), hash('not')]
	const found = hits('car', {looks: true, only: album}).filter(({hit}) => hit.match === 'visual')
	expect(found.map(({name}) => name)).toEqual(['clearly'])
})

test('is sure of the one thing that has what was typed, however much else is written on it', () => {
	// The number is one word of a hundred on one picture
	expect(found('8420921596')).toEqual(['screenshot'])
	expect(strength('screenshot', '8420921596')).toBeGreaterThan(0.85)
	// ... and a number is not held against what pictures look like
	expect(found('8420921596', {looks: true})).toEqual(['screenshot'])
	expect(found('order 8420921596', {looks: true})[0]).toBe('screenshot')
})

test('adds up the reasons there are for one thing', () => {
	// An apple with "Apple" written on it, over one that only looks like one
	const [first] = hits('apple', {looks: true})
	expect(first!.name).toBe('sticker')
	expect(first!.hit.strength).toBeGreaterThan(strength('clearly', 'apple', {looks: true}))
	// A document that says it on three pages, over one that says it on one
	expect(strength('book', 'apple')).toBeGreaterThan(strength('note', 'apple'))
})

test('finds a picture by words that are on different lines of it, after one with them on a line', () => {
	expect(found('coffee berlin')).toEqual(['sign', 'receipt'])
	// Every word has to be on the picture
	expect(found('coffee berlin cake')).toEqual(['receipt'])
	expect(found('coffee berlin tea')).toEqual([])
	// ... whichever script each is in
	expect(found('coffee 東京')).toEqual(['shirt'])
})

test('finds a picture by its words however many, or however often, they are typed', () => {
	// The same two words over and over are still the two that are on the receipt
	expect(found(`${'coffee berlin '.repeat(300)}cake`)).toEqual(['receipt'])
	// More words than can be looked for together are looked for as far as that goes
	const many = Array.from({length: 600}, (_, index) => `word${index}`).join(' ')
	expect(found(`coffee berlin ${many}`)).toEqual([])
})

test('shows a picture found that way by all that is written on it', () => {
	const [, {hit}] = hits('coffee berlin')
	expect(hit).toMatchObject({
		match: 'text',
		exact: true,
		snippet: {text: 'Coffee and cake Total 7.50 Berlin Hauptbahnhof'},
	})
	expect(hit.snippet!.highlights).toEqual([
		[0, 6],
		[27, 33],
	])
})

test('does not put together the passages of a document', () => {
	// "invoice" is on the letter's first page and "Berlin" on its second
	expect(found('invoice berlin')).toEqual([])
})

test('finds words whole, not what only starts with them', () => {
	expect(found('cat')).toEqual(['poster', 'memo'])
	expect(found('invo')).toEqual([])
	expect(found('coffee berl')).toEqual([])
})

test("finds nothing of someone else's", () => {
	expect(found('coffee berlin', {accountId: 'someone else'})).toEqual([])
	expect(found('invoice', {accountId: 'someone else'})).toEqual([])
})

test('is surer of a name the more of it was typed', () => {
	expect(nameStrength('car', 'car.jpg')).toBe(1)
	expect(nameStrength('red car', 'Red Car.PNG')).toBe(1)
	const [short, long] = [nameStrength('car', 'red car.png'), nameStrength('car', 'car insurance renewal 2024.pdf')]
	expect(short).toBeGreaterThan(long)
	expect(long).toBeGreaterThan(nameStrength('car', 'carpet.pdf'))
	expect(nameStrength('car', 'carpet.pdf')).toBeGreaterThan(nameStrength('car', 'oscar.png'))
	expect(nameStrength('car', 'oscar.png')).toBeGreaterThan(0)
	expect(nameStrength('car', 'boat.jpg')).toBe(0)
})

test('is nearly as sure of a name that was typed with a slip of the fingers', () => {
	// The whole name but for two letters the wrong way round
	const slipped = nameStrength('minuets', 'minutes.docx', true)
	expect(slipped).toBeGreaterThan(0.5)
	expect(slipped).toBeLessThan(nameStrength('minutes', 'minutes.docx'))
	// ... over one word of a longer name
	expect(slipped).toBeGreaterThan(nameStrength('minuets', 'minutes of the March meeting.docx', true))
	// A name that only starts like what was typed is a weak reason
	expect(nameStrength('sampel', 'SampleDoc.pdf', true)).toBeLessThan(0.35)
})

test('looks for what things are like among the files of the one asking, from a list of them kept half a minute', () => {
	vi.useFakeTimers()
	try {
		const theirs = () => found('something to see', {looks: true, accountId: 'someone else'})
		const give = (name: string) => {
			const id =
				(database.prepare('SELECT id FROM contents WHERE blake3 = ?').pluck().get(hash(name)) as number | undefined) ??
				database.prepare('INSERT INTO contents(blake3) VALUES (?)').run(hash(name)).lastInsertRowid
			database.prepare('INSERT INTO entries VALUES (?, 2)').run(id)
		}
		// The photos here are the owner's, and someone with none of them is shown none
		expect(found('something to see', {looks: true})).toEqual(expect.arrayContaining(['clearly', 'barely']))
		expect(theirs()).toEqual([])

		// A copy of one that was here already is theirs from the next list of their files on
		give('clearly')
		expect(theirs()).toEqual([])
		vi.advanceTimersByTime(30_000)
		expect(theirs()).toEqual(['clearly'])

		// A photo that arrives is found at once: what is stored after the list was made is looked at too
		const store = new EmbeddingsStore(nodePath.join(directory, 'embeddings.db'))
		store.set(hash('arrival'), shows(0.75))
		store.close()
		give('arrival')
		expect(theirs().sort()).toEqual(['arrival', 'clearly'])
	} finally {
		vi.useRealTimers()
	}
})
