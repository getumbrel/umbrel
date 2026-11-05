// Pure layout math for the virtualized timeline. Kept free of React so it can
// be unit-tested and reasoned about on its own.
//
// Grouping and geometry are two passes on purpose. Which items fall in which
// day, month or year depends on the list and the grouping and on nothing
// else, so it is computed once per list (`groupItems`, O(items)); where a
// tile sits depends only on the column count, so a layout is a running sum
// over the sections (`layoutAt`, O(sections)) — microseconds even for a
// decade of months. That is what makes a live pinch affordable: it builds the
// layouts either side of a fractional column count on every frame and draws
// the blend between them, and a tile slides from the end of one row to the
// start of the next instead of jumping there.
//
// Nothing here allocates per item except the grouping pass, and nothing here
// measures the DOM, so every question the grid asks — what is visible, what a
// point hits, what a marquee covers, where a tile is — is answered for the
// whole list whether it is mounted or not.

import type {Item} from '@/features/photos/hooks/use-items'
import {capitalizeDate} from '@/utils/date-time'

export type Zoom = 'years' | 'months' | 'days'

// ── Grid geometry ─────────────────────────────────────────────────────────

// The gap and the corner radius are proportions of the tile, and the gap goes
// to nothing at the small end: zoomed all the way out the grid should read as
// one mosaic, not as a screen door — today's `round(tile / 30)` is 3% of a
// 180px tile but 14% of a 14px one, so the grid gets airier as it shrinks,
// which is exactly backwards. Continuous, so a live pinch never pops by a
// pixel, and continuity is also what lets `tileSizeFor` be exact. The radius
// still tracks the gap, as it always has, so every tile the app already
// offered keeps the corner it has today — and a mosaic tile, whose gap has
// gone, is square.
//
// Phones run the same ramp but cap it at a hairline. A phone's grid is the
// iOS Photos grid: edge to edge, the pictures all but touching, every pixel
// of a 393px screen spent on photographs rather than on gutters — a 10px
// gap there is a quarter of a column at six across. The ramp below the cap
// is shared, so the mosaic is the same mosaic on either.
const GAP_MAX = {desktop: 10, mobile: 2} as const
const gapMax = (isMobile: boolean) => (isMobile ? GAP_MAX.mobile : GAP_MAX.desktop)
export const tileGap = (tile: number, isMobile: boolean) => Math.min(gapMax(isMobile), Math.max(0, tile / 30 - 0.4))
export const tileRadius = tileGap
// The tile sizes where `tileGap` changes régime: it is 0 at or below
// GAP_ZERO and pinned at its cap from where the ramp reaches it on
const GAP_ZERO = 12
const gapFull = (isMobile: boolean) => (gapMax(isMobile) + 0.4) * 30

// The tile widths the zoom control spans. `min` is where elements stop being
// a sensible way to draw a photo — ten thousand of them is not a tuning
// problem — and `floor` is as far out as the canvas goes, subject to what the
// device's atlas can actually hold (see gpu/capability.ts). The preference
// itself is a tile size in px (device independent); the grid turns it into a
// whole number of columns for its width, and a row always fills the container
// exactly.
//
// `initial` is the tile a device opens at until its user picks one, and it is
// a default read at the time, never stored (see PhotosViewProvider): 180 is
// the desktop grid that has always shipped; 132 is three columns on every
// phone in portrait — 360px to 430px wide, edge to edge, round to three —
// where 180 was two, the most zoomed-in the grid goes, a column of posters.
export const TILE_SIZE = {
	desktop: {min: 48, max: 400, floor: 14, initial: 180},
	mobile: {min: 40, max: 220, floor: 12, initial: 132},
} as const
const MIN_COLUMNS = 2

export function tileBounds(isMobile: boolean) {
	return isMobile ? TILE_SIZE.mobile : TILE_SIZE.desktop
}

export function defaultTileSize(isMobile: boolean) {
	return tileBounds(isMobile).initial
}

export function clampTileSize(size: number) {
	return Number.isFinite(size)
		? Math.min(TILE_SIZE.desktop.max, Math.max(TILE_SIZE.mobile.floor, size))
		: TILE_SIZE.desktop.initial
}

// Every column count a container of this width can show: the zoom stops.
// Exact, because `columns · tile + (columns − 1) · gap = width` rearranges to
// this whatever the gap is.
function columnsFor(width: number, size: number, isMobile: boolean) {
	const gap = tileGap(size, isMobile)
	return (width + gap) / (size + gap)
}

