import {describe, expect, test} from 'vitest'

import {
	lineRegions,
	lineSegments,
	matchRegions,
	quadPath,
	rangeQuad,
	restingStrength,
	textLines,
	type Quad,
} from './text-regions'

const level: Quad = [0.1, 0.2, 0.9, 0.2, 0.9, 0.3, 0.1, 0.3]
// Rising to the right, and taller at its far end: a sign seen from one side
const tilted: Quad = [0.1, 0.5, 0.9, 0.3, 0.9, 0.5, 0.1, 0.6]

describe('textLines', () => {
	test('pairs each line with its quad, and knows where the line starts', () => {
		const lines = textLines('TESCO\nSourdough Loaf', [level, tilted])
		expect(lines).toEqual([
			{text: 'TESCO', start: 0, quad: level},
			{text: 'Sourdough Loaf', start: 6, quad: tilted},
		])
	})

	test('leaves lines without a place when there are fewer quads, none, or a broken one', () => {
		expect(textLines('one\ntwo', [level]).map((line) => line.quad)).toEqual([level, undefined])
		expect(textLines('one\ntwo', undefined).map((line) => line.quad)).toEqual([undefined, undefined])
		expect(
			textLines('one\ntwo\nthree', [[0, 0, 1], [0, 0, 1, 0, 1, Number.NaN, 0, 1], level]).map((line) => line.quad),
		).toEqual([undefined, undefined, level])
	})

	test('keeps a corner the detector put a hair outside the picture inside it', () => {
		expect(textLines('one', [[-0.01, 0, 1.02, 0, 1, 1, 0, 1]])[0]!.quad).toEqual([0, 0, 1, 0, 1, 1, 0, 1])
	})
})

describe('rangeQuad', () => {
	test('takes the share of the line the characters are', () => {
		// Ten characters of one width: the second half, unpadded
		const [x0, y0, x1, y1, x2, y2, x3, y3] = rangeQuad(level, 'aaaaaaaaaa', 5, 10, 0)
		expect([x0, x1, x2, x3].map((n) => +n.toFixed(4))).toEqual([0.5, 0.9, 0.9, 0.5])
		expect([y0, y1, y2, y3]).toEqual([0.2, 0.2, 0.3, 0.3])
	})

	test('follows a tilted line along both its edges', () => {
		const [x0, y0, x1, y1, x2, y2, x3, y3] = rangeQuad(tilted, 'aaaaaaaaaa', 0, 5, 0)
		expect([x0, y0]).toEqual([0.1, 0.5])
		expect([x1, +y1.toFixed(4)]).toEqual([0.5, 0.4])
		expect([x2, +y2.toFixed(4)]).toEqual([0.5, 0.55])
		expect([x3, y3]).toEqual([0.1, 0.6])
	})

	test('gives narrow letters less of the line than wide ones', () => {
		// "illi" is narrow, "mmmm" wide: the wide word takes more than half
		const [, , x1] = rangeQuad(level, 'illimmmm', 0, 4, 0)
		expect(x1).toBeLessThan(0.4)
	})

	test('is padded, but never past the ends of the line', () => {
		const whole = rangeQuad(level, 'word', 0, 4)
		expect(whole).toEqual(level)
		const [x0, , x1] = rangeQuad(level, 'aaaaaaaaaa', 4, 6)
		expect(x0).toBeLessThan(0.1 + 0.8 * 0.4)
		expect(x1).toBeGreaterThan(0.1 + 0.8 * 0.6)
	})

	test('counts a character outside the basic plane once', () => {
		// The emoji is two UTF-16 units; the match after it starts at unit 3
		const [x0] = rangeQuad(level, '😀 ab', 3, 5, 0)
		expect(x0).toBeGreaterThan(0.1)
		expect(x0).toBeLessThan(0.9)
	})
})

describe('lineSegments', () => {
	test('splits the marked text at its line breaks', () => {
		expect(lineSegments('Pumpkin soup\nsourdough .. £5', ['sourdough'])).toEqual([
			[{text: 'Pumpkin soup', highlighted: false}],
			[
				{text: 'sourdough', highlighted: true},
				{text: ' .. £5', highlighted: false},
			],
		])
	})

	test('marks both lines of a match a sign stacked', () => {
		expect(lineSegments('HAPPY\nBIRTHDAY\nMila', ['happy birthday'])).toEqual([
			[{text: 'HAPPY', highlighted: true}],
			[{text: 'BIRTHDAY', highlighted: true}],
			[{text: 'Mila', highlighted: false}],
		])
	})

	test('keeps empty lines, so lines still pair with their quads', () => {
		expect(lineSegments('one\n\nthree', [])).toEqual([
			[{text: 'one', highlighted: false}],
			[],
			[{text: 'three', highlighted: false}],
		])
	})
})

describe('matchRegions', () => {
	const lines = textLines('TESCO\nSourdough Loaf\nsourdough again', [level, tilted, level])

	test('finds each match in its line, in reading order', () => {
		const regions = matchRegions(lines, ['sourdough'])
		expect(regions.map((region) => region.line)).toEqual([1, 2])
		// The word opens its line, so its region starts where the line does
		expect(regions[0]!.quad.slice(0, 2)).toEqual([0.1, 0.5])
		expect(regions[0]!.quad[2]).toBeLessThan(0.9)
	})

	test('points at both lines of a match that runs over a line break', () => {
		const stacked = textLines('HAPPY\nBIRTHDAY', [level, tilted])
		expect(matchRegions(stacked, ['happy birthday'])).toEqual([
			{line: 0, quad: level},
			{line: 1, quad: tilted},
		])
	})

	test('passes over a match in a line with no place', () => {
		const partial = textLines('sourdough\nsourdough', [level])
		expect(matchRegions(partial, ['sourdough'])).toMatchObject([{line: 0}])
	})

	test('stops at the limit', () => {
		const page = textLines(
			Array.from({length: 40}, () => 'milk').join('\n'),
			Array.from({length: 40}, () => level),
		)
		expect(matchRegions(page, ['milk'])).toHaveLength(24)
	})

	test('is nothing without terms', () => {
		expect(matchRegions(lines, [])).toEqual([])
	})
})

test('lineRegions is every line that has a place', () => {
	expect(lineRegions(textLines('a\nb\nc', [level, [], tilted]))).toEqual([
		{line: 0, quad: level},
		{line: 2, quad: tilted},
	])
})

test('restingStrength quietens a crowd and never silences it', () => {
	expect(restingStrength(1)).toBe(1)
	expect(restingStrength(4)).toBe(1)
	expect(restingStrength(10)).toBeLessThan(1)
	expect(restingStrength(24)).toBeGreaterThanOrEqual(0.55)
	expect(restingStrength(500)).toBe(0.55)
})

test('quadPath draws the four corners in the picture’s own space', () => {
	expect(quadPath(tilted, 1000, 500)).toBe('M100 250L900 150L900 250L100 300Z')
})
