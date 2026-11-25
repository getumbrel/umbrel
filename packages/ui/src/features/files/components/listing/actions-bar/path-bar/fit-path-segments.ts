/**
 * Fits the desktop path bar's segments, measured at their natural `widths`,
 * into `available` px.
 *
 * The root shows in full, and so do the current folder and its parent while
 * they fit. The folders between them narrow first, each to an equal share but
 * never below `minWidth`. When even that doesn't fit, folders fold into an
 * overflow menu `overflowWidth` wide, from the root's end and the parent
 * last, so the folders nearest the current one stay in view. Then the root
 * folds too, leaving the menu and the current folder, as the phone path bar
 * shows only the current folder. The current folder is the last to give: it
 * narrows only once it stands beside the menu alone, and never below
 * `minCurrentWidth`. A path of one name (a root, or a search's title) has
 * nothing to fold, and narrows the same way.
 *
 * A path set as a title reads badly with its folders cut short, so it folds
 * them instead: with `minWidth` Infinity nothing between the root and the
 * current folder ever narrows.
 *
 * Returns whether the root is folded, how many segments after it are folded,
 * and the width of each segment that narrows (undefined for one that keeps
 * its natural width).
 */
export function fitPathSegments({
	available,
	widths,
	minWidth,
	minCurrentWidth = minWidth,
	overflowWidth,
}: {
	available: number
	widths: number[]
	minWidth: number
	minCurrentWidth?: number
	overflowWidth: number
}): {foldsRoot: boolean; folded: number; widths: Array<number | undefined>} {
	const fitted: Array<number | undefined> = widths.map(() => undefined)
	if (sum(widths) <= available) return {foldsRoot: false, folded: 0, widths: fitted}
	// A path of one name has nothing to fold: the name is cut at its end
	if (widths.length < 2) return {foldsRoot: false, folded: 0, widths: [Math.max(available, minCurrentWidth)]}

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

	// Everything between is folded, and the root and the current folder still
	// don't fit: the root folds too, and the current folder narrows only if it
	// is too long to stand whole beside the menu
	const alone = available - overflowWidth
	if (widths[current] > alone) fitted[current] = Math.max(alone, minCurrentWidth)
	return {foldsRoot: true, folded: between.length, widths: fitted}
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
