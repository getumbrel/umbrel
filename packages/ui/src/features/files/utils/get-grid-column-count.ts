/**
 * Fixed width of an icons-view item. Mobile uses a narrower item so three
 * columns fit a 380px-wide phone (~332px of grid width after paddings).
 * Keep in sync with the item's width classes in icons-view-file-item.tsx
 * (w-25 below lg, w-28 at lg+).
 */
export function getGridItemWidth(isMobile: boolean): number {
	return isMobile ? 100 : 112
}

/**
 * Heights of a list-view row and an icons-view grid cell, and the gap between
 * the grid's rows. Shared between VirtualizedList (layout) and keyboard
 * navigation (scroll-into-view math) so the two can't drift apart.
 *
 * Both make room for larger text (`largerText` is useLargerText(), the pixels
 * every text size has gained): a list row holds one line of text at line height
 * 1.5, two on mobile, and a grid cell two name lines at 1.25 and a label at 1.5.
 */
export function getListRowHeight(isMobile: boolean, largerText: number): number {
	return isMobile ? 50 + largerText * 3 : 40 + largerText * 1.5
}
export function getGridItemHeight(largerText: number): number {
	return 146 + largerText * 4
}
export const GRID_ROW_GAP = 8

/**
 * Horizontal padding of the icons-view scroller (px-3 below lg, px-6 at lg+ in
 * virtualized-list.tsx). The rendered list is widened by this amount to push
 * the scrollbar into the padding, and keyboard navigation subtracts it from
 * clientWidth to recover the grid layout width.
 */
export function getGridScrollerPadding(isMobile: boolean): number {
	return isMobile ? 12 : 24
}

/**
 * Calculate the number of columns that fit in a grid view of the given width.
 * This formula is shared between VirtualizedList (for rendering) and
 * keyboard navigation (for arrow key row jumps).
 */
export function getGridColumnCount(width: number, itemWidth = 112): number {
	const minGap = 8
	const borderAllowance = 2
	const containerWidth = itemWidth + borderAllowance * 2
	return Math.max(1, Math.floor((width + minGap) / (containerWidth + minGap)))
}

/**
 * The listing scroller fades content at its edges (see
 * .umbrel-files-fade-scroller in index.css: a 48px bottom ramp, and a 24px top
 * ramp once scrolled). Scroll-into-view math pads by these so a selection
 * lands in the clearly-visible band instead of under a fade.
 */
export const LISTING_FADE_TOP_PX = 24
export const LISTING_FADE_BOTTOM_PX = 48
