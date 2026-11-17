import {useCallback, useEffect, useRef, type MouseEvent, type PointerEvent, type RefObject} from 'react'

// A press that moves less than this is a click, and stays one
const DRAG_THRESHOLD_PX = 4
// Holding the pointer past the scroller's top or bottom edge scrolls it: px
// per frame, from the minimum at the edge up to the maximum this far beyond it
const SCROLL_MIN_PX = 4
const SCROLL_MAX_PX = 32
const SCROLL_RAMP_PX = 160

// A box in the scroller's content coordinates: px from the content's top left
// corner, as laid out (before any CSS transform scales what is drawn)
export type MarqueeRect = {left: number; top: number; right: number; bottom: number}

type Drag = {
	pointerId: number
	// The element the handlers are on, which takes the pointer once a box is drawn
	captor: HTMLElement
	// Where the press was, in the scroller's content coordinates
	origin: {x: number; y: number}
	// The last pointer position, in client coordinates
	client: {x: number; y: number}
	// Past the threshold: a box is drawn and the selection follows it
	dragging: boolean
	// What the drag adds to: the selection when it started (shift/⌘ held), or
	// what a plain drag keeps
	base: ReadonlySet<string>
	// The selection last set from the box, to skip redundant updates
	last: ReadonlySet<string>
	scrollFrame: number | null
	// Px per frame the edge auto-scroll currently moves by (signed), updated
	// on every pointer move so the running loop follows the pointer
	scrollBy: number
	// The scroll listener that keeps the box in place, to remove at the end
	onScroll: (() => void) | null
}

const NONE: ReadonlySet<string> = new Set()
const NO_EDGES = {top: 0, bottom: 0}

// How the box looks, wherever it is drawn. It starts hidden: the marquee shows it.
export const marqueeBoxClass =
	'pointer-events-none absolute top-0 left-0 z-10 hidden rounded-sm border border-white/40 bg-white/10'

