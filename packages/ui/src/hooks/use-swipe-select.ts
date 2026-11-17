import {useCallback, useEffect, useRef, type RefObject} from 'react'

// A finger that travels this far sideways before it travels as far up or
// down is a swipe across the items; one that sets off vertically is a scroll,
// and the browser has it (the scroller is touch-action: pan-y)
const SLOP_PX = 10
// From a handle (an item's selection circle) any direction selects, after this much travel
const HANDLE_SLOP_PX = 4
// Holding the finger within this band at the top or bottom of what can be
// seen scrolls: px per frame, from the minimum at the band's inner edge up to
// the maximum at the scroller's edge and beyond
const EDGE_PX = 72
const SCROLL_MIN_PX = 2
const SCROLL_MAX_PX = 24

type Swipe = {
	pointerId: number
	// Where the finger came down, and where it is now, in client coordinates
	origin: {x: number; y: number}
	client: {x: number; y: number}
	// It came down on a handle, where the browser doesn't scroll
	// (touch-action: none), so the swipe is the scroller's from the start
	fromHandle: boolean
	// Past the slop: the scroller owns the finger and the selection follows it
	active: boolean
	// The item the swipe started on and the one it reaches to now (none until
	// it sets off). Ids rather than indexes, so a layout that changes under
	// the swipe (a page landing as it scrolls) can't shift the range.
	from: string
	to: string | null
	// Whether it selects or deselects: the opposite of what its first item was
	adding: boolean
	// The selection when it started, which everything outside the range keeps
	base: ReadonlySet<string>
	scrollFrame: number | null
	// Px per frame the edge auto-scroll currently moves by (signed), updated
	// on every move so the running loop follows the finger
	scrollBy: number
}

