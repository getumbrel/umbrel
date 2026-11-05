import {describe, expect, it} from 'vitest'

import type {Item} from '@/features/photos/hooks/use-items'

import {
	anchoredScrollTop,
	blend,
	clampTileSize,
	clickColumns,
	columnRange,
	columnValue,
	defaultFocalY,
	defaultTileSize,
	findAnchor,
	FOOTER_HEIGHT,
	gridLayout,
	groupItems,
	HEADER_HEIGHT,
	headersIn,
	itemAt,
	itemsInRect,
	layoutAt,
	LOADER_HEIGHT,
	rectOf,
	sectionAt,
	TILE_SIZE,
	tileGap,
	tileRadius,
	tileRect,
	tileSizeFor,
	trackColumns,
	trackPosition,
	visibleItems,
	zoomTrack,
	type Layout,
	type Zoom,
} from './timeline-rows'

const item = (id: string, takenAt: number): Item => ({
	id,
	kind: 'photo',
	takenAt,
	width: 4,
	height: 3,
	isFavorite: false,
})
const at = (iso: string) => new Date(iso).getTime()
const group = (items: Item[], zoom: Zoom = 'months', hasMore = false) =>
	groupItems({items, zoom, hasMore, language: 'en-US'})
const layoutOf = (items: Item[], columns: number, tile = 100, gap = 3, inset = 0, hasMore = false) =>
	layoutAt(group(items, 'months', hasMore), columns, tile, gap, inset)

describe('gridLayout', () => {
	it('fills the row exactly and never drops below two columns', () => {
		const {columns, tile, gap} = gridLayout(1000, 180, false)
		expect(columns).toBe(5)
		expect(gap).toBe(tileGap(tile, false))
		expect(columns * tile + gap * (columns - 1)).toBeCloseTo(1000)
		expect(gridLayout(50, 400, false).columns).toBe(2)
		expect(gridLayout(0, 96, true).tile).toBeGreaterThan(0)
	})

	it('offers every column count between the largest and the smallest tile', () => {
		expect(columnRange(1200, false)).toEqual({min: 3, max: 24})
		expect(columnRange(360, true)).toEqual({min: 2, max: 8})
		expect(tileSizeFor(1200, 3, false)).toBeLessThanOrEqual(TILE_SIZE.desktop.max)
		expect(tileSizeFor(1200, 24, false)).toBeGreaterThanOrEqual(TILE_SIZE.desktop.min)
	})

	it('gives the mosaic a fifth of the zoom track and the DOM range the rest', () => {
		const track = zoomTrack(1200, false, TILE_SIZE.desktop.floor)
		expect(track).toEqual({min: 3, seam: 24, max: 85})
		// The ends, and the seam a fifth of the way along
		expect(trackPosition(track, track.max)).toBe(0)
		expect(trackPosition(track, track.seam)).toBeCloseTo(0.2)
		expect(trackPosition(track, track.min)).toBe(1)
		// Halfway along is a tile people would actually browse at, which is the
		// whole point — before the split it was 44 columns and a 27px tile
		expect(Math.round(trackColumns(track, 0.5))).toBe(16)
		expect(tileSizeFor(1200, trackColumns(track, 0.5), false)).toBeGreaterThan(70)
	})

	it('is a round trip, and spans the DOM range alone when there is no canvas', () => {
		for (const floor of [TILE_SIZE.desktop.floor, undefined]) {
			const track = zoomTrack(1200, false, floor)
			for (const position of [0, 0.1, 0.2, 0.5, 0.9, 1]) {
				expect(trackPosition(track, trackColumns(track, position))).toBeCloseTo(position)
			}
		}
		// Without a canvas the seam is the end of the track, so the DOM range
		// gets all of it and the control is exactly what it always was
		const dom = zoomTrack(1200, false)
		expect(dom).toEqual({min: 3, seam: 24, max: 24})
		expect(trackColumns(dom, 0)).toBe(24)
		expect(trackColumns(dom, 0.5)).toBeCloseTo(13.5)
		expect(trackColumns(dom, 1)).toBe(3)
	})

	it('reaches further out when the renderer can draw a smaller tile', () => {
		const {min, max} = columnRange(1200, false, TILE_SIZE.desktop.floor)
		expect(min).toBe(3)
		expect(max).toBeGreaterThan(columnRange(1200, false).max)
		expect(tileSizeFor(1200, max, false)).toBeGreaterThanOrEqual(TILE_SIZE.desktop.floor)
	})

	it('steps a click as a slice of the track, never less than a column', () => {
		const track = zoomTrack(1200, false, TILE_SIZE.desktop.floor) // {min: 3, seam: 24, max: 85}
		// Crossing the mosaic is a handful of clicks, not sixty-one
		let out = track.seam
		let outward = 0
		while (out < track.max) {
			out = clickColumns(track, out, 1)
			outward++
		}
		expect(outward).toBeLessThanOrEqual(6)
		let back = track.max
		let inward = 0
		while (back > track.seam) {
			back = clickColumns(track, back, -1)
			inward++
		}
		expect(inward).toBeLessThanOrEqual(6)
		// … while the browse range keeps the single-column feel it always had
		expect(clickColumns(track, 10, 1)).toBe(11)
		expect(clickColumns(track, 10, -1)).toBe(9)
		// Every click moves, in the direction asked, and the ends hold
		for (let columns = track.min; columns < track.max; columns++)
			expect(clickColumns(track, columns, 1)).toBeGreaterThan(columns)
		for (let columns = track.max; columns > track.min; columns--)
			expect(clickColumns(track, columns, -1)).toBeLessThan(columns)
		expect(clickColumns(track, track.max, 1)).toBe(track.max)
		expect(clickColumns(track, track.min, -1)).toBe(track.min)
		// A paging key asks for at least three columns
		expect(clickColumns(track, 10, 1, 3)).toBe(13)
		expect(clickColumns(track, 10, -1, 3)).toBe(7)
		// Without a canvas the control still walks its whole-column stops
		const dom = zoomTrack(1200, false)
		expect(clickColumns(dom, 10, 1)).toBe(11)
		expect(clickColumns(dom, dom.max, 1)).toBe(dom.max)
	})

	it('maps a tile size to a column value, clamped to the stops', () => {
		expect(columnValue(1200, 1000, false)).toBe(3)
		expect(columnValue(1200, 10, false)).toBe(24)
		for (const columns of [3, 6, 24]) {
			expect(columnValue(1200, tileSizeFor(1200, columns, false), false)).toBeCloseTo(columns, 1)
		}
		// A tile size persisted from a session that had the canvas is clamped
		// back up to the stops a session without it offers
		expect(columnValue(1200, 14, false)).toBe(columnRange(1200, false).max)
		expect(columnValue(1200, 14, false, TILE_SIZE.desktop.floor)).toBeCloseTo(85, 0)
		expect(clampTileSize(Number.NaN)).toBe(TILE_SIZE.desktop.initial)
		expect(clampTileSize(5)).toBe(TILE_SIZE.mobile.floor)
		expect(clampTileSize(14)).toBe(14)
		expect(clampTileSize(9999)).toBe(TILE_SIZE.desktop.max)
	})
})

