// Pure math for the time rail: the index of months down the right edge of a
// long timeline. Kept free of React and of the DOM, like timeline-rows:
// every question the rail asks — which month is under a rail point, where a
// month sits on the rail, what time the viewport is looking at, what
// scrollTop shows a month — is arithmetic over the item list, the layout and
// the library calendar, so it is answered for the whole timeline whether it
// is loaded or not.
//
// The rail maps *time*, weighted by how many items each month holds: a month
// with three thousand photos gets proportionally more rail than a month with
// forty — which is also (rows being uniform) proportional to scroll
// distance, so a spot on the rail lands where the eye expects.

import {
	firstItemBelow,
	rectOf,
	sectionIndexAt,
	sectionIndexOf,
	type Layout,
} from '@/features/photos/components/listing/timeline-rows'

// ── Months ────────────────────────────────────────────────────────────────

// A month is one number, year·12 + month₀, in UTC — the same calendar the
// grid's grouping and the backend's `summary.months` use, so a server/
// browser timezone difference can't shift a boundary.
export type MonthKey = number

export function monthKeyOf(takenAt: number): MonthKey {
	const date = new Date(takenAt)
	return date.getUTCFullYear() * 12 + date.getUTCMonth()
}

// From the calendar's shape: year plus month 1–12
export const monthKeyFor = (year: number, month: number): MonthKey => year * 12 + (month - 1)

export const yearOf = (key: MonthKey) => Math.floor(key / 12)

// Epoch ms of the month's UTC start; a month's end is the next month's start
export function monthStartUtc(key: MonthKey): number {
	const year = Math.floor(key / 12)
	return Date.UTC(year, key - year * 12, 1)
}

// ── The rail's domain ─────────────────────────────────────────────────────

export type MonthBucket = {key: MonthKey; count: number; estimated?: boolean}

// The months the loaded (newest-first) list holds, newest first. Items of a
// month are contiguous under the list's takenAt ordering, so this is one pass.
export function monthsFromItems(items: {takenAt: number}[]): MonthBucket[] {
	const buckets: MonthBucket[] = []
	let open: MonthBucket | undefined
	for (const item of items) {
		const key = monthKeyOf(item.takenAt)
		if (!open || open.key !== key) {
			open = {key, count: 0}
			buckets.push(open)
		}
		open.count++
	}
	return buckets
}

// However far the estimated tail reaches, it never fabricates more than
// fifty years of months
const MAX_ESTIMATED_MONTHS = 600

const monthBucketsOf = (calendar: {year: number; month: number; count: number}[]): MonthBucket[] =>
	calendar
		.filter(({count}) => count > 0)
		.map(({year, month, count}) => ({key: monthKeyFor(year, month), count}))
		.sort((a, b) => b.key - a.key)

// Every month the rail spans, newest first, with how many items each holds.
// Exact when this listing's own calendar is known — the library summary's
// months, there before a single page beyond the first has loaded. A filtered
// listing has no calendar of its own, so its unloaded remainder (`total`
// less what is loaded) borrows the library's as a *shape*: what remains is
// spread over the library's months older than the loaded frontier, in
// proportion to how full each is — the filtered span can't outrun the
// library's, and its density usually follows it. Only with no calendar at
// all does the tail fall back to continuing at the loaded months' average
// density, which a recent-heavy first page can badly skew (dense months load
// first, so the tail reads too short) — which is why the rail holds off
// showing until the summary has answered.
export function railDomain({
	loaded,
	calendar,
	shape,
	total,
}: {
	loaded: MonthBucket[]
	calendar?: {year: number; month: number; count: number}[]
	shape?: {year: number; month: number; count: number}[]
	total?: number
}): MonthBucket[] {
	if (calendar !== undefined) return monthBucketsOf(calendar)
	if (loaded.length === 0) return []
	const loadedCount = loaded.reduce((sum, {count}) => sum + count, 0)
	const remaining = Math.max(0, (total ?? loadedCount) - loadedCount)
	if (remaining === 0) return loaded
	const oldest = loaded[loaded.length - 1]!.key
	if (shape !== undefined) {
		const older = monthBucketsOf(shape).filter(({key}) => key < oldest)
		const weight = older.reduce((sum, {count}) => sum + count, 0)
		if (weight > 0) {
			return [...loaded, ...older.map(({key, count}) => ({key, count: (count / weight) * remaining, estimated: true}))]
		}
	}
	const perMonth = Math.max(1, loadedCount / loaded.length)
	const tail = Math.min(MAX_ESTIMATED_MONTHS, Math.max(1, Math.round(remaining / perMonth)))
	const buckets = [...loaded]
	for (let index = 0; index < tail; index++) {
		buckets.push({key: oldest - 1 - index, count: remaining / tail, estimated: true})
	}
	return buckets
}

