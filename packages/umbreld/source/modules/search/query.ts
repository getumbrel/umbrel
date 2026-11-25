import {foldName} from '../files/places.ts'

import type {SearchFilter} from './types.ts'

// Reads what was typed the way a person means it: "dad in thailand 2026" is
// someone, somewhere and a year, with nothing left to look for; "beach last
// summer" is a beach, and when. What is read that way is a filter, and the
// rest is left as words for the models.
//
// Not a model: the same words always mean the same thing, and the one
// searching is shown what was understood. The words for dates and kinds are
// English. People are the ones the account has named, and places the ones it
// has something taken in, in whatever language they are typed (see
// ../files/places.ts, which reads those).
//
// A word can be read as a filter and have been meant as a word ("turkey
// dinner"). In quotes it is only ever a word, which is also what taking its
// filter off leaves it as (see asTyped), and where nothing fits what was read,
// what was typed is looked for as it is (see search.ts).

// One of the words typed. In quotes, a word is only ever a word.
export type TypedWord = {text: string; quoted: boolean}

// A filter read out of the words from `from` up to `to`: `named` is where in
// them the words that say it start, after any that only led to it, and `rest`
// what else was in a word a name written without spaces was found inside
// ("東京の写真"), which is still to look for
export type Read = {chip: SearchFilter; from: number; to: number; named: number; rest?: string}
type Span = Pick<Read, 'from' | 'to' | 'named' | 'rest'>

export function typedWords(query: string): TypedWord[] {
	const words: TypedWord[] = []
	for (const [, quoted, plain] of query.matchAll(/"([^"]*)"|(\S+)/g)) {
		if (quoted !== undefined) for (const text of quoted.split(/\s+/)) words.push({text, quoted: true})
		// A quote with no other to close it is not typed for anything
		else words.push({text: plain!.replaceAll('"', ''), quoted: false})
	}
	return words.filter(({text}) => text)
}

// Words that lead to a filter and say nothing once it is read ("in
// thailand", "from 2019", "photos of dad", "with anna")
const LEADING = new Set(['in', 'at', 'from', 'on', 'during', 'since', 'of', 'with'])
// ... and that follow a kind of thing ("videos of", "photos from")
const TRAILING = new Set(['of', 'with', 'from', 'showing'])

// The kinds of thing Photos tells apart, by what they are called. The longest
// first, so that "live photos" is not read as photos.
const KINDS: Array<[string, SearchFilter]> = [
	...['live photos', 'live photo'].map((name) => [name, {type: 'subKind', label: 'Live Photos', subKind: 'live'}]),
	...['screenshots', 'screenshot'].map((name) => [
		name,
		{type: 'subKind', label: 'Screenshots', subKind: 'screenshot'},
	]),
	...['panoramas', 'panorama'].map((name) => [name, {type: 'subKind', label: 'Panoramas', subKind: 'panorama'}]),
	...['photos', 'photo', 'pictures', 'picture', 'pics'].map((name) => [
		name,
		{type: 'kind', label: 'Photos', kind: 'photo'},
	]),
	...['videos', 'video', 'clips'].map((name) => [name, {type: 'kind', label: 'Videos', kind: 'video'}]),
] as Array<[string, SearchFilter]>

