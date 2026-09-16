import {useCallback, useEffect, useRef, type KeyboardEvent, type RefObject} from 'react'

// Arrow keys over results that mix single-column rows with grids of tiles.
// cmdk only knows a flat list, so the rows are read off the rendered layout:
// items whose boxes share a top edge form a row, and the arrows move between
// and along those rows. Up and down keep a "preferred" x like a text editor's
// cursor column, so stepping through a one-item row and back lands on the
// tile you left.

export type NavRect = {value: string; top: number; left: number; width: number; height: number}
export type NavDirection = 'up' | 'down' | 'left' | 'right'

const KEY_DIRECTIONS: Record<string, NavDirection> = {
	ArrowUp: 'up',
	ArrowDown: 'down',
	ArrowLeft: 'left',
	ArrowRight: 'right',
}

export function groupRows(items: NavRect[]): NavRect[][] {
	const sorted = [...items].sort((a, b) => a.top - b.top || a.left - b.left)
	const rows: NavRect[][] = []
	for (const item of sorted) {
		const row = rows[rows.length - 1]
		if (row && item.top - row[0].top <= Math.min(row[0].height, item.height) / 2) row.push(item)
		else rows.push([item])
	}
	for (const row of rows) row.sort((a, b) => a.left - b.left)
	return rows
}

const centerX = (rect: NavRect) => rect.left + rect.width / 2

function nearestInRow(row: NavRect[], x: number) {
	let best = row[0]
	for (const item of row) if (Math.abs(centerX(item) - x) < Math.abs(centerX(best) - x)) best = item
	return best
}

// Stepping out of a full-width row into a grid of tiles lands on the first
// tile — reading order — rather than whichever tile sits under the row's
// middle. A remembered column (`preferredX`) still wins over this.
function enterRow(row: NavRect[], from: NavRect, preferredX: number | undefined) {
	if (preferredX !== undefined) return nearestInRow(row, preferredX)
	const widest = Math.max(...row.map((item) => item.width))
	return from.width >= widest * 2 ? row[0] : nearestInRow(row, centerX(from))
}

export function findNeighbor(
	rows: NavRect[][],
	current: string | undefined,
	direction: NavDirection,
	preferredX?: number,
): NavRect | undefined {
	if (rows.length === 0) return undefined
	let rowIndex = -1
	let columnIndex = -1
	for (const [index, row] of rows.entries()) {
		const column = row.findIndex((item) => item.value === current)
		if (column >= 0) {
			rowIndex = index
			columnIndex = column
			break
		}
	}
	if (rowIndex < 0) {
		const last = rows[rows.length - 1]
		return direction === 'up' || direction === 'left' ? last[last.length - 1] : rows[0][0]
	}
	const row = rows[rowIndex]
	const wrap = (index: number) => (index + rows.length) % rows.length
	// Along a row, the ends continue into the next grid row (one with
	// neighbours), skipping single-item rows such as "More" links and list rows
	const nextGridRow = (step: 1 | -1) => {
		for (let index = wrap(rowIndex + step); index !== rowIndex; index = wrap(index + step)) {
			if (rows[index].length > 1) return rows[index]
		}
		return row
	}
	switch (direction) {
		case 'down':
			return enterRow(rows[wrap(rowIndex + 1)], row[columnIndex], preferredX)
		case 'up':
			return enterRow(rows[wrap(rowIndex - 1)], row[columnIndex], preferredX)
		case 'right':
			return columnIndex + 1 < row.length ? row[columnIndex + 1] : nextGridRow(1)[0]
		case 'left': {
			if (columnIndex > 0) return row[columnIndex - 1]
			const previous = nextGridRow(-1)
			return previous[previous.length - 1]
		}
	}
}

function measureItems(list: HTMLElement): NavRect[] {
	const items: NavRect[] = []
	for (const element of list.querySelectorAll<HTMLElement>('[cmdk-item]:not([aria-disabled="true"])')) {
		const value = element.dataset.value
		if (!value) continue
		const rect = element.getBoundingClientRect()
		if (rect.width === 0 || rect.height === 0) continue
		items.push({value, top: rect.top, left: rect.left, width: rect.width, height: rect.height})
	}
	return items
}

// Returns a keydown handler for the search field. It claims the arrow keys
// (preventDefault, which cmdk honours by standing down) and moves the
// controlled selection.
export function useCmdkGridNavigation(
	listRef: RefObject<HTMLElement | null>,
	value: string,
	setValue: (value: string) => void,
) {
	const preferredX = useRef<number | undefined>(undefined)
	const keyboardValue = useRef<string | undefined>(undefined)

	// A selection the keyboard didn't make (the mouse, a fresh result set)
	// resets the remembered column
	useEffect(() => {
		if (value !== keyboardValue.current) preferredX.current = undefined
	}, [value])

	return useCallback(
		(event: KeyboardEvent<HTMLInputElement>) => {
			const direction = KEY_DIRECTIONS[event.key]
			if (!direction || event.altKey || event.metaKey || event.ctrlKey) return
			// The arrows pick IME candidates while composing (cmdk guards the same way)
			if (event.nativeEvent.isComposing || event.keyCode === 229) return
			const list = listRef.current
			if (!list) return
			const items = measureItems(list)
			if (items.length === 0) return
			const rows = groupRows(items)
			const current = items.find((item) => item.value === value)
			const vertical = direction === 'up' || direction === 'down'
			// Left and right belong to the grid while the selection is on a tile
			// (a row with neighbours); on a full-width row they stay caret keys
			if (!vertical) {
				const row = rows.find((candidate) => candidate.some((item) => item.value === value))
				if (!row || row.length < 2) return
			}
			const remembered = vertical ? preferredX.current : undefined
			const next = findNeighbor(rows, current?.value, direction, remembered)
			if (!next) return
			event.preventDefault()
			// Only a tile-sized item is worth remembering as a column; a
			// full-width row says nothing about where in a grid to land
			const column = next.width < list.clientWidth / 2 ? centerX(next) : undefined
			preferredX.current = vertical ? (remembered ?? column) : column
			keyboardValue.current = next.value
			setValue(next.value)
		},
		[listRef, setValue, value],
	)
}
