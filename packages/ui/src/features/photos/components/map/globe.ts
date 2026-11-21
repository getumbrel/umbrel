import type {FeatureIdentifier, Map as MapLibreMap} from 'maplibre-gl'

import {FLAT_ZOOM, GLOBE_ZOOM} from '@/features/photos/components/map/map-style'
import {mercatorX, mercatorY, WORLD_SIZE} from '@/features/photos/components/map/points'
import {direction} from '@/features/photos/components/map/sun'

const RADIANS = Math.PI / 180

// How far above the map its camera is, in pixels, for a view this tall
// (MapLibre's field of view, top to bottom, unless told otherwise)
export function focalLength(height: number, fieldOfView = 36.87) {
	return height / 2 / Math.tan((fieldOfView * RADIANS) / 2)
}

// How round the map is drawn at a zoom: 1 a globe, 0 flat, and unrolling in
// between (see the style's projection)
export function globeness(zoom: number) {
	return 1 - Math.min(1, Math.max(0, (zoom - GLOBE_ZOOM) / (FLAT_ZOOM - GLOBE_ZOOM)))
}

// How big the map's view is. Asking the page makes it lay itself out, and
// this is asked several times a frame, so the answer is kept until the map's
// canvas, which the map resizes with its view before it tells anyone, has
// another size
const sizes = new WeakMap<MapLibreMap, {width: number; height: number; drawn: string}>()
export function viewSize(map: MapLibreMap) {
	const canvas = map.getCanvas()
	const drawn = `${canvas.width}x${canvas.height}`
	let size = sizes.get(map)
	if (size?.drawn !== drawn) {
		const {clientWidth: width, clientHeight: height} = map.getContainer()
		size = {width, height, drawn}
		sizes.set(map, size)
	}
	return size
}

// The camera the map is drawn with, looking straight down at its centre from
// a focal length above it (MapLibre's own, with no pitch or bearing): what is
// needed to say where anything on or beyond the globe lands on screen
export function mapCamera(map: MapLibreMap) {
	const center = map.getCenter()
	const zoom = map.getZoom()
	const world = WORLD_SIZE * 2 ** zoom
	const [latitude, longitude] = [center.lat * RADIANS, center.lng * RADIANS]
	return {
		center,
		zoom,
		world,
		// Where the centre is drawn: off the canvas's middle by the map's padding
		origin: map.project(center),
		focal: focalLength(viewSize(map).height, map.getVerticalFieldOfView()),
		// The globe is sized so the scale at its centre is the flat map's there
		radius: world / (2 * Math.PI) / Math.cos(latitude),
		// Out of the globe towards the camera, and the screen's right and up
		out: [Math.cos(latitude) * Math.cos(longitude), Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude)],
		east: [-Math.sin(longitude), Math.cos(longitude), 0],
		north: [-Math.sin(latitude) * Math.cos(longitude), -Math.sin(latitude) * Math.sin(longitude), Math.cos(latitude)],
		globeness: globeness(zoom),
	}
}
export type MapCamera = ReturnType<typeof mapCamera>

const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!

// How far inside the horizon a place starts to show, as a share of the globe's radius
const LIMB = 0.12

