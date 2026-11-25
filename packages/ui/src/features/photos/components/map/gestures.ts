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
//
// A scroll's steps aren't taken at once but followed, closing on where
// they lead a share at a time, so the map glides between them and settles
// rather than jumping a step and stopping dead. Let go of mid-glide (a click,
// a drag), or with the map sent somewhere else (a pinch, a flight to a
// marker), it stops where it is.
//
// Each share is taken as the map draws a frame, not in a frame of the page's
// own: the map draws what it is told in the frame after, so everything laid
// over it, which moves when it is told, would run a frame ahead of the map
// all the way. MapLibre takes its own gestures this way, and gives no public
// way in to it: _requestRenderFrame is the one its camera uses, and is in its
// types, so a MapLibre without it fails the type check, not the map.
export function attachMapGestures(map: MapLibreMap) {
	const container = map.getContainer()
	// A flick is let go of at the speed it was going, and slows to a stop over
	// a while, easing out, rather than dropping to a third of that speed and
	// stopping short (MapLibre's own)
	map.dragPan.enable({linearity: 0.55, easing: easeOut, deceleration: 1800, maxSpeed: 1200})
	const pending = {x: 0, y: 0}
	let gliding = 0
	let last = 0
	// (Our own steps are moves of the map as well, and aren't what stops them)
	let stepping = false
	const glide = () => {
		const time = performance.now()
		const share = 1 - Math.exp(-(last ? time - last : 16) / FOLLOW_MS)
		last = time
		const step = {x: pending.x * share, y: pending.y * share}
		const settled = Math.hypot(pending.x - step.x, pending.y - step.y) < 0.5
		const by = settled ? {...pending} : step
		pending.x -= by.x
		pending.y -= by.y
		stepping = true
		map.panBy([by.x, by.y], {animate: false})
		stepping = false
		gliding = settled ? 0 : map._requestRenderFrame(glide)
		if (settled) last = 0
	}
	const stopGliding = () => {
		map._cancelRenderFrame(gliding)
		gliding = 0
		last = 0
		pending.x = pending.y = 0
	}
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
		// A pinch or a wheel is MapLibre's to zoom by, and nothing is left of a
		// glide that would go on panning under it
		if (!streak.panning || event.ctrlKey) return stopGliding()
		event.preventDefault()
		event.stopPropagation()
		pending.x += event.deltaX
		pending.y += event.deltaY
		gliding ||= map._requestRenderFrame(glide)
	}
	const onMoveStart = () => {
		if (!stepping) stopGliding()
	}
	container.addEventListener('wheel', onWheel, {capture: true, passive: false})
	container.addEventListener('pointerdown', stopGliding, {capture: true})
	map.on('movestart', onMoveStart)
	return () => {
		stopGliding()
		container.removeEventListener('wheel', onWheel, {capture: true})
		container.removeEventListener('pointerdown', stopGliding, {capture: true})
		map.off('movestart', onMoveStart)
	}
}

// How quickly a scroll's glide closes on where it leads: most of the way in
// about twice this
const FOLLOW_MS = 70
// Fast to begin with, as fast as it was let go of, and long and soft to its end
const easeOut = (t: number) => 1 - (1 - t) ** 3

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
