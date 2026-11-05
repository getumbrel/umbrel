import {useLayoutEffect, useRef, useState} from 'react'

// The picture's corner radius at rest, in px (`rounded-xl` on the picture)
export const PICTURE_RADIUS = 12
export const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
const FLY_IN = {duration: 380, easing: EASE_OUT, fill: 'backwards'} as const
const FLY_BACK = {duration: 300, easing: EASE_OUT, fill: 'forwards'} as const
// Without a tile to fly from or to, the picture simply arrives, or goes
const APPEAR = {duration: 240, easing: EASE_OUT, fill: 'backwards'} as const
const VANISH = {duration: 180, easing: EASE_OUT, fill: 'forwards'} as const

export type Rect = {left: number; top: number; width: number; height: number}

// The picture's state, at its fitted rect `to`, in which its centre square
// sits exactly over the tile `from` — the crop a tile shows — with the
// tile's corners. Transform and clip only, so the flight between this and
// rest runs on the compositor; the clip's radius carries the corners from
// the tile's to the picture's.
export function overTile(to: Rect, from: Rect & {radius: number}) {
	const {x, y, scale, ox, oy} = tileFit(to, from)
	return {
		transform: `translate(${x}px, ${y}px) scale(${scale})`,
		clipPath: `inset(${oy}px ${ox}px round ${from.radius / scale}px)`,
	}
}
// … as numbers: the transform's parts, and the crop's insets
function tileFit(to: Rect, from: Rect) {
	const crop = Math.min(to.width, to.height)
	const ox = (to.width - crop) / 2
	const oy = (to.height - crop) / 2
	const scale = from.width / crop
	return {x: from.left - to.left - ox * scale, y: from.top - to.top - oy * scale, scale, ox, oy}
}

// Where the picture is when the flight home takes it over, if not at rest:
// translate(x, y) scale(scale) about its corner — a drag-to-dismiss's last
// frame, a pinch closing it, or a zoomed picture flattened onto itself (with
// `clipPath` the window it was being seen through). `velocity` is how it
// was moving as the finger let go — its centre in px/ms, its scale per ms —
// for the flight to carry on at that speed (see carryEasing).
export type FlightStart = {
	x: number
	y: number
	scale: number
	clipPath?: string
	velocity?: {x: number; y: number; scale: number}
}
const startTransform = (start: FlightStart) => `translate(${start.x}px, ${start.y}px) scale(${start.scale})`
// `inner` drawn inside a further transform `outer` (both about the picture's
// corner) — a pinch's or a drag's start inside the info sheet's lift — as
// one start: the same pixels, moving at the same speed on screen
export function composeStart(outer: {x: number; y: number; scale: number}, inner?: FlightStart): FlightStart {
	if (!inner) return outer
	const {velocity} = inner
	return {
		x: outer.x + outer.scale * inner.x,
		y: outer.y + outer.scale * inner.y,
		scale: outer.scale * inner.scale,
		clipPath: inner.clipPath,
		velocity: velocity && {
			x: velocity.x * outer.scale,
			y: velocity.y * outer.scale,
			scale: velocity.scale * outer.scale,
		},
	}
}

// The flight home's curve, bent so it leaves at the speed the finger let go
// at. The flight runs from `start` to `end` along a straight line in
// transform space; a release velocity is a rate of progress along it — the
// centre's speed toward the tile, the scale's toward the tile's — weighed by
// how much of the motion each one is, and a cubic-bezier's opening slope is
// exactly that rate times the duration. A picture flung away from its tile
// (dragged down past a tile above it) leaves with a slope below zero: it
// carries on a little the way it was thrown before turning for home, where
// a fixed curve would snap it round in one frame.
const DEFAULT_SLOPE = 4 // EASE_OUT's own opening slope (0.8 / 0.2)
export function carryEasing(
	start: FlightStart,
	end: {x: number; y: number; scale: number},
	box: Rect,
	duration: number,
) {
	const velocity = start.velocity
	if (!velocity) return EASE_OUT
	const halfW = box.width / 2
	const halfH = box.height / 2
	const dx = end.x + end.scale * halfW - (start.x + start.scale * halfW)
	const dy = end.y + end.scale * halfH - (start.y + start.scale * halfH)
	const distance = Math.hypot(dx, dy)
	const ds = end.scale - start.scale
	// A change of scale, in px: how far the corners move for it
	const reach = Math.abs(ds) * Math.hypot(halfW, halfH)
	if (distance + reach < 1) return EASE_OUT
	const travelRate = distance > 0 ? (velocity.x * dx + velocity.y * dy) / (distance * distance) : 0
	const scaleRate = ds !== 0 ? velocity.scale / ds : 0
	const rate = (travelRate * distance + scaleRate * reach) / (distance + reach)
	const slope = Number.isFinite(rate) ? rate * duration : DEFAULT_SLOPE
	// Never so steep the curve overshoots its end, nor so far back that the
	// turn-around becomes a second motion of its own
	const y1 = Math.min(Math.max(slope * 0.2, -0.5), 1)
	return `cubic-bezier(0.2, ${Number(y1.toFixed(3))}, 0.2, 1)`
}

const AT_REST = {transform: 'none', clipPath: `inset(0px round ${PICTURE_RADIUS}px)`}