// The stops this width offers, down to `minTile` — which is the DOM's minimum
// unless the canvas is available to draw smaller (see gpu/capability.ts). The
// range can never outrun the renderer, because the renderer sets it.
export function columnRange(width: number, isMobile: boolean, minTile?: number) {
	const bounds = tileBounds(isMobile)
	const min = Math.max(MIN_COLUMNS, Math.ceil(columnsFor(width, bounds.max, isMobile)))
	const max = Math.max(min, Math.floor(columnsFor(width, minTile ?? bounds.min, isMobile)))
	return {min, max}
}

// Continuous column count for a tile size — the slider's value — clamped to
// the stops this width offers. `Math.round` of it is the column count.
export function columnValue(width: number, size: number, isMobile: boolean, minTile?: number) {
	const {min, max} = columnRange(width, isMobile, minTile)
	return Math.min(max, Math.max(min, columnsFor(width, size, isMobile)))
}

// The tile width that fills `width` with this many columns, to the pixel:
// solve `c · t + (c − 1) · gap(t) = width` in closed form in each of the gap
// function's three régimes and keep the answer that lands in its own. They
// agree at the boundaries because the gap is continuous, and `columns` may be
// fractional — which is what a row of a blended layout needs.
export function tileSizeFor(width: number, columns: number, isMobile: boolean) {
	const c = Math.max(1, columns)
	const sloped = (width + 0.4 * (c - 1)) / (c + (c - 1) / 30)
	if (sloped > GAP_ZERO && sloped < gapFull(isMobile)) return Math.max(1, sloped)
	const tight = width / c
	if (tight <= GAP_ZERO) return Math.max(1, tight)
	return Math.max(1, (width - gapMax(isMobile) * (c - 1)) / c)
}

export function gridLayout(width: number, size: number, isMobile: boolean, minTile?: number) {
	const columns = Math.round(columnValue(width, size, isMobile, minTile))
	const tile = tileSizeFor(width, columns, isMobile)
	return {columns, tile, gap: tileGap(tile, isMobile)}
}

// ── The zoom track ────────────────────────────────────────────────────────

// The zoom control's own coordinate: 0 at the left, where the grid is furthest
// out, 1 at the right, where its tiles are biggest.
//
// It can't be evenly spread over the column counts any more. A 1000px grid has
// a dozen stops between a 400px tile and the smallest one elements draw, and
// fifty more below that in the mosaic — so an even track would spend four
// fifths of itself on the mosaic and crowd every size people actually browse
// at into its last few pixels. The mosaic is given a fifth of the track and
// the rest keeps the range the control has always had. That makes the track
// roughly logarithmic in the tile, which is how it reads: a step near the
// right is worth tens of pixels of tile, a step near the left a fraction of
// one, and each feels the same size.
const MOSAIC_SHARE = 0.2

// The column counts the track spans: the fewest (biggest tiles), the most
// elements can draw (the seam), and the most this device's renderer can.
export type ZoomTrack = {min: number; seam: number; max: number}

export function zoomTrack(width: number, isMobile: boolean, minTile?: number): ZoomTrack {
	const {min, max} = columnRange(width, isMobile, minTile)
	// Without a canvas the seam *is* the end of the track, and the mosaic's
	// share of it is nothing — the control is then exactly what it always was
	return {min, seam: Math.min(max, columnRange(width, isMobile).max), max}
}

const mosaicShare = ({seam, max}: ZoomTrack) => (max > seam ? MOSAIC_SHARE : 0)

export function trackPosition(track: ZoomTrack, columns: number): number {
	const {min, seam, max} = track
	const share = mosaicShare(track)
	if (columns >= seam) return share === 0 ? 0 : (share * (max - columns)) / (max - seam)
	if (seam === min) return 1
	return share + ((1 - share) * (seam - columns)) / (seam - min)
}

export function trackColumns(track: ZoomTrack, position: number): number {
	const {min, seam, max} = track
	const share = mosaicShare(track)
	if (position <= share) return share === 0 ? max : max - (position / share) * (max - seam)
	return seam - ((position - share) / (1 - share)) * (seam - min)
}

// One click of − or + (and each tick of holding one down). A click moves the
// thumb by a slice of the track rather than by a column: the track is the
// control's perceptual coordinate — the mosaic's dozens of stops take a fifth
// of it, the sizes people browse at keep the rest — so a fixed slice feels
// the same size wherever the thumb is, where a fixed column count kept the
// browse range pleasant and made the mosaic sixty clicks deep. Never less
// than a whole column (`atLeast` of them for a paging key), so a click always
// visibly moves the grid; the slider itself keeps every stop for precision.
const CLICK_SLICE = 0.05