describe('tileGap / tileRadius', () => {
	it('scales with the tile, reaching nothing at the small end', () => {
		expect(tileGap(180, false)).toBeCloseTo(5.6)
		expect(tileGap(48, false)).toBeCloseTo(1.2)
		expect(tileGap(400, false)).toBe(10)
		expect(tileGap(12, false)).toBe(0)
		expect(tileGap(6, false)).toBe(0)
	})

	it('stays within a pixel of the stepped gap it replaces at every size the DOM offers', () => {
		for (const tile of [48, 180, 400]) {
			expect(Math.abs(tileGap(tile, false) - Math.min(10, Math.max(2, Math.round(tile / 30))))).toBeLessThanOrEqual(1)
		}
	})

	it('keeps the radius on the gap, so today’s tiles keep their corners and a mosaic tile is square', () => {
		expect(tileRadius(48, false)).toBeCloseTo(1.2)
		expect(tileRadius(180, false)).toBeCloseTo(5.6)
		expect(tileRadius(400, false)).toBe(10)
		expect(tileRadius(12, false)).toBe(0)
	})
})

describe('tileSizeFor', () => {
	// The three régimes of tileGap: pinned at 10, sloped, and nothing
	const cases: [width: number, columns: number][] = [
		[1200, 3],
		[1200, 3.5],
		[1200, 6],
		[1200, 6.4],
		[1200, 24],
		[1200, 85],
		[1200, 120],
		[1200, 120.7],
		[360, 2],
		[360, 8],
	]

	it('fills the width exactly, at whole and fractional column counts', () => {
		for (const [width, columns] of cases) {
			const tile = tileSizeFor(width, columns, false)
			expect(columns * tile + (columns - 1) * tileGap(tile, false)).toBeCloseTo(width, 6)
		}
	})

	it('covers all three gap régimes', () => {
		expect(tileGap(tileSizeFor(1200, 3, false), false)).toBe(10)
		expect(tileGap(tileSizeFor(1200, 24, false), false)).toBeGreaterThan(0)
		expect(tileGap(tileSizeFor(1200, 120, false), false)).toBe(0)
	})
})

