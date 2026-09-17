import {describe, expect, it} from 'vitest'

import {findNeighbor, groupRows, type NavRect} from './cmdk-navigation'

// Two list rows, then a 3-wide grid of tiles, then a "More" link on its own row
const rect = (value: string, top: number, left: number, width = 100, height = 40): NavRect => ({
	value,
	top,
	left,
	width,
	height,
})
const layout: NavRect[] = [
	rect('row-a', 0, 0, 600),
	rect('row-b', 44, 0, 600),
	rect('tile-1', 100, 0, 100, 100),
	rect('tile-2', 100.4, 110, 100, 100), // sub-pixel drift still groups with its row
	rect('tile-3', 100, 220, 100, 100),
	rect('tile-4', 210, 0, 100, 100),
	rect('tile-5', 210, 110, 100, 100),
	rect('more', 330, 500, 60, 24),
]

describe('groupRows', () => {
	it('groups boxes sharing a top edge into rows, left to right', () => {
		const rows = groupRows(layout).map((row) => row.map((item) => item.value))
		expect(rows).toEqual([['row-a'], ['row-b'], ['tile-1', 'tile-2', 'tile-3'], ['tile-4', 'tile-5'], ['more']])
	})
})

describe('findNeighbor', () => {
	const rows = groupRows(layout)
	const step = (current: string | undefined, direction: Parameters<typeof findNeighbor>[2], x?: number) =>
		findNeighbor(rows, current, direction, x)?.value

	it('starts at the first item when nothing is selected', () => {
		expect(step(undefined, 'down')).toBe('row-a')
		expect(step(undefined, 'up')).toBe('more')
	})

	it('moves along a tile row and continues into the next grid row', () => {
		expect(step('tile-1', 'right')).toBe('tile-2')
		expect(step('tile-3', 'right')).toBe('tile-4')
		expect(step('tile-4', 'left')).toBe('tile-3')
		// Row ends skip single-item rows ("More", list rows) and wrap around
		expect(step('tile-5', 'right')).toBe('tile-1')
		expect(step('tile-1', 'left')).toBe('tile-5')
		expect(step('row-a', 'left')).toBe('tile-5')
	})

	it('moves between rows by nearest column', () => {
		expect(step('tile-3', 'down')).toBe('tile-5')
		expect(step('tile-5', 'up')).toBe('tile-2')
		expect(step('more', 'up')).toBe('tile-5')
		expect(step('more', 'down')).toBe('row-a')
	})

	it('enters a grid from a full-width row at its first tile', () => {
		expect(step('row-b', 'down')).toBe('tile-1')
		expect(step('row-a', 'up')).toBe('more')
		expect(step('row-b', 'down', 270)).toBe('tile-3')
	})

	it('keeps a preferred column across single-item rows', () => {
		// Coming from tile-3 through the one-item "More" row, back up lands on tile-3's column
		const x = 270
		expect(step('tile-3', 'down', x)).toBe('tile-5')
		expect(step('tile-5', 'down', x)).toBe('more')
		expect(step('more', 'up', x)).toBe('tile-5')
		expect(step('tile-5', 'up', x)).toBe('tile-3')
	})
})
