import {describe, expect, test} from 'vitest'

import {indexAtPoint, indexesInRect, type ListingLayout} from './listing-hit-test'

const rect = (left: number, top: number, right: number, bottom: number) => ({left, top, right, bottom})

describe('indexesInRect in the list view', () => {
	const list: ListingLayout = {view: 'list', count: 10, width: 800, rowHeight: 44}

	test('covers every row the box passes over, whole or in part', () => {
		// From inside the second row to inside the fifth
		expect(indexesInRect(list, rect(100, 50, 300, 190))).toEqual([1, 2, 3, 4])
	})

	test('a box inside one row touches that row alone', () => {
		expect(indexesInRect(list, rect(400, 100, 420, 110))).toEqual([2])
	})

	test('rows far past what is mounted are covered just the same', () => {
		const long: ListingLayout = {view: 'list', count: 5000, width: 800, rowHeight: 44}
		const covered = indexesInRect(long, rect(10, 44 * 1000 + 1, 20, 44 * 4000 - 1))
		expect(covered.length).toBe(3000)
		expect(covered[0]).toBe(1000)
		expect(covered.at(-1)).toBe(3999)
	})

	test('stops at the last row, and below it touches nothing', () => {
		expect(indexesInRect(list, rect(0, 400, 100, 900))).toEqual([9])
		expect(indexesInRect(list, rect(0, 441, 100, 900))).toEqual([])
	})

	test('a box beside the rows, or over an empty listing, touches nothing', () => {
		expect(indexesInRect(list, rect(801, 0, 900, 440))).toEqual([])
		expect(indexesInRect({...list, count: 0}, rect(0, 0, 100, 100))).toEqual([])
	})
})

describe('indexesInRect in the icons view', () => {
	// Tiles 100 wide and 150 tall, 8 apart: columns start at 0, 108, 216, 324; rows at 0, 158, 316
	const grid: ListingLayout = {view: 'icons', count: 10, columnCount: 4, itemWidth: 100, itemHeight: 150}

	test('covers the tiles the box touches, in listing order', () => {
		// Across the second and third columns, down the first two rows
		expect(indexesInRect(grid, rect(150, 100, 250, 200))).toEqual([1, 2, 5, 6])
	})

	test('the gaps between tiles are nobody’s', () => {
		// Inside the gap between the first and second columns
		expect(indexesInRect(grid, rect(101, 10, 107, 140))).toEqual([])
		// Inside the gap between the first and second rows
		expect(indexesInRect(grid, rect(10, 151, 90, 157))).toEqual([])
	})

	test('an edge that only touches a tile counts', () => {
		expect(indexesInRect(grid, rect(100, 10, 104, 20))).toEqual([0])
		expect(indexesInRect(grid, rect(104, 10, 108, 20))).toEqual([1])
	})

	test('the last row holds only the tiles it has', () => {
		// The third row has two tiles (indexes 8 and 9): the box runs across all four columns
		expect(indexesInRect(grid, rect(0, 320, 430, 400))).toEqual([8, 9])
	})

	test('a box past the last column or the last row touches nothing', () => {
		expect(indexesInRect(grid, rect(430, 0, 600, 100))).toEqual([])
		expect(indexesInRect(grid, rect(0, 470, 100, 600))).toEqual([])
	})
})

describe('indexAtPoint', () => {
	const list: ListingLayout = {view: 'list', count: 10, width: 800, rowHeight: 60}
	const grid: ListingLayout = {view: 'icons', count: 10, columnCount: 4, itemWidth: 100, itemHeight: 150}

	test('a point level with a row is on it, wherever across the listing it is', () => {
		expect(indexAtPoint(list, 10, 0)).toBe(0)
		expect(indexAtPoint(list, 400, 125)).toBe(2)
		expect(indexAtPoint(list, 5000, 599)).toBe(9)
	})

	test('past the last row there is nothing', () => {
		expect(indexAtPoint(list, 10, 600)).toBeUndefined()
		expect(indexAtPoint(list, 10, -1)).toBeUndefined()
	})

	test('a point on a tile is on it', () => {
		expect(indexAtPoint(grid, 50, 50)).toBe(0)
		expect(indexAtPoint(grid, 250, 200)).toBe(6)
		expect(indexAtPoint(grid, 110, 320)).toBe(9)
	})

	test('the gaps, the space past the last column and the space past the last tile are nobody’s', () => {
		expect(indexAtPoint(grid, 104, 50)).toBeUndefined()
		expect(indexAtPoint(grid, 50, 154)).toBeUndefined()
		expect(indexAtPoint(grid, 440, 50)).toBeUndefined()
		// The third row has two tiles: the third column is empty
		expect(indexAtPoint(grid, 250, 320)).toBeUndefined()
	})
})
