import {describe, expect, it} from 'vitest'

import {
	groupItems,
	HEADER_HEIGHT,
	layoutAt,
	rectOf,
	sectionAt,
} from '@/features/photos/components/listing/timeline-rows'
import type {Item} from '@/features/photos/hooks/use-items'

import {
	buildScale,
	firstIndexBefore,
	labelUnit,
	monthAtRailY,
	monthKeyFor,
	monthKeyOf,
	monthNamedAt,
	monthRange,
	monthsFromItems,
	monthSpan,
	monthStartUtc,
	pickMonthLabels,
	pickYearLabels,
	railDomain,
	railYForMonth,
	scrollForMonth,
	scrollForTime,
	scrollNamingMonth,
	timeAtFraction,
	timeAtScroll,
	yearMarks,
	yearOf,
} from './rail-scale'

const item = (id: string, takenAt: number): Item => ({
	id,
	kind: 'photo',
	takenAt,
	width: 4,
	height: 3,
	isFavorite: false,
})
const at = (iso: string) => new Date(iso).getTime()

// `count` items spread through one UTC month, newest first within the month
function month(year: number, month1: number, count: number, prefix: string): Item[] {
	const start = Date.UTC(year, month1 - 1, 1)
	const end = Date.UTC(year, month1, 1)
	const step = (end - start) / (count + 1)
	return Array.from({length: count}, (_, index) => item(`${prefix}${index}`, Math.round(end - (index + 1) * step)))
}

const layoutOf = (items: Item[], columns = 4, tile = 100, gap = 0, inset = 0, hasMore = false) =>
	layoutAt(groupItems({items, zoom: 'months', hasMore, language: 'en-US'}), columns, tile, gap, inset)

describe('month keys', () => {
	it('are UTC and roundtrip through month starts', () => {
		const key = monthKeyOf(at('2024-06-15T12:00:00Z'))
		expect(key).toBe(monthKeyFor(2024, 6))
		expect(yearOf(key)).toBe(2024)
		expect(monthStartUtc(key)).toBe(Date.UTC(2024, 5, 1))
		expect(monthStartUtc(key + 1)).toBe(Date.UTC(2024, 6, 1))
	})

	it('do not shift across the December–January boundary', () => {
		const december = monthKeyOf(Date.UTC(2023, 11, 31, 23, 59, 59))
		const january = monthKeyOf(Date.UTC(2024, 0, 1, 0, 0, 0))
		expect(january - december).toBe(1)
		expect(yearOf(december)).toBe(2023)
		expect(yearOf(january)).toBe(2024)
	})
})

describe('monthsFromItems', () => {
	it('buckets a newest-first list by month, in order', () => {
		const items = [...month(2024, 6, 3, 'a'), ...month(2024, 5, 2, 'b'), ...month(2023, 12, 1, 'c')]
		expect(monthsFromItems(items)).toEqual([
			{key: monthKeyFor(2024, 6), count: 3},
			{key: monthKeyFor(2024, 5), count: 2},
			{key: monthKeyFor(2023, 12), count: 1},
		])
	})

	it('is empty for an empty list', () => {
		expect(monthsFromItems([])).toEqual([])
	})
})

