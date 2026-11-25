import {describe, expect, it} from 'vitest'

import {folderTrail, formatMoment} from './format'
import {refinesQuery} from './refine'
import {matchReason} from './search-match-line'
import {hasHighlight, markTerms, snippetSegments, snippetTerms} from './snippet'
import {searchLearning, searchWork} from './status'
import type {SearchResult, SearchStatus} from './types'

const plain = (text: string) => ({text, highlighted: false})
const hit = (text: string) => ({text, highlighted: true})

describe('snippetSegments', () => {
	it('splits a snippet into plain and highlighted runs', () => {
		expect(snippetSegments({text: 'IKEA receipt, Berlin', highlights: [[0, 4]]})).toEqual([
			hit('IKEA'),
			plain(' receipt, Berlin'),
		])
		expect(
			snippetSegments({
				text: 'Total at IKEA: receipt 42',
				highlights: [
					[9, 13],
					[15, 22],
				],
			}),
		).toEqual([plain('Total at '), hit('IKEA'), plain(': '), hit('receipt'), plain(' 42')])
	})

	it('returns the whole text when nothing is highlighted', () => {
		expect(snippetSegments({text: 'Just words', highlights: []})).toEqual([plain('Just words')])
	})

	it('opens near the first highlight, at a word boundary, behind an ellipsis', () => {
		const text = 'Thank you for shopping with us today. Please transfer to IBAN DE89 3704 0044 0532 0130 00 soon'
		const start = text.indexOf('DE89')
		const segments = snippetSegments({text, highlights: [[start, start + 27]]})
		expect(segments).toEqual([plain('…Please transfer to IBAN '), hit('DE89 3704 0044 0532 0130 00'), plain(' soon')])
		// The match starts within the lead a truncated line can show
		expect(segments[0].text.length).toBeLessThanOrEqual(29)
	})

	it('cuts mid-word rather than give up most of the lead to one long word', () => {
		const text = `${'a'.repeat(60)} match`
		const segments = snippetSegments({text, highlights: [[61, 66]]})
		expect(segments).toEqual([plain(`…${'a'.repeat(27)} `), hit('match')])
	})

	it('keeps a few words after the first highlight, to the end of a word, and marks the cut', () => {
		const text = `Lease: notice period of three months before the tenancy ends, ${'and so on '.repeat(20)}`
		const start = text.indexOf('notice')
		const segments = snippetSegments({text, highlights: [[start, start + 13]]})
		expect(segments).toEqual([
			plain('Lease: '),
			hit('notice period'),
			plain(' of three months before the tenancy ends, and so…'),
		])
	})

	it('keeps a later highlight the cut would have split', () => {
		const text = `match ${'x'.repeat(40)} second-match-here and more words after it`
		const second = text.indexOf('second')
		const segments = snippetSegments({
			text,
			highlights: [
				[0, 5],
				[second, second + 17],
			],
		})
		expect(segments).toEqual([hit('match'), plain(` ${'x'.repeat(40)} `), hit('second-match-here'), plain('…')])
	})

	it('never cuts inside a character', () => {
		// Each emoji is two code units; with one character either side of the
		// match, both cuts would land between them
		const text = `${'😀'.repeat(20)}-MATCH-${'😀'.repeat(30)}`
		const start = text.indexOf('MATCH')
		const joined = snippetSegments({text, highlights: [[start, start + 5]]})
			.map((segment) => segment.text)
			.join('')
		expect(joined).toBe(`…${'😀'.repeat(14)}-MATCH-${'😀'.repeat(23)}…`)
	})

	it('collapses line breaks and runs of whitespace', () => {
		expect(snippetSegments({text: 'Invoice\n\n  No.  2025-118\n', highlights: [[16, 24]]})).toEqual([
			plain('Invoice No. '),
			hit('2025-118'),
		])
	})
})

describe('hasHighlight', () => {
	it('is only true of a snippet that marks some of its text', () => {
		expect(hasHighlight({text: 'IKEA receipt', highlights: [[0, 4]]})).toBe(true)
		expect(hasHighlight({text: 'IKEA receipt', highlights: []})).toBe(false)
	})
})