// Click-drag selection over a scrolling grid or list, for a mouse: the one
// marquee Files and Photos both draw.
//
// Which items the box touches is the caller's to say, as arithmetic over its
// layout (`itemsInRect`). Nothing is measured in the DOM, so a frame costs
// the same however many items are on screen, and the box covers rows a
// virtualised list hasn't mounted, exactly: scrolling a long way with the
// button held selects everything passed over, and dragging back gives it up.
//
// Pressing and moving past a small threshold starts a drag. A plain click is
// left to whatever is under it. The selection becomes what the box covers, or
// is added to with shift or ⌘/ctrl held. Holding the pointer beyond the top
// or bottom edge scrolls, and the wheel scrolls under a held box too.
//
// The element that wraps the items gets `handlers` (the scroller itself, or
// anything round it), and the box element gets `boxRef`: it is positioned and
// shown by direct style writes, off React's render path. Where the box lives
// decides how it is placed:
// - inside the scroller, at the origin of its content, it is drawn in the
//   content's coordinates and scrolls with the items (Photos);
// - anywhere else, it is laid over the part of the scroller that can be
//   seen, in the coordinates of its own offset parent (Files, whose scroller
//   is a virtualised list's own element).
//
// A scroller drawn smaller or larger by a CSS transform (Files inside Rewind)
// needs nothing said: the scale is read off the scroller.
export function useMarquee({
	scrollerRef,
	itemsInRect,
	selectionRef,
	heldRef,
	onSelect,
	canStart,
	edges = NO_EDGES,
}: {
	scrollerRef: RefObject<HTMLElement | null>
	// The ids of the items a box touches, or null while that can't be told
	// (nothing laid out yet), which leaves the drag as it is
	itemsInRect: (rect: MarqueeRect) => Iterable<string> | null
	// The current selection, for a drag that adds to it
	selectionRef: RefObject<ReadonlySet<string>>
	// What a plain drag keeps selected, if anything: for a selection that
	// spans views, the part picked elsewhere
	heldRef?: RefObject<ReadonlySet<string>>
	onSelect: (ids: ReadonlySet<string>) => void
	// Whether a press may become a drag: a press on something that has its own
	// use for a drag (a file that can be picked up) is not the marquee's
	canStart?: (event: PointerEvent<HTMLElement>) => boolean
	// How much of the scroller's top and bottom is covered (a fade, a dock
	// floating over it), in its own px. The scrolling starts where the cover
	// does, since the pointer may not be able to get past the edge itself.
	edges?: {top: number; bottom: number}
}) {
	const boxRef = useRef<HTMLDivElement>(null)
	const dragRef = useRef<Drag | null>(null)
	// The click that ends a drag must not reach the item under the pointer
	const swallowClick = useRef(false)
	// The caller's latest, for handlers and frames that outlive a render
	const latest = useRef({itemsInRect, onSelect, canStart, edges})
	useEffect(() => {
		latest.current = {itemsInRect, onSelect, canStart, edges}
	})

	// Position the box and select what it covers, for the drag's current
	// pointer and scroll position
	const update = () => {
		const drag = dragRef.current
		const scroller = scrollerRef.current
		const box = boxRef.current
		if (!drag?.dragging || !scroller || !box) return
		const bounds = scroller.getBoundingClientRect()
		const scale = scaleOf(scroller, bounds)
		const point = toContent(scroller, bounds, scale, drag.client.x, drag.client.y)
		const x = clamp(point.x, scroller.scrollLeft, scroller.scrollLeft + scroller.clientWidth)
		const y = clamp(point.y, 0, scroller.scrollHeight)
		const rect = {
			left: Math.min(x, drag.origin.x),
			top: Math.min(y, drag.origin.y),
			right: Math.max(x, drag.origin.x),
			bottom: Math.max(y, drag.origin.y),
		}
		const covered = latest.current.itemsInRect(rect)
		if (covered === null) return
		placeBox(box, scroller, bounds, scale, rect)
		const next = new Set(drag.base)
		for (const id of covered) next.add(id)
		if (sameSet(next, drag.last)) return
		drag.last = next
		latest.current.onSelect(next)
	}

	// Keep scrolling while the pointer is held at or beyond an edge
	const autoScroll = () => {
		const drag = dragRef.current
		const scroller = scrollerRef.current
		if (!drag?.dragging || !scroller) return
		const bounds = scroller.getBoundingClientRect()
		const scale = scaleOf(scroller, bounds)
		const top = bounds.top + latest.current.edges.top * scale
		const bottom = bounds.bottom - latest.current.edges.bottom * scale
		const beyond = drag.client.y < top ? drag.client.y - top : Math.max(0, drag.client.y - bottom)
		if (beyond === 0) {
			if (drag.scrollFrame !== null) cancelAnimationFrame(drag.scrollFrame)
			drag.scrollFrame = null
			return
		}
		const speed = SCROLL_MIN_PX + Math.min(1, Math.abs(beyond) / SCROLL_RAMP_PX) * (SCROLL_MAX_PX - SCROLL_MIN_PX)
		drag.scrollBy = Math.sign(beyond) * speed
		const step = () => {
			scroller.scrollTop += drag.scrollBy
			update()
			drag.scrollFrame = requestAnimationFrame(step)
		}
		if (drag.scrollFrame === null) drag.scrollFrame = requestAnimationFrame(step)
	}

	// Stable, so another gesture (a pinch) can hold on to it and end the drag
	const end = useCallback(() => {
		const drag = dragRef.current
		const scroller = scrollerRef.current
		if (!drag) return
		dragRef.current = null
		if (!drag.dragging) return
		if (drag.scrollFrame !== null) cancelAnimationFrame(drag.scrollFrame)
		if (drag.onScroll) scroller?.removeEventListener('scroll', drag.onScroll)
		if (drag.captor.hasPointerCapture(drag.pointerId)) drag.captor.releasePointerCapture(drag.pointerId)
		if (boxRef.current) boxRef.current.style.display = 'none'
		swallowClick.current = true
	}, [scrollerRef])
	// A drag interrupted by an unmount leaves nothing running
	useEffect(
		() => () => {
			const drag = dragRef.current
			dragRef.current = null
			if (!drag) return
			if (drag.scrollFrame !== null) cancelAnimationFrame(drag.scrollFrame)
			if (drag.onScroll) scrollerRef.current?.removeEventListener('scroll', drag.onScroll)
		},
		[scrollerRef],
	)

	// Says whether the press is one a drag may grow from, for a caller with
	// something of its own to do then (a press on empty space lets go of the
	// selection in Files)
	const onPointerDown = (event: PointerEvent<HTMLElement>): boolean => {
		const scroller = scrollerRef.current
		if (event.button !== 0 || event.pointerType !== 'mouse' || !scroller || dragRef.current) return false
		// A fresh press: whatever the last drag left pending is stale
		swallowClick.current = false
		const bounds = scroller.getBoundingClientRect()
		const scale = scaleOf(scroller, bounds)
		// Not from outside the scroller, and not from its scrollbar
		if (event.clientX < bounds.left || event.clientY < bounds.top || event.clientY > bounds.bottom) return false
		if (event.clientX > bounds.left + scroller.clientWidth * scale) return false
		if (latest.current.canStart && !latest.current.canStart(event)) return false
		const additive = event.shiftKey || event.metaKey || event.ctrlKey
		dragRef.current = {
			pointerId: event.pointerId,
			captor: event.currentTarget,
			origin: toContent(scroller, bounds, scale, event.clientX, event.clientY),
			client: {x: event.clientX, y: event.clientY},
			dragging: false,
			base: additive ? selectionRef.current : (heldRef?.current ?? NONE),
			last: selectionRef.current,
			scrollFrame: null,
			scrollBy: 0,
			onScroll: null,
		}
		return true
	}

	const onPointerMove = (event: PointerEvent<HTMLElement>) => {
		const drag = dragRef.current
		const scroller = scrollerRef.current
		if (!drag || !scroller || event.pointerId !== drag.pointerId) return
		drag.client = {x: event.clientX, y: event.clientY}
		if (!drag.dragging) {
			// The button came up somewhere this never heard of
			if (!(event.buttons & 1)) {
				dragRef.current = null
				return
			}
			const bounds = scroller.getBoundingClientRect()
			const point = toContent(scroller, bounds, scaleOf(scroller, bounds), event.clientX, event.clientY)
			if (Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y) < DRAG_THRESHOLD_PX) return
			drag.dragging = true
			// What the press itself did to the selection (see onPointerDown) has landed by now
			drag.last = selectionRef.current
			// From here the marquee owns the pointer, wherever it goes
			drag.captor.setPointerCapture(event.pointerId)
			drag.onScroll = update
			scroller.addEventListener('scroll', update)
			if (boxRef.current) boxRef.current.style.display = 'block'
		}
		update()
		autoScroll()
	}

	const onPointerUp = (event: PointerEvent<HTMLElement>) => {
		if (event.pointerId === dragRef.current?.pointerId) end()
	}

	const onClickCapture = (event: MouseEvent<HTMLElement>) => {
		if (!swallowClick.current) return
		swallowClick.current = false
		event.stopPropagation()
	}

	return {
		boxRef,
		// Another gesture ends a drag: the two cannot both own the pointer
		end,
		handlers: {
			onPointerDown,
			onPointerMove,
			onPointerUp,
			onPointerCancel: onPointerUp,
			// Capture can be taken away (the window loses focus mid-drag): the drag ends with it
			onLostPointerCapture: onPointerUp,
			onClickCapture,
		},
	}
}