// Keys descend: the first bucket at or below the month
export function bucketIndexFor(buckets: MonthBucket[], key: MonthKey): number {
	if (buckets.length === 0) return 0
	if (key >= buckets[0]!.key) return 0
	if (key <= buckets[buckets.length - 1]!.key) return buckets.length - 1
	let lo = 0
	let hi = buckets.length - 1
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (buckets[mid]!.key <= key) hi = mid
		else lo = mid + 1
	}
	return lo
}

// How many calendar months the domain spans, gaps included
export const monthSpan = (buckets: MonthBucket[]) =>
	buckets.length === 0 ? 0 : buckets[0]!.key - buckets[buckets.length - 1]!.key + 1

// ── The scale: months ⇄ rail pixels ───────────────────────────────────────

export type RailSegment = {key: MonthKey; top: number; span: number; count: number; estimated: boolean}
export type RailScale = {segments: RailSegment[]; height: number}

// Each month's slice of the track, purely proportional to its count — no
// floors, so the rail stays honest with scroll distance; a three-photo month
// in a dense library is nearly invisible on the rail, as it is in the grid.
export function buildScale(buckets: MonthBucket[], height: number): RailScale {
	const total = buckets.reduce((sum, {count}) => sum + count, 0)
	const segments: RailSegment[] = []
	let top = 0
	for (const bucket of buckets) {
		const span = total > 0 ? (bucket.count / total) * height : height / buckets.length
		segments.push({key: bucket.key, top, span, count: bucket.count, estimated: bucket.estimated === true})
		top += span
	}
	return {segments, height}
}

// The month under a rail point, and how far through it the point sits
export function monthAtRailY(scale: RailScale, y: number): {key: MonthKey; fraction: number} | undefined {
	const {segments, height} = scale
	if (segments.length === 0) return undefined
	const clamped = Math.min(Math.max(0, y), height)
	let lo = 0
	let hi = segments.length - 1
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1
		if (segments[mid]!.top <= clamped) lo = mid
		else hi = mid - 1
	}
	const segment = segments[lo]!
	const fraction = segment.span > 0 ? Math.min(1, (clamped - segment.top) / segment.span) : 0
	return {key: segment.key, fraction}
}

// Where a month sits on the rail. A month the domain skips (an empty gap)
// lands on the boundary it would occupy — the top of the first older segment.
export function railYForMonth(scale: RailScale, key: MonthKey, fraction = 0): number {
	const {segments, height} = scale
	if (segments.length === 0) return 0
	if (key > segments[0]!.key) return 0
	if (key < segments[segments.length - 1]!.key) return height
	// Keys descend: the first segment at or below the month
	let lo = 0
	let hi = segments.length - 1
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (segments[mid]!.key <= key) hi = mid
		else lo = mid + 1
	}
	const segment = segments[lo]!
	return segment.key === key ? segment.top + Math.min(1, Math.max(0, fraction)) * segment.span : segment.top
}

// ── Year marks ────────────────────────────────────────────────────────────

export type YearMark = {year: number; y: number; span: number}

