import {describe, expect, it} from 'vitest'

import {detentHeights, releaseVelocity, resisted, rubberBand, settleTarget} from '@/components/ui/detent-sheet'

// A phone's map: 800px tall, the bar's foot 140px down
const BOX = 800
const STOPS = detentHeights([0.55, 'full'], BOX, 140)

describe('detentHeights', () => {
	it('takes fractions of the box, and full as the room under the inset', () => {
		expect(STOPS).toEqual([440, 660])
	})

	it('never goes past the room full has', () => {
		expect(detentHeights([0.9, 'full'], 400, 100)).toEqual([300, 300])
		expect(detentHeights(['full'], 100, 200)).toEqual([0])
	})
})

describe('rubberBand', () => {
	it('gives at first, then less and less, never reaching the room', () => {
		expect(rubberBand(0, 140)).toBe(0)
		const [a, b, c] = [rubberBand(20, 140), rubberBand(200, 140), rubberBand(10_000, 140)]
		expect(a).toBeGreaterThan(10)
		expect(a).toBeLessThan(20)
		expect(b).toBeLessThan(100)
		expect(c).toBeLessThan(140)
	})

	it('has no give without room', () => {
		expect(rubberBand(50, 0)).toBe(0)
	})
})

describe('resisted', () => {
	it('follows the finger between the detents and down toward away', () => {
		expect(resisted(500, STOPS, BOX, true)).toBe(500)
		expect(resisted(200, STOPS, BOX, true)).toBe(200)
		expect(resisted(-30, STOPS, BOX, true)).toBe(0)
	})

	it('resists past the top detent, within the room above it', () => {
		const past = resisted(760, STOPS, BOX, true)
		expect(past).toBeGreaterThan(660)
		expect(past).toBeLessThan(760)
		expect(resisted(5000, STOPS, BOX, true)).toBeLessThan(BOX)
	})

	it('resists below the lowest when it cannot be swiped away', () => {
		const below = resisted(340, STOPS, BOX, false)
		expect(below).toBeLessThan(440)
		expect(below).toBeGreaterThan(340)
	})
})

describe('releaseVelocity', () => {
	it('is the last moment’s speed, up positive, in px/s', () => {
		const samples = [
			{time: 0, at: 400},
			{time: 100, at: 420},
			{time: 150, at: 450},
			{time: 200, at: 480},
		]
		expect(releaseVelocity(samples, 200)).toBeCloseTo(600)
	})

	it('is nothing for a finger that came to rest before letting go', () => {
		expect(
			releaseVelocity(
				[
					{time: 0, at: 400},
					{time: 16, at: 440},
				],
				300,
			),
		).toBe(0)
	})

	it('reads moves that come far apart', () => {
		const samples = [
			{time: 0, at: 420},
			{time: 50, at: 406},
			{time: 200, at: 364},
			{time: 250, at: 350},
		]
		expect(releaseVelocity(samples, 300)).toBeCloseTo(-280)
	})

	it('is nothing for a single sample', () => {
		expect(releaseVelocity([{time: 10, at: 400}], 10)).toBe(0)
	})
})

describe('settleTarget', () => {
	const at = (position: number, velocity = 0, dismissible = true) =>
		settleTarget({position, velocity, stops: STOPS, dismissible})

	it('settles a slow release at the nearest detent', () => {
		expect(at(470)).toBe(0)
		expect(at(600)).toBe(1)
		expect(at(700)).toBe(1)
	})

	it('carries a slower release on the way it was going', () => {
		// 530 is nearer the medium detent, but heading up it ends nearer full
		expect(at(530, 400)).toBe(1)
		expect(at(570, -400)).toBe(0)
	})

	it('moves a flick one detent its way, from where it was let go', () => {
		expect(at(445, 900)).toBe(1)
		expect(at(650, -900)).toBe(0)
		// Even let go just short of full, a flick down is back to medium, not away
		expect(at(655, -4000)).toBe(0)
		// Flicked up from past the top, it stays at the top
		expect(at(700, 900)).toBe(1)
	})

	it('puts it away when flicked down from the lowest detent', () => {
		expect(at(430, -900)).toBe('dismiss')
	})

	it('puts it away when let go well below the lowest detent, and not before', () => {
		expect(at(300)).toBe('dismiss')
		expect(at(330)).toBe(0)
	})

	it('keeps a sheet that cannot be swiped away at its lowest', () => {
		expect(at(300, 0, false)).toBe(0)
		expect(at(430, -900, false)).toBe(0)
	})
})
