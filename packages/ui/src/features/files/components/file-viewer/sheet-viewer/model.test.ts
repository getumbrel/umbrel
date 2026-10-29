import {describe, expect, test} from 'vitest'

import {Axis} from './axis'
import {areaAt, overlaps, placeOf, sameRange, step, visibleLine, withMerges} from './model'

// Rows 1 and 2 hidden, and 5 (0-based); columns 0 and 3 hidden
const rows = new Axis(8, 20, [1, 0, 2, 0, 5, 0])
const cols = new Axis(6, 64, [0, 0, 3, 0])
const merges = [{top: 3, left: 1, bottom: 4, right: 2}]

describe('visibleLine', () => {
	test('a shown line is itself', () => {
		expect(visibleLine(rows, 3, 1)).toBe(3)
	})

	test('a hidden one gives way to the next shown in its direction, else the other way', () => {
		expect([visibleLine(rows, 1, 1), visibleLine(rows, 2, -1), visibleLine(cols, 0, 1)]).toEqual([3, 0, 1])
		// Nothing shown further on: back the other way
		expect(visibleLine(new Axis(4, 20, [2, 0, 3, 0]), 3, 1)).toBe(1)
	})

	test('an axis with nothing shown keeps the line asked for', () => {
		expect(visibleLine(new Axis(2, 20, [0, 0, 1, 0]), 1, 1)).toBe(1)
	})
})

describe('step', () => {
	test('passes over hidden lines, and stays put at the edge', () => {
		expect(step({rows, cols, merges: []}, {row: 0, col: 1}, 1, 0)).toEqual({row: 3, col: 1})
		expect(step({rows, cols, merges: []}, {row: 0, col: 1}, 0, -1)).toEqual({row: 0, col: 1})
		expect(step({rows, cols, merges: []}, {row: 7, col: 5}, 1, 0)).toEqual({row: 7, col: 5})
	})

	test('leaves a merge from its far side', () => {
		expect(step({rows, cols, merges}, {row: 3, col: 1}, 0, 1)).toEqual({row: 3, col: 4})
		expect(step({rows, cols, merges}, {row: 3, col: 1}, 1, 0)).toEqual({row: 6, col: 1})
	})
})

describe('merges', () => {
	test('a cell stands for the merge it is in', () => {
		expect(areaAt(merges, 4, 2)).toEqual(merges[0])
		expect(areaAt(merges, 0, 0)).toEqual({top: 0, left: 0, bottom: 0, right: 0})
		expect(sameRange(areaAt(merges, 3, 1), merges[0])).toBe(true)
	})

	test('a selection grows until no merge sticks out of it', () => {
		const chained = [
			{top: 0, left: 1, bottom: 1, right: 2},
			{top: 1, left: 3, bottom: 3, right: 3},
		]
		expect(withMerges({top: 0, left: 0, bottom: 0, right: 1}, chained)).toEqual({top: 0, left: 0, bottom: 1, right: 2})
		expect(withMerges({top: 1, left: 2, bottom: 1, right: 3}, chained)).toEqual({top: 0, left: 1, bottom: 3, right: 3})
	})
})

describe('placeOf', () => {
	test('a cell or a range on this sheet', () => {
		expect(placeOf('B5')).toEqual({range: {top: 4, left: 1, bottom: 4, right: 1}})
		expect(placeOf('$A$1:C2')).toEqual({range: {top: 0, left: 0, bottom: 1, right: 2}})
	})

	test('on another sheet, its name quoted or not', () => {
		expect(placeOf('Expenses!A1')).toEqual({sheet: 'Expenses', range: {top: 0, left: 0, bottom: 0, right: 0}})
		expect(placeOf("'Q1!Data'!B3")?.sheet).toBe('Q1!Data')
		expect(placeOf("'It''s here'!C2:D4")).toEqual({sheet: "It's here", range: {top: 1, left: 2, bottom: 3, right: 3}})
	})

	test('nothing for what is not a reference', () => {
		expect([placeOf('Rates'), placeOf('Sheet1!Rates'), placeOf('')]).toEqual([undefined, undefined, undefined])
	})
})

test('two ranges overlap when they share a cell, a corner included', () => {
	const b2c3 = {top: 1, left: 1, bottom: 2, right: 2}
	expect(overlaps(b2c3, {top: 2, left: 2, bottom: 5, right: 5})).toBe(true)
	expect(overlaps(b2c3, {top: 0, left: 0, bottom: 9, right: 9})).toBe(true)
	expect(overlaps(b2c3, {top: 3, left: 1, bottom: 3, right: 2})).toBe(false)
	expect(overlaps(b2c3, {top: 1, left: 3, bottom: 2, right: 3})).toBe(false)
})