export function clickColumns(track: ZoomTrack, columns: number, by: 1 | -1, atLeast = 1): number {
	const position = trackPosition(track, columns)
	const slid = Math.round(trackColumns(track, Math.min(1, Math.max(0, position - by * CLICK_SLICE))))
	const least = columns + by * atLeast
	const next = by > 0 ? Math.max(slid, least) : Math.min(slid, least)
	return Math.min(track.max, Math.max(track.min, next))
}

// ── Grouping ──────────────────────────────────────────────────────────────

// A cheap, numeric UTC key per item, matching the backend's calendar summary
// and the date ranges emitted by search suggestions.
function groupKey(takenAt: number, zoom: Zoom): number {
	const date = new Date(takenAt)
	if (zoom === 'years') return date.getUTCFullYear()
	if (zoom === 'months') return date.getUTCFullYear() * 12 + date.getUTCMonth()
	return date.getUTCFullYear() * 400 + date.getUTCMonth() * 32 + date.getUTCDate()
}

function groupTitle(takenAt: number, zoom: Zoom, language: string): string {
	const date = new Date(takenAt)
	if (zoom === 'years') return String(date.getUTCFullYear())
	const title =
		zoom === 'months'
			? date.toLocaleDateString(language, {month: 'long', year: 'numeric', timeZone: 'UTC'})
			: date.toLocaleDateString(language, {
					weekday: 'short',
					month: 'long',
					day: 'numeric',
					year: 'numeric',
					timeZone: 'UTC',
				})
	return capitalizeDate(title, language)
}

// One date group: a run of the (newest-first) list, and the title its header
// carries. Nothing geometric — a section is the same section at every zoom.
export type Section = {key: string; title: string; start: number; count: number}

// The list, grouped. Recomputed only when the items, the grouping or the
// language change; every layout below is derived from it in O(sections).
export type Timeline = {
	items: Item[]
	sections: Section[]
	// Where each item is in the list, so a tile can be found again by id
	// after a reflow, a page append or a delete
	indexOf: Map<string, number>
	hasMore: boolean
	// Whether a footer line follows the last row once every page is loaded
	footer: boolean
}

export function groupItems({
	items,
	zoom,
	hasMore,
	language,
	footer = false,
}: {
	items: Item[]
	zoom: Zoom
	hasMore: boolean
	language: string
	footer?: boolean
}): Timeline {
	const sections: Section[] = []
	const indexOf = new Map<string, number>()
	let key: number | undefined
	let open: Section | undefined
	for (let index = 0; index < items.length; index++) {
		const item = items[index]!
		indexOf.set(item.id, index)
		const next = groupKey(item.takenAt, zoom)
		if (next !== key || !open) {
			key = next
			open = {key: `h:${zoom}:${next}`, title: groupTitle(item.takenAt, zoom, language), start: index, count: 0}
			sections.push(open)
		}
		open.count++
	}
	return {items, sections, indexOf, hasMore, footer}
}

// ── Layout ────────────────────────────────────────────────────────────────

export const HEADER_HEIGHT = 38 // 10px top space + 20px title + 8px below
export const LOADER_HEIGHT = 48
export const FOOTER_HEIGHT = 48

export type Layout = Timeline & {
	// Whole at rest; fractional while a pinch is between two stops, when this
	// is the blend of the layouts either side (see `blend`)
	columns: number
	tile: number
	gap: number
	// The top of each section's header row, parallel to `sections`
	tops: number[]
	// Where the trailing loader sits, while more pages exist
	loaderTop?: number
	// Where the footer line sits, once every page is loaded
	footerTop?: number
	total: number
	// A blended layout keeps the two it lies between. Section geometry above
	// is already interpolated — so everything that reads a section reads it
	// the same way either side of a gesture — and a tile's place, which is
	// the one thing a column count changes discontinuously, is interpolated
	// on demand in `rectOf`.
	between?: {lo: Layout; hi: Layout; t: number}
}

