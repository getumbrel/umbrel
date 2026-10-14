import {LngLat, type Map as MapLibreMap} from 'maplibre-gl'

import {globeness, viewSize} from '@/features/photos/components/map/globe'
import {latitudeAt, longitudeAt, mercatorX, mercatorY, WORLD_SIZE} from '@/features/photos/components/map/points'

// Wheel events that arrive closer together than this are one gesture, and
// keep the reading its first event got
const STREAK_MS = 120
// A mouse wheel moves in notches of ~100px; a trackpad starts a scroll with
// small steps
const NOTCH = 50
// … but a Mac smooths a wheel's notches into steps as small as a trackpad's.
// Those come in whole multiples of this, which a trackpad's never are: it is
// how MapLibre tells the two apart as well
const MAC_WHEEL_STEP = 4.000244140625

// A Mac's trackpad, the way Maps reads it: two fingers moving pan the map,
// a pinch zooms it. Browsers report both as wheel events — a pinch with
// ctrlKey set — and MapLibre zooms on every one, the way a mouse wheel does
// on a PC. So a scroll that reads as a trackpad's is taken first, on the
// way down, and becomes a pan; pinches and real wheels go on to MapLibre's
// own zoom. A streak is read once, by its first event, so a pan can't turn
// into a zoom halfway through a flick.
export function attachMapGestures(map: MapLibreMap) {
	const container = map.getContainer()
	let streak: {panning: boolean; at: number} | undefined
	const onWheel = (event: WheelEvent) => {
		const now = performance.now()
		if (!streak || now - streak.at > STREAK_MS) {
			// The unit is asked for before the deltas: Firefox turns a wheel's
			// lines into pixels, for good, for anyone who reads them first
			const pixels = event.deltaMode === WheelEvent.DOM_DELTA_PIXEL
			const macWheel = event.deltaY !== 0 && event.deltaY % MAC_WHEEL_STEP === 0
			streak = {
				panning: pixels && !event.ctrlKey && !macWheel && (event.deltaX !== 0 || Math.abs(event.deltaY) < NOTCH),
				at: now,
			}
		}
		streak.at = now
		if (!streak.panning || event.ctrlKey) return
		event.preventDefault()
		event.stopPropagation()
		map.panBy([event.deltaX, event.deltaY], {animate: false})
	}
	container.addEventListener('wheel', onWheel, {capture: true, passive: false})
	return () => container.removeEventListener('wheel', onWheel, {capture: true})
}

const MAX_LATITUDE = 85.051129

// How far the camera goes. Laid flat, the world can be pulled as far as the
// edge of the part of the map that's shown — the list's edge, not the
// window's, so nothing is left stuck beneath the list — and once it is
// smaller than that, it sits in the middle. As a globe, it turns freely, and
// eases into that as it flattens.
//
// And how near and far: MapLibre keeps the zoom within the map's limits only
// in the hold this one stands in for. The far limit is a size of globe, not
// a zoom: one zoom draws the globe bigger the nearer a pole its middle is,
// and MapLibre zooms out as it is turned that way to keep it one size. So
// that limit is lower there by as much, as it is in MapLibre's own.
export function holdWithinWorld(map: MapLibreMap) {
	map.setTransformConstrain((lngLat, asked) => {
		const lat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lngLat.lat))
		const farthest = map.getMinZoom() + Math.log2(Math.cos((lat * Math.PI) / 180))
		const zoom = Math.min(map.getMaxZoom(), Math.max(farthest, asked))
		const free = {x: mercatorX(lngLat.wrap().lng), y: mercatorY(lat)}
		const flat = 1 - globeness(zoom)
		const world = WORLD_SIZE * 2 ** zoom
		const {top = 0, right = 0, bottom = 0, left = 0} = map.getPadding()
		const {width, height} = viewSize(map)
		const hold = (at: number, shown: number) => {
			const half = shown / world / 2
			const held = half >= 0.5 ? 0.5 : Math.min(1 - half, Math.max(half, at))
			return at + (held - at) * flat
		}
		const x = hold(free.x, width - left - right)
		const y = hold(free.y, height - top - bottom)
		return {center: new LngLat(longitudeAt(x), latitudeAt(y)), zoom}
	})
}
