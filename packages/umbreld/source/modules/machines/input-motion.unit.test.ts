import {afterEach, expect, test, vi} from 'vitest'
import {createPointerMotion, pointOnMotion} from './input-motion.js'

afterEach(() => vi.restoreAllMocks())
const from = {x: 100, y: 300},
	to = {x: 700, y: 300}
const points = (motion: ReturnType<typeof createPointerMotion>) =>
	Array.from({length: 1001}, (_, i) => pointOnMotion(motion, i / 1000))

test('a long reach can overshoot modestly and curve back onto the exact target', () => {
	vi.spyOn(Math, 'random').mockReturnValue(0.2)
	const motion = createPointerMotion(from, to, {width: 1000, height: 700})
	const samples = points(motion)
	const farthest = Math.max(...samples.map((p) => p.x))
	expect(farthest).toBeGreaterThan(to.x + 1)
	expect(farthest).toBeLessThan(to.x + 18)
	expect(samples.at(-1)).toEqual(to)
	expect(samples[750].y).not.toBe(to.y)
	const speeds = samples.slice(1).map((p, i) => Math.hypot(p.x - samples[i].x, p.y - samples[i].y))
	expect(Math.max(...speeds.slice(750))).toBeLessThan(Math.max(...speeds.slice(0, 650)) * 0.15)
})

test('an undershoot keeps approaching instead of forcing every gesture to bounce', () => {
	vi.spyOn(Math, 'random').mockReturnValue(0.8)
	const motion = createPointerMotion(from, to, {width: 1000, height: 700})
	expect(motion.settle!.near.x).toBeLessThan(to.x)
	expect(points(motion).every((p) => p.x <= to.x)).toBe(true)
	expect(pointOnMotion(motion, 1)).toEqual(to)
})

test('correction overlaps the reach smoothly and starts and ends at rest', () => {
	vi.spyOn(Math, 'random').mockReturnValue(0.2)
	const motion = createPointerMotion(from, to, {width: 1000, height: 700})
	const h = 0.00001
	const speed = (t: number) => {
		const a = pointOnMotion(motion, t),
			b = pointOnMotion(motion, t + h)
		return {x: (b.x - a.x) / h, y: (b.y - a.y) / h}
	}
	for (const join of [motion.settle!.correctionStart, motion.settle!.reachEnd]) {
		const before = speed(join - h),
			after = speed(join)
		expect(Math.hypot(before.x - after.x, before.y - after.y)).toBeLessThan(0.5)
	}
	expect(Math.hypot(speed(0).x, speed(0).y)).toBeLessThan(0.01)
	expect(Math.hypot(speed(1 - h).x, speed(1 - h).y)).toBeLessThan(0.01)
})

test('all variations stay in bounds, including targets at screen corners', () => {
	const random = vi.spyOn(Math, 'random')
	for (const value of [0, 0.2, 0.5, 0.99]) {
		random.mockReturnValue(value)
		for (const target of [
			{x: 0, y: 0},
			{x: 799, y: 0},
			{x: 0, y: 599},
			{x: 799, y: 599},
		]) {
			const motion = createPointerMotion({x: 400, y: 300}, target, {width: 800, height: 600})
			for (const point of points(motion)) {
				expect(point.x).toBeGreaterThanOrEqual(-1e-9)
				expect(point.x).toBeLessThanOrEqual(799 + 1e-9)
				expect(point.y).toBeGreaterThanOrEqual(-1e-9)
				expect(point.y).toBeLessThanOrEqual(599 + 1e-9)
			}
			expect(pointOnMotion(motion, 2)).toEqual(target)
			expect(pointOnMotion(motion, -1)).toEqual({x: 400, y: 300})
		}
	}
})

test('sampling a serialized motion is deterministic, and precision moves stay direct', () => {
	const random = vi.spyOn(Math, 'random').mockReturnValue(0.2)
	const motion = createPointerMotion(from, to, {width: 1000, height: 700})
	random.mockReturnValue(0.8)
	expect(points(JSON.parse(JSON.stringify(motion)))).toEqual(points(motion))
	expect(createPointerMotion(from, to, {width: 1000, height: 700})).not.toEqual(motion)
	expect(pointOnMotion(motion, 0.3).y).not.toBe(from.y)
	const drag = createPointerMotion(from, to, {width: 1000, height: 700, straight: true, durationMs: 300})
	expect(drag.settle).toBeUndefined()
	expect(drag.durationMs).toBe(300)
	expect(points(drag).every((p) => Math.abs(p.y - 300) < 1e-9)).toBe(true)
	expect(createPointerMotion(from, {x: 110, y: 305}, {width: 1000, height: 700}).settle).toBeUndefined()
})