// One mark per year in the domain, at the top of its newest month's segment
export function yearMarks(scale: RailScale): YearMark[] {
	const marks: YearMark[] = []
	let open: YearMark | undefined
	for (const segment of scale.segments) {
		const year = yearOf(segment.key)
		if (!open || open.year !== year) {
			open = {year, y: segment.top, span: 0}
			marks.push(open)
		}
		open.span += segment.span
	}
	return marks
}

// Which year marks get a printed label: every one when the rail has room,
// decades first when it doesn't — so a crowded century decimates to 1990,
// 2000, 2010 rather than to whichever years happened to fit.
export function pickYearLabels(marks: YearMark[], minGap: number): YearMark[] {
	const kept: YearMark[] = []
	const fits = (mark: YearMark) => kept.every((other) => Math.abs(other.y - mark.y) >= minGap)
	for (const mark of marks) if (mark.year % 10 === 0 && fits(mark)) kept.push(mark)
	for (const mark of marks) if (mark.year % 10 !== 0 && fits(mark)) kept.push(mark)
	return kept.sort((a, b) => a.y - b.y)
}

// What the rail's labels count in: years over a long domain, months over a
// short one — a ten-week listing still deserves a legible axis
export type LabelUnit = 'years' | 'months'
export const labelUnit = (buckets: MonthBucket[]): LabelUnit => (monthSpan(buckets) >= 24 ? 'years' : 'months')

// Month labels for a short domain, decimated like the years are: Januaries
// anchor first (they carry the year), quarter starts next, the rest where
// room remains.
export type MonthMark = {key: MonthKey; y: number}
export function pickMonthLabels(scale: RailScale, minGap: number): MonthMark[] {
	const rank = (key: MonthKey) => {
		const month = ((key % 12) + 12) % 12
		return month === 0 ? 0 : month % 3 === 0 ? 1 : 2
	}
	const marks: MonthMark[] = scale.segments.map(({key, top}) => ({key, y: top}))
	const kept: MonthMark[] = []
	const fits = (mark: MonthMark) => kept.every((other) => Math.abs(other.y - mark.y) >= minGap)
	for (let priority = 0; priority <= 2; priority++) {
		for (const mark of marks) if (rank(mark.key) === priority && fits(mark)) kept.push(mark)
	}
	return kept.sort((a, b) => a.y - b.y)
}

// The takenAt under a (month, fraction) spot, from the loaded list — what a
// short-span pill names to the day; undefined while the month isn't loaded
export function timeAtFraction(items: {takenAt: number}[], key: MonthKey, fraction: number): number | undefined {
	const {start, end} = monthRange(items, key)
	if (start >= end) return undefined
	const index = Math.min(end - 1, start + Math.floor(Math.min(1, Math.max(0, fraction)) * (end - start)))
	return items[index]!.takenAt
}

// ── Time ⇄ scroll ─────────────────────────────────────────────────────────

// The first index whose takenAt is strictly below `t`, over the newest-first
// list — the boundary every month question reduces to
export function firstIndexBefore(items: {takenAt: number}[], t: number): number {
	let lo = 0
	let hi = items.length
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (items[mid]!.takenAt < t) hi = mid
		else lo = mid + 1
	}
	return lo
}

// The [start, end) run of a month's items; start === end when the list holds
// none of it (not loaded yet, or the listing simply skips the month)
export function monthRange(items: {takenAt: number}[], key: MonthKey): {start: number; end: number} {
	return {start: firstIndexBefore(items, monthStartUtc(key + 1)), end: firstIndexBefore(items, monthStartUtc(key))}
}

// The month the viewport's top row is looking at, and how far through it —
// what the rail's thumb marks. Strictly below the top, unlike the render
// window's predicate: a row whose bottom edge exactly touches the viewport
// top shows no pixels, and the eye is on the header or row beneath it.
export function timeAtScroll(layout: Layout, scrollTop: number): {key: MonthKey; fraction: number} | undefined {
	const {items} = layout
	if (items.length === 0) return undefined
	const index = Math.min(items.length - 1, firstItemBelow(layout, scrollTop))
	const key = monthKeyOf(items[index]!.takenAt)
	const {start, end} = monthRange(items, key)
	return {key, fraction: Math.min(1, Math.max(0, (index - start) / Math.max(1, end - start)))}
}

