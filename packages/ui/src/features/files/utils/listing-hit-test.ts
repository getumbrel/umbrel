import {GRID_GAP} from '@/features/files/utils/get-grid-column-count'

// The listing's layout, as VirtualizedList lays it out: rows one under
// another from the content's top, or tiles placed by hand a gap apart
export type ListingLayout =
	| {view: 'list'; count: number; width: number; rowHeight: number}
	| {view: 'icons'; count: number; columnCount: number; itemWidth: number; itemHeight: number}

type Rect = {left: number; top: number; right: number; bottom: number}

/**
 * The index of the item at a point in the scroller's content, if one is
 * there. A row of the list is the listing's whole width, so any point level
 * with it is on it. In the grid the gaps between tiles, and the space past
 * the last tile, are nobody's.
 */
export function indexAtPoint(layout: ListingLayout, x: number, y: number): number | undefined {
	if (y < 0) return undefined
	if (layout.view === 'list') {
		const index = Math.floor(y / layout.rowHeight)
		return index < layout.count ? index : undefined
	}
	if (x < 0) return undefined
	const {columnCount, itemWidth, itemHeight, count} = layout
	const columnPitch = itemWidth + GRID_GAP
	const rowPitch = itemHeight + GRID_GAP
	const column = Math.floor(x / columnPitch)
	const row = Math.floor(y / rowPitch)
	if (column >= columnCount || x - column * columnPitch > itemWidth || y - row * rowPitch > itemHeight) return undefined
	const index = row * columnCount + column
	return index < count ? index : undefined
}

/**
 * The indexes of the items a box touches, in listing order. The box is in the
 * scroller's content coordinates. Arithmetic over the layout, like the
 * keyboard's scroll-into-view and the touch selection's `indexAt`: no item
 * needs to be mounted to be found, so a marquee drawn across a virtualised
 * listing covers every row it passes, and a frame of it costs the same
 * however many are on screen.
 *
 * An edge that only touches an item counts, and the gaps between tiles are
 * nobody's: a box that fits inside one touches nothing.
 */
export function indexesInRect(layout: ListingLayout, rect: Rect): number[] {
	const indexes: number[] = []
	if (layout.count === 0 || rect.right < 0 || rect.bottom < 0) return indexes

	if (layout.view === 'list') {
		if (rect.left > layout.width) return indexes
		const first = Math.max(0, Math.floor(rect.top / layout.rowHeight))
		const last = Math.min(layout.count - 1, Math.floor(rect.bottom / layout.rowHeight))
		for (let index = first; index <= last; index++) indexes.push(index)
		return indexes
	}

	const {columnCount, itemWidth, itemHeight, count} = layout
	const columnPitch = itemWidth + GRID_GAP
	const rowPitch = itemHeight + GRID_GAP
	// A tile at pitch p and size s spans [n*p, n*p + s]: it is touched from
	// the first n whose far edge reaches the box to the last whose near edge does
	const firstColumn = Math.max(0, Math.ceil((rect.left - itemWidth) / columnPitch))
	const lastColumn = Math.min(columnCount - 1, Math.floor(rect.right / columnPitch))
	const firstRow = Math.max(0, Math.ceil((rect.top - itemHeight) / rowPitch))
	const lastRow = Math.min(Math.ceil(count / columnCount) - 1, Math.floor(rect.bottom / rowPitch))
	for (let row = firstRow; row <= lastRow; row++) {
		for (let column = firstColumn; column <= lastColumn; column++) {
			const index = row * columnCount + column
			if (index < count) indexes.push(index)
		}
	}
	return indexes
}
