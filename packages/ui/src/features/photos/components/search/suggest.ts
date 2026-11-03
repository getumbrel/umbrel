import type {SearchToken} from '@/features/photos/components/view-context'
import type {PhotoSubKind} from '@/features/photos/constants'
import {capitalizeDate} from '@/utils/date-time'

// What the search field's text could mean, structurally. Everything here is
// computed from data the app already holds — the library's calendar (which
// months hold something, from the summary), the sources list, and the
// photo/video split — so suggestions cost no round trip and arrive with the
// keystroke. Free text needs no suggestion: it is already narrowing the grid
// by file name as it is typed.

// A month the library has items in, newest first, as the summary reports it.
// Identified by year/month (1–12), not an epoch: the range a suggestion
// carries uses UTC, matching the backend's calendar buckets.
export type MonthCount = {year: number; month: number; count: number}

export type SuggestSource = {id: string; name: string; count?: number}
export type SuggestAlbum = {id: string; name: string; count?: number}
export type SuggestKind = {kind: 'photo' | 'video'; label: string; count?: number}
export type SuggestSubKind = {subKind: PhotoSubKind; label: string; count?: number}

// A suggestion is the token choosing it would add, plus how many items it
// holds (when the count would be truthful for the current view)
export type Suggestion = {token: SearchToken; count?: number}

// With nothing typed the panel is an invitation, not a void: the split, the
// sources, the albums and the freshest months, each one tap away. Typed text
// is read as a date first and foremost — a month name or its start ("aug"),
// a year ("2024", or just "20"), a month of a year in either order
// ("aug 2024", "8/2024"), or a range between two of those ("2019–2021",
// "aug 2024 - jan 2025") — and as a source, album or kind by name. Only
// stretches of the calendar that actually hold something are offered.
export function suggest({
	text,
	locale,
	months,
	sources,
	albums,
	kinds,
	subKinds = [],
}: {
	text: string
	locale: string
	months: MonthCount[]
	sources: SuggestSource[]
	albums: SuggestAlbum[]
	kinds: SuggestKind[]
	subKinds?: SuggestSubKind[]
}): Suggestion[] {
	const needle = text.trim().toLocaleLowerCase(locale)
	const out: Suggestion[] = []
	for (const {kind, label, count} of kinds) {
		if (!needle || label.toLocaleLowerCase(locale).startsWith(needle)) out.push({token: {type: 'kind', kind}, count})
	}
	for (const {subKind, label, count} of subKinds) {
		if (!needle || label.toLocaleLowerCase(locale).startsWith(needle))
			out.push({token: {type: 'subKind', subKind, label}, count})
	}
	for (const {id, name, count} of sources) {
		if (!needle || name.toLocaleLowerCase(locale).includes(needle))
			out.push({token: {type: 'source', id, label: name}, count})
	}
	// A library can hold many albums; browsing shows only the front of the
	// caller's order (freshest first) — the rest are a few letters away
	const browsedAlbums = needle ? albums : albums.slice(0, MAX_BROWSE_ALBUMS)
	for (const {id, name, count} of browsedAlbums) {
		if (!needle || name.toLocaleLowerCase(locale).includes(needle))
			out.push({token: {type: 'album', id, label: name}, count})
	}
	out.push(...dates(needle, months, locale))
	return out
}

const MAX_BROWSE_ALBUMS = 6

const MAX_DATES = 5

