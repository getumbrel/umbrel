import {useCallback, useEffect, useRef, type RefObject} from 'react'

import {itemAt, type Layout} from '@/features/photos/components/listing/timeline-rows'

// A finger that travels this far sideways before it travels as far up or
// down is a swipe across the tiles; one that sets off vertically is a scroll,
// and the browser has it (the scroller is touch-action: pan-y)
const SLOP_PX = 10
// Holding the finger within this band at the top or bottom of the visible
// grid scrolls it: px per frame, from the minimum at the band's inner edge up
// to the maximum at the grid's edge and beyond
const EDGE_PX = 72
const SCROLL_MIN_PX = 2
const SCROLL_MAX_PX = 24

type Swipe = {
	pointerId: number
	// Where the finger came down, and where it is now, in client coordinates
	origin: {x: number; y: number}
	client: {x: number; y: number}
	// Past the slop, sideways: the grid owns the finger and the selection follows it
	active: boolean
	// The item the swipe started on and the one it reaches to now (none until
	// it sets off). Ids rather than indexes, so a layout that changes under
	// the swipe — a page landing as it scrolls — can't shift the range.
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

// Swipe to select, for a touch screen in selection mode, the way iOS Photos
// does it. A finger that sets off sideways from a tile selects every item
// from that one to the one under the finger, in list order — so it runs on
// down the rows as the finger does — or deselects them, when the first one
// was already selected. Sliding back returns the items it leaves to what they
// were, and holding the finger near the top or bottom edge scrolls. Like the
// marquee, which tile is where is arithmetic over the layout (itemAt), so the
// range covers rows that aren't mounted and the canvas works the same way.
//
// Its listeners are the scroller's own, not React's: a swipe that turns
// downwards must keep the page from scrolling, which takes a touchmove
// listener that isn't passive (React's are).
export function useSwipeSelect({
	scrollerRef,
	viewRef,
	selectionRef,
	enabled,
	edges,
	onSelect,
}: {
	scrollerRef: RefObject<HTMLDivElement | null>
	viewRef: RefObject<{layout: Layout} | null>
	// The current selection, which a swipe adds to or takes from
	selectionRef: RefObject<ReadonlySet<string>>
	// Whether a swipe selects at all: in selection mode, where a tap toggles too
	enabled: boolean
	// How far in from the scroller's top and bottom the tiles can be seen (the
	// bar floats over the top, the dock over the bottom): the auto-scroll bands start there
	edges: {top: number; bottom: number}
	onSelect: (ids: ReadonlySet<string>) => void
}) {
	const swipeRef = useRef<Swipe | null>(null)
	// The click that ends a swipe must not reach the tile under the finger
	const swallowClick = useRef(false)
	const latest = useRef({enabled, edges, onSelect})
	useEffect(() => {
		latest.current = {enabled, edges, onSelect}
	}, [enabled, edges, onSelect])

	// Stable, so a pinch can hold on to it
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
			const layout = viewRef.current?.layout
			if (!swipe?.active || !layout) return
			const bounds = scroller.getBoundingClientRect()
			// Off either side of the grid, the finger still reaches the tile at that edge
			const x = Math.max(0, Math.min(scroller.clientWidth - 1, swipe.client.x - bounds.left))
			const index = itemAt(layout, x, swipe.client.y - bounds.top + scroller.scrollTop)
			// Over a gap or a header it keeps reaching where it last did
			const to = index === undefined ? (swipe.to ?? swipe.from) : layout.items[index]!.id
			if (to === swipe.to) return
			swipe.to = to
			const start = layout.indexOf.get(swipe.from)
			const stop = layout.indexOf.get(to)
			if (start === undefined || stop === undefined) return
			const next = new Set(swipe.base)
			for (let i = Math.min(start, stop); i <= Math.max(start, stop); i++) {
				const id = layout.items[i]!.id
				if (swipe.adding) next.add(id)
				else next.delete(id)
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
			const layout = viewRef.current?.layout
			const bounds = scroller.getBoundingClientRect()
			const index =
				layout && itemAt(layout, event.clientX - bounds.left, event.clientY - bounds.top + scroller.scrollTop)
			// A swipe starts on a tile
			if (!layout || index === undefined) return
			const id = layout.items[index]!.id
			const base = selectionRef.current
			swipeRef.current = {
				pointerId: event.pointerId,
				origin: {x: event.clientX, y: event.clientY},
				client: {x: event.clientX, y: event.clientY},
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
				if (Math.max(dx, dy) < SLOP_PX) return
				// Up or down first: a scroll, which the browser has already taken
				// (or would have, if the list had room to move)
				if (dy >= dx) {
					swipeRef.current = null
					return
				}
				swipe.active = true
				// From here the grid owns the finger, wherever it goes — off the
				// tile it came down on, which may scroll away and unmount
				scroller.setPointerCapture(event.pointerId)
			}
			update()
			autoScroll()
		}

		const onPointerUp = (event: PointerEvent) => {
			if (event.pointerId === swipeRef.current?.pointerId) end()
		}
		// The grid's capture being taken away ends the swipe — but not the
		// tile's implicit capture of the touch, which the grid takes over when
		// the swipe sets off, and whose loss bubbles up here too
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
	}, [scrollerRef, viewRef, selectionRef, end])

	// A pinch ends a swipe: the two cannot both own the touch
	return {end}
}