describe('railDomain', () => {
	it('prefers the calendar, sorted newest first, dropping empty months', () => {
		const domain = railDomain({
			loaded: [{key: monthKeyFor(2024, 6), count: 1}],
			calendar: [
				{year: 2023, month: 1, count: 5},
				{year: 2024, month: 6, count: 7},
				{year: 2023, month: 6, count: 0},
			],
			total: 12,
		})
		expect(domain).toEqual([
			{key: monthKeyFor(2024, 6), count: 7},
			{key: monthKeyFor(2023, 1), count: 5},
		])
	})

	it('returns the loaded months alone when nothing remains', () => {
		const loaded = [{key: monthKeyFor(2024, 6), count: 10}]
		expect(railDomain({loaded, total: 10})).toEqual(loaded)
	})

	it('spreads the unloaded remainder over an estimated tail at loaded density', () => {
		const loaded = [
			{key: monthKeyFor(2024, 6), count: 100},
			{key: monthKeyFor(2024, 5), count: 100},
		]
		const domain = railDomain({loaded, total: 600})
		const tail = domain.slice(2)
		expect(tail.length).toBe(4) // 400 remaining at ~100/month
		expect(tail.every(({estimated}) => estimated)).toBe(true)
		// Contiguous below the oldest loaded month
		expect(tail.map(({key}) => key)).toEqual([1, 2, 3, 4].map((step) => monthKeyFor(2024, 5) - step))
		// Counts still sum to the listing's total
		const sum = domain.reduce((total, {count}) => total + count, 0)
		expect(sum).toBeCloseTo(600)
	})

	it('shapes the tail on the library calendar when one is given', () => {
		const loaded = [{key: monthKeyFor(2024, 6), count: 100}]
		const shape = [
			{year: 2024, month: 6, count: 500}, // at the frontier: already loaded, not part of the tail
			{year: 2024, month: 2, count: 300},
			{year: 2021, month: 7, count: 100},
		]
		const domain = railDomain({loaded, shape, total: 300})
		expect(domain[0]).toEqual({key: monthKeyFor(2024, 6), count: 100})
		// The 200 remaining spread over the older library months, 3:1
		expect(domain.slice(1)).toEqual([
			{key: monthKeyFor(2024, 2), count: 150, estimated: true},
			{key: monthKeyFor(2021, 7), count: 50, estimated: true},
		])
	})

	it('falls back to loaded density when the shape holds nothing older', () => {
		const loaded = [{key: monthKeyFor(2024, 6), count: 100}]
		const shape = [{year: 2024, month: 6, count: 500}]
		const domain = railDomain({loaded, shape, total: 300})
		expect(domain.length).toBeGreaterThan(1)
		expect(domain.slice(1).every(({estimated}) => estimated)).toBe(true)
	})

	it('spans gaps in its month count', () => {
		expect(
			monthSpan([
				{key: monthKeyFor(2024, 6), count: 1},
				{key: monthKeyFor(2024, 1), count: 1},
			]),
		).toBe(6)
		expect(monthSpan([])).toBe(0)
	})
})

describe('buildScale', () => {
	it('gives each month a span proportional to its count', () => {
		const scale = buildScale(
			[
				{key: monthKeyFor(2024, 6), count: 300},
				{key: monthKeyFor(2024, 5), count: 100},
			],
			400,
		)
		expect(scale.segments[0]).toMatchObject({top: 0, span: 300})
		expect(scale.segments[1]).toMatchObject({top: 300, span: 100})
	})

	it('splits the track evenly when every count is zero', () => {
		const scale = buildScale(
			[
				{key: monthKeyFor(2024, 6), count: 0},
				{key: monthKeyFor(2024, 5), count: 0},
			],
			100,
		)
		expect(scale.segments.map(({span}) => span)).toEqual([50, 50])
	})
})

describe('rail position ⇄ month', () => {
	const scale = buildScale(
		[
			{key: monthKeyFor(2024, 6), count: 100},
			{key: monthKeyFor(2024, 4), count: 100}, // May missing: a gap
			{key: monthKeyFor(2024, 3), count: 200},
		],
		400,
	)

	it('roundtrips a point through its month and fraction', () => {
		const found = monthAtRailY(scale, 150)!
		expect(found.key).toBe(monthKeyFor(2024, 4))
		expect(found.fraction).toBeCloseTo(0.5)
		expect(railYForMonth(scale, found.key, found.fraction)).toBeCloseTo(150)
	})

	it('clamps beyond either end of the track', () => {
		expect(monthAtRailY(scale, -10)!.key).toBe(monthKeyFor(2024, 6))
		expect(monthAtRailY(scale, 999)!.key).toBe(monthKeyFor(2024, 3))
		expect(railYForMonth(scale, monthKeyFor(2025, 1))).toBe(0)
		expect(railYForMonth(scale, monthKeyFor(2020, 1))).toBe(400)
	})

	it('lands a gap month on the boundary it would occupy', () => {
		expect(railYForMonth(scale, monthKeyFor(2024, 5))).toBe(100)
	})

	it('answers nothing for an empty scale', () => {
		expect(monthAtRailY(buildScale([], 100), 10)).toBeUndefined()
	})
})

