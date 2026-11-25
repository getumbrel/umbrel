import {expect, test} from 'vitest'

import {asTyped, leftOf, readWords, typedWords} from './query.ts'

// A Wednesday
const now = new Date(2026, 10, 25, 12).getTime()
const people = [
	{id: 'anna', name: 'Anna Smith'},
	{id: 'dad', name: 'Dad'},
	{id: 'rose', name: 'Rose'},
	{id: 'ben-a', name: 'Ben Adams'},
	{id: 'ben-b', name: 'Ben Brown'},
]

// What is read from what was typed: each filter, and what is left
function read(query: string, narrowed?: {person?: boolean; date?: boolean; kind?: boolean}) {
	const words = typedWords(query)
	const reads = readWords(words, {now, people, narrowed})
	return {
		chips: reads.map(({chip}) => chip.label),
		left: leftOf(words, reads)
			.map(({text}) => text)
			.join(' '),
		asTyped: reads.map((one) => asTyped(words, reads, one)),
	}
}

test('reads who, when and what kind of thing was typed, and leaves the rest', () => {
	expect(read('dad on the beach last summer')).toMatchObject({chips: ['Dad'], left: 'on the beach last summer'})
	expect(read('photos of dad from 2019')).toEqual({
		chips: ['Photos', 'Dad', '2019'],
		left: '',
		asTyped: ['"photos"', 'of "dad"', 'from "2019"'],
	})
	expect(read('a dog running')).toEqual({chips: [], left: 'a dog running', asTyped: []})
})

test('reads someone by their name in full, or by the first of it where it is one person', () => {
	expect(read('anna smith skiing')).toMatchObject({chips: ['Anna Smith'], left: 'skiing'})
	expect(read('anna skiing')).toMatchObject({chips: ['Anna Smith'], left: 'skiing'})
	expect(read("dad's car")).toMatchObject({chips: ['Dad'], left: 'car'})
	expect(read('with Anna')).toMatchObject({chips: ['Anna Smith'], left: ''})
	// Two people start with it
	expect(read('ben skiing')).toMatchObject({chips: [], left: 'ben skiing'})
	expect(read('ben brown skiing')).toMatchObject({chips: ['Ben Brown']})
	// Everyone named is read, each once
	expect(read('dad anna and rose hiking')).toMatchObject({chips: ['Dad', 'Anna Smith', 'Rose'], left: 'hiking'})
	expect(read('anna smith and anna')).toMatchObject({chips: ['Anna Smith'], left: 'and anna'})
})

test('reads when: a day, a month, a year, a season of one, or a stretch back from today', () => {
	const stretch = (query: string) => {
		const [{chip}] = readWords(typedWords(query), {now, people: []})
		return chip.type === 'date'
			? [chip.label, new Date(chip.from).toDateString(), new Date(chip.to).toDateString()]
			: []
	}
	expect(stretch('2024')).toEqual(['2024', 'Mon Jan 01 2024', 'Wed Jan 01 2025'])
	expect(stretch('august 2024')).toEqual(['August 2024', 'Thu Aug 01 2024', 'Sun Sep 01 2024'])
	expect(stretch('12 aug 2024')).toEqual(['12 August 2024', 'Mon Aug 12 2024', 'Tue Aug 13 2024'])
	expect(stretch('2024-08-12')).toEqual(['12 August 2024', 'Mon Aug 12 2024', 'Tue Aug 13 2024'])
	// With no year, the last one that month has been in
	expect(stretch('december')).toEqual(['December 2025', 'Mon Dec 01 2025', 'Thu Jan 01 2026'])
	expect(stretch('summer 2023')).toEqual(['Summer 2023', 'Thu Jun 01 2023', 'Fri Sep 01 2023'])
	expect(stretch('yesterday')).toEqual(['Yesterday', 'Tue Nov 24 2026', 'Wed Nov 25 2026'])
	expect(stretch('last week')).toEqual(['Last week', 'Mon Nov 16 2026', 'Mon Nov 23 2026'])
	expect(stretch('last 3 months')).toEqual(['Last 3 months', 'Tue Aug 25 2026', 'Thu Nov 26 2026'])
	// A month that is a word first is one when it is led to, a year that has not come is a number
	expect(read('may flowers').chips).toEqual([])
	expect(read('flowers in may').chips).toEqual(['May 2026'])
	expect(read('2099').chips).toEqual([])
	expect(read('2024-13-40').chips).toEqual([])
})

test('reads a year and a kind of thing from among other words', () => {
	expect(read('invoice 2024')).toMatchObject({chips: ['2024'], left: 'invoice'})
	expect(read('beach from 2024')).toMatchObject({chips: ['2024'], left: 'beach'})
	expect(read('rose garden')).toMatchObject({chips: ['Rose'], left: 'garden'})
	// One kind: what a thing is, before whether it is a photo or a video
	expect(read('video call screenshot')).toMatchObject({chips: ['Screenshots'], left: 'video call'})
	expect(read('dog videos')).toMatchObject({chips: ['Videos'], left: 'dog'})
	expect(read('videos of dogs')).toMatchObject({chips: ['Videos'], left: 'dogs'})
	expect(read('live photos of the sea')).toMatchObject({chips: ['Live Photos'], left: 'the sea'})
})

test('reads nothing from words in quotes, or of what a view is already narrowed by', () => {
	expect(read('"rose" garden')).toEqual({chips: [], left: 'rose garden', asTyped: []})
	expect(read('"anna smith" 2024')).toMatchObject({chips: ['2024'], left: 'anna smith'})
	expect(read('dad 2024 videos', {person: true, kind: true})).toMatchObject({chips: ['2024'], left: 'dad videos'})
	// A quote nothing closes is not typed for anything
	expect(read('"rose garden')).toMatchObject({chips: ['Rose'], left: 'garden'})
})

test('says what to look for should a filter not be what was meant', () => {
	// Its own words in quotes, and without what the others were read from
	expect(read('rose garden 2024').asTyped).toEqual(['"rose" garden', 'garden "2024"'])
	expect(read('anna smith in "paris"').asTyped).toEqual(['"anna smith" in "paris"'])
})
