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
	const crop = Math.min(to.width, to.height)
	const ox = (to.width - crop) / 2
	const oy = (to.height - crop) / 2
	const scale = from.width / crop
	return {
		transform: `translate(${from.left - to.left - ox * scale}px, ${from.top - to.top - oy * scale}px) scale(${scale})`,
		clipPath: `inset(${oy}px ${ox}px round ${from.radius / scale}px)`,
	}
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
		// `start` is a transform the picture is visually at though its inline
		// style has just been cleared — a drag-to-dismiss's last frame — so the
		// flight carries on from the finger instead of snapping to the centre.
		back: (start?: string) => {
			if (!picture || reduceMotion) return Promise.resolve()
			// Measured at rest: an opening still in flight is cut short
			leaving.current = true
			for (const animation of picture.getAnimations()) animation.cancel()
			const first = start ? {...AT_REST, transform: start} : AT_REST
			const from = tileOf(id, tileRect)
			const animation = from
				? picture.animate([first, overTile(picture.getBoundingClientRect(), from)], FLY_BACK)
				: picture.animate(
						[
							{...first, opacity: 1},
							// A dragged picture keeps going the way it was sent
							start ? {transform: `${start} translateY(48px)`, opacity: 0} : {opacity: 0, transform: 'scale(0.94)'},
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
