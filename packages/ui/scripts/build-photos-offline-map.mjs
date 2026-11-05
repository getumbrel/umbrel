import {mkdir, readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'

// Builds the small, runtime-offline atlas Photos names places from, and draws
// its map from when the device has no basemap.
// Source data comes from Natural Earth, which is public domain:
// https://www.naturalearthdata.com/about/terms-of-use/
//
// Usage:
//   node scripts/build-photos-offline-map.mjs /path/to/natural-earth-vector

const sourceRoot = process.argv[2]
if (!sourceRoot) throw new Error('Pass the path to a natural-earth-vector checkout')

const source = (name) => path.join(sourceRoot, 'geojson', name)
const output = path.resolve('public/assets/photos/offline-map-v1.json')

const [countriesSource, placesSource] = await Promise.all([
	readGeoJson(source('ne_110m_admin_0_countries.geojson')),
	readGeoJson(source('ne_10m_populated_places_simple.geojson')),
])

const countries = countriesSource.features.flatMap((feature) =>
	areaRecords(feature.geometry, [
		feature.properties.NAME_EN || feature.properties.NAME,
		validIso2(feature.properties.ISO_A2),
	]),
)

const places = placesSource.features.map((feature) => {
	const [lng, lat] = feature.geometry.coordinates
	return [
		round(lng),
		round(lat),
		feature.properties.nameascii || feature.properties.name,
		feature.properties.adm1name || '',
		validIso2(feature.properties.iso_a2),
		Math.max(0, Number(feature.properties.pop_max) || 0),
		Math.max(0, Number(feature.properties.scalerank) || 0),
	]
})

const atlas = {
	version: 1,
	source: 'Natural Earth 5.1 (public domain)',
	// Compact field names keep the shipped JSON small. See OfflineMapData in
	// map/atlas.ts for the tuple shapes.
	c: countries,
	p: places,
}

await mkdir(path.dirname(output), {recursive: true})
await writeFile(output, `${JSON.stringify(atlas)}\n`)

const bytes = Buffer.byteLength(JSON.stringify(atlas))
console.log(`Wrote ${output} (${(bytes / 1024 / 1024).toFixed(2)} MiB)`)

async function readGeoJson(file) {
	return JSON.parse(await readFile(file, 'utf8'))
}

function validIso2(value) {
	return typeof value === 'string' && /^[A-Z]{2}$/.test(value) ? value : ''
}

// [name, ISO-2, bbox, rings]. A MultiPolygon becomes multiple records so the
// browser can reject distant islands before it tests a point against them.
function areaRecords(geometry, prefix, tolerance = 0.06) {
	const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
	return polygons
		.map((polygon) => polygon.map((ring) => simplifyRing(ring, tolerance)).filter((ring) => ring.length >= 4))
		.filter((polygon) => polygon.length > 0)
		.map((polygon) => [...prefix, bbox(polygon.flat()), polygon])
}

function simplifyRing(points, tolerance) {
	if (points.length < 4) return []
	const open = points.slice(0, -1)
	const simplified = simplifyLine(open, tolerance)
	if (simplified.length < 3) return []
	return [...simplified, simplified[0]]
}

function simplifyLine(points, tolerance) {
	if (points.length <= 2) return points.map(roundPoint)
	const squareTolerance = tolerance * tolerance
	const kept = new Uint8Array(points.length)
	kept[0] = 1
	kept[points.length - 1] = 1
	const stack = [[0, points.length - 1]]

	while (stack.length > 0) {
		const [start, end] = stack.pop()
		let furthest = -1
		let maxDistance = squareTolerance
		for (let index = start + 1; index < end; index += 1) {
			const distance = segmentDistanceSquared(points[index], points[start], points[end])
			if (distance > maxDistance) {
				maxDistance = distance
				furthest = index
			}
		}
		if (furthest !== -1) {
			kept[furthest] = 1
			stack.push([start, furthest], [furthest, end])
		}
	}

	return points.filter((_, index) => kept[index]).map(roundPoint)
}

function segmentDistanceSquared(point, start, end) {
	let x = start[0]
	let y = start[1]
	let dx = end[0] - x
	let dy = end[1] - y

	if (dx !== 0 || dy !== 0) {
		const position = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy)
		if (position > 1) {
			x = end[0]
			y = end[1]
		} else if (position > 0) {
			x += dx * position
			y += dy * position
		}
	}

	dx = point[0] - x
	dy = point[1] - y
	return dx * dx + dy * dy
}

function bbox(points) {
	let west = 180
	let south = 90
	let east = -180
	let north = -90
	for (const [lng, lat] of points) {
		west = Math.min(west, lng)
		south = Math.min(south, lat)
		east = Math.max(east, lng)
		north = Math.max(north, lat)
	}
	return [round(west), round(south), round(east), round(north)]
}

function roundPoint([lng, lat]) {
	return [round(lng), round(lat)]
}

function round(value) {
	return Math.round(Number(value) * 10_000) / 10_000
}
