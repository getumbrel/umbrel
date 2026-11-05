import {describe, expect, it} from 'vitest'

import {createVelocityTracker, PAGE_SPRING, springConfig, stepAxis, type Axis} from './spring'

// Runs an axis to rest in 60 Hz frames (each integrated in substeps, as
// animate() does) and reports how long it took and how far past its target
// it ever went
function settle(axis: Axis, maxSeconds = 3) {
	const target = axis.to ?? 0
	const side = Math.sign(axis.value - target)
	let t = 0
	let overshoot = 0
	while (t < maxSeconds) {
		let rested = false
		for (let n = 0; n < 4 && !rested; n++) rested = stepAxis(axis, 1 / 240)
		t += 1 / 60
		if (side) overshoot = Math.max(overshoot, -side * (axis.value - target))
		if (rested) return {t, overshoot}
	}
	return {t: Infinity, overshoot}
}

describe('stepAxis springs', () => {
	it('comes to rest exactly on its target', () => {
		const axis: Axis = {value: 0, velocity: 0, to: 385, config: PAGE_SPRING}
		const {t} = settle(axis)
		expect(t).toBeLessThan(1)
		expect(axis.value).toBe(385)
		expect(axis.velocity).toBe(0)
	})

	it('arrives sooner the faster it was thrown', () => {
		const slow = settle({value: -100, velocity: 0, to: -385, config: PAGE_SPRING, clamp: true}).t
		const fast = settle({value: -100, velocity: -2500, to: -385, config: PAGE_SPRING, clamp: true}).t
		expect(fast).toBeLessThan(slow)
	})

	it('never swings past a clamped target, however hard it is thrown', () => {
		const axis: Axis = {value: 0, velocity: 9000, to: 300, config: PAGE_SPRING, clamp: true}
		const {overshoot} = settle(axis)
		expect(overshoot).toBe(0)
		expect(axis.value).toBe(300)
	})

	it('swings a little with a damping ratio below 1, not at all at 1', () => {
		expect(
			settle({value: 0, velocity: 0, to: 1, config: springConfig(0.36, 0.86), precision: 0.001}).overshoot,
		).toBeGreaterThan(0)
		expect(
			settle({value: 0, velocity: 0, to: 1, config: springConfig(0.36, 1), precision: 0.001}).overshoot,
		).toBeLessThan(1e-3)
	})
})

describe('stepAxis glides', () => {
	it('slows by friction to a stop inside its bounds', () => {
		const axis: Axis = {value: 0, velocity: -1000, min: -2000, max: 0, config: PAGE_SPRING}
		const {t} = settle(axis)
		expect(t).toBeLessThan(4)
		// UIScrollView's deceleration carries 1000 px/s about half a second's worth
		expect(axis.value).toBeGreaterThan(-560)
		expect(axis.value).toBeLessThan(-440)
	})

	it('runs past an edge it reaches with speed to spare, and springs back onto it', () => {
		const axis: Axis = {value: -100, velocity: -2000, min: -300, max: 0, config: springConfig(0.36)}
		let furthest = 0
		for (let i = 0; i < 400 && !stepAxis(axis, 1 / 240); i++) furthest = Math.min(furthest, axis.value)
		expect(furthest).toBeLessThan(-300)
		expect(axis.value).toBe(-300)
	})
})

describe('createVelocityTracker', () => {
	it('reports the recent travel per ms', () => {
		const tracker = createVelocityTracker()
		for (let t = 0; t <= 100; t += 10) tracker.add(t, t * 2, -t)
		const v = tracker.velocity(100)
		expect(v.x).toBeCloseTo(2)
		expect(v.y).toBeCloseTo(-1)
	})

	it('reports nothing once the finger has been still a moment', () => {
		const tracker = createVelocityTracker()
		for (let t = 0; t <= 100; t += 10) tracker.add(t, t * 2, 0)
		expect(tracker.velocity(250)).toEqual({x: 0, y: 0})
	})
})
