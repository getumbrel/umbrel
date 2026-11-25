import type {FileSystemItem} from '@/features/files/types'

// The paths of a selection, as a set. A listing keeps dozens of rows mounted
// and every one of them has to know whether it is selected each time the
// selection changes, so the set is built once per selection and shared: a row
// that searched the selection for itself made selecting a few thousand items
// cost millions of comparisons.
let latest: {items: readonly FileSystemItem[]; paths: ReadonlySet<string>} | undefined
export function selectedPathsOf(items: readonly FileSystemItem[]): ReadonlySet<string> {
	if (latest?.items !== items) latest = {items, paths: new Set(items.map((item) => item.path))}
	return latest.paths
}

// Where a selected row of the list stands in its run of selected rows, which
// is what rounds its corners: alone, at either end of the run, or inside it.
// Nothing for a row that isn't selected.
export type SelectionPosition = '' | 'standalone' | 'first' | 'middle' | 'last'
export function selectionPositionOf(
	selected: ReadonlySet<string>,
	path: string,
	// The paths of the rows above and below it in the listing, where there are any
	above: string | undefined,
	below: string | undefined,
): SelectionPosition {
	if (!selected.has(path)) return ''
	const joinsAbove = above !== undefined && selected.has(above)
	const joinsBelow = below !== undefined && selected.has(below)
	if (joinsAbove) return joinsBelow ? 'middle' : 'last'
	return joinsBelow ? 'first' : 'standalone'
}
