import {describe, expect, test} from 'vitest'

import {hslTriplet, momentFlag} from '@/features/photos/components/listing/gpu/tile-renderer'

import {containInset, momentFraction} from './scrubber'

describe('momentFraction', () => {
	test('is how far through the video the moment is', () => {
		expect(momentFraction(30_000, 120_000)).toBe(0.25)
		expect(momentFraction(0, 120_000)).toBe(0)
		expect(momentFraction(120_000, 120_000)).toBe(1)
	})

	test('stays on the line when the moment is outside the length it was given', () => {
		// A moment rounded past the end, or a length that was probed short
		expect(momentFraction(121_000, 120_000)).toBe(1)
		expect(momentFraction(-5, 120_000)).toBe(0)
	})

	test('has no place without a length', () => {
		expect(momentFraction(30_000, undefined)).toBeUndefined()
		expect(momentFraction(30_000, 0)).toBeUndefined()
		expect(momentFraction(30_000, Number.NaN)).toBeUndefined()
		expect(momentFraction(Number.NaN, 120_000)).toBeUndefined()
	})
})

describe('containInset', () => {
	test('a wide picture leaves a band above and below', () => {
		const {inline, block} = containInset(1920, 1080)
		expect(inline).toBe(0)
		expect(block).toBeCloseTo(21.875)
	})

	test('a tall picture leaves a band either side', () => {
		const {inline, block} = containInset(1080, 1920)
		expect(inline).toBeCloseTo(21.875)
		expect(block).toBe(0)
	})

	test('a square picture, or one not measured yet, fills the box', () => {
		expect(containInset(512, 512)).toEqual({inline: 0, block: 0})
		expect(containInset(0, 0)).toEqual({inline: 0, block: 0})
	})
})

describe('momentFlag', () => {
	// The shader's reading of it: floor(flags / 8) − 1, in thousandths
	const read = (flag: number) => (Math.floor(flag / 8) - 1) / 1000

	test('carries the place of the moment above the three state bits', () => {
		for (const [moment, length] of [
			[0, 80_000],
			[29_984, 80_000],
			[80_000, 80_000],
		]) {
			const flag = momentFlag(moment, length)
			expect(flag % 8).toBe(0)
			expect(read(flag + 7)).toBeCloseTo(moment / length, 3)
		}
	})

	test('is nothing without a moment or a length', () => {
		expect(momentFlag(undefined, 80_000)).toBe(0)
		expect(momentFlag(30_000, undefined)).toBe(0)
	})

	test('survives the float the instance buffer stores it in', () => {
		const flag = momentFlag(80_000, 80_000) + 7
		expect(new Float32Array([flag])[0]).toBe(flag)
	})
})

describe('hslTriplet', () => {
	test('reads a colour token as red, green and blue', () => {
		const [r, g, b] = hslTriplet('50 100% 52%')!
		expect([r, g, b].map((n) => Math.round(n * 255))).toEqual([255, 214, 10])
		expect(hslTriplet(' 0 0% 100% ')).toEqual([1, 1, 1])
	})

	test('is nothing for what is not a token', () => {
		expect(hslTriplet('')).toBeUndefined()
		expect(hslTriplet('#ffd60a')).toBeUndefined()
	})
})