describe('label granularity', () => {
	it('counts in years over a long domain and months under two years', () => {
		expect(
			labelUnit([
				{key: monthKeyFor(2026, 6), count: 1},
				{key: monthKeyFor(2024, 6), count: 1},
			]),
		).toBe('years')
		expect(
			labelUnit([
				{key: monthKeyFor(2026, 6), count: 1},
				{key: monthKeyFor(2026, 4), count: 1},
			]),
		).toBe('months')
		expect(labelUnit([{key: monthKeyFor(2026, 6), count: 1}])).toBe('months')
	})

	it('anchors month labels on Januaries, then quarters, where room is tight', () => {
		const buckets = Array.from({length: 14}, (_, index) => ({key: monthKeyFor(2026, 8) - index, count: 10}))
		const scale = buildScale(buckets, 140) // 10px per month, min gap 25 below
		const kept = pickMonthLabels(scale, 25)
		const months = kept.map(({key}) => ((key % 12) + 12) % 12)
		expect(months).toContain(0) // January survives the crowding
		for (let index = 1; index < kept.length; index++) {
			expect(kept[index]!.y - kept[index - 1]!.y).toBeGreaterThanOrEqual(25)
		}
	})

	it('labels every month when the rail has room', () => {
		const buckets = [
			{key: monthKeyFor(2026, 6), count: 10},
			{key: monthKeyFor(2026, 5), count: 10},
			{key: monthKeyFor(2026, 4), count: 10},
		]
		expect(pickMonthLabels(buildScale(buckets, 300), 18).length).toBe(3)
	})
})

describe('timeAtFraction', () => {
	const items = [...month(2026, 6, 10, 'a'), ...month(2026, 5, 4, 'b')]

	it('names the moment under a month fraction from the loaded list', () => {
		const takenAt = timeAtFraction(items, monthKeyFor(2026, 6), 0.5)!
		expect(takenAt).toBe(items[5]!.takenAt)
		expect(monthKeyOf(takenAt)).toBe(monthKeyFor(2026, 6))
	})

	it('clamps its fraction and answers nothing for an unloaded month', () => {
		expect(timeAtFraction(items, monthKeyFor(2026, 6), 2)).toBe(items[9]!.takenAt)
		expect(timeAtFraction(items, monthKeyFor(2026, 4), 0.5)).toBeUndefined()
		expect(timeAtFraction([], monthKeyFor(2026, 6), 0)).toBeUndefined()
	})
})

describe('year marks and labels', () => {
	it('marks each year at the top of its newest month', () => {
		const scale = buildScale(
			[
				{key: monthKeyFor(2024, 2), count: 100},
				{key: monthKeyFor(2024, 1), count: 100},
				{key: monthKeyFor(2023, 12), count: 200},
			],
			400,
		)
		expect(yearMarks(scale)).toEqual([
			{year: 2024, y: 0, span: 200},
			{year: 2023, y: 200, span: 200},
		])
	})

	it('keeps decades first when labels crowd', () => {
		const marks = Array.from({length: 21}, (_, index) => ({year: 2020 - index, y: index * 10, span: 10}))
		const kept = pickYearLabels(marks, 25)
		const years = kept.map(({year}) => year)
		expect(years).toContain(2020)
		expect(years).toContain(2010)
		expect(years).toContain(2000)
		// … spaced at least the minimum apart
		for (let index = 1; index < kept.length; index++) {
			expect(kept[index]!.y - kept[index - 1]!.y).toBeGreaterThanOrEqual(25)
		}
	})
})