describe('phone spacing', () => {
	it('caps the gap at a hairline and keeps the shared ramp below it', () => {
		expect(tileGap(130, true)).toBe(2)
		expect(tileGap(72, true)).toBeCloseTo(2)
		expect(tileGap(48, true)).toBeCloseTo(tileGap(48, false))
		expect(tileGap(12, true)).toBe(0)
		expect(tileRadius(130, true)).toBe(2)
	})

	it('fills a phone edge to edge, at whole and fractional column counts, in every régime', () => {
		for (const [width, columns] of [
			[393, 2],
			[393, 3],
			[393, 3.4],
			[393, 6],
			[393, 9.5],
			[393, 40],
			[852, 6],
		] as const) {
			const tile = tileSizeFor(width, columns, true)
			expect(columns * tile + (columns - 1) * tileGap(tile, true)).toBeCloseTo(width, 6)
		}
		expect(tileGap(tileSizeFor(393, 3, true), true)).toBe(2)
		expect(tileGap(tileSizeFor(393, 6, true), true)).toBeLessThan(2)
		expect(tileGap(tileSizeFor(393, 40, true), true)).toBe(0)
		// Round trip: a phone's tile size gives back its column count
		for (const columns of [2, 3, 6, 9]) {
			expect(columnValue(393, tileSizeFor(393, columns, true), true)).toBeCloseTo(columns, 6)
		}
	})
})

describe('defaultTileSize', () => {
	it('opens every phone in portrait at three columns', () => {
		for (let width = 360; width <= 430; width++) {
			expect(gridLayout(width, defaultTileSize(true), true).columns).toBe(3)
		}
	})

	it('keeps the desktop grid that has always shipped', () => {
		expect(defaultTileSize(false)).toBe(180)
		expect(gridLayout(1000, defaultTileSize(false), false).columns).toBe(5)
	})

	it('pages like the desktop does: a screenful of either is under one page', () => {
		// pageSizeFor (view-context) turns 96px and up into 200-item pages
		expect(defaultTileSize(true)).toBeGreaterThanOrEqual(96)
	})
})

describe('groupItems', () => {
	const items = [
		item('a', at('2026-08-27T10:00:00')),
		item('b', at('2026-08-26T10:00:00')),
		item('c', at('2026-08-01T10:00:00')),
		item('d', at('2026-07-31T10:00:00')),
		item('e', at('2025-12-31T10:00:00')),
	]

	it('opens a section per month, over a run of the list', () => {
		const {sections, indexOf} = group(items)
		expect(sections.map((s) => [s.title, s.start, s.count])).toEqual([
			['August 2026', 0, 3],
			['July 2026', 3, 1],
			['December 2025', 4, 1],
		])
		expect([...indexOf]).toEqual([
			['a', 0],
			['b', 1],
			['c', 2],
			['d', 3],
			['e', 4],
		])
	})

	it('groups by year and by UTC day', () => {
		expect(group(items, 'years').sections.map((s) => s.title)).toEqual(['2026', '2025'])
		const days = group(items, 'days').sections
		expect(days.map((s) => s.count)).toEqual([1, 1, 1, 1, 1])
		expect(days[0]!.title).toBe('Thu, August 27, 2026')
	})

	it('keeps UTC month-boundary items in the backend summary month', () => {
		expect(group([item('boundary', at('2025-01-01T00:30:00Z'))]).sections[0]?.title).toBe('January 2025')
	})

	it('keeps keys stable and unique, and handles an empty list', () => {
		const keys = group(items).sections.map((s) => s.key)
		expect(keys).toEqual(group(items, 'months', true).sections.map((s) => s.key))
		expect(new Set(keys).size).toBe(keys.length)
		expect(group([]).sections).toEqual([])
	})
})