// How much larger or smaller than laid out the scroller is drawn (a CSS
// transform on it or round it): its drawn width over its own
function scaleOf(scroller: HTMLElement, bounds: DOMRect) {
	const scale = scroller.offsetWidth > 0 ? bounds.width / scroller.offsetWidth : 1
	return scale > 0 && Number.isFinite(scale) ? scale : 1
}

// A point on screen, in the scroller's content coordinates
function toContent(scroller: HTMLElement, bounds: DOMRect, scale: number, clientX: number, clientY: number) {
	return {
		x: (clientX - bounds.left) / scale + scroller.scrollLeft,
		y: (clientY - bounds.top) / scale + scroller.scrollTop,
	}
}

function placeBox(box: HTMLElement, scroller: HTMLElement, bounds: DOMRect, scale: number, rect: MarqueeRect) {
	// In the scroller's content, which it scrolls with: the content's own coordinates
	if (scroller.contains(box)) {
		box.style.transform = `translate(${rect.left}px, ${rect.top}px)`
		box.style.width = `${rect.right - rect.left}px`
		box.style.height = `${rect.bottom - rect.top}px`
		return
	}
	// Over the scroller: what can be seen of the box, in the coordinates of
	// whatever positions it. Nothing clips it there, so it is cut to the
	// scroller's own edges here.
	const left = clamp(rect.left - scroller.scrollLeft, 0, scroller.clientWidth)
	const right = clamp(rect.right - scroller.scrollLeft, 0, scroller.clientWidth)
	const top = clamp(rect.top - scroller.scrollTop, 0, scroller.clientHeight)
	const bottom = clamp(rect.bottom - scroller.scrollTop, 0, scroller.clientHeight)
	const parent = box.offsetParent instanceof HTMLElement ? box.offsetParent : null
	const parentBounds = parent?.getBoundingClientRect()
	const offsetX = parentBounds ? (bounds.left - parentBounds.left) / scale - (parent?.clientLeft ?? 0) : 0
	const offsetY = parentBounds ? (bounds.top - parentBounds.top) / scale - (parent?.clientTop ?? 0) : 0
	box.style.transform = `translate(${offsetX + left}px, ${offsetY + top}px)`
	box.style.width = `${right - left}px`
	box.style.height = `${bottom - top}px`
}

function clamp(value: number, min: number, max: number) {
	return Math.max(min, Math.min(max, value))
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>) {
	if (a.size !== b.size) return false
	for (const id of a) if (!b.has(id)) return false
	return true
}