describe('snippetTerms', () => {
	it('is the highlighted words, each once, longest first', () => {
		const snippet = {
			text: 'Happy birthday, happy birthday to you, Mila.',
			highlights: [
				[0, 14],
				[16, 30],
				[39, 43],
			] as [number, number][],
		}
		expect(snippetTerms(snippet)).toEqual(['happy birthday', 'mila'])
	})

	it('is nothing without a snippet or a highlight', () => {
		expect(snippetTerms(undefined)).toEqual([])
		expect(snippetTerms({text: 'a quiet street at dusk', highlights: []})).toEqual([])
	})
})

describe('markTerms', () => {
	const marked = (text: string, terms: string[]) =>
		markTerms(text, terms)
			.map((segment) => (segment.highlighted ? `[${segment.text}]` : segment.text))
			.join('')

	it('marks every occurrence, whatever its case, and gives the text back whole', () => {
		expect(marked('Pumpkin soup & sourdough .. £5.50\nSourdough loaf £3', ['sourdough'])).toBe(
			'Pumpkin soup & [sourdough] .. £5.50\n[Sourdough] loaf £3',
		)
	})

	it('finds words a picture broke across lines', () => {
		expect(marked('HAPPY\nBIRTHDAY', ['happy birthday'])).toBe('[HAPPY\nBIRTHDAY]')
	})

	it('takes a term for what it says, not as a pattern', () => {
		expect(marked('total (net) 4.50 and 4x50', ['(net)', '4.50'])).toBe('total [(net)] [4.50] and 4x50')
	})

	it('prefers the longer of two terms that start alike', () => {
		expect(marked('black diamond run', ['black diamond run', 'black'])).toBe('[black diamond run]')
	})

	it('leaves text alone when there is nothing to find', () => {
		expect(markTerms('plain words', [])).toEqual([{text: 'plain words', highlighted: false}])
		expect(markTerms('plain words', ['absent'])).toEqual([{text: 'plain words', highlighted: false}])
		expect(markTerms('', ['absent'])).toEqual([])
	})
})

describe('matchReason', () => {
	const result = (fields: Partial<SearchResult>) => ({kind: 'document', match: 'text', ...fields}) as SearchResult
	const words = {text: 'happy birthday to you', highlights: [[0, 14]] as [number, number][]}

	it('shows the words that matched, with the page or moment they are at', () => {
		expect(matchReason(result({snippet: words, page: 3}))).toEqual({type: 'words', snippet: words, page: 3})
		expect(matchReason(result({kind: 'video', match: 'speech', snippet: words, moment: {startMs: 41_000}}))).toEqual({
			type: 'words',
			snippet: words,
			momentMs: 41_000,
		})
	})

	it('says what matched at a moment that has no words to show', () => {
		expect(matchReason(result({kind: 'video', match: 'visual', moment: {startMs: 50_000}}))).toEqual({
			type: 'moment',
			momentMs: 50_000,
			spoken: false,
		})
		expect(matchReason(result({kind: 'audio', match: 'speech', moment: {startMs: 41_000}}))).toEqual({
			type: 'moment',
			momentMs: 41_000,
			spoken: true,
		})
	})

	it('does not show text read off a photo that matched by meaning', () => {
		const reading = {text: 'l0 %% KASSE 4 ~~ 12,99', highlights: []}
		expect(matchReason(result({kind: 'photo', snippet: reading}))).toEqual({type: 'picture'})
		// A document's passage reads as prose, highlighted or not
		expect(matchReason(result({snippet: reading}))).toEqual({type: 'words', snippet: reading})
		// … and a photo whose text holds the words shows them
		expect(matchReason(result({kind: 'photo', snippet: words}))).toEqual({type: 'words', snippet: words})
	})

	it('says which page of a document matched by how it looks', () => {
		expect(matchReason(result({match: 'visual', page: 4}))).toEqual({type: 'page', page: 4})
	})

	it('falls back to where the file lives', () => {
		expect(matchReason(result({match: 'name'}))).toEqual({type: 'folder'})
	})
})