describe('layoutAt / visibleItems', () => {
	const items = [
		item('a', at('2026-08-27T10:00:00')),
		item('b', at('2026-08-26T10:00:00')),
		item('c', at('2026-07-31T10:00:00')),
	]
	// One column of 100px tiles with 3px gaps: August's header at 0 with a
	// tile at 38 and one at 141, July's header at 244 with a tile at 282
	const layout = layoutOf(items, 1)

	it('accumulates section tops and the total', () => {
		expect(layout.tops).toEqual([0, 244])
		expect(layout.total).toBe(385)
		expect(layout.loaderTop).toBeUndefined()
	})

	it('gives a header its fixed height and a tile row its size plus the gap', () => {
		expect(layout.tops[1]! - layout.tops[0]!).toBe(HEADER_HEIGHT + 2 * 103)
		const withLoader = layoutOf(items, 1, 100, 3, 0, true)
		expect(withLoader.loaderTop).toBe(385)
		expect(withLoader.total).toBe(385 + LOADER_HEIGHT)
	})

	it('reserves the footer band only once every page is loaded', () => {
		const footered = layoutAt(
			groupItems({items, zoom: 'months', hasMore: false, language: 'en-US', footer: true}),
			1,
			100,
			3,
		)
		expect(footered.footerTop).toBe(385)
		expect(footered.total).toBe(385 + FOOTER_HEIGHT)
		const stillLoading = layoutAt(
			groupItems({items, zoom: 'months', hasMore: true, language: 'en-US', footer: true}),
			1,
			100,
			3,
		)
		expect(stillLoading.footerTop).toBeUndefined()
		expect(stillLoading.total).toBe(385 + LOADER_HEIGHT)
		expect(layout.footerTop).toBeUndefined()
	})

	it('places every tile from the section it is in', () => {
		expect(rectOf(layout, 0)).toEqual({x: 0, y: 38, size: 100})
		expect(rectOf(layout, 1)).toEqual({x: 0, y: 141, size: 100})
		expect(rectOf(layout, 2)).toEqual({x: 0, y: 282, size: 100})
		expect(tileRect(layout, 'b')).toEqual({x: 0, y: 141, size: 100})
		expect(tileRect(layout, 'nope')).toBeUndefined()
	})

	it('wraps a section at the column count, short last row included', () => {
		// Five items in August, three in July, four columns
		const many = layoutOf(
			[
				...'abcde'.split('').map((id, i) => item(id, at('2026-08-27T10:00:00') - i * 60_000)),
				...'fgh'.split('').map((id, i) => item(id, at('2026-07-27T10:00:00') - i * 60_000)),
			],
			4,
		)
		expect(rectOf(many, 3)).toEqual({x: 3 * 103, y: 38, size: 100})
		// The short last row of August, then the first tile of July
		expect(rectOf(many, 4)).toEqual({x: 0, y: 141, size: 100})
		expect(many.tops).toEqual([0, 38 + 2 * 103])
		expect(rectOf(many, 5)).toEqual({x: 0, y: 244 + 38, size: 100})
	})

	it('finds the items intersecting the viewport plus overscan', () => {
		expect(visibleItems(layout, 0, 100, 0)).toEqual({start: 0, end: 0})
		expect(visibleItems(layout, 0, 200, 0)).toEqual({start: 0, end: 1})
		expect(visibleItems(layout, 150, 100, 0)).toEqual({start: 1, end: 1})
		expect(visibleItems(layout, 150, 100, 50)).toEqual({start: 0, end: 2})
		expect(visibleItems(layout, 10_000, 100, 0).end).toBeLessThan(visibleItems(layout, 10_000, 100, 0).start)
		expect(visibleItems(layoutOf([], 1), 0, 100, 0)).toEqual({start: 0, end: -1})
	})
})

