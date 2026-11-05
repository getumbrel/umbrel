import {describe, expect, it} from 'vitest'

import {carryEasing, composeStart, overTile} from './picture-flight'

describe('overTile', () => {
	it('maps a landscape picture’s centre square onto the tile, corners included', () => {
		const to = {left: 100, top: 100, width: 400, height: 300}
		const from = {left: 10, top: 20, width: 60, height: 60, radius: 6}
		expect(overTile(to, from)).toEqual({
			// Crop is 300×300 at x 50: scale 0.2 puts it at the tile once the
			// picture is moved so that (100 + 50·0.2, 100) lands on (10, 20)
			transform: 'translate(-100px, -80px) scale(0.2)',
			clipPath: 'inset(0px 50px round 30px)',
		})
	})

	it('crops a portrait picture top and bottom', () => {
		const {clipPath} = overTile(
			{left: 0, top: 0, width: 300, height: 500},
			{left: 0, top: 0, width: 150, height: 150, radius: 0},
		)
		expect(clipPath).toBe('inset(100px 0px round 0px)')
	})
})

describe('carryEasing', () => {
	const box = {left: 0, top: 0, width: 300, height: 200}
	const end = {x: 0, y: 400, scale: 1}

	it('keeps the stock curve without a velocity', () => {
		expect(carryEasing({x: 0, y: 0, scale: 1}, end, box, 300)).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)')
	})

	it('opens at the release speed: progress per ms × duration is the opening slope', () => {
		// 1 px/ms toward a target 400px away over 300ms: slope 0.75, y1 = 0.15
		expect(carryEasing({x: 0, y: 0, scale: 1, velocity: {x: 0, y: 1, scale: 0}}, end, box, 300)).toBe(
			'cubic-bezier(0.2, 0.15, 0.2, 1)',
		)
	})

	it('carries on the way it was thrown before turning for a tile behind it', () => {
		const easing = carryEasing({x: 0, y: 0, scale: 1, velocity: {x: 0, y: -1, scale: 0}}, end, box, 300)
		expect(easing).toBe('cubic-bezier(0.2, -0.15, 0.2, 1)')
	})

	it('never bends so far that the curve overshoots or loops', () => {
		const easing = carryEasing({x: 0, y: 0, scale: 1, velocity: {x: 0, y: 50, scale: 0}}, end, box, 300)
		expect(easing).toBe('cubic-bezier(0.2, 1, 0.2, 1)')
	})
})

describe('composeStart', () => {
	it('folds a start into a further transform about the same corner', () => {
		expect(
			composeStart({x: 10, y: 20, scale: 0.5}, {x: 100, y: 0, scale: 0.8, velocity: {x: 2, y: 0, scale: 0.001}}),
		).toEqual({
			x: 60,
			y: 20,
			scale: 0.4,
			clipPath: undefined,
			velocity: {x: 1, y: 0, scale: 0.0005},
		})
	})
})
