/**
 * Calculate the number of columns that fit in a grid view of the given width.
 * This formula is shared between VirtualizedList (for rendering) and
 * keyboard navigation (for arrow key row jumps).
 */
export function getGridColumnCount(width: number): number {
	const itemWidth = 112
	const minGap = 8
	const borderAllowance = 2
	const containerWidth = itemWidth + borderAllowance * 2
	return Math.max(1, Math.floor((width + minGap) / (containerWidth + minGap)))
}