// Absolute geometry for a whole column count.
//
// Everything is in the scroller's own coordinates. The first row starts
// `inset` px down: the actions bar floats over the top of the scroller, and
// that is the space tiles scroll under it into.
export function layoutAt(timeline: Timeline, columns: number, tile: number, gap: number, inset = 0): Layout {
	const {sections, hasMore, footer} = timeline
	const pitch = tile + gap
	const tops = new Array<number>(sections.length)
	let top = inset
	for (let index = 0; index < sections.length; index++) {
		tops[index] = top
		top += HEADER_HEIGHT + Math.ceil(sections[index]!.count / columns) * pitch
	}
	return {
		...timeline,
		columns,
		tile,
		gap,
		tops,
		loaderTop: hasMore ? top : undefined,
		footerTop: !hasMore && footer ? top : undefined,
		total: top + (hasMore ? LOADER_HEIGHT : footer ? FOOTER_HEIGHT : 0),
	}
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t

// The grid between two whole column counts: what a pinch draws. Sections keep
// their identity — a blend is only ever built from two layouts of the same
// grouping — so their tops interpolate, and a tile travels the straight line
// from where it sits in one to where it sits in the other. That diagonal
// slide, from the end of a row to the start of the next, is what a column
// count changing under your fingers looks like.
export function blend(lo: Layout, hi: Layout, t: number): Layout {
	if (t <= 0 || lo === hi) return lo
	if (t >= 1) return hi
	return {
		...lo,
		columns: mix(lo.columns, hi.columns, t),
		tile: mix(lo.tile, hi.tile, t),
		gap: mix(lo.gap, hi.gap, t),
		tops: lo.tops.map((top, index) => mix(top, hi.tops[index]!, t)),
		loaderTop: lo.loaderTop === undefined ? undefined : mix(lo.loaderTop, hi.loaderTop!, t),
		footerTop: lo.footerTop === undefined ? undefined : mix(lo.footerTop, hi.footerTop!, t),
		total: mix(lo.total, hi.total, t),
		between: {lo, hi, t},
	}
}

// The section holding an item: the last one starting at or before it
function sectionOf({sections}: Layout, index: number) {
	let lo = 0
	let hi = sections.length - 1
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1
		if (sections[mid]!.start <= index) lo = mid
		else hi = mid - 1
	}
	return lo
}

export type Rect = {x: number; y: number; size: number}

function placeIn(layout: Layout, index: number): Rect {
	const section = sectionOf(layout, index)
	const local = index - layout.sections[section]!.start
	const pitch = layout.tile + layout.gap
	const row = Math.floor(local / layout.columns)
	return {
		x: (local - row * layout.columns) * pitch,
		y: layout.tops[section]! + HEADER_HEIGHT + row * pitch,
		size: layout.tile,
	}
}

// Where a tile is, in the scroller's coordinates. Two divisions and a binary
// search over the sections — cheap enough to ask for every tile on screen on
// every frame of a gesture, which is exactly what the canvas does.
export function rectOf(layout: Layout, index: number): Rect {
	const {between} = layout
	if (!between) return placeIn(layout, index)
	const a = placeIn(between.lo, index)
	const b = placeIn(between.hi, index)
	return {
		x: mix(a.x, b.x, between.t),
		y: mix(a.y, b.y, between.t),
		size: mix(a.size, b.size, between.t),
	}
}

// The tile's rect for an item that may not be mounted, or may not be an
// element at all — a canvas tile, or one that has scrolled far out of view
export function tileRect(layout: Layout, id: string): Rect | undefined {
	const index = layout.indexOf.get(id)
	return index === undefined ? undefined : rectOf(layout, index)
}

// The first index `after` is true for, over a predicate that is false then
// true. Tile tops only ever increase with the index — in a blend too, being
// the mix of two sequences that do — so every window the grid needs is one
// contiguous run found by two of these.
function firstWhere(length: number, after: (index: number) => boolean) {
	let lo = 0
	let hi = length
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (after(mid)) hi = mid
		else lo = mid + 1
	}
	return lo
}

// The items whose tiles intersect [scrollTop − overscan, scrollTop + viewport
// + overscan], as one run: items are in order and a section's rows are
// uniform, so a window is always an index range. `end` is inclusive, and
// `end < start` means nothing is visible.
export function visibleItems(layout: Layout, scrollTop: number, viewport: number, overscan: number) {
	const length = layout.items.length
	if (length === 0) return {start: 0, end: -1}
	const from = scrollTop - overscan
	const to = scrollTop + viewport + overscan
	const start = firstWhere(length, (index) => rectOf(layout, index).y + layout.tile >= from)
	const end = firstWhere(length, (index) => rectOf(layout, index).y > to) - 1
	return {start, end}
}

// The item under a point, or nothing when it lands in a gap, a header or past
// the end of a short row
export function itemAt(layout: Layout, x: number, y: number): number | undefined {
	const {start, end} = visibleItems(layout, y, 0, 0)
	for (let index = start; index <= end; index++) {
		const rect = rectOf(layout, index)
		if (x >= rect.x && x < rect.x + rect.size && y >= rect.y && y < rect.y + rect.size) return index
	}
	return undefined
}

export type Box = {left: number; top: number; right: number; bottom: number}