// Who is named, when, and what kind of thing, read out of the words that are
// not in quotes: the longest names first, then the first date, then a kind.
// Where something was taken is read afterwards, from what these leave (see
// search.ts). Nothing the view searched is already narrowed by is read again.
export function readWords(
	words: TypedWord[],
	{
		now,
		people,
		narrowed = {},
	}: {
		now: number
		people: Array<{id: string; name: string}>
		narrowed?: {person?: boolean; date?: boolean; kind?: boolean}
	},
): Read[] {
	const folded = words.map(({text, quoted}) => (quoted ? '' : fold(text)))
	const taken = words.map(({quoted}) => quoted)
	const found: Read[] = []
	const free = (from: number, length: number) =>
		from + length <= words.length && taken.slice(from, from + length).every((is) => !is)
	// Takes words for a filter, with one before them that only led to them
	const take = (from: number, length: number, chip: Read['chip']) => {
		const led = from > 0 && !taken[from - 1] && LEADING.has(folded[from - 1]!)
		for (let index = led ? from - 1 : from; index < from + length; index++) taken[index] = true
		found.push({chip, from: led ? from - 1 : from, to: from + length, named: from})
		return found.at(-1)!
	}
	const find = (phrase: string[]) => {
		for (let from = 0; from + phrase.length <= words.length; from++) {
			if (free(from, phrase.length) && phrase.every((part, offset) => folded[from + offset] === part)) return from
		}
	}

	// Everyone named, each by their name in full, or by the first of it where
	// nobody else's starts the same
	if (!narrowed.person) {
		const named = people.map((person) => ({...person, parts: fold(person.name).split(' ').filter(Boolean)}))
		const calls = named.flatMap((person) => {
			const first = person.parts[0]
			const only = first && named.filter(({parts}) => parts[0] === first).length === 1
			return [person.parts, ...(person.parts.length > 1 && only ? [[first!]] : [])].map((parts) => ({person, parts}))
		})
		const read = new Set<string>()
		for (const {person, parts} of calls.sort((one, other) => other.parts.length - one.parts.length)) {
			const from = parts.length > 0 && !read.has(person.id) ? find(parts) : undefined
			if (from === undefined) continue
			take(from, parts.length, {type: 'person', label: person.name, personId: person.id})
			read.add(person.id)
		}
		// "dad and anna": what joins two of them goes with the second
		for (const person of found) {
			const joins = person.from - 1
			const joined = folded[joins] === 'and' && !taken[joins] && found.some(({to}) => to === joins)
			if (joined) taken[joins] = true
			if (joined) person.from = joins
		}
	}

	if (!narrowed.date) {
		const date = findDate(folded, free, new Date(now))
		if (date) take(date.from, date.length, {type: 'date', label: date.label, from: date.start, to: date.end})
	}

	if (!narrowed.kind) {
		for (const [phrase, chip] of KINDS) {
			const parts = phrase.split(' ')
			const from = find(parts)
			if (from === undefined) continue
			const kind = take(from, parts.length, chip)
			// "photos of …", "videos from …": the word that joins goes with the kind
			const next = from + parts.length
			const joined = next < words.length - 1 && !taken[next] && TRAILING.has(folded[next]!)
			if (joined) taken[next] = true
			if (joined) kind.to = next + 1
			break
		}
	}
	return found.sort((one, other) => one.from - other.from)
}

// What is left to look for: the words no filter was read from. Words that
// only join, with nothing left to join, are not a search.
export function leftOf(words: TypedWord[], reads: Span[]) {
	const left = words.flatMap((word, index) => {
		const read = reads.find(({from, to}) => index >= from && index < to)
		if (!read) return [word]
		return read.rest && index === read.from ? [{text: read.rest, quoted: false}] : []
	})
	const joining = ({text, quoted}: TypedWord) =>
		!quoted && (LEADING.has(fold(text)) || TRAILING.has(fold(text)) || fold(text) === 'and')
	return reads.length > 0 && left.every(joining) ? [] : left
}

// What was typed, should one of the filters read from it not be what was
// meant: its own words in quotes, and without what the others were read from
export function asTyped(words: TypedWord[], reads: Span[], read: Span) {
	return words
		.flatMap((word, index) => {
			const other = reads.find((other) => other !== read && index >= other.from && index < other.to)
			if (other) return other.rest && index === other.from ? [other.rest] : []
			const text = word.quoted ? `"${word.text}"` : word.text
			if (index < read.named || index >= read.to) return [text]
			// The words that say it, in one pair of quotes
			return [`${index === read.named ? '"' : ''}${word.text}${index === read.to - 1 ? '"' : ''}`]
		})
		.join(' ')
}

