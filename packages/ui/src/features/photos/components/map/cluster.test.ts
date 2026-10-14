import {describe, expect, test} from 'vitest'

import {clusterPoints, clusterZoom, lineage, MARKER_SIZE, padBounds} from '@/features/photos/components/map/cluster'
import {mercatorX, mercatorY, POINT_FLAGS, type MapPoints} from '@/features/photos/components/map/points'

// Points newest first, as the server sends them
function pointsAt(places: Array<{lat: number; lng: number; flags?: number}>): MapPoints {
	const count = places.length
	return {
		count,
		lat: Float32Array.from(places, ({lat}) => lat),
		lng: Float32Array.from(places, ({lng}) => lng),
		x: Float64Array.from(places, ({lng}) => mercatorX(lng)),
		y: Float64Array.from(places, ({lat}) => mercatorY(lat)),
		takenAt: Float64Array.from(places, (_, index) => count - index),
		flags: Uint8Array.from(places, ({flags = 0}) => flags),
		tint: new Int32Array(count).fill(-1),
		unlocated: 0,
		id: (index) => `p${index}`,
		indexOf: (id) => Number(id.slice(1)),
	}
}

const WORLD = {minX: 0, minY: 0, maxX: 1, maxY: 1}
// Two cities, a few photos each, a street apart within each
const LISBON = [
	{lat: 38.7139, lng: -9.1394},
	{lat: 38.7223, lng: -9.1393},
	{lat: 38.7101, lng: -9.1452},
]
const TOKYO = [
	{lat: 35.6762, lng: 139.6503},
	{lat: 35.6895, lng: 139.6917},
]

describe('clusterPoints', () => {
	test('gathers nearby photos into one marker per place, counting every one', () => {
		const points = pointsAt([...LISBON, ...TOKYO])
		const {clusters, owner} = clusterPoints(points, 3, WORLD)
		expect(clusters.map(({count}) => count).sort()).toEqual([2, 3])
		// Every point is owned by the cluster that counts it, and a cover by its own
		clusters.forEach((cluster, index) => expect(owner[cluster.cover]).toBe(index))
		expect([...owner].every((at) => at >= 0)).toBe(true)
	})

	test('splits a place into its streets far enough in', () => {
		const points = pointsAt(LISBON)
		expect(clusterPoints(points, 4, WORLD).clusters).toHaveLength(1)
		expect(clusterPoints(points, 17, WORLD).clusters).toHaveLength(3)
	})

	test('picks favourites over the rest, photos over videos and screenshots, then the newest', () => {
		const plain = pointsAt([...LISBON])
		expect(clusterPoints(plain, 3, WORLD).clusters[0]!.cover).toBe(0)
		const favourite = pointsAt([LISBON[0]!, LISBON[1]!, {...LISBON[2]!, flags: POINT_FLAGS.favorite}])
		expect(clusterPoints(favourite, 3, WORLD).clusters[0]!.cover).toBe(2)
		const screenshot = pointsAt([
			{...LISBON[0]!, flags: POINT_FLAGS.screenshot},
			{...LISBON[1]!, flags: POINT_FLAGS.video},
		])
		expect(clusterPoints(screenshot, 3, WORLD).clusters[0]!.cover).toBe(1)
	})

	test('leaves out what is outside the box', () => {
		const points = pointsAt([...LISBON, ...TOKYO])
		const europe = {minX: mercatorX(-20), maxX: mercatorX(30), minY: mercatorY(60), maxY: mercatorY(30)}
		const {clusters, owner} = clusterPoints(points, 3, europe)
		expect(clusters).toHaveLength(1)
		expect(owner[3]).toBe(-1)
	})

	test('gathers a cell whole when the edge of the box runs through it', () => {
		const points = pointsAt(LISBON)
		// Its east edge has one of Lisbon's photos inside it and two outside
		const box = {minX: mercatorX(-20), maxX: mercatorX(-9.14), minY: mercatorY(60), maxY: mercatorY(30)}
		expect(clusterPoints(points, 3, box).clusters.map(({count}) => count)).toEqual([3])
	})

	test('never leaves two markers on top of one another', () => {
		// A ring of photos around a cell corner, so the grid alone would cut it four ways
		const points = pointsAt(
			Array.from({length: 40}, (_, index) => ({
				lat: 45 + Math.sin(index) * 0.01,
				lng: 7.5 + Math.cos(index) * 0.01,
			})),
		)
		for (const zoom of [6, 9, 12]) {
			const scale = 512 * 2 ** zoom
			const {clusters} = clusterPoints(points, zoom, WORLD)
			for (const a of clusters)
				for (const b of clusters) {
					if (a === b) continue
					const apart = Math.max(
						Math.abs(points.x[a.cover]! - points.x[b.cover]!) * scale,
						Math.abs(points.y[a.cover]! - points.y[b.cover]!) * scale,
					)
					expect(apart).toBeGreaterThan(MARKER_SIZE / 2)
				}
			expect(clusters.reduce((sum, {count}) => sum + count, 0)).toBe(40)
		}
	})
})

