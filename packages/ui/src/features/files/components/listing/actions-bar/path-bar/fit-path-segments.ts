/**
 * Fits the desktop path bar's segments, measured at their natural `widths`,
 * into `available` px.
 *
 * The root shows in full, and so do the current folder and its parent while
 * they fit. The folders between them narrow first, each to an equal share but
 * never below `minWidth` (their icon and caret). When even that doesn't fit,
 * folders fold into an overflow menu `overflowWidth` wide, from the root's end
 * and the parent last, so the folders nearest the current one stay in view.
 * Then the current folder narrows. In a bar too narrow for the root beside
 * that, the root folds too, leaving the menu and the current folder, as the
 * phone path bar shows only the current folder.
 *
 * Returns whether the root is folded, how many segments after it are folded,
 * and the width of each segment that narrows (undefined for one that keeps
 * its natural width).
 */
export function fitPathSegments({
	available,
	widths,
	minWidth,
	overflowWidth,
}: {
	available: number
	widths: number[]
	minWidth: number
	overflowWidth: number
}): {foldsRoot: boolean; folded: number; widths: Array<number | undefined>} {
	const fitted: Array<number | undefined> = widths.map(() => undefined)
	if (widths.length < 2 || sum(widths) <= available) return {foldsRoot: false, folded: 0, widths: fitted}

	const current = widths.length - 1
	// The folders between the root and the current folder, the parent last
	const between = range(1, current)
	for (let folded = 0; folded <= between.length; folded++) {
		const shown = between.slice(folded)
		const parent = shown.at(-1)
		const narrowing = shown.slice(0, -1)
		const fixed =
			widths[0] + widths[current] + (parent === undefined ? 0 : widths[parent]) + (folded > 0 ? overflowWidth : 0)
		const room = available - fixed
		if (sum(narrowing.map((i) => Math.min(widths[i], minWidth))) > room) continue

		const share = equalShare(
			narrowing.map((i) => widths[i]),
			room,
		)
		for (const i of narrowing) {
			if (widths[i] > share) fitted[i] = Math.max(share, minWidth)
		}
		return {foldsRoot: false, folded, widths: fitted}
	}

	// Everything between is folded, and the root and the current folder still don't fit
	const folded = between.length
	const menu = folded > 0 ? overflowWidth : 0
	const besideRoot = available - widths[0] - menu
	if (besideRoot >= minWidth) {
		fitted[current] = besideRoot
		return {foldsRoot: false, folded, widths: fitted}
	}
	const alone = available - overflowWidth
	if (widths[current] > alone) fitted[current] = Math.max(alone, minWidth)
	return {foldsRoot: true, folded, widths: fitted}
}

// The width every item wider than it narrows to, so that all of them fit `room`
// (Infinity when they already fit)
function equalShare(widths: number[], room: number) {
	const sorted = [...widths].sort((a, b) => a - b)
	let remaining = room
	for (let i = 0; i < sorted.length; i++) {
		const share = remaining / (sorted.length - i)
		if (sorted[i] > share) return share
		remaining -= sorted[i]
	}
	return Infinity
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

// [start, end)
const range = (start: number, end: number) => Array.from({length: Math.max(0, end - start)}, (_, i) => start + i)