// As names are told apart: without case, accents or punctuation, and "dad's" as "dad"
const fold = (text: string) => foldName(text.replace(/['’]s$/iu, ''))

const MONTHS = 'january february march april may june july august september october november december'.split(' ')
// "may" and "march" are words before they are months: alone they stay words
const AMBIGUOUS_MONTHS = new Set(['may', 'march'])
// The seasons of the northern half of the world, by their first month: winter runs into the next year
const SEASONS: Record<string, number> = {spring: 2, summer: 5, autumn: 8, fall: 8, winter: 11}
const UNITS = ['day', 'week', 'month', 'year'] as const
const NUMBERS = 'one two three four five six seven eight nine ten eleven twelve'.split(' ')
type Unit = (typeof UNITS)[number]

// The first run of words that says when, of the ones nothing else was read
// from. Every stretch of time starts when it says and ends just before `end`,
// by the device's own clock, like the dates Photos shows.
function findDate(words: string[], free: (from: number, length: number) => boolean, now: Date) {
	const year = (word?: string) => {
		const value = /^(19|20)\d\d$/.test(word ?? '') ? Number(word) : undefined
		return value !== undefined && value <= now.getFullYear() + 1 ? value : undefined
	}
	const month = (word?: string) => {
		const index = MONTHS.findIndex((name) => name === word || (word?.length === 3 && name.startsWith(word)))
		return index === -1 ? undefined : index
	}
	const day = (word?: string) => {
		const value = /^\d{1,2}(st|nd|rd|th)?$/.test(word ?? '') ? Number.parseInt(word!, 10) : undefined
		return value && value <= 31 ? value : undefined
	}
	const stretch = (from: number, length: number, label: string, start: Date, end: Date) => ({
		from,
		length,
		label,
		start: start.getTime(),
		end: end.getTime(),
	})
	const called = (index: number) => MONTHS[index]![0]!.toUpperCase() + MONTHS[index]!.slice(1)
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
	const unit = (word?: string) => UNITS.find((name) => word === name || word === `${name}s`)

	for (let index = 0; index < words.length; index++) {
		if (!free(index, 1)) continue
		const [word, next, afterNext] = [words[index]!, words[index + 1], words[index + 2]]

		// 2024-08-12
		const whole = /^(\d{4}) (\d{2}) (\d{2})$/.exec(word)
		if (whole && year(whole[1])) {
			const [y, m, d] = [Number(whole[1]), Number(whole[2]) - 1, Number(whole[3])]
			const date = new Date(y, m, d)
			// A thirteenth month or a 30 February is not a date
			if (date.getMonth() === m && date.getDate() === d) {
				return stretch(index, 1, `${d} ${called(m)} ${y}`, date, new Date(y, m, d + 1))
			}
		}

		// 12 august 2024, august 12 2024, august 2024, august
		const first = month(word) !== undefined
		const m = first ? month(word) : day(word) ? month(next) : undefined
		if (m !== undefined) {
			const d = first ? (year(next) ? undefined : day(next)) : day(word)
			const stated = year(words[index + (d ? 2 : 1)])
			const length = (d ? 2 : 1) + (stated ? 1 : 0)
			const alone = AMBIGUOUS_MONTHS.has(word) && !d && !stated && !LEADING.has(words[index - 1] ?? '')
			if (free(index, length) && !alone) {
				// With no year, the last one that month has been in
				const y = stated ?? (new Date(now.getFullYear(), m, d ?? 1) > now ? now.getFullYear() - 1 : now.getFullYear())
				if (d) return stretch(index, length, `${d} ${called(m)} ${y}`, new Date(y, m, d), new Date(y, m, d + 1))
				return stretch(index, length, `${called(m)} ${y}`, new Date(y, m, 1), new Date(y, m + 1, 1))
			}
		}

		// summer 2023
		if (word in SEASONS && year(next) && free(index, 2)) {
			const label = `${word[0]!.toUpperCase()}${word.slice(1)} ${next}`
			return stretch(
				index,
				2,
				label,
				new Date(year(next)!, SEASONS[word]!, 1),
				new Date(year(next)!, SEASONS[word]! + 3, 1),
			)
		}

		const y = year(word)
		if (y) return stretch(index, 1, String(y), new Date(y, 0, 1), new Date(y + 1, 0, 1))

		if (word === 'today') return stretch(index, 1, 'Today', today, shift(today, 'day', 1))
		if (word === 'yesterday') return stretch(index, 1, 'Yesterday', shift(today, 'day', -1), today)

		// this week, last month, last 3 weeks, past year
		if (word === 'this' && unit(next) && free(index, 2)) {
			const start = startOf(today, unit(next)!)
			return stretch(index, 2, `This ${unit(next)}`, start, shift(start, unit(next)!, 1))
		}
		if ((word === 'last' || word === 'past') && free(index, 2)) {
			const count = /^\d{1,3}$/.test(next ?? '') ? Number(next) : NUMBERS.indexOf(next ?? '') + 1 || undefined
			if (count && unit(afterNext) && free(index, 3)) {
				const label = `Last ${count} ${unit(afterNext)}${count === 1 ? '' : 's'}`
				return stretch(index, 3, label, shift(today, unit(afterNext)!, -count), shift(today, 'day', 1))
			}
			if (unit(next) && unit(next) !== 'day') {
				// The past week is the seven days until now, last week the one before this
				if (word === 'past') {
					return stretch(index, 2, `Past ${unit(next)}`, shift(today, unit(next)!, -1), shift(today, 'day', 1))
				}
				const end = startOf(today, unit(next)!)
				return stretch(index, 2, `Last ${unit(next)}`, shift(end, unit(next)!, -1), end)
			}
		}
	}
}

function startOf(date: Date, unit: Unit) {
	if (unit === 'year') return new Date(date.getFullYear(), 0, 1)
	if (unit === 'month') return new Date(date.getFullYear(), date.getMonth(), 1)
	// A week starts on its Monday
	if (unit === 'week') return new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7))
	return date
}

function shift(date: Date, unit: Unit, count: number) {
	const [years, months, days] = [
		unit === 'year' ? count : 0,
		unit === 'month' ? count : 0,
		unit === 'week' ? count * 7 : unit === 'day' ? count : 0,
	]
	return new Date(date.getFullYear() + years, date.getMonth() + months, date.getDate() + days)
}