// Where a tile is, from the layout rather than the DOM: below the seam the
// grid's tiles are cells of a canvas and have no elements to measure
export type TileRect = (id: string) => (Rect & {radius: number}) | null
// Empty an item's tile while its picture is away from it, or fill it again
export type LiftTile = (id: string | undefined) => void

// The grid's tile for an item, when it is on screen to fly from or to
function tileOf(id: string | undefined, tileRect?: TileRect) {
	const tile = id ? document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"]`) : null
	const rect = tile
		? {...tile.getBoundingClientRect().toJSON(), radius: parseFloat(getComputedStyle(tile).borderRadius) || 0}
		: id && tileRect?.(id)
	if (!rect) return null
	const visible =
		rect.top + rect.height > 0 && rect.left + rect.width > 0 && rect.top < innerHeight && rect.left < innerWidth
	return visible ? rect : null
}

// The picture's flight between its tile and the stage: one motion in which
// the tile's square grows into the whole picture as it travels (and draws
// back in as it returns), so what leaves and what lands is exactly the tile.
// Once per opening — stepping to another item never animates. Without a
// tile on screen (a deep link, an item scrolled far out of view) the
// picture just appears or goes; with reduced motion, nothing moves. Give
// `ref` to the picture: the flight starts the moment the element exists,
// which in a portal is a commit after the open. `arrived` says the picture
// is at rest, for what shouldn't happen in flight — decoding the full-size
// original, or playing a video.
//
// While the picture is up its tile is empty (`liftTile`): what flies is the
// photograph itself, leaving its place in the grid and coming back to it.
export function usePictureFlight({
	open,
	id,
	reduceMotion,
	tileRect,
	liftTile,
}: {
	open: boolean
	id: string | undefined
	reduceMotion: boolean
	tileRect?: TileRect
	liftTile?: LiftTile
}) {
	const [picture, setPicture] = useState<HTMLElement | null>(null)
	// Whether the picture has arrived: what only makes sense at rest (a
	// playing video, say) waits for it
	const [arrived, setArrived] = useState(false)
	const flown = useRef(false)
	// The close has taken over the picture (see back)
	const leaving = useRef(false)
	useLayoutEffect(() => {
		if (!open) {
			flown.current = false
			leaving.current = false
			setArrived(false)
			return
		}
		if (flown.current || !picture) return
		flown.current = true
		if (reduceMotion) {
			setArrived(true)
			return
		}
		const from = tileOf(id, tileRect)
		const animation = from
			? picture.animate([overTile(picture.getBoundingClientRect(), from), AT_REST], FLY_IN)
			: picture.animate(
					[
						{opacity: 0, transform: 'scale(0.96)'},
						{opacity: 1, transform: 'none'},
					],
					APPEAR,
				)
		const land = () => setArrived(true)
		// Landed — or cut short by something other than a close, which must not
		// leave the stage waiting for ever. A close that cancels an opening
		// still in the air is not a landing: what waits for one — a video's
		// autoplaying player above all — has no business mounting on a picture
		// that is on its way home.
		animation.finished.then(land, () => leaving.current || land())
	}, [picture, open, id, reduceMotion])

	// The tile empties in the commit the picture takes off in — the picture's
	// first frame sits exactly over it, so nothing is seen to vanish — follows
	// the item being looked at while stepping, so the way home always leads to
	// an empty place, and fills again in the commit the lightbox leaves in,
	// under the picture that has just landed on it.
	useLayoutEffect(() => {
		if (!liftTile) return
		if (!open) liftTile(undefined)
		else if (picture && id) liftTile(id)
	}, [liftTile, open, picture, id])
	// … and whatever happens to the lightbox, a tile is never left empty
	useLayoutEffect(() => () => liftTile?.(undefined), [liftTile])

	return {
		ref: setPicture,
		arrived,
		// Resolves once the picture is gone — at once with reduced motion.
		// `start` is where the picture visually is though its inline style has
		// just been cleared (see FlightStart), so the flight carries on from the
		// finger — at the finger's speed — instead of snapping to the centre.
		back: (start?: FlightStart) => {
			if (!picture || reduceMotion) return Promise.resolve()
			// Measured at rest: an opening still in flight is cut short
			leaving.current = true
			for (const animation of picture.getAnimations()) animation.cancel()
			const first = start ? {transform: startTransform(start), clipPath: start.clipPath ?? AT_REST.clipPath} : AT_REST
			const from = tileOf(id, tileRect)
			const box = picture.getBoundingClientRect()
			const animation = from
				? picture.animate([first, overTile(box, from)], {
						...FLY_BACK,
						easing: start ? carryEasing(start, tileFit(box, from), box, FLY_BACK.duration) : FLY_BACK.easing,
					})
				: picture.animate(
						[
							{...first, opacity: 1},
							// A dragged picture keeps going the way it was sent
							// (keeping a zoomed picture's clip: `none` can't be blended into)
							start
								? {transform: `${startTransform(start)} translateY(48px)`, clipPath: first.clipPath, opacity: 0}
								: {opacity: 0, transform: 'scale(0.94)'},
						],
						VANISH,
					)
			return animation.finished.then(
				() => undefined,
				() => undefined,
			)
		},
	}
}