// Swipe to select, for a touch screen in selection mode, the way iOS does
// it: the one gesture Files and Photos both use.
//
// A finger that sets off sideways from an item selects every item from that
// one to the one under the finger, in the caller's order, so across a grid it
// runs on down the rows as the finger does, as in Photos. In a list, where
// rows run the whole width, an item can also carry a handle (its selection
// circle): a finger that comes down there selects in any direction, straight
// down the rows, as in Mail. Either way it deselects instead when the first
// item was already selected, sliding back returns the items it leaves to
// what they were, and holding the finger near the top or bottom edge scrolls.
//
// Which item is where, and what lies between two of them, is the caller's to
// say as arithmetic over its layout (`itemAt`, `between`). Nothing is
// measured in the DOM, so the range covers rows a virtualised list hasn't
// mounted.
//
// The scroller should be `touch-action: pan-y`, which tells the browser to
// scroll it up and down and leave a sideways swipe alone. Without it a
// browser is free to take the swipe for itself and cancel the touch. (Chrome's
// touch emulation doesn't, so that can't be told there.) A handle must be
// `touch-action: none`. The listeners are the scroller's own, not React's: a
// swipe that turns downwards must keep the page from scrolling, which takes
// a touchmove listener that isn't passive (React's are).
export function useSwipeSelect({
	scrollerRef,
	scrollerKey,
	itemAt,
	between,
	selectionRef,
	enabled,
	edges,
	onSelect,
	handle,
}: {
	scrollerRef: RefObject<HTMLElement | null>
	// Changes whenever the scroller's element does, for a scroller that isn't
	// there from the start or is swapped for another (a virtualised list's own
	// element). Not needed for one that mounts with its owner and stays.
	scrollerKey?: unknown
	// The id of the item at a point in the scroller's content (px from its
	// top left corner), if there is one there
	itemAt: (x: number, y: number) => string | undefined
	// The ids from one item to another, both included, in either order, or
	// null while that can't be told (one of them has left the list)
	between: (from: string, to: string) => Iterable<string> | null
	// The current selection, which a swipe adds to or takes from
	selectionRef: RefObject<ReadonlySet<string>>
	// Whether a swipe selects at all: in selection mode, where a tap toggles too
	enabled: boolean
	// How far in from the scroller's top and bottom the items can be seen (a
	// bar or a fade over the top, the dock over the bottom): the auto-scroll
	// bands start there
	edges: {top: number; bottom: number}
	onSelect: (ids: ReadonlySet<string>) => void
	// A selector for the part of an item a finger selects from in any
	// direction (see above), where items have one
	handle?: string
}) {
	const swipeRef = useRef<Swipe | null>(null)
	// The click that ends a swipe must not reach the item under the finger
	const swallowClick = useRef(false)
	// The caller's latest, for listeners and frames that outlive a render
	const latest = useRef({itemAt, between, enabled, edges, onSelect, handle})
	useEffect(() => {
		latest.current = {itemAt, between, enabled, edges, onSelect, handle}
	})

	// Stable, so another gesture (a pinch) can hold on to it and end the swipe
	const end = useCallback(() => {
		const swipe = swipeRef.current
		const scroller = scrollerRef.current
		if (!swipe) return
		swipeRef.current = null
		if (!swipe.active) return
		if (swipe.scrollFrame !== null) cancelAnimationFrame(swipe.scrollFrame)
		if (scroller?.hasPointerCapture(swipe.pointerId)) scroller.releasePointerCapture(swipe.pointerId)
		swallowClick.current = true
	}, [scrollerRef])

	useEffect(() => {
		const scroller = scrollerRef.current
		if (!scroller) return

		// Select (or deselect) the run from the first item to the one under the
		// finger, for its current position and the scroll
		const update = () => {
			const swipe = swipeRef.current
			if (!swipe?.active) return
			const bounds = scroller.getBoundingClientRect()
			// Off either side of the scroller, the finger still reaches the item at that edge
			const x = Math.max(0, Math.min(scroller.clientWidth - 1, swipe.client.x - bounds.left))
			const id = latest.current.itemAt(x, swipe.client.y - bounds.top + scroller.scrollTop)
			// Over a gap, a header or the space past the last item it keeps reaching where it last did
			const to = id ?? swipe.to ?? swipe.from
			if (to === swipe.to) return
			const run = latest.current.between(swipe.from, to)
			if (run === null) return
			swipe.to = to
			const next = new Set(swipe.base)
			for (const item of run) {
				if (swipe.adding) next.add(item)
				else next.delete(item)
			}
			latest.current.onSelect(next)
		}

		// Keep scrolling while the finger is held in the band at either edge
		const autoScroll = () => {
			const swipe = swipeRef.current
			if (!swipe?.active) return
			const bounds = scroller.getBoundingClientRect()
			const {edges} = latest.current
			const top = bounds.top + edges.top + EDGE_PX
			const bottom = bounds.bottom - edges.bottom - EDGE_PX
			const into = swipe.client.y < top ? swipe.client.y - top : Math.max(0, swipe.client.y - bottom)
			if (into === 0) {
				if (swipe.scrollFrame !== null) cancelAnimationFrame(swipe.scrollFrame)
				swipe.scrollFrame = null
				return
			}
			const speed = SCROLL_MIN_PX + Math.min(1, Math.abs(into) / EDGE_PX) * (SCROLL_MAX_PX - SCROLL_MIN_PX)
			swipe.scrollBy = Math.sign(into) * speed
			const step = () => {
				scroller.scrollTop += swipe.scrollBy
				update()
				swipe.scrollFrame = requestAnimationFrame(step)
			}
			if (swipe.scrollFrame === null) swipe.scrollFrame = requestAnimationFrame(step)
		}

		const onPointerDown = (event: PointerEvent) => {
			// A second finger is a pinch's (which ends the swipe), not a wider swipe
			if (swipeRef.current) return
			// A fresh press, by any pointer and in any mode: whatever the last
			// swipe left pending is stale. A lifted touch rarely clicks, so
			// nothing else is sure to clear it.
			swallowClick.current = false
			if (event.pointerType === 'mouse' || !latest.current.enabled) return
			const bounds = scroller.getBoundingClientRect()
			const id = latest.current.itemAt(event.clientX - bounds.left, event.clientY - bounds.top + scroller.scrollTop)
			// A swipe starts on an item
			if (id === undefined) return
			const base = selectionRef.current
			const {handle} = latest.current
			swipeRef.current = {
				pointerId: event.pointerId,
				origin: {x: event.clientX, y: event.clientY},
				client: {x: event.clientX, y: event.clientY},
				fromHandle: handle !== undefined && event.target instanceof Element && event.target.closest(handle) !== null,
				active: false,
				from: id,
				to: null,
				adding: !base.has(id),
				base,
				scrollFrame: null,
				scrollBy: 0,
			}
		}

		const onPointerMove = (event: PointerEvent) => {
			const swipe = swipeRef.current
			if (!swipe || event.pointerId !== swipe.pointerId) return
			swipe.client = {x: event.clientX, y: event.clientY}
			if (!swipe.active) {
				const dx = Math.abs(event.clientX - swipe.origin.x)
				const dy = Math.abs(event.clientY - swipe.origin.y)
				if (swipe.fromHandle) {
					if (Math.max(dx, dy) < HANDLE_SLOP_PX) return
				} else {
					if (Math.max(dx, dy) < SLOP_PX) return
					// Up or down first: a scroll, which the browser has already taken
					// (or would have, if the list had room to move)
					if (dy >= dx) {
						swipeRef.current = null
						return
					}
				}
				swipe.active = true
				// From here the scroller owns the finger, wherever it goes: off the
				// item it came down on, which may scroll away and unmount
				scroller.setPointerCapture(event.pointerId)
			}
			update()
			autoScroll()
		}

		const onPointerUp = (event: PointerEvent) => {
			if (event.pointerId === swipeRef.current?.pointerId) end()
		}
		// The scroller's capture being taken away ends the swipe, but not the
		// item's implicit capture of the touch, which the scroller takes over
		// when the swipe sets off, and whose loss bubbles up here too
		const onLostPointerCapture = (event: PointerEvent) => {
			if (event.target === scroller) onPointerUp(event)
		}

		// The browser doesn't scroll a touch that set off sideways, but it
		// mustn't start to when the swipe turns downwards either
		const onTouchMove = (event: TouchEvent) => {
			if (swipeRef.current?.active && event.cancelable) event.preventDefault()
		}

		const onClick = (event: MouseEvent) => {
			if (!swallowClick.current) return
			swallowClick.current = false
			event.stopPropagation()
		}

		scroller.addEventListener('pointerdown', onPointerDown)
		scroller.addEventListener('pointermove', onPointerMove)
		scroller.addEventListener('pointerup', onPointerUp)
		scroller.addEventListener('pointercancel', onPointerUp)
		scroller.addEventListener('lostpointercapture', onLostPointerCapture)
		scroller.addEventListener('touchmove', onTouchMove, {passive: false})
		scroller.addEventListener('click', onClick, {capture: true})
		return () => {
			scroller.removeEventListener('pointerdown', onPointerDown)
			scroller.removeEventListener('pointermove', onPointerMove)
			scroller.removeEventListener('pointerup', onPointerUp)
			scroller.removeEventListener('pointercancel', onPointerUp)
			scroller.removeEventListener('lostpointercapture', onLostPointerCapture)
			scroller.removeEventListener('touchmove', onTouchMove)
			scroller.removeEventListener('click', onClick, {capture: true})
			// A swipe interrupted by an unmount leaves nothing running
			const frame = swipeRef.current?.scrollFrame
			if (frame !== null && frame !== undefined) cancelAnimationFrame(frame)
			swipeRef.current = null
		}
	}, [scrollerRef, scrollerKey, selectionRef, end])

	// Another gesture ends a swipe: the two cannot both own the touch
	return {end}
}