describe('refinesQuery', () => {
	it('holds while a query is extended or cut back', () => {
		expect(refinesQuery('sun', 'sunset')).toBe(true)
		expect(refinesQuery('sunset', 'sunset beach')).toBe(true)
		expect(refinesQuery('sunset beach', 'sunset b')).toBe(true)
		expect(refinesQuery('Sunset', 'sunset')).toBe(true)
	})

	it('holds when words are taken out or put in around the ones that stay', () => {
		expect(refinesQuery('dad beach 2019', 'beach')).toBe(true)
		expect(refinesQuery('beach', 'sunny beach')).toBe(true)
	})

	it('holds when a word is put in quotes, as taking off what was read from it does', () => {
		expect(refinesQuery('sunset dad', 'sunset "dad"')).toBe(true)
		expect(refinesQuery('dad in thailand', 'in "thailand"')).toBe(true)
		expect(refinesQuery('anna smith in paris', '"anna smith" in "paris"')).toBe(true)
		expect(refinesQuery('sunset dad', 'sunset "mum"')).toBe(false)
	})

	it('does not hold for a different question', () => {
		expect(refinesQuery('sunset', 'ikea receipt')).toBe(false)
		expect(refinesQuery('ikea receipt', 'amazon invoice')).toBe(false)
		expect(refinesQuery('sunset beach', 'sunset ikea')).toBe(false)
	})

	it('never holds across an empty query', () => {
		expect(refinesQuery('', 'sunset')).toBe(false)
		expect(refinesQuery('sunset', '  ')).toBe(false)
		expect(refinesQuery('', '')).toBe(false)
		// Quotes alone are still something typed
		expect(refinesQuery('"', '""')).toBe(true)
	})
})

describe('formatMoment', () => {
	it('reads like a player clock', () => {
		expect(formatMoment(0)).toBe('0:00')
		expect(formatMoment(7_400)).toBe('0:07')
		expect(formatMoment(83_000)).toBe('1:23')
		expect(formatMoment(3_723_000)).toBe('1:02:03')
		expect(formatMoment(-5)).toBe('0:00')
	})
})

describe('folderTrail', () => {
	it('lists the folders a file is in, nearest last', () => {
		expect(folderTrail('/Home/Documents/ikea.pdf')).toEqual({folders: ['Home', 'Documents'], clipped: false})
		expect(folderTrail('/Home/ikea.pdf')).toEqual({folders: ['Home'], clipped: false})
	})

	it('keeps the nearest folders of a deep path', () => {
		expect(folderTrail('/Home/Documents/Taxes/2025/Receipts/ikea.pdf')).toEqual({
			folders: ['Taxes', '2025', 'Receipts'],
			clipped: true,
		})
	})
})

type Counts = Parameters<typeof searchWork>[0]
const count = (completed: number, total: number) => ({completed, total})
// A library of a thousand things with every kind of work done, but speech
const indexing = (progress: Partial<NonNullable<Counts>['progress']> = {}): NonNullable<Counts> => ({
	enabled: true,
	progress: {
		previews: count(1000, 1000),
		embedding: count(1000, 1000),
		text: count(1000, 1000),
		faces: count(1000, 1000),
		speech: count(2, 50),
		...progress,
	},
})