describe('inset', () => {
	// One month, one column: header, a, b, starting 50px down
	const items = [item('a', at('2026-08-27T10:00:00')), item('b', at('2026-08-26T10:00:00'))]
	const layout = layoutOf(items, 1, 100, 3, 50)

	it('starts the first row below the overlaid chrome and counts the space into the total', () => {
		expect(layout.tops).toEqual([50])
		expect(rectOf(layout, 0)).toEqual({x: 0, y: 88, size: 100})
		expect(rectOf(layout, 1)).toEqual({x: 0, y: 191, size: 100})
		expect(layout.total).toBe(294)
	})

	it('keeps scroll positions in the same space as the rows', () => {
		expect(visibleItems(layout, 0, 100, 0)).toEqual({start: 0, end: 0})
		expect(findAnchor(layout, 0, {y: 0})).toEqual({id: 'a', top: 88})
		// Scrolled to the top, the top row stays put across a reflow
		expect(anchoredScrollTop(layoutOf(items, 1, 80, 3, 50), findAnchor(layout, 0, {y: 0})!)).toBe(0)
	})

	it('finds the section under a point and the headers in a band', () => {
		const two = layoutOf([...items, item('c', at('2026-07-31T10:00:00'))], 1, 100, 3, 50)
		expect(two.tops).toEqual([50, 294])
		expect(sectionAt(two, 0)?.title).toBe('August 2026')
		expect(sectionAt(two, 293)?.title).toBe('August 2026')
		expect(sectionAt(two, 294)?.title).toBe('July 2026')
		expect(sectionAt(two, 10_000)?.title).toBe('July 2026')
		expect(sectionAt(layoutOf([], 1), 0)).toBeUndefined()
		expect(headersIn(two, 0, 1000).map((h) => h.top)).toEqual([50, 294])
		// A band inside August still carries August's header, which is above it
		expect(headersIn(two, 200, 250).map((h) => h.title)).toEqual(['August 2026'])
	})
})

describe('itemAt', () => {
	// Three columns of 100px tiles with 10px gaps: a header, then a row of
	// three (a, b, c) at y=38 and a row of two (d, e) at y=148
	const items = 'abcde'.split('').map((id, i) => item(id, at('2024-05-05T10:00:00') - i * 60_000))
	const layout = layoutOf(items, 3, 100, 10)

	it('finds the tile under a point', () => {
		expect(itemAt(layout, 0, 38)).toBe(0)
		expect(itemAt(layout, 115, 60)).toBe(1)
		expect(itemAt(layout, 50, 200)).toBe(3)
	})

	it('misses gaps, headers, short rows and points outside the content', () => {
		expect(itemAt(layout, 105, 60)).toBeUndefined() // the column gap
		expect(itemAt(layout, 50, 142)).toBeUndefined() // the row gap
		expect(itemAt(layout, 50, 20)).toBeUndefined() // the header
		expect(itemAt(layout, 250, 200)).toBeUndefined() // past the short last row
		expect(itemAt(layout, -5, 60)).toBeUndefined()
		expect(itemAt(layout, 50, 10_000)).toBeUndefined()
	})
})

describe('itemsInRect', () => {
	const items = 'abcde'.split('').map((id, i) => item(id, at('2024-05-05T10:00:00') - i * 60_000))
	const layout = layoutOf(items, 3, 100, 10)
	const hits = (left: number, top: number, right: number, bottom: number) =>
		itemsInRect(layout, {left, top, right, bottom})

	it('touches nothing in a header, in a gap, or past a short row', () => {
		expect(hits(0, 0, 50, 30)).toEqual([])
		expect(hits(102, 40, 108, 60)).toEqual([]) // the column gap
		expect(hits(0, 139, 300, 147)).toEqual([]) // the row gap
		expect(hits(225, 150, 300, 200)).toEqual([]) // the empty third column of the last row
	})

	it('selects every tile the rectangle overlaps, in list order', () => {
		expect(hits(0, 38, 50, 50)).toEqual(['a'])
		expect(hits(105, 40, 115, 45)).toEqual(['b'])
		expect(hits(90, 130, 120, 160)).toEqual(['a', 'b', 'd', 'e'])
		expect(hits(-100, -100, 1000, 1000)).toEqual(['a', 'b', 'c', 'd', 'e'])
	})

	it('accepts rectangles starting above or left of the content', () => {
		expect(hits(-20, -20, 10, 40)).toEqual(['a'])
		expect(hits(-20, -20, -5, 40)).toEqual([])
	})
})

