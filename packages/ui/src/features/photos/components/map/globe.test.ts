import type {Map as MapLibreMap} from 'maplibre-gl'
import {describe, expect, it} from 'vitest'

import {
	focalLength,
	globeness,
	globeZoom,
	horizon,
	locate,
	mapCamera,
	viewSize,
} from '@/features/photos/components/map/globe'
import {FLAT_ZOOM, GLOBE_ZOOM} from '@/features/photos/components/map/map-style'
import {mercatorX, mercatorY} from '@/features/photos/components/map/points'

// A map 1200 by 800 looking at a place, with its centre drawn where padding puts it
const WIDTH = 1200
const HEIGHT = 800
const ORIGIN = {x: 700, y: 420}
function mapAt(lng: number, lat: number, zoom: number, stub = {}) {
	return {
		getCenter: () => ({lng, lat}),
		getZoom: () => zoom,
		project: () => ORIGIN,
		getContainer: () => ({clientWidth: WIDTH, clientHeight: HEIGHT}),
		getCanvas: () => ({width: WIDTH * 2, height: HEIGHT * 2}),
		getVerticalFieldOfView: () => 36.87,
		...stub,
	} as unknown as MapLibreMap
}

describe('the globe', () => {
	it('is fully round up to one zoom, flat from another, and unrolls in between', () => {
		expect(globeness(0)).toBe(1)
		expect(globeness(GLOBE_ZOOM)).toBe(1)
		expect(globeness((GLOBE_ZOOM + FLAT_ZOOM) / 2)).toBeCloseTo(0.5)
		expect(globeness(FLAT_ZOOM)).toBe(0)
		expect(globeness(18)).toBe(0)
	})

	it('puts a place on the flat map where Mercator does', () => {
		const camera = mapCamera(mapAt(-9.14, 38.72, 8))
		const world = 512 * 2 ** 8
		const {x, y, shown} = locate(camera, -8.61, 41.15)
		expect(x).toBeCloseTo(ORIGIN.x + (mercatorX(-8.61) - mercatorX(-9.14)) * world, 6)
		expect(y).toBeCloseTo(ORIGIN.y + (mercatorY(41.15) - mercatorY(38.72)) * world, 6)
		expect(shown).toBe(1)
	})

	it('puts the middle of the view where the map draws it, however round it is', () => {
		for (const zoom of [1.5, GLOBE_ZOOM, 4.4, FLAT_ZOOM, 9]) {
			const place = locate(mapCamera(mapAt(139.69, 35.68, zoom)), 139.69, 35.68)
			expect(place.x).toBeCloseTo(ORIGIN.x, 6)
			expect(place.y).toBeCloseTo(ORIGIN.y, 6)
			expect(place.shown).toBe(1)
		}
	})

	it('shows what is this side of the horizon, hides what is round the back, and fades in between', () => {
		const camera = mapCamera(mapAt(0, 0, 1.8))
		const reach = horizon(camera)
		// A camera a focal length up sees less than half the globe
		expect(reach).toBeGreaterThan(60)
		expect(reach).toBeLessThan(90)
		expect(locate(camera, 30, 10).shown).toBe(1)
		expect(locate(camera, 180, 0).shown).toBe(0)
		expect(locate(camera, reach + 1, 0).shown).toBe(0)
		const coming = locate(camera, reach - 2, 0).shown
		expect(coming).toBeGreaterThan(0)
		expect(coming).toBeLessThan(1)
		// East is to the right and north is up
		expect(locate(camera, 30, 0).x).toBeGreaterThan(ORIGIN.x)
		expect(locate(camera, 0, 30).y).toBeLessThan(ORIGIN.y)
	})

	it('draws a place on the edge of the globe at the edge of its disc', () => {
		const camera = mapCamera(mapAt(0, 0, 1.8))
		const {radius, focal} = camera
		const edge = (focal * radius) / Math.sqrt((radius + focal) ** 2 - radius ** 2)
		expect(locate(camera, horizon(camera), 0).x - ORIGIN.x).toBeCloseTo(edge, 6)
	})

	it('is zoomed to look as wide as it is asked to', () => {
		for (const latitude of [0, 37.8, -50]) {
			const zoom = globeZoom(560, latitude, HEIGHT)
			const {radius, focal} = mapCamera(mapAt(10, latitude, zoom))
			expect(focal).toBeCloseTo(focalLength(HEIGHT), 6)
			expect((2 * focal * radius) / Math.sqrt((radius + focal) ** 2 - radius ** 2)).toBeCloseTo(560, 6)
		}
	})

	it('asks the page how big the view is once, and again when the map has resized its canvas', () => {
		let height = HEIGHT
		let asked = 0
		const map = mapAt(0, 0, 2, {
			getContainer: () => {
				asked++
				return {clientWidth: WIDTH, clientHeight: height}
			},
			getCanvas: () => ({width: WIDTH * 2, height: height * 2}),
		})
		expect(viewSize(map)).toMatchObject({width: WIDTH, height: HEIGHT})
		expect(mapCamera(map).focal).toBeCloseTo(focalLength(HEIGHT), 6)
		expect(asked).toBe(1)
		height = 500
		expect(viewSize(map)).toMatchObject({width: WIDTH, height: 500})
		expect(mapCamera(map).focal).toBeCloseTo(focalLength(500), 6)
		expect(asked).toBe(2)
	})
})