// The items whose tiles a rectangle (in the scroller's coordinates) touches,
// in list order. Arithmetic over the layout, so it covers the whole list —
// mounted or not, DOM or canvas — and never measures: a marquee can run it on
// every pointer move.
export function itemsInRect(layout: Layout, rect: Box): string[] {
	const ids: string[] = []
	if (layout.items.length === 0 || rect.right < 0 || rect.bottom < 0) return ids
	const {start, end} = visibleItems(layout, rect.top, rect.bottom - rect.top, 0)
	for (let index = start; index <= end; index++) {
		const tile = rectOf(layout, index)
		if (
			tile.x <= rect.right &&
			tile.x + tile.size >= rect.left &&
			tile.y <= rect.bottom &&
			tile.y + tile.size >= rect.top
		)
			ids.push(layout.items[index]!.id)
	}
	return ids
}

// ── Sections on screen ────────────────────────────────────────────────────

// A section's header, where it sits
export type Header = {key: string; title: string; top: number}

// The last section starting at or before `y`
export function sectionAt(layout: Layout, y: number): Header | undefined {
	const {sections, tops} = layout
	if (sections.length === 0) return undefined
	const index = sectionIndexAt(layout, y)
	return {key: sections[index]!.key, title: sections[index]!.title, top: tops[index]!}
}

// The section a y falls in: the last whose header is at or above it (the
// first, above them all)
export function sectionIndexAt(layout: Layout, y: number) {
	return Math.max(0, firstWhere(layout.sections.length, (i) => layout.tops[i]! > y) - 1)
}

// The section an item is in: the last that starts at or before it
export function sectionIndexOf(layout: Layout, index: number) {
	return Math.max(0, firstWhere(layout.sections.length, (i) => layout.sections[i]!.start > index) - 1)
}

// The first item whose tile reaches below y (the item count, when none does)
export function firstItemBelow(layout: Layout, y: number) {
	return firstWhere(layout.items.length, (i) => {
		const rect = rectOf(layout, i)
		return rect.y + rect.size > y
	})
}

// Every header between `from` and `to`, plus the one above `from` whose
// section is still running through it
export function headersIn(layout: Layout, from: number, to: number): Header[] {
	const {sections, tops} = layout
	const headers: Header[] = []
	let index = firstWhere(sections.length, (i) => tops[i]! > from) - 1
	if (index < 0) index = 0
	for (; index < sections.length && tops[index]! <= to; index++) {
		headers.push({key: sections[index]!.key, title: sections[index]!.title, top: tops[index]!})
	}
	return headers
}

// ── Scroll anchoring ──────────────────────────────────────────────────────

// Where the eye is while zooming, in viewport px. Without a pointer to zoom
// about, keep the top row still near the top of the list and the centre row
// still once the user is scrolled in — the focal point slides smoothly from
// one to the other over the first half viewport of scrolling.
export function defaultFocalY(scrollTop: number, viewport: number) {
	return Math.min(scrollTop, viewport / 2)
}

// The tile to keep still while the layout changes underneath it: the one
// under the focal point, and where its row's top sits in the viewport
export type Anchor = {id: string; top: number}

export function findAnchor(layout: Layout, scrollTop: number, focal: {x?: number; y: number}): Anchor | undefined {
	const length = layout.items.length
	if (length === 0) return undefined
	const columns = Math.round(layout.columns)
	const y = Math.max(0, scrollTop + focal.y)
	// The first tile of the row the focal point falls in — the predicate flips
	// at a row's first item, since a row's tiles share a top
	let first = firstWhere(length, (index) => rectOf(layout, index).y + layout.tile >= y)
	if (first >= length) {
		// Past the last row (the focal point is on the trailing loader): step
		// back to the start of it
		const section = layout.sections[sectionOf(layout, length - 1)]!
		first = length - 1 - ((length - 1 - section.start) % columns)
	}
	const section = layout.sections[sectionOf(layout, first)]!
	// … and the rest of that row: a whole one, or what is left of the section
	const last = Math.min(section.start + section.count, first + columns) - 1
	const index =
		focal.x === undefined
			? first + Math.floor((last - first + 1) / 2)
			: Math.min(last, first + Math.max(0, Math.floor(focal.x / (layout.tile + layout.gap))))
	return {id: layout.items[index]!.id, top: rectOf(layout, index).y - scrollTop}
}

// The scrollTop that puts the anchor's row back where it was, in a new
// layout; undefined when the tile is no longer in the list (e.g. deleted)
export function anchoredScrollTop(layout: Layout, anchor: Anchor): number | undefined {
	const index = layout.indexOf.get(anchor.id)
	return index === undefined ? undefined : rectOf(layout, index).y - anchor.top
}
