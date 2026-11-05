import {describe, expect, it} from 'vitest'

import {fitColumns, fitRows, homeFit} from './home-fit'

const phoneGrid = {cell: {min: 70, max: 70}, gap: {min: 12, max: 20}}
const regularGrid = {cell: {min: 110, max: 120}, gap: {min: 16, max: 30}}

describe('homeFit', () => {
	it('leaves a tall window alone', () => {
		expect(homeFit({width: 1920, height: 1080})).toEqual({
			phoneScale: false,
			low: false,
			inlineHeader: false,
			tightWidgets: false,
		})
	})

	it('keeps a phone in portrait on its phone layout', () => {
		const fit = homeFit({width: 393, height: 659})
		expect(fit.phoneScale).toBe(true)
		expect(fit.inlineHeader).toBe(false)
	})

	it('puts the logo beside the greeting on short phones, and keeps their widget names', () => {
		const fit = homeFit({width: 382, height: 580})
		expect(fit.inlineHeader).toBe(true)
		expect(fit.tightWidgets).toBe(false)
	})

	it('uses the phone scale for a phone in landscape', () => {
		const fit = homeFit({width: 750, height: 296})
		expect(fit.phoneScale).toBe(true)
		expect(fit.inlineHeader).toBe(true)
		expect(fit.tightWidgets).toBe(true)
	})

	it('counts sideways phones and outer displays as phones, however wide', () => {
		for (const size of [
			{width: 382, height: 580},
			{width: 594, height: 368},
			{width: 832, height: 420},
		]) {
			expect(homeFit(size).phoneScale).toBe(true)
		}
	})

	it('leaves tablets and inner displays off the phone scale', () => {
		for (const size of [
			{width: 669, height: 867},
			{width: 744, height: 1047},
			{width: 951, height: 585},
		]) {
			expect(homeFit(size).phoneScale).toBe(false)
		}
	})

	it('tightens a tablet in landscape without using the phone scale', () => {
		const fit = homeFit({width: 1133, height: 658, touch: true})
		expect(fit.phoneScale).toBe(false)
		expect(fit.inlineHeader).toBe(true)
		expect(fit.tightWidgets).toBe(true)
	})

	it('keeps the regular Home in a laptop browser as short as a tablet on its side', () => {
		for (const size of [
			{width: 1366, height: 657},
			{width: 1280, height: 632},
			{width: 1133, height: 658},
		]) {
			expect(homeFit(size)).toEqual({phoneScale: false, low: false, inlineHeader: false, tightWidgets: false})
		}
	})

	it('tightens a short window below desktop widths, touchscreen or not', () => {
		expect(homeFit({width: 951, height: 650}).tightWidgets).toBe(true)
		expect(homeFit({width: 951, height: 650, touch: true}).tightWidgets).toBe(true)
	})
})

describe('fitColumns', () => {
	it('keeps four columns on a narrow outer display', () => {
		const {columns, cellW, gapX} = fitColumns({width: 324, maxColumns: 4, ...phoneGrid})
		expect(columns).toBe(4)
		expect(cellW).toBe(70)
		expect(gapX).toBeCloseTo(14.67, 1)
	})

	it('leaves a phone as it was', () => {
		expect(fitColumns({width: 355, maxColumns: 4, ...phoneGrid})).toEqual({columns: 4, cellW: 70, gapX: 20})
	})

	it('narrows cells before losing a column on an inner display', () => {
		const {columns, cellW, gapX} = fitColumns({width: 637, maxColumns: 6, ...regularGrid})
		expect(columns).toBe(5)
		expect(cellW).toBe(114)
		expect(gapX).toBeGreaterThanOrEqual(16)
	})

	it('keeps the full grid on a large screen', () => {
		expect(fitColumns({width: 870, maxColumns: 6, ...regularGrid})).toEqual({columns: 6, cellW: 120, gapX: 30})
	})

	it('never overflows the width', () => {
		for (let width = 300; width <= 1000; width += 7) {
			const {columns, cellW, gapX} = fitColumns({width, maxColumns: 6, ...regularGrid})
			expect(columns * cellW + (columns - 1) * gapX).toBeLessThanOrEqual(width + 0.001)
		}
	})

	it('survives the width being unmeasured', () => {
		expect(fitColumns({width: 0, maxColumns: 6, ...regularGrid}).columns).toBe(0)
	})
})

describe('fitRows', () => {
	const gap = {min: 12, max: 32}

	it('fits a second row a 1440×800 laptop used to miss', () => {
		expect(fitRows({height: 257, rowH: 110, gap, gapAbove: true}).rows).toBe(2)
	})

	it('spreads rows over a tall screen, up to the most gap allowed', () => {
		const {rows, gapY} = fitRows({height: 717, rowH: 110, gap, gapAbove: true})
		expect(rows).toBe(5)
		expect(gapY).toBe(32)
	})

	it('keeps the smallest gap when rows only just fit', () => {
		expect(fitRows({height: 110 * 2 + 12, rowH: 110, gap}).gapY).toBe(12)
	})

	it('never overflows the height', () => {
		for (let height = 100; height <= 1200; height += 13) {
			for (const gapAbove of [true, false]) {
				const {rows, gapY} = fitRows({height, rowH: 110, gap, gapAbove})
				const gaps = gapAbove ? rows : Math.max(0, rows - 1)
				expect(rows * 110 + gaps * gapY).toBeLessThanOrEqual(height + 0.001)
			}
		}
	})
})