// Where a place is on screen, and how much of it shows: 0 round the back of
// the globe, 1 well this side of its edge, and in between as it comes round.
// MapLibre's own project() answers for a full globe until the map is fully
// flat, while it draws the unrolling in between by blending the two in clip
// space — so that is done here, for a marker to stay on its place throughout.
export function locate(camera: MapCamera, lng: number, lat: number) {
	const {origin, focal, radius, world, center, globeness} = camera
	const flat = {
		x: (mercatorX(lng) - mercatorX(center.lng)) * world,
		y: (mercatorY(lat) - mercatorY(center.lat)) * world,
	}
	if (globeness === 0) return {x: origin.x + flat.x, y: origin.y + flat.y, shown: 1}
	const [latitude, longitude] = [lat * RADIANS, lng * RADIANS]
	const place = [Math.cos(latitude) * Math.cos(longitude), Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude)]
	const facing = dot(place, camera.out)
	const round = {x: radius * dot(place, camera.east), y: -radius * dot(place, camera.north)}
	const depth = focal + radius * (1 - facing)
	const w = focal + (depth - focal) * globeness
	return {
		x: origin.x + (focal * (flat.x + (round.x - flat.x) * globeness)) / w,
		y: origin.y + (focal * (flat.y + (round.y - flat.y) * globeness)) / w,
		// The horizon is nearer than half way round: the camera is a focal length up
		shown: Math.min(1, Math.max(0, (facing - radius / (radius + focal)) / LIMB)),
	}
}

// The zoom at which the globe looks this many pixels across in a view this
// tall, with this latitude at the middle of it. Seen from a focal length up,
// its edge is nearer than its widest, so it looks smaller than it is.
export function globeZoom(across: number, latitude: number, height: number) {
	const focal = focalLength(height)
	const edge = across / 2
	const radius = (edge * edge + edge * Math.hypot(edge, focal)) / focal
	return Math.log2((2 * Math.PI * radius * Math.cos(latitude * RADIANS)) / WORLD_SIZE)
}

// How far inside the horizon a name is gone by, and whole from, in how
// squarely its place faces the camera. A name runs out on either side of its
// place, so one whose place is near the edge would hang out past the globe
// into space: it fades well before its place does
const NAMES = {gone: 0.16, whole: 0.38}

// Fades the map's names out as they come round to the globe's edge, by the
// 'shown' state the style's names are drawn with. Set only where it changed,
// so setting it, which draws the map again, settles. Laid flat the map has no
// edge to come to, and its names aren't asked after: what was set is taken
// off, and they show whole. Returns what stops it.
export function fadeNamesAtHorizon(map: MapLibreMap) {
	// The style's names: it is the map's for as long as the map is
	const layers = map
		.getStyle()
		.layers.filter((layer) => layer.type === 'symbol')
		.map((layer) => layer.id)
	if (layers.length === 0) return () => {}
	const set = new Map<string, {name: FeatureIdentifier; shown: number}>()
	let frame = 0
	const fade = () => {
		frame = 0
		const camera = mapCamera(map)
		if (camera.globeness === 0) {
			for (const {name, shown} of set.values()) if (shown !== 1) map.removeFeatureState(name, 'shown')
			set.clear()
			return
		}
		const horizon = camera.radius / (camera.radius + camera.focal)
		for (const {id, source, sourceLayer, geometry} of map.queryRenderedFeatures({layers})) {
			if (id === undefined || geometry.type !== 'Point') continue
			const [lng, lat] = geometry.coordinates as [number, number]
			const along = (dot(direction(lng, lat), camera.out) - horizon - NAMES.gone) / (NAMES.whole - NAMES.gone)
			const eased = Math.min(1, Math.max(0, along))
			// Unrolling, the fade goes with the globe
			const shown = Math.round((1 - camera.globeness * (1 - eased * eased * (3 - 2 * eased))) * 50) / 50
			const key = `${sourceLayer}/${id}`
			if (set.get(key)?.shown === shown) continue
			const name = {source, sourceLayer, id}
			set.set(key, {name, shown})
			map.setFeatureState(name, {shown})
		}
	}
	const schedule = () => {
		frame ||= requestAnimationFrame(fade)
	}
	map.on('move', schedule)
	map.on('idle', schedule)
	schedule()
	return () => {
		cancelAnimationFrame(frame)
		map.off('move', schedule)
		map.off('idle', schedule)
	}
}

// How far round the globe from the middle of the view its edge is, in degrees
export function horizon({radius, focal}: MapCamera) {
	return Math.acos(radius / (radius + focal)) / RADIANS
}