export type ScrollWindow = {inset: number; viewport: number; trailing: number}

const clampScroll = (layout: Layout, target: number, {viewport, trailing}: ScrollWindow) =>
	Math.max(0, Math.min(target, layout.total + trailing - viewport))

// The scrollTop that shows a month, or undefined while the list holds none
// of it. A month's newest item opens a section under months and days
// grouping (a new month is always a new day), and then the month lands with
// its header exactly where the first header sits at rest — under the bar,
// its title handed off (tops[0] is the layout's own inset). Mid-month, or
// mid-year under years grouping, the row itself lands just under the bar.
export function scrollForMonth(
	layout: Layout,
	key: MonthKey,
	fraction: number,
	window: ScrollWindow,
): number | undefined {
	const {items, sections, tops} = layout
	const {start, end} = monthRange(items, key)
	if (start >= end) return undefined
	const index = Math.min(end - 1, start + Math.floor(Math.min(1, Math.max(0, fraction)) * (end - start)))
	if (index === start && sections.length > 0) {
		const section = sectionIndexOf(layout, index)
		if (sections[section]!.start === index) return clampScroll(layout, tops[section]! - tops[0]!, window)
	}
	return clampScroll(layout, rectOf(layout, index).y - window.inset, window)
}

// Where a moment would sit: the row of the first item at or past it — the
// landing for a month the listing turns out not to hold
export function scrollForTime(layout: Layout, t: number, window: ScrollWindow): number | undefined {
	const {items} = layout
	if (items.length === 0) return undefined
	const index = Math.min(items.length - 1, firstIndexBefore(items, t))
	return clampScroll(layout, rectOf(layout, index).y - window.inset, window)
}

// `scrollForMonth`, for a landing the actions bar must agree with. The bar
// names the section whose header has reached the hand-off (see TimelineGrid),
// and a row parked just under the bar — the first row of a section — still
// has its header below that line, so the bar would name the section before
// it: a scrubber's bubble saying October over a bar saying November. Such a
// landing goes the header's height further, to where the section hands its
// title off; anywhere else in a section the two already agree.
export function scrollNamingMonth(
	layout: Layout,
	key: MonthKey,
	fraction: number,
	window: ScrollWindow & {handoff: number},
): number | undefined {
	const target = scrollForMonth(layout, key, fraction, window)
	if (target === undefined) return undefined
	const {items, tops} = layout
	const {start, end} = monthRange(items, key)
	const index = Math.min(end - 1, start + Math.floor(Math.min(1, Math.max(0, fraction)) * (end - start)))
	const top = tops[sectionIndexOf(layout, index)]
	if (top === undefined || target + window.handoff >= top) return target
	// A pixel past the line, so a scrollTop the browser rounds to its device
	// pixels can't fall back short of it
	return clampScroll(layout, top - window.handoff + 1, window)
}

// The month the actions bar is naming at a scroll position: its section is
// the one at the hand-off line (see TimelineGrid), and the month is that of
// the row at the top of what the eye can see, kept inside that section — one
// month under months or days grouping, and under years the month the eye is
// actually on within the year the bar says. What a scrubber's bubble shows
// once the grid can travel no further (the foot of the list), so the two
// never disagree.
export function monthNamedAt(
	layout: Layout,
	scrollTop: number,
	window: {inset: number; handoff: number},
): MonthKey | undefined {
	const {items, sections} = layout
	if (items.length === 0 || sections.length === 0) return undefined
	const section = sections[sectionIndexAt(layout, scrollTop + window.handoff)]!
	const first = firstItemBelow(layout, scrollTop + window.inset)
	const index = Math.min(section.start + section.count - 1, Math.max(section.start, first))
	return monthKeyOf(items[index]!.takenAt)
}
