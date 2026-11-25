import {expect, test} from 'vitest'

import {passages} from './readable.ts'

const sentence = (words: number, first: string) =>
	`${first} ${Array.from({length: words - 2}, () => 'word').join(' ')} end.`

test('embeds a passage that ends at the end of a sentence as it is', () => {
	// Two paragraphs of 120 words: each is a passage of its own
	const split = passages([`${sentence(120, 'One')}\n\n${sentence(120, 'Two')}`])
	expect(split.map(({text}) => text.split(' ').length)).toEqual([120, 120])
	for (const {text, context} of split) expect(context).toBe(text)
})

test('embeds a passage that cuts a sentence in two with the rest of that sentence', () => {
	// 190 words, then a sentence of 20 that the 200th word cuts in two
	const split = passages([`${sentence(190, 'Start')} ${sentence(20, 'Cut')} ${sentence(150, 'After')}`])
	expect(split).toHaveLength(2)
	const [first, second] = split
	expect(first.text.split(' ')).toHaveLength(200)
	// The first has the 10 words of the sentence that the second starts with ...
	expect(first.context).toBe(`${first.text} ${second.text.split(' ').slice(0, 10).join(' ')}`)
	// ... and the second the 10 that the first ends with, and nothing after itself
	expect(second.context).toBe(`${first.text.split(' ').slice(-10).join(' ')} ${second.text}`)
	// What is kept and shown has each word once
	expect(`${first.text} ${second.text}`.split(' ')).toHaveLength(360)
})

test('has a sentence that runs over the end of a page whole in both pages', () => {
	const split = passages([`${sentence(30, 'First')} A sentence that runs`, `over the page. ${sentence(30, 'Last')}`])
	expect(split.map(({page}) => page)).toEqual([1, 2])
	expect(split[0].context).toBe(`${split[0].text} over the page.`)
	expect(split[1].context).toBe(`A sentence that runs ${split[1].text}`)
})

test('takes no more of a sentence than its share, in words or in characters', () => {
	// A sentence of 500 words: 30 of its words either side of where it is cut
	const long = passages([Array.from({length: 500}, (_, index) => `w${index}`).join(' ')])
	expect(long[0].context.split(' ')).toHaveLength(230)
	expect(long[1].context.split(' ')).toHaveLength(260)
	// Written without spaces and without an end to its sentence, text is cut
	// 400 characters at a time: 300 characters of it either side of a cut
	const unspaced = passages(['字'.repeat(1000), '文'.repeat(1000)])
	expect(unspaced.map(({page, text}) => [page, text.length])).toEqual([
		...[400, 400, 200].map((length) => [1, length]),
		...[400, 400, 200].map((length) => [2, length]),
	])
	expect(unspaced[0].context).toBe(`${'字'.repeat(400)} ${'字'.repeat(300)}`)
	expect(unspaced[2].context).toBe(`${'字'.repeat(300)} ${'字'.repeat(200)} ${'文'.repeat(300)}`)
})

test('counts text written without spaces by its characters, and takes it a sentence at a time', () => {
	// Nine sentences of 90 characters and a full stop, with nothing between them: a line of it is
	// one word however long. Four are as much as a passage holds, at two characters to a word.
	const text = Array.from('一二三四五六七八九', (character) => `${character.repeat(90)}。`).join('')
	const split = passages([text])
	expect(split.map(({text}) => text.length)).toEqual([364, 364, 91])
	// Each ends where a sentence does, so it is embedded as it is, and none of the text is lost
	for (const {text, context} of split) expect(context).toBe(text)
	expect(split.map(({text}) => text).join('')).toBe(text)
	// Beside words set apart by spaces it counts as the words it comes to: 120 characters are 60,
	// too many to follow 150 words in one passage
	const mixed = passages([`${'word '.repeat(150)}${'東京'.repeat(60)} ${'word '.repeat(100).trim()}`])
	expect(mixed.map(({text}) => text.split(' ').length)).toEqual([150, 101])
	// Thai ends a sentence with a space, where it marks the end at all: a passage that
	// ends in Thai is embedded as it is, with nothing of the passages either side
	const thai = passages([Array.from({length: 40}, () => 'ก'.repeat(30)).join(' ')])
	expect(thai.length).toBeGreaterThan(1)
	for (const {text, context} of thai) expect(context).toBe(text)
	// A character outside the plane most are in is not cut in two
	const rare = passages(['𠮷'.repeat(500)])
	expect(rare.map(({text}) => [...text].length)).toEqual([400, 100])
	expect(rare.map(({text}) => text).join('')).toBe('𠮷'.repeat(500))
})

test('keeps the first 200 passages of a document, wherever in a page or a paragraph they end', () => {
	const words = (count: number, from = 0) => Array.from({length: count}, (_, index) => `w${from + index}`).join(' ')
	// One paragraph of 50,000 words: 200 passages of 200, up to the 40,000th
	const paragraph = passages([words(50_000)])
	expect(paragraph).toHaveLength(200)
	expect(paragraph.at(-1)!.text.split(' ').at(-1)).toBe('w39999')
	// The last has nothing after it to finish its sentence with
	expect(paragraph.at(-1)!.context.endsWith('w39999')).toBe(true)
	// Paragraphs of 150 words are a passage each, and pages of one paragraph too
	const paragraphs = passages([Array.from({length: 250}, (_, index) => words(150, index * 150)).join('\n\n')])
	expect(paragraphs).toHaveLength(200)
	expect(paragraphs.at(-1)!.text.split(' ').at(-1)).toBe('w29999')
	const paged = passages(Array.from({length: 250}, (_, index) => words(150, index * 150)))
	expect(paged.map(({page}) => page)).toEqual(Array.from({length: 200}, (_, index) => index + 1))
})
