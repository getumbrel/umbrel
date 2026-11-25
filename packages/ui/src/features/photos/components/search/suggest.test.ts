import {describe, expect, it} from 'vitest'

import {suggest, type MonthCount} from './suggest'

// A small library calendar: a run of 2024 months, a hole, and one old year
const MONTHS: MonthCount[] = [
	{year: 2025, month: 1, count: 40},
	{year: 2024, month: 12, count: 31},
	{year: 2024, month: 8, count: 214},
	{year: 2024, month: 2, count: 12},
	{year: 2023, month: 8, count: 118},
	{year: 2019, month: 6, count: 7},
]

const SOURCES = [
	{id: 'my-umbrel', name: "Craig's Umbrel", count: 900},
	{id: 'iphone-nate', name: "Nate's iPhone", count: 300},
]
const ALBUMS = [{id: 'a-iceland', name: 'Iceland Trip', count: 52}]
const KINDS = [
	{kind: 'photo', label: 'Photos', count: 1000},
	{kind: 'video', label: 'Videos', count: 200},
] as const
const SUB_KINDS = [{subKind: 'screenshot', label: 'Screenshots', count: 34}] as const

const run = (text: string) =>
	suggest({
		text,
		locale: 'en',
		months: MONTHS,
		sources: SOURCES,
		albums: ALBUMS,
		kinds: [...KINDS],
		subKinds: [...SUB_KINDS],
	})
const dates = (text: string) => run(text).filter(({token}) => token.type === 'date')
const labels = (text: string) => dates(text).map(({token}) => (token.type === 'date' ? token.label : ''))

describe('suggest', () => {
	it('offers every dimension when nothing is typed: kinds, subKinds, sources, albums, recent months', () => {
		const all = run('')
		expect(all.map(({token}) => token.type)).toEqual([
			'kind',
			'kind',
			'subKind',
			'source',
			'source',
			'album',
			'date',
			'date',
			'date',
		])
		expect(labels('')).toEqual(['January 2025', 'December 2024', 'August 2024'])
	})

	it('matches sources and albums anywhere in the name, kinds and subKinds at the start', () => {
		expect(run('nate').map(({token}) => token.type)).toEqual(['source'])
		expect(run('icela').map(({token}) => token.type)).toEqual(['album'])
		expect(run('vid')[0]?.token).toEqual({type: 'kind', kind: 'video'})
		expect(run('scre')[0]?.token).toEqual({type: 'subKind', subKind: 'screenshot', label: 'Screenshots'})
		// "photos" should not be found in the middle of a kind label
		expect(run('ideo').some(({token}) => token.type === 'kind')).toBe(false)
	})

	it('reads a month name, whole or begun, as that month in every year that has it — newest first', () => {
		expect(labels('august')).toEqual(['August 2024', 'August 2023'])
		expect(labels('au')).toEqual(['August 2024', 'August 2023'])
		// Ambiguous letters cover all the months they begin
		expect(labels('j')).toEqual(['January 2025', 'June 2019'])
	})

	it('reads a year, whole or begun', () => {
		expect(labels('2024')).toEqual(['2024'])
		expect(dates('2024')[0]?.count).toBe(31 + 214 + 12)
		expect(labels('20')).toEqual(['2025', '2024', '2023', '2019'])
	})

	it('reads a month of a year in either order, and numerically', () => {
		for (const text of ['august 2024', '2024 august', '8/2024', '2024/8', '8.2024']) {
			expect(labels(text), text).toEqual(['August 2024'])
			expect(dates(text)[0]?.count, text).toBe(214)
		}
	})

	it('uses the same UTC calendar boundaries as the backend summary', () => {
		const token = dates('january 2025')[0]?.token
		expect(token).toMatchObject({
			type: 'date',
			from: Date.UTC(2025, 0, 1),
			to: Date.UTC(2025, 1, 1),
		})
	})

	it('offers nothing for months and years the library does not have', () => {
		expect(dates('2020')).toEqual([])
		expect(dates('march 2024')).toEqual([])
		expect(labels('march')).toEqual([])
	})

	it('reads a range between two dates, whatever the punctuation', () => {
		for (const text of ['2023-2024', '2023 – 2024', '2023 to 2024', 'aug 2023 - feb 2024']) {
			expect(dates(text), text).toHaveLength(1)
		}
		expect(labels('2023-2024')).toEqual(['2023 – 2024'])
		expect(dates('2023-2024')[0]?.count).toBe(118 + 12 + 214 + 31)
		expect(labels('aug 2023 - feb 2024')).toEqual(['Aug 2023 – Feb 2024'])
		expect(dates('aug 2023 - feb 2024')[0]?.count).toBe(118 + 12)
	})

	it('orders a backwards range forwards', () => {
		expect(labels('2024 - 2023')).toEqual(['2023 – 2024'])
	})

	it('does not read a dash inside a file name as a range', () => {
		expect(dates('img-2024')).toEqual([])
	})

	it('keeps the span honest: a month range excludes the rest of its years', () => {
		// Aug 2023 – Feb 2024 must not include Aug 2024 or Dec 2024
		expect(dates('aug 2023 - feb 2024')[0]?.count).not.toBe(118 + 12 + 214 + 31)
	})

	it('leaves letters that fit no month, source or kind unsuggested — they are a file name', () => {
		expect(run('img_0042')).toEqual([])
	})
})

describe('suggest: people', () => {
	const PEOPLE = [
		{id: 'p-dad', name: 'Dad', count: 420},
		{id: 'p-anna', name: 'Anna Maria', count: 300},
		{id: 'p-mark', name: 'Mark', count: 120},
		{id: 'p-ryan', name: 'Ryan', count: 80},
		{id: 'p-eve', name: 'Eve', count: 60},
		{id: 'p-zoe', name: 'Zoë', count: 40},
		{id: 'p-august', name: 'August', count: 12},
	]
	const people = (text: string) =>
		suggest({text, locale: 'en', months: MONTHS, sources: SOURCES, albums: ALBUMS, kinds: [...KINDS], people: PEOPLE})

	it('offers the front of the people list when nothing is typed, between the types and the sources', () => {
		const all = people('')
		expect(all.map(({token}) => token.type)).toEqual([
			'kind',
			'kind',
			...Array(6).fill('person'),
			'source',
			'source',
			'album',
			'date',
			'date',
			'date',
		])
		expect(all[2]).toEqual({token: {type: 'person', id: 'p-dad', label: 'Dad'}, count: 420})
		// The seventh waits for a letter
		expect(all.some(({token}) => token.type === 'person' && token.id === 'p-august')).toBe(false)
	})

	it('matches a name from the start of any of its words, never mid-word', () => {
		const ids = (text: string) => people(text).flatMap(({token}) => (token.type === 'person' ? [token.id] : []))
		expect(ids('ma')).toEqual(['p-anna', 'p-mark'])
		expect(ids('an')).toEqual(['p-anna'])
		expect(ids('DAD')).toEqual(['p-dad'])
		expect(ids('zoë')).toEqual(['p-zoe'])
		expect(ids('anna m')).toEqual(['p-anna'])
	})

	it('offers a person and a month alike when a name is also one', () => {
		expect(people('august').map(({token}) => token.type)).toEqual(['person', 'date', 'date'])
	})

	it('offers nobody when no people are passed', () => {
		expect(run('dad')).toEqual([])
	})
})
