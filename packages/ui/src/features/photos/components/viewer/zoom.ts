// The geometry of zooming the lightbox's picture. Everything is in the
// picture's box coordinates: px from the top-left corner of the fitted
// picture as it sits at rest. A view is the transform its content gets —
// translate(x, y) scale(s) about that corner — so fit is the identity, and
// the content point under a finger is (finger − (x, y)) / s.

export type View = {s: number; x: number; y: number}
export const FIT: View = {s: 1, x: 0, y: 0}
export type Point = {x: number; y: number}

// Fit, give or take what no eye can see
export const isFit = (view: View) => Math.abs(view.s - 1) < 1e-3 && Math.abs(view.x) < 0.5 && Math.abs(view.y) < 0.5

// Where the picture sits: its fitted box on screen, and the stage it may
// fill once zoomed (the window it is seen through), in box coordinates —
// so `viewport.left` is ≤ 0 and `viewport.right` ≥ the box's width
export type Geometry = {
	left: number
	top: number
	width: number
	height: number
	viewport: {left: number; top: number; right: number; bottom: number}
}

// A screen point in box coordinates
export const toBox = (geo: Geometry, point: Point): Point => ({x: point.x - geo.left, y: point.y - geo.top})

// Where the content may sit at scale `s` without the stage showing past its
// edge: anywhere that keeps it covering the window, or — where it is
// smaller than the window on an axis — centred on that axis
export function bounds(geo: Geometry, s: number) {
	const axis = (size: number, lo: number, hi: number) => {
		const content = size * s
		if (content <= hi - lo) {
			const centred = lo + (hi - lo - content) / 2
			return [centred, centred] as const
		}
		return [hi - content, lo] as const
	}
	const [minX, maxX] = axis(geo.width, geo.viewport.left, geo.viewport.right)
	const [minY, maxY] = axis(geo.height, geo.viewport.top, geo.viewport.bottom)
	return {minX, maxX, minY, maxY}
}

// The view at rest: inside its bounds — and exactly fit when it is at fit
// scale, so a box measured half a pixel off-centre can't leave fit "zoomed"
export function clampView(geo: Geometry, view: View): View {
	if (Math.abs(view.s - 1) < 1e-3) return FIT
	const b = bounds(geo, view.s)
	return {
		s: view.s,
		x: Math.min(Math.max(view.x, b.minX), b.maxX),
		y: Math.min(Math.max(view.y, b.minY), b.maxY),
	}
}

// UIScrollView's rubber band: past an edge the content follows ever less of
// the finger's travel, never more than `dimension` (the window's size)
const RUBBER = 0.55
const band = (over: number, dimension: number) => (1 - 1 / ((over * RUBBER) / dimension + 1)) * dimension
export function rubber(value: number, min: number, max: number, dimension: number) {
	if (value < min) return min - band(min - value, dimension)
	if (value > max) return max + band(value - max, dimension)
	return value
}
// … and for a scale, in ratios rather than px: pinching to twice the limit
// gets about a sixth past it, and no pinch gets more than two-thirds
const SCALE_BAND = 0.5
export function rubberScale(s: number, min: number, max: number) {
	if (s > max) return max * Math.exp(band(Math.log(s / max), SCALE_BAND))
	if (s < min) return min * Math.exp(-band(Math.log(min / s), SCALE_BAND))
	return s
}

// The view at scale `s` that keeps the content under `point` (box
// coordinates) where it is
export function zoomAbout(view: View, point: Point, s: number): View {
	return {s, x: point.x - (s * (point.x - view.x)) / view.s, y: point.y - (s * (point.y - view.y)) / view.s}
}

// A double-tap's destination: scale `s`, with the tapped content point
// brought to the middle of the window (`centre`, the way iOS zooms to where
// a finger tapped) or kept under the pointer (a click, which the eye is
// already following) — clamped either way, so no empty stage shows
export function zoomInAt(geo: Geometry, view: View, point: Point, s: number, centre: boolean): View {
	const content = {x: (point.x - view.x) / view.s, y: (point.y - view.y) / view.s}
	const anchor = centre
		? {x: (geo.viewport.left + geo.viewport.right) / 2, y: (geo.viewport.top + geo.viewport.bottom) / 2}
		: point
	return clampView(geo, {s, x: anchor.x - s * content.x, y: anchor.y - s * content.y})
}

// The window as a clip-path on the picture, for an element carrying `view`
// itself (clip-path is in the element's own, untransformed, coordinates):
// zoomed, the picture stops clipping to its own box and shows its content
// through the stage instead, with the picture's corners
export function viewportClip(geo: Geometry, view: View, radius: number) {
	const {viewport} = geo
	const top = (viewport.top - view.y) / view.s
	const left = (viewport.left - view.x) / view.s
	const right = geo.width - (viewport.right - view.x) / view.s
	const bottom = geo.height - (viewport.bottom - view.y) / view.s
	return `inset(${top}px ${right}px ${bottom}px ${left}px round ${radius / view.s}px)`
}

// How far in a pinch may go: 4× fit, or further where the image has the
// pixels for it — up to one image pixel per device pixel — but never past 6×
export const MIN_MAX_ZOOM = 4
export const MAX_MAX_ZOOM = 6
export function maxZoom(fitWidth: number, sourceWidth: number, dpr: number) {
	if (!(fitWidth > 0) || !(sourceWidth > 0)) return MIN_MAX_ZOOM
	return Math.max(MIN_MAX_ZOOM, Math.min(MAX_MAX_ZOOM, sourceWidth / (fitWidth * dpr)))
}

// The stage's renditions stop at 1280 px on the short edge (CONTRACT.md):
// how wide that is for an image of `width` × `height`
export const RENDITION_SHORT_EDGE = 1280
export function renditionWidth(width: number, height: number) {
	const short = Math.min(width, height)
	return short > RENDITION_SHORT_EDGE ? (width * RENDITION_SHORT_EDGE) / short : width
}

// Originals every browser draws in an <img>, by file name. HEIC, RAW and
// the rest stay on the 1280 however far in the zoom goes — until the
// backend offers a larger browser-viewable rendition.
const DECODABLE = /\.(jpe?g|jfif|png|webp|gif|avif)$/i
export const canDecodeOriginal = (fileName: string | undefined) => !!fileName && DECODABLE.test(fileName)