describe('time ⇄ scroll', () => {
	// 8 in June, 6 in May, 4 in March — 4 columns of 100px tiles
	const items = [...month(2024, 6, 8, 'a'), ...month(2024, 5, 6, 'b'), ...month(2024, 3, 4, 'c')]
	const layout = layoutOf(items)
	const window = {inset: 0, viewport: 300, trailing: 0}

	it('finds a month run by binary search', () => {
		expect(firstIndexBefore(items, monthStartUtc(monthKeyFor(2024, 6)))).toBe(8)
		expect(monthRange(items, monthKeyFor(2024, 5))).toEqual({start: 8, end: 14})
		expect(monthRange(items, monthKeyFor(2024, 4))).toEqual({start: 14, end: 14})
	})

	it('scrolls a month-opening item to the rest position of its header', () => {
		const target = scrollForMonth(layout, monthKeyFor(2024, 5), 0, window)!
		// May's section header lands where the first header sits at rest
		expect(target).toBe(layout.tops[1]! - layout.tops[0]!)
		const found = timeAtScroll(layout, target)!
		expect(found.key).toBe(monthKeyFor(2024, 5))
		expect(found.fraction).toBe(0)
	})

	it('scrolls mid-month to the row under the bar', () => {
		const window = {inset: 40, viewport: 300, trailing: 0}
		const target = scrollForMonth(layout, monthKeyFor(2024, 5), 0.5, window)!
		const index = 8 + Math.floor(0.5 * 6)
		expect(target).toBe(rectOf(layout, index).y - 40)
	})

	it('answers undefined for a month the list does not hold', () => {
		expect(scrollForMonth(layout, monthKeyFor(2024, 4), 0, window)).toBeUndefined()
		expect(scrollForMonth(layoutOf([]), monthKeyFor(2024, 6), 0, window)).toBeUndefined()
	})

	it('clamps to the scrollable extent', () => {
		const target = scrollForMonth(layout, monthKeyFor(2024, 3), 0.99, window)!
		expect(target).toBeLessThanOrEqual(layout.total - window.viewport)
		expect(target).toBeGreaterThanOrEqual(0)
	})

	it('lands a missing month where it would sit', () => {
		// April 2024 is empty: its landing is March's first row
		const target = scrollForTime(layout, monthStartUtc(monthKeyFor(2024, 4) + 1), window)!
		expect(target).toBe(Math.min(rectOf(layout, 14).y, layout.total - window.viewport))
	})

	it('tracks the viewport top through month fractions', () => {
		const mid = rectOf(layout, 12).y // May's second row: partway through the month
		const found = timeAtScroll(layout, mid)!
		expect(found.key).toBe(monthKeyFor(2024, 5))
		expect(found.fraction).toBeGreaterThan(0)
		expect(found.fraction).toBeLessThan(1)
	})

	it('answers nothing for an empty layout', () => {
		expect(timeAtScroll(layoutOf([]), 0)).toBeUndefined()
	})

	it('keeps headers in the geometry it reasons over', () => {
		// Sanity: the section math above depends on HEADER_HEIGHT rows existing
		expect(layout.tops[1]! - layout.tops[0]!).toBe(HEADER_HEIGHT + 2 * 100)
	})
})

describe('agreeing with the bar', () => {
	// A phone's frame: content starts 54px down, the bar names the section
	// whose header has reached 2px above the scroller's top (see surface.tsx)
	const frame = {inset: 54, handoff: -2}
	const items = [
		...month(2024, 6, 12, 'a'),
		...month(2024, 5, 7, 'b'),
		...month(2024, 3, 9, 'c'),
		...month(2023, 12, 20, 'd'),
	]
	const layout = layoutOf(items, 3, 120, 2, frame.inset - HEADER_HEIGHT)
	const window = {inset: frame.inset, viewport: 500, trailing: 80, handoff: frame.handoff}
	const max = layout.total + window.trailing - window.viewport
	const barMonth = (scrollTop: number) => Number(sectionAt(layout, scrollTop + frame.handoff)!.key.split(':')[2])

	it('lands every month so the bar names it, however far through it', () => {
		for (const key of [monthKeyFor(2024, 5), monthKeyFor(2024, 3), monthKeyFor(2023, 12)]) {
			for (const fraction of [0, 0.1, 0.34, 0.5, 0.99]) {
				const target = scrollNamingMonth(layout, key, fraction, window)!
				// The foot of the list can't scroll a late month to the top
				if (target >= max) continue
				expect(barMonth(target)).toBe(key)
			}
		}
	})

	it('only ever moves a landing on, never back, and by no more than a header', () => {
		for (const fraction of [0, 0.2, 0.6]) {
			const plain = scrollForMonth(layout, monthKeyFor(2024, 3), fraction, window)!
			const named = scrollNamingMonth(layout, monthKeyFor(2024, 3), fraction, window)!
			expect(named).toBeGreaterThanOrEqual(plain)
			expect(named - plain).toBeLessThanOrEqual(HEADER_HEIGHT + 1)
		}
		expect(scrollNamingMonth(layout, monthKeyFor(2024, 4), 0, window)).toBeUndefined()
	})

	it('names the month the bar names, at every scroll position', () => {
		for (let scrollTop = 0; scrollTop <= max; scrollTop += 7) {
			expect(monthNamedAt(layout, scrollTop, frame)).toBe(barMonth(scrollTop))
		}
		expect(monthNamedAt(layoutOf([]), 0, frame)).toBeUndefined()
	})

	it('names the month the eye is on within a year, under years grouping', () => {
		const years = layoutAt(groupItems({items, zoom: 'years', hasMore: false, language: 'en-US'}), 3, 120, 2, 16)
		const target = rectOf(years, 14).y - frame.inset // a May row, under 2024's header
		expect(monthNamedAt(years, target, frame)).toBe(monthKeyFor(2024, 5))
	})
})