describe('anchoredScrollTop', () => {
	// Twelve photos in one month: 4 columns → 3 rows; 3 columns → 4 rows
	const items = 'abcdefghijkl'.split('').map((id, i) => item(id, at('2026-08-27T10:00:00') - i * 60_000))
	const layoutFor = (columns: number, extra: {hasMore?: boolean; items?: Item[]} = {}) =>
		layoutOf(extra.items ?? items, columns, 100, 3, 0, extra.hasMore ?? false)
	const four = layoutFor(4) // rows at 38, 141, 244
	const three = layoutFor(3) // rows at 38, 141, 244, 347
	// Anchor in `prev`, then find the scrollTop that keeps it still in `next`
	const anchorScrollTop = (prev: Layout, next: Layout, scrollTop: number, focal: {x?: number; y: number}) => {
		const anchor = findAnchor(prev, scrollTop, focal)
		return (anchor && anchoredScrollTop(next, anchor)) ?? scrollTop
	}

	it('finds the tile under the focal point and where its row sits', () => {
		expect(findAnchor(four, 150, {y: 50})).toEqual({id: 'g', top: 141 - 150})
		expect(findAnchor(four, 150, {x: 0, y: 50})).toEqual({id: 'e', top: -9})
		expect(tileRect(three, 'g')).toEqual({x: 0, y: 244, size: 100})
		expect(tileRect(three, 'nope')).toBeUndefined()
	})

	it('keeps the top row at the top when the list is scrolled to the top', () => {
		expect(anchorScrollTop(four, three, 0, {y: 0})).toBe(0)
		expect(anchorScrollTop(three, four, 0, {y: 0})).toBe(0)
	})

	it('keeps the row under the focal point at the same viewport position', () => {
		// y = 200 → second tile row (e f g h), middle item g → third row of three
		expect(anchorScrollTop(four, three, 150, {y: 50})).toBe(244 - (141 - 150))
		// … and back
		expect(anchorScrollTop(three, four, 253, {y: 50})).toBe(150)
	})

	it('zooms about the pointer when it has a horizontal position', () => {
		// Leftmost column: item e is in the second row of three
		expect(anchorScrollTop(four, three, 150, {x: 0, y: 50})).toBe(141 - (141 - 150))
		// Rightmost column: item h is in the third row of three
		expect(anchorScrollTop(four, three, 150, {x: 350, y: 50})).toBe(244 - (141 - 150))
	})

	it('steps back from a trailing loader and survives an empty or shrunken list', () => {
		const withLoader = layoutFor(4, {hasMore: true})
		// Focal point on the loader: anchor on the last tile row (i j k l → item k)
		expect(anchorScrollTop(withLoader, three, 400, {y: 0})).toBe(347 - (244 - 400))
		expect(anchorScrollTop(layoutOf([], 4), three, 10, {y: 0})).toBe(10)
		// The focal item was deleted: fall back to the current position
		const without = layoutFor(3, {items: items.filter((i) => i.id !== 'g')})
		expect(anchorScrollTop(four, without, 150, {y: 50})).toBe(150)
	})

	it('focuses the top of the list at first and the centre once scrolled in', () => {
		expect(defaultFocalY(0, 800)).toBe(0)
		expect(defaultFocalY(200, 800)).toBe(200)
		expect(defaultFocalY(5000, 800)).toBe(400)
	})
})

describe('blend', () => {
	const items = 'abcdefghijkl'.split('').map((id, i) => item(id, at('2026-08-27T10:00:00') - i * 60_000))
	const timeline = group(items)
	const lo = layoutAt(timeline, 4, 100, 3)
	const hi = layoutAt(timeline, 3, 140, 5)

	it('is either end at the ends', () => {
		expect(blend(lo, hi, 0)).toBe(lo)
		expect(blend(lo, hi, 1)).toBe(hi)
	})

	it('puts every tile halfway at the halfway point', () => {
		const half = blend(lo, hi, 0.5)
		for (let index = 0; index < items.length; index++) {
			const a = rectOf(lo, index)
			const b = rectOf(hi, index)
			expect(rectOf(half, index)).toEqual({x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, size: (a.size + b.size) / 2})
		}
		expect(half.total).toBe((lo.total + hi.total) / 2)
		expect(half.tile).toBe(120)
	})

	it('is continuous in t, and readable by everything a layout is', () => {
		const before = rectOf(blend(lo, hi, 0.499), 7)
		const after = rectOf(blend(lo, hi, 0.501), 7)
		expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1)
		const half = blend(lo, hi, 0.5)
		const {start, end} = visibleItems(half, 0, half.total, 0)
		expect({start, end}).toEqual({start: 0, end: items.length - 1})
		expect(sectionAt(half, 0)?.top).toBe((lo.tops[0]! + hi.tops[0]!) / 2)
	})
})