function dates(needle: string, months: MonthCount[], locale: string): Suggestion[] {
	if (!needle) return months.slice(0, 3).map((month) => monthSuggestion(month, locale))

	// A range: two parseable dates around a dash, "to" or "..". Bare-hyphen
	// years ("2019-2021") are read too; a bare hyphen inside a word is not a
	// range, it's a file name.
	const parts = /^(\d{4})\s*-\s*(\d{4})$/.exec(needle)?.slice(1) ?? needle.split(/\s*(?:–|—|\.{2})\s*|\s+(?:-|to)\s+/)
	if (parts.length === 2) {
		const spans = [parseSpan(parts[0], locale), parseSpan(parts[1], locale)]
		if (spans[0] && spans[1]) {
			const [lo, hi] = spans[0].from <= spans[1].from ? (spans as [Span, Span]) : [spans[1], spans[0]]
			const span = {from: lo.from, to: hi.to}
			const count = countIn(months, span)
			if (count === 0) return []
			const label = capitalizeDate(`${shortLabel(lo, locale)} – ${shortLabel(hi, locale)}`, locale)
			return [{token: {type: 'date', label, ...span}, count}]
		}
		return []
	}

	// One date: a whole month or year the text pins down…
	const span = parseSpan(needle, locale)
	if (span) {
		const count = countIn(months, span)
		return count > 0
			? [{token: {type: 'date', label: longLabel(span, locale), from: span.from, to: span.to}, count}]
			: []
	}

	// … or the start of one: a month name's first letters name that month in
	// every year that has it, newest first; a year's first digits name the
	// matching years
	if (/^\p{L}+$/u.test(needle)) {
		const matching = monthNumbers(needle, locale)
		return months
			.filter((month) => matching.has(month.month))
			.slice(0, MAX_DATES)
			.map((month) => monthSuggestion(month, locale))
	}
	if (/^\d{2,3}$/.test(needle)) {
		const byYear = new Map<number, number>()
		for (const {year, count} of months) byYear.set(year, (byYear.get(year) ?? 0) + count)
		return [...byYear.entries()]
			.filter(([year]) => String(year).startsWith(needle))
			.sort((a, b) => b[0] - a[0])
			.slice(0, MAX_DATES)
			.map(([year, count]) => {
				const span = yearSpan(year)
				return {token: {type: 'date', label: String(year), from: span.from, to: span.to}, count}
			})
	}
	return []
}

// A stretch of the calendar the text names outright: a year, or one month of
// one year. `unit` keeps the range label honest ("2019 – Aug 2021").
type Span = {from: number; to: number; unit: 'month' | 'year'; year: number; month?: number}

function parseSpan(part: string, locale: string): Span | undefined {
	const words = part.split(/\s+/)
	if (words.length === 1) {
		const [word] = words as [string]
		if (/^\d{4}$/.test(word)) return yearSpan(Number(word))
		// "8/2024" or "2024/8" (slash or dot)
		const monthFirst = /^(\d{1,2})[/.](\d{4})$/.exec(word)
		const yearFirst = /^(\d{4})[/.](\d{1,2})$/.exec(word)
		const month = Number(monthFirst?.[1] ?? yearFirst?.[2])
		const year = Number(monthFirst?.[2] ?? yearFirst?.[1])
		if (month >= 1 && month <= 12) return monthSpan(year, month)
		return undefined
	}
	if (words.length === 2) {
		// "aug 2024" either way round — but only when the letters pin down a
		// single month ("ju 2024" could be June or July, so it names neither)
		const year = words.find((word) => /^\d{4}$/.test(word))
		const name = words.find((word) => /^\p{L}+$/u.test(word))
		if (!year || !name) return undefined
		const matching = monthNumbers(name, locale)
		if (matching.size !== 1) return undefined
		return monthSpan(Number(year), [...matching][0]!)
	}
	return undefined
}

function monthSpan(year: number, month: number): Span {
	return {from: Date.UTC(year, month - 1), to: Date.UTC(year, month), unit: 'month', year, month}
}
function yearSpan(year: number): Span {
	return {from: Date.UTC(year, 0), to: Date.UTC(year + 1, 0), unit: 'year', year}
}

// The month numbers (1–12) whose locale name starts with the typed letters
function monthNumbers(needle: string, locale: string) {
	const format = new Intl.DateTimeFormat(locale, {month: 'long', timeZone: 'UTC'})
	const matching = new Set<number>()
	for (let month = 0; month < 12; month++) {
		if (
			format
				.format(new Date(Date.UTC(2000, month)))
				.toLocaleLowerCase(locale)
				.startsWith(needle)
		)
			matching.add(month + 1)
	}
	return matching
}

function monthSuggestion({year, month, count}: MonthCount, locale: string): Suggestion {
	const span = monthSpan(year, month)
	return {token: {type: 'date', label: longLabel(span, locale), from: span.from, to: span.to}, count}
}

function longLabel(span: Span, locale: string) {
	if (span.unit === 'year') return String(span.year)
	return capitalizeDate(
		new Intl.DateTimeFormat(locale, {month: 'long', year: 'numeric', timeZone: 'UTC'}).format(span.from),
		locale,
	)
}
function shortLabel(span: Span, locale: string) {
	if (span.unit === 'year') return String(span.year)
	return new Intl.DateTimeFormat(locale, {month: 'short', year: 'numeric', timeZone: 'UTC'}).format(span.from)
}

function countIn(months: MonthCount[], span: {from: number; to: number}) {
	let count = 0
	for (const month of months) {
		const start = Date.UTC(month.year, month.month - 1)
		if (start >= span.from && start < span.to) count += month.count
	}
	return count
}