describe('searchWork', () => {
	it('is over when all a surface rests on is done, whatever is left of speech', () => {
		for (const surface of ['everywhere', 'photos', 'files', 'people'] as const) {
			expect(searchWork(indexing(), surface)).toBeNull()
			expect(searchWork(indexing({speech: count(0, 5000)}), surface)).toBeNull()
		}
	})

	it('knows nothing before the counts are in, and of a library with nothing in it', () => {
		expect(searchWork(undefined, 'everywhere')).toBeNull()
		const empty = {previews: count(0, 0), embedding: count(0, 0), text: count(0, 0), faces: count(0, 0)}
		expect(searchWork(indexing(empty), 'everywhere')).toBeNull()
	})

	it('counts what photos and videos show, faces and text for Photos and the palette', () => {
		const counts = indexing({embedding: count(500, 1000), text: count(250, 1000), faces: count(0, 1000)})
		for (const surface of ['everywhere', 'photos'] as const) {
			expect(searchWork(counts, surface)).toMatchObject({completed: 750, total: 3000, percent: 25})
		}
	})

	it('counts no faces for Files, and only faces for People', () => {
		const faces = indexing({faces: count(100, 1000)})
		expect(searchWork(faces, 'files')).toBeNull()
		expect(searchWork(faces, 'people')).toMatchObject({completed: 100, total: 1000, percent: 10})
		const text = indexing({text: count(500, 1000)})
		expect(searchWork(text, 'files')).toMatchObject({completed: 1500, total: 2000, percent: 75})
		expect(searchWork(text, 'people')).toBeNull()
	})

	it("never counts previews, which are not Search's work", () => {
		expect(searchWork(indexing({previews: count(0, 1000)}), 'everywhere')).toBeNull()
	})

	it('holds Photos back for exactly what holds the palette back', () => {
		const counts = [
			indexing({speech: count(0, 5000)}),
			indexing({faces: count(10, 1000)}),
			indexing({text: count(1, 2)}),
		]
		for (const each of counts) expect(searchWork(each, 'photos')).toEqual(searchWork(each, 'everywhere'))
	})

	it('is never whole while something is left, and says when little is', () => {
		const nearly = searchWork(indexing({faces: count(999, 1000)}), 'everywhere')
		expect(nearly).toMatchObject({percent: 99, substantial: false})
		expect(searchWork(indexing({faces: count(900, 1000)}), 'everywhere')?.substantial).toBe(true)
		// A whole percentage, rounded down, however the division comes out
		expect(searchWork(indexing({faces: count(29, 100)}), 'people')?.percent).toBe(29)
		expect(searchWork(indexing({faces: count(57, 100)}), 'people')?.percent).toBe(57)
		expect(searchWork(indexing({faces: count(1999, 2000)}), 'people')?.percent).toBe(99)
		expect(searchWork(indexing({faces: count(1, 1000)}), 'people')?.percent).toBe(0)
		// A count that has run ahead of its total does not make up for another
		expect(searchWork(indexing({embedding: count(1100, 1000), faces: count(900, 1000)}), 'everywhere')).toMatchObject({
			completed: 2900,
			total: 3000,
		})
	})
})

describe('searchLearning', () => {
	const status = (
		available: boolean,
		reason: SearchStatus['reason'],
		completed: number,
		total: number,
	): SearchStatus => ({available, reason, indexing: {completed, total}})
	const work = searchWork(indexing({embedding: count(0, 1000), text: count(320, 1000)}), 'everywhere')

	it('says nothing once search is up and has read all the surface rests on', () => {
		expect(searchLearning(undefined, work)).toBeNull()
		// Search's own count takes speech in: it is not what is gone by
		expect(searchLearning(status(true, undefined, 440, 1000), null)).toBeNull()
		expect(searchLearning(status(true, undefined, 0, 0), null)).toBeNull()
	})

	it('reports how much is read while some of it is not', () => {
		expect(searchLearning(status(true, undefined, 1000, 1000), work)).toEqual({learned: 44})
	})

	it('says when reading the rest is waiting for memory', () => {
		const waiting: SearchStatus = {available: true, indexing: {completed: 440, total: 1000, waitingForMemory: true}}
		expect(searchLearning(waiting, work)).toEqual({learned: 44, waiting: true})
		// Nothing to say when it is only speech that waits
		expect(searchLearning(waiting, null)).toBeNull()
	})

	it('reports starting for as long as the models load, whatever the progress', () => {
		expect(searchLearning(status(false, 'starting', 0, 0), null)).toBe('starting')
		expect(searchLearning(status(false, 'starting', 10, 100), work)).toBe('starting')
		expect(searchLearning(status(false, 'starting', 100, 100), null)).toBe('starting')
	})

	it('says so when the models cannot be run', () => {
		expect(searchLearning(status(false, 'error', 0, 500), null)).toBe('error')
		expect(searchLearning(status(false, 'unsupported-device', 0, 0), null)).toBe('names-only')
	})
})