describe('lineage', () => {
	test('deals a split out of the marker its photos were in, which keeps its own photo', () => {
		const points = pointsAt(LISBON)
		const out = clusterPoints(points, 4, WORLD)
		const into = clusterPoints(points, 17, WORLD)
		const {origins, destinations} = lineage(out, into)
		// Every street came out of the one Lisbon marker…
		expect(origins).toEqual([0, 0, 0])
		// … whose photo is still one of them, and where it was
		expect(into.clusters.some(({cover}) => cover === out.clusters[0]!.cover)).toBe(true)
		// … and zooming back out, every street folds into it
		expect(lineage(into, out).origins).toEqual([destinations[0]])
		expect(lineage(into, out).destinations).toEqual([0, 0, 0])
	})
})

describe('clusterZoom', () => {
	test('splits at each whole level and merges only a little below it', () => {
		expect(clusterZoom(5.4, undefined, 17)).toBe(5)
		expect(clusterZoom(6.0, 5, 17)).toBe(6)
		expect(clusterZoom(5.8, 6, 17)).toBe(6)
		expect(clusterZoom(5.65, 6, 17)).toBe(5)
		expect(clusterZoom(3.2, 6, 17)).toBe(3)
		expect(clusterZoom(19, 6, 17)).toBe(17)
	})
})

describe('padBounds', () => {
	// What the server's bounds filter keeps: edges included
	const holds = ({west, south, east, north}: ReturnType<typeof padBounds>, {lat, lng}: {lat: number; lng: number}) =>
		lat >= south && lat <= north && lng >= west && lng <= east

	test('holds every photo of a spot, as a float32 gives them, and stops at the antimeridian', () => {
		const spot = [{lat: 38.7139, lng: -9.1394}].map(({lat, lng}) => ({lat: Math.fround(lat), lng: Math.fround(lng)}))
		const {clusters} = clusterPoints(pointsAt(spot), 17, WORLD)
		expect(holds(padBounds(clusters[0]!), spot[0]!)).toBe(true)
		const bounds = padBounds({minX: 0, minY: 0.4, maxX: 1, maxY: 0.6})
		expect([bounds.west, bounds.east]).toEqual([-180, 180])
	})

	test('reaches on to the pole for a spot of photos taken past where Mercator stops', () => {
		const north = [
			{lat: 89.99, lng: 10},
			{lat: 86, lng: 10.0000001},
			{lat: 90, lng: 10},
		]
		const south = [
			{lat: -89.99, lng: 166.67},
			{lat: -88, lng: 166.67},
		]
		for (const spot of [north, south]) {
			const {clusters} = clusterPoints(pointsAt(spot), 17, WORLD)
			expect(clusters).toHaveLength(1)
			const bounds = padBounds(clusters[0]!)
			for (const place of spot) expect(holds(bounds, place)).toBe(true)
		}
		// … and not elsewhere
		const lisbon = padBounds(clusterPoints(pointsAt(LISBON.slice(0, 1)), 17, WORLD).clusters[0]!)
		expect(lisbon.north).toBeLessThan(39)
		expect(lisbon.south).toBeGreaterThan(38)
	})
})
