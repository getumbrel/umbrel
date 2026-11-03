import {describe, expect, it} from 'vitest'

import {direction, moonOverhead, skyTurn, sunOverhead} from '@/features/photos/components/map/sun'

describe('the sun', () => {
	it('is over the equator at an equinox and a tropic at a solstice', () => {
		// The moments of the March equinox and June solstice of 2026, and the December solstice of 2025
		expect(sunOverhead(Date.UTC(2026, 2, 20, 14, 46)).lat).toBeCloseTo(0, 1)
		expect(sunOverhead(Date.UTC(2026, 5, 21, 8, 25)).lat).toBeCloseTo(23.44, 1)
		expect(sunOverhead(Date.UTC(2025, 11, 21, 15, 3)).lat).toBeCloseTo(-23.44, 1)
	})

	it('is over Greenwich at noon there, give or take the equation of time', () => {
		// Mid-April and at the start of September the sundial and the clock agree
		expect(Math.abs(sunOverhead(Date.UTC(2026, 3, 15, 12)).lng)).toBeLessThan(0.3)
		expect(Math.abs(sunOverhead(Date.UTC(2026, 8, 1, 12)).lng)).toBeLessThan(0.3)
		// Early November the sun is more than sixteen minutes ahead of the clock: four degrees west already
		expect(sunOverhead(Date.UTC(2026, 10, 3, 12)).lng).toBeCloseTo(-4.1, 0)
		// … and mid-February fourteen behind
		expect(sunOverhead(Date.UTC(2026, 1, 11, 12)).lng).toBeCloseTo(3.55, 0)
	})

	it('goes round westwards, fifteen degrees an hour', () => {
		const noon = sunOverhead(Date.UTC(2026, 3, 15, 12)).lng
		expect(sunOverhead(Date.UTC(2026, 3, 15, 18)).lng - noon).toBeCloseTo(-90, 0)
		expect(sunOverhead(Date.UTC(2026, 3, 15, 6)).lng - noon).toBeCloseTo(90, 0)
	})

	it('has the sky turned 280.46° over Greenwich at the start of 2000, and once more a sidereal day later', () => {
		expect(skyTurn(Date.UTC(2000, 0, 1, 12))).toBeCloseTo(280.4606, 3)
		const siderealDay = 86_164_090.5
		expect(skyTurn(Date.UTC(2000, 0, 1, 12) + siderealDay)).toBeCloseTo(280.4606, 2)
	})

	it('points out of the Earth through a place', () => {
		expect(direction(0, 0)).toEqual([1, 0, 0])
		expect(direction(90, 0)[1]).toBeCloseTo(1)
		expect(direction(12, 90)[2]).toBeCloseTo(1)
	})
})

describe('the moon', () => {
	const apart = (time: number) => {
		const [sun, moon] = [sunOverhead(time), moonOverhead(time)]
		const [a, b] = [direction(sun.lng, sun.lat), direction(moon.lng, moon.lat)]
		return (Math.acos(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) * 180) / Math.PI
	}
	// How much of its face is lit, from new (0) to full (1), as the star field draws it
	const lit = (time: number) => (1 - Math.cos((apart(time) * Math.PI) / 180)) / 2

	it('is beside the sun when it is new, and right in front of it at an eclipse', () => {
		// The new moon of 6 January 2000, which lunations are counted from
		expect(apart(Date.UTC(2000, 0, 6, 18, 14))).toBeLessThan(5.5)
		expect(lit(Date.UTC(2000, 0, 6, 18, 14))).toBeLessThan(0.005)
		// The total solar eclipse of 8 April 2024, at its greatest
		expect(apart(Date.UTC(2024, 3, 8, 18, 17))).toBeLessThan(1)
	})

	it("is opposite the sun when it is full, and in the Earth's shadow at an eclipse", () => {
		// The total lunar eclipse of 21 January 2000, at its greatest
		expect(apart(Date.UTC(2000, 0, 21, 4, 44))).toBeGreaterThan(179)
		expect(lit(Date.UTC(2000, 0, 21, 4, 44))).toBeGreaterThan(0.999)
	})

	it('is half lit at the quarters, a week either side of new', () => {
		// First quarter, 14 January 2000, 13:34
		expect(lit(Date.UTC(2000, 0, 14, 13, 34))).toBeCloseTo(0.5, 1)
		// Last quarter, 28 January 2000, 07:57
		expect(lit(Date.UTC(2000, 0, 28, 7, 57))).toBeCloseTo(0.5, 1)
	})

	it("keeps within its five degrees of the sun's path, and so within twenty-nine of the equator", () => {
		for (let day = 0; day < 60; day++) {
			expect(Math.abs(moonOverhead(Date.UTC(2026, 0, 1) + day * 86_400_000).lat)).toBeLessThan(29)
		}
	})
})
