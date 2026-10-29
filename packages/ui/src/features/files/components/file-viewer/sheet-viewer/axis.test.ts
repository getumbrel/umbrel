import {describe, expect, test} from 'vitest'

import {Axis} from './axis'

describe('Axis', () => {
	test('lines of the default size', () => {
		const axis = new Axis(1_000_000, 20)
		expect([axis.size(5), axis.start(5), axis.total]).toEqual([20, 100, 20_000_000])
		expect([axis.at(0), axis.at(19.9), axis.at(20), axis.at(19_999_999), axis.at(1e12)]).toEqual([
			0, 0, 1, 999_999, 999_999,
		])
	})

	test('sized and hidden lines', () => {
		// Line 1 is 50, line 3 hidden, line 4 is 10; lines past the count are ignored
		const axis = new Axis(6, 20, [1, 50, 3, 0, 4, 10, 9, 99])
		expect([0, 1, 2, 3, 4, 5].map((i) => axis.size(i))).toEqual([20, 50, 20, 0, 10, 20])
		expect([0, 1, 2, 3, 4, 5, 6].map((i) => axis.start(i))).toEqual([0, 20, 70, 90, 90, 100, 120])
		expect(axis.total).toBe(120)
		// The hidden line is never the one under a position
		expect([0, 20, 69, 70, 89, 90, 95, 100, 500].map((p) => axis.at(p))).toEqual([0, 1, 1, 2, 2, 4, 4, 5, 5])
	})

	test('an empty axis', () => {
		const axis = new Axis(0, 20)
		expect([axis.total, axis.at(10)]).toEqual([0, 0])
	})
})
