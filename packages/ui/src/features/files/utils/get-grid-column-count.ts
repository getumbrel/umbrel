/**
 * The listing's measurements. Shared between VirtualizedList (layout),
 * keyboard navigation (scroll-into-view math) and the touch selection
 * gesture (which item a finger is over), so they can't drift apart.
 *
 * `isMobile` is the layout below lg: rows of two lines made for a thumb, and
 * narrower tiles. `largerText` is useLargerText(), the pixels every text size
 * has gained, which rows and tiles make room for.
 */

/**
 * Height of a list-view row. A desktop row holds one line of text beside a
 * 28px icon; a phone's row a 40px icon beside a name over a line of details.
 */
export function getListRowHeight(isMobile: boolean, largerText: number): number {
	return isMobile ? 60 + largerText * 3 : 44 + largerText * 1.5
}

/** The gap between the icons view's tiles, across and down */
export const GRID_GAP = 8
export const GRID_ROW_GAP = GRID_GAP

/**
 * The narrowest an icons-view tile gets. Tiles share the row's width evenly,
 * so each is this or a little wider. Three fit across a 380px-wide phone.
 */
export function getGridMinItemWidth(isMobile: boolean): number {
	return isMobile ? 104 : 128
}

/**
 * How many tiles fit across a grid of the given width.
 */
export function getGridColumnCount(width: number, minItemWidth = 128): number {
	return Math.max(1, Math.floor((width + GRID_GAP) / (minItemWidth + GRID_GAP)))
}

/**
 * The width each tile takes: the row shared out between the columns, so the
 * grid runs flush from edge to edge with even gaps.
 */
export function getGridItemWidth(width: number, isMobile: boolean): number {
	const columnCount = getGridColumnCount(width, getGridMinItemWidth(isMobile))
	return (width - GRID_GAP * (columnCount - 1)) / columnCount
}

/**
 * Height of an icons-view tile: its padding, the 72px box the icon or picture
 * sits in, two lines of name at line height 1.25 and a line of details at 1.5.
 */
export function getGridItemHeight(largerText: number): number {
	return 150 + largerText * 4
}

/**
 * How much wider than its content the scroller is drawn, so that a scrollbar
 * that takes layout space sits in the margin beside the rows instead of on
 * them. Phones have no such scrollbar, and their rows run edge to edge.
 * Keep in sync with the container's padding in virtualized-list.tsx.
 */
export function getGridScrollerPadding(isMobile: boolean, isEmbedded = false): number {
	if (isEmbedded) return isMobile ? 12 : 24
	return isMobile ? 0 : 16
}

/**
 * The listing scroller fades content at its edges (see
 * .umbrel-files-fade-scroller in index.css): at the top once scrolled, and at
 * the bottom, which in Files itself is where the dock floats over it.
 * Scroll-into-view math pads by these so a selection lands in the
 * clearly-visible band instead of under a fade.
 */
export const LISTING_FADE_TOP_PX = 20
export const LISTING_FADE_BOTTOM_PX = 48

/**
 * What the layout knows and anything acting on the scroller needs: how many
 * columns the grid has, and how much of the scroller's bottom is under the
 * dock or a fade. VirtualizedList writes them on the scroller's element, so
 * keyboard navigation reads the very numbers the rows were laid out with.
 */
export function readScrollerLayout(scroller: HTMLElement | null) {
	return {
		columnCount: Number(scroller?.dataset.columns) || 1,
		bottomInset: Number(scroller?.dataset.bottomInset) || LISTING_FADE_BOTTOM_PX,
	}
}
