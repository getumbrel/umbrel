import {useReducedMotion} from 'motion/react'
import {memo, useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {flushSync} from 'react-dom'

import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {ItemThumbnail} from '@/features/photos/components/listing/item-thumbnail'
import type {StripDrive} from '@/features/photos/components/viewer/viewer-channels'
import type {Item} from '@/features/photos/hooks/use-items'
import {useContainerSize} from '@/hooks/use-container-size'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'

// ── Shape ──
// Thumb box and the pitch between thumbs. Layout never changes on hover: the
// growth is a transform, so slot positions stay arithmetic and the strip can
// be windowed like the timeline.
const THUMB = 48
const GAP = 8
const SLOT = THUMB + GAP
const GROW = 1.5
// How far neighbours slide to keep the gap while a thumb is grown
const SHIFT = (THUMB * (GROW - 1)) / 2
// The thumbs' inset from the strip's foot, and the room above them for the
// keyboard focus ring
const INSET = 8
const RING_PAD = 4
// Compact is phones and touch screens: no hover to grow into, so the strip is
// its thumbs and nothing more, and the scroller is the hit target itself.
// Regular is the pointer's: 24px of headroom above the thumbs for the growth
// and 8px more so its ring clears the clip edge. The viewer pulls that
// headroom up over the foot of the stage — exactly where a height-constrained
// video draws its seek bar — so a regular strip's box is transparent to hits
// and only the band its thumbs sit in takes them (scrolls and wheels on it
// bubble to the scroller).
const COMPACT_HEIGHT = RING_PAD + THUMB + INSET
const REGULAR_HEIGHT = 88
// A strip moving faster than this many slots a second is a flick, not a scrub
const FLICK_SPEED = 9

// ── Motion ──
// A released mouse drag carries on with the speed it was let go at, decaying
// exponentially (this time constant), and is aimed so it comes to rest
// exactly on the slot its momentum would have reached — the way a native
// fling with snapping lands. Settles (a click, ←/→, a wheel at rest) use the
// same curve, quicker.
const COAST_MS = 325
const SETTLE_MS = 90
// A press that travels further than this is a drag, not a click
const DRAG_SLOP = 4
// Velocity is read from the drag's last moments; a finger held still this
// long before letting go has no momentum
const VELOCITY_WINDOW_MS = 80
// The scroll velocity's smoothing time constant (frames arrive unevenly)
const VELOCITY_MS = 50
// How long the strip must be quiet after a user scroll before it is theirs
// no longer
const SCRUB_IDLE_MS = 160
// During a flick (not a scrub) the stage follows the centre at most this
// often: each item it lands on costs the viewer a render, a fast flick
// crosses a slot every frame, and what flies past is browsing anyway — the
// release always lands the exact item
const FLICK_SELECT_MS = 90

// ── Windowing ──
// Thumbs mounted beyond each edge of the strip, and the range moves
// in steps of this many so a scrub doesn't render at every slot. Moving, it
// also reaches this far ahead in the direction of travel, so a flick never
// outruns what is mounted.
const OVERSCAN = 8
const RANGE_STEP = 4
const LEAD_MS = 250
const LEAD_MAX = 48
// Snap points are mounted much further out than thumbs: a native fling picks
// its resting snap point when it starts, so the one it will land on must
// already exist. The same goes for the current item's, around which a window
// is always mounted too (see snapWindows).
const SNAP_WINDOW = 160
// Ask for the next page when this close to the end of what's loaded
const LOAD_AHEAD = 30

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

// The runs of items that get snap points: SNAP_WINDOW beyond the mounted
// range, and as far either side of the current item — in order, without
// overlap. The strip turns mandatory snapping on wherever it comes to rest on
// the current item, and the browser then holds it to the nearest snap point
// that exists. The range alone can't promise that one is the current item's:
// it follows the scroll position after the fact, so in the commit that first
// centres the strip — a lightbox opened deep into the library — it still
// describes the strip's start. The snap would carry the strip back to the
// window's edge, and the strip, taking a scroll it didn't write for the
// user's, would put the item there on stage.
function snapWindows(range: {start: number; end: number}, current: number, last: number) {
	const around = (start: number, end: number) => ({
		start: Math.max(0, start - SNAP_WINDOW),
		end: Math.min(last, end + SNAP_WINDOW),
	})
	const mounted = around(range.start, range.end)
	if (current < 0) return [mounted]
	const own = around(current, current)
	if (own.end < mounted.start - 1) return [own, mounted]
	if (own.start > mounted.end + 1) return [mounted, own]
	return [{start: Math.min(own.start, mounted.start), end: Math.max(own.end, mounted.end)}]
}

// Whether the strip is the pointer's (see REGULAR_HEIGHT)
function useRegularStrip() {
	const isMobile = useIsMobile()
	const isTouch = useIsTouchDevice()
	return !isMobile && !isTouch
}

// The strip's box while there is nothing to show yet, so the stage above
// doesn't resize when the list arrives
export function FilmstripPlaceholder() {
	return <div style={{height: useRegularStrip() ? REGULAR_HEIGHT : COMPACT_HEIGHT}} />
}

type Glide = {from: number; target: number; t0: number; tau: number; owner: 'user' | 'settle'}
type Press = {pointerId: number; x0: number; s0: number; dragging: boolean; samples: {t: number; x: number}[]}

// A horizontally virtualized strip of thumbnails. On hover the pointed-at
// thumb grows and everything to either side slides over by half the growth,
// so gaps stay even — one index of React state and a CSS transition per
// thumb, nothing per frame. Scrolling it is scrubbing (iOS-style): the thumb
// passing the centre becomes the item on stage — cheap, because the viewer
// keeps the item in local state and runs the stage on thumbnails until the
// scrub rests.
// Touch scrolls natively, with native momentum and scroll-snap, so it rests
// exactly on an item and feels like the platform rather than an imitation of
// it. A mouse drags it with momentum, a vertical wheel scrolls it, and a
// click travels to a thumb. While the stage is being swiped the strip
// follows it frame by frame through `drive`.
export function Filmstrip({
	items,
	currentId,
	hasMore,
	loadMore,
	onSelect,
	grow = true,
	drive,
}: {
	items: Item[]
	currentId: string
	hasMore: boolean
	loadMore: () => void
	onSelect: (id: string) => void
	// Hover growth (pointer only); off = a plain strip
	grow?: boolean
	// The stage's swipe travel, for the strip to follow (see StripDrive)
	drive?: StripDrive
}) {
	const reduceMotion = useReducedMotion() ?? false
	const regular = useRegularStrip()
	const scrollerRef = useRef<HTMLDivElement>(null)
	const trackRef = useRef<HTMLDivElement>(null)
	// A regular strip's hit band: the scroller itself takes no hits there (see
	// REGULAR_HEIGHT), so a mouse drag captures the pointer here instead
	const bandRef = useRef<HTMLDivElement>(null)
	const {width} = useContainerSize(scrollerRef)
	const [range, setRange] = useState({start: 0, end: -1})
	const [hovered, setHovered] = useState<number | null>(null)
	const growEnabled = grow && regular
	const currentIndex = items.findIndex((item) => item.id === currentId)

	// What the loop and the handlers need from the latest render — refreshed
	// first thing in each commit's layout phase, ahead of everything below
	// and of the viewer's drive reset that follows in the same commit
	const live = useRef({items, currentIndex, onSelect, reduceMotion})
	useLayoutEffect(() => {
		live.current = {items, currentIndex, onSelect, reduceMotion}
	})

	// The strip's moving parts, outside React. `owner` is who positions it:
	// nobody (resting on the current item, snap on), the user (a touch, its
	// native momentum, a mouse drag and its coast, a wheel — the item follows
	// the strip), a settle of our own (travelling to the current item), or
	// the stage's swipe (the drive). `expected` is the last scroll position
	// we wrote, so its echo in a scroll event isn't mistaken for the user.
	const state = useRef({
		owner: 'none' as 'none' | 'user' | 'settle' | 'drive',
		expected: NaN,
		touching: false,
		wheeling: false,
		press: null as Press | null,
		glide: null as Glide | null,
		suppressClick: false,
		// The drive's position, in items, and how far past either end it pulls
		drivePos: 0,
		overshoot: 0,
		// The strip's speed (items/ms), from the last frame's time and the last
		// position sample (kept across rests: the first step after a pause must
		// still read as a speed)
		lastT: 0,
		sampleF: NaN,
		sampleT: 0,
		velocity: 0,
		raf: 0,
		idle: undefined as ReturnType<typeof setTimeout> | undefined,
		// The id the strip last showed as current, or chose itself, and when
		selected: '',
		selectedT: 0,
	})

	// `sync` (from a scroll event) commits a new range at once: the strip's own
	// state, a small render — and otherwise it queues behind the viewer's
	// render for the item the scrub just landed on, and a flick outruns what
	// is mounted
	const rangeRef = useRef(range)
	rangeRef.current = range
	const updateRange = useCallback(
		(sync = false) => {
			const el = scrollerRef.current
			if (!el || width === 0) return
			const centre = el.scrollLeft / SLOT
			const half = width / 2 / SLOT
			const lead = clamp(state.current.velocity * LEAD_MS, -LEAD_MAX, LEAD_MAX)
			const start = Math.max(0, Math.floor((centre - half - OVERSCAN + Math.min(0, lead)) / RANGE_STEP) * RANGE_STEP)
			const end = Math.min(
				items.length - 1,
				Math.ceil((centre + half + OVERSCAN + Math.max(0, lead)) / RANGE_STEP) * RANGE_STEP,
			)
			const prev = rangeRef.current
			if (prev.start === start && prev.end === end) return
			rangeRef.current = {start, end}
			if (sync) flushSync(() => setRange({start, end}))
			else setRange({start, end})
		},
		[items.length, width],
	)
	useLayoutEffect(() => updateRange(), [updateRange])

	useEffect(() => {
		if (hasMore && range.end >= items.length - 1 - LOAD_AHEAD) loadMore()
	}, [hasMore, range.end, items.length, loadMore])

	// ── Writing the strip ──
	const writeScroll = useCallback((left: number) => {
		const el = scrollerRef.current
		if (!el) return
		state.current.expected = left
		el.scrollLeft = left
	}, [])
	// Snapping belongs to native scrolling only: with it on, every position we
	// write ourselves would be snapped too
	const setSnap = useCallback((on: boolean) => {
		const el = scrollerRef.current
		if (el) el.style.scrollSnapType = on ? 'x mandatory' : 'none'
	}, [])

	// Where the strip is meant to be, in px, and how far that is from where
	// the scroller actually is. A browser keeps scroll positions to whole
	// pixels, so a position we write — the drive's, a glide's — lands up to
	// half a pixel off; the track carries the remainder as a transform (and
	// the drive's rubber band past either end), so the thumbs sit exactly
	// where the stage says. Native scrolling is its own truth.
	const placement = useCallback((el: HTMLElement) => {
		const st = state.current
		const scrolled = el.scrollLeft
		const meant =
			st.owner === 'drive' ? st.drivePos * SLOT : Math.abs(st.expected - scrolled) < 1 ? st.expected : scrolled
		return {position: meant, offset: meant - scrolled + st.overshoot * SLOT}
	}, [])

	// Puts the track where the strip is meant to be (see placement)
	const paint = useCallback(() => {
		const el = scrollerRef.current
		const track = trackRef.current
		if (!el || !track) return
		const {offset} = placement(el)
		track.style.transform = Math.abs(offset) > 0.01 ? `translateX(${(-offset).toFixed(2)}px)` : ''
	}, [placement])

	// The item at the centre is the one on stage, while the user has the strip
	const selectIndex = useCallback((index: number) => {
		const st = state.current
		const {items, onSelect} = live.current
		const id = items[clamp(index, 0, items.length - 1)]?.id
		if (!id || id === st.selected) return
		st.selected = id
		onSelect(id)
	}, [])
	const nearest = useCallback((left: number) => {
		const {items} = live.current
		return clamp(Math.round(left / SLOT), 0, items.length - 1)
	}, [])

	// The frame loop: carries a glide, paints, and follows the centre with the
	// selection while the user has the strip. Runs only while something is
	// moving and stops the moment everything rests.
	const frameRef = useRef<() => void>(() => {})
	const wake = useCallback(() => {
		const st = state.current
		if (st.raf) return
		st.lastT = performance.now()
		st.raf = requestAnimationFrame(() => frameRef.current())
	}, [])

	// The user is done with the strip: the item at the centre is the choice
	const release = useCallback(() => {
		const st = state.current
		const el = scrollerRef.current
		if (!el || st.owner !== 'user' || st.touching || st.press?.dragging || st.glide) return
		const index = nearest(el.scrollLeft)
		selectIndex(index)
		st.owner = 'none'
		st.wheeling = false
		// Native snapping lands exactly on a slot; a wheel or a touch that
		// interrupted a settle doesn't, and is eased onto the nearest
		if (Math.abs(el.scrollLeft - index * SLOT) > 0.5) {
			st.owner = 'settle'
			st.glide = {from: el.scrollLeft, target: index * SLOT, t0: performance.now(), tau: SETTLE_MS, owner: 'settle'}
			wake()
		} else setSnap(true)
	}, [nearest, selectIndex, setSnap, wake])
	const restartIdle = useCallback(() => {
		const st = state.current
		clearTimeout(st.idle)
		st.idle = setTimeout(release, SCRUB_IDLE_MS)
	}, [release])

	const frame = () => {
		const st = state.current
		st.raf = 0
		const el = scrollerRef.current
		if (!el) return
		const {reduceMotion} = live.current
		// One clock for everything here (the glides start from it too)
		const now = performance.now()
		st.lastT = now
		let landed: Glide | null = null
		if (st.glide) {
			const g = st.glide
			let left = g.target + (g.from - g.target) * Math.exp(-Math.max(0, now - g.t0) / g.tau)
			if (reduceMotion || Math.abs(left - g.target) < 0.5) {
				left = g.target
				landed = g
				st.glide = null
			}
			writeScroll(left)
		}
		// The strip's speed: how far ahead the range reaches, and whether the
		// user is flicking or scrubbing
		const f = placement(el).position / SLOT
		if (Number.isFinite(st.sampleF)) {
			const gap = Math.max(8, now - st.sampleT)
			const v = (f - st.sampleF) / gap
			st.velocity += (v - st.velocity) * (1 - Math.exp(-gap / VELOCITY_MS))
		}
		st.sampleF = f
		st.sampleT = now
		const speed = Math.abs(st.velocity) * 1000
		const resting = !st.glide && !st.press?.dragging && Math.abs(st.velocity) < 1e-4
		if (resting) st.velocity = 0
		paint()
		if (st.owner === 'user' && (speed < FLICK_SPEED || now - st.selectedT >= FLICK_SELECT_MS)) {
			st.selectedT = now
			selectIndex(nearest(el.scrollLeft))
		}
		if (landed) {
			if (landed.owner === 'user') release()
			else if (st.owner === 'settle') {
				st.owner = 'none'
				setSnap(true)
			}
		}
		if (!resting && !st.raf) {
			st.raf = requestAnimationFrame(() => frameRef.current())
		}
	}
	useLayoutEffect(() => {
		frameRef.current = frame
	})

	// The user takes the strip — from a settle mid-flight, from the drive
	const claim = useCallback(() => {
		const st = state.current
		if (st.owner !== 'user' && st.glide) {
			st.glide = null
			// Snapping again here would jump to the nearest slot under the
			// finger; leave it off, and the release eases onto one instead
			const el = scrollerRef.current
			if (el && Math.abs(el.scrollLeft - nearest(el.scrollLeft) * SLOT) < 0.5) setSnap(true)
		}
		st.owner = 'user'
		st.overshoot = 0
		restartIdle()
	}, [nearest, restartIdle, setSnap])

	// Travel to the current item. Instant on first layout (and under reduced
	// motion), a quick settle otherwise.
	const centerOn = useCallback(
		(index: number, instant: boolean) => {
			const el = scrollerRef.current
			if (!el) return
			const st = state.current
			// Clamped, or an end-of-strip target could never be reached and the
			// settle would never end
			const target = clamp(index * SLOT, 0, el.scrollWidth - el.clientWidth)
			if (instant || live.current.reduceMotion || Math.abs(el.scrollLeft - target) < 0.5) {
				st.glide = null
				st.owner = 'none'
				writeScroll(target)
				setSnap(true)
				paint()
				return
			}
			setSnap(false)
			st.owner = 'settle'
			st.glide = {from: el.scrollLeft, target, t0: performance.now(), tau: SETTLE_MS, owner: 'settle'}
			wake()
		},
		[paint, setSnap, wake, writeScroll],
	)

	// Keep the current item at the centre — unless the user is scrubbing, in
	// which case the id is following the strip, not the other way round.
	// The (id, index) pair the strip last laid out for, to tell a navigation
	// (new id) from the library shifting under a stationary item (same id,
	// new index) — photos landing from an upload ahead of this one
	const anchorRef = useRef<{id: string; index: number} | null>(null)
	useLayoutEffect(() => {
		const el = scrollerRef.current
		const st = state.current
		if (!el || width === 0 || currentIndex < 0) return
		const anchor = anchorRef.current
		anchorRef.current = {id: currentId, index: currentIndex}
		st.selected = currentId
		if (!anchor) {
			// First layout: be there
			centerOn(currentIndex, true)
			return
		}
		if (anchor.id === currentId) {
			const delta = currentIndex - anchor.index
			if (delta === 0) return
			// Same item, new slot: the list changed around it, not a navigation.
			// Every thumb just moved by the same distance, so move the viewport
			// and everything in flight with them — before paint, and no matter
			// who owns the scroll — and the strip stands perfectly still. Scroll
			// anchoring, by hand: the browser's can't see absolutely-positioned
			// thumbs move.
			const by = delta * SLOT
			writeScroll(el.scrollLeft + by)
			if (st.glide) {
				st.glide.from += by
				st.glide.target += by
			}
			if (st.press) st.press.s0 += by
			st.drivePos += delta
			st.sampleF += delta
			// The pointer hasn't moved, so neither may the grown thumb
			setHovered((h) => (h === null ? null : h + delta))
			updateRange()
			return
		}
		// A navigation. The user's scrub leads it, and the drive's reset —
		// which follows this effect in the same commit — puts the strip on the
		// new item itself (see StripDrive)
		if (st.owner === 'user' || st.owner === 'drive') return
		centerOn(currentIndex, false)
	}, [currentId, currentIndex, width, centerOn, updateRange, writeScroll])

	// The stage's swipe: the strip sits at the current item plus the stage's
	// travel, exactly, every frame — applied straight from the drive's
	// listener, so it lands in the same frame as the stage (and the commit's
	// reset to 0 lands before paint). Past either end the strip pulls by the
	// same rubber band as the stage. A user holding the strip has it.
	useEffect(() => {
		if (!drive) return
		return drive.subscribe((value) => {
			const st = state.current
			if (st.owner === 'user') return
			if (value === 0 && st.owner !== 'drive') return
			const {currentIndex, items} = live.current
			if (currentIndex < 0) return
			const position = currentIndex + value
			const clamped = clamp(position, 0, items.length - 1)
			st.glide = null
			st.drivePos = clamped
			st.overshoot = position - clamped
			if (value === 0) st.owner = 'none'
			else {
				st.owner = 'drive'
				setSnap(false)
			}
			writeScroll(clamped * SLOT)
			if (value === 0) setSnap(true)
			paint()
			wake()
		})
	}, [drive, paint, setSnap, wake, writeScroll])

	const onScroll = () => {
		updateRange(true)
		const el = scrollerRef.current
		if (!el) return
		const st = state.current
		wake()
		// Our own write's echo, or a settle or the drive in flight
		if (Math.abs(el.scrollLeft - st.expected) < 1 || st.owner === 'settle' || st.owner === 'drive') return
		// The user's scroll (a touch's native momentum, a trackpad): where it is
		// is where it is meant to be
		st.expected = NaN
		claim()
	}

	// ── Touch ── native: just note the finger, so the strip stays the user's
	// while it is down even if it holds still
	const onTouchStart = () => {
		state.current.touching = true
		claim()
	}
	const onTouchEnd = () => {
		state.current.touching = false
		restartIdle()
	}

	// ── Mouse ── a drag past the slop takes the strip (pointer capture, so it
	// carries on outside it), and its release coasts onto a slot
	const onPointerDown = (e: React.PointerEvent) => {
		if (e.pointerType !== 'mouse' || e.button !== 0) return
		const el = scrollerRef.current
		if (!el) return
		state.current.press = {
			pointerId: e.pointerId,
			x0: e.clientX,
			s0: el.scrollLeft,
			dragging: false,
			samples: [{t: e.timeStamp, x: e.clientX}],
		}
	}
	const onPointerMove = (e: React.PointerEvent) => {
		const el = scrollerRef.current
		if (!el || e.pointerType !== 'mouse') return
		const st = state.current
		const press = st.press
		if (!press || press.pointerId !== e.pointerId) return
		const dx = e.clientX - press.x0
		if (!press.dragging) {
			if (Math.abs(dx) < DRAG_SLOP) return
			press.dragging = true
			;(bandRef.current ?? el).setPointerCapture(e.pointerId)
			el.style.cursor = 'grabbing'
			claim()
			st.glide = null
			setSnap(false)
			setHovered(null)
		}
		press.samples.push({t: e.timeStamp, x: e.clientX})
		while (press.samples.length > 2 && e.timeStamp - press.samples[0]!.t > VELOCITY_WINDOW_MS) press.samples.shift()
		writeScroll(clamp(press.s0 - dx, 0, el.scrollWidth - el.clientWidth))
		wake()
	}
	const onPointerUp = (e: React.PointerEvent) => {
		const el = scrollerRef.current
		const st = state.current
		const press = st.press
		if (!el || !press || press.pointerId !== e.pointerId) return
		st.press = null
		if (!press.dragging) return
		el.style.cursor = ''
		// The drag was not a click on whatever thumb it ended over
		st.suppressClick = true
		setTimeout(() => (st.suppressClick = false))
		const first = press.samples[0]!
		const last = press.samples[press.samples.length - 1]!
		const held = e.timeStamp - last.t > VELOCITY_WINDOW_MS
		const velocity = held || last.t === first.t ? 0 : -(last.x - first.x) / (last.t - first.t)
		const target = nearest(el.scrollLeft + velocity * COAST_MS) * SLOT
		st.glide = {from: el.scrollLeft, target, t0: performance.now(), tau: COAST_MS, owner: 'user'}
		wake()
	}

	// ── Wheel ── mouse wheels are vertical; the strip is not. React's wheel
	// listener is passive, so this one is attached by hand to be able to claim
	// the event. Horizontal (trackpad) scrolling is native and snaps itself.
	useEffect(() => {
		const el = scrollerRef.current
		if (!el) return
		const onWheel = (e: WheelEvent) => {
			if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
			e.preventDefault()
			const st = state.current
			const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * el.clientWidth : e.deltaY
			claim()
			st.glide = null
			st.wheeling = true
			setSnap(false)
			writeScroll(clamp(el.scrollLeft + delta, 0, el.scrollWidth - el.clientWidth))
			wake()
		}
		el.addEventListener('wheel', onWheel, {passive: false})
		return () => el.removeEventListener('wheel', onWheel)
	}, [claim, setSnap, wake, writeScroll])

	useEffect(
		() => () => {
			clearTimeout(state.current.idle)
			cancelAnimationFrame(state.current.raf)
		},
		[],
	)

	// A click is a destination, not a scrub: the strip travels to the chosen
	// thumb once the viewer has it
	const select = useCallback(
		(id: string) => {
			const st = state.current
			if (st.suppressClick) return
			clearTimeout(st.idle)
			if (st.owner === 'user' && !st.press?.dragging && !st.glide) st.owner = 'none'
			onSelect(id)
		},
		[onSelect],
	)

	const last = items.length - 1
	const windows = snapWindows(range, currentIndex, last)
	const windowsKey = windows.map(({start, end}) => `${start}-${end}`).join()
	// A snapped scroller holds on to its snap point when the snap points change
	// under it, and browsers disagree on which one that is: Chrome keeps the
	// element, WebKit (every iPhone browser, and Safari) keeps its index. The
	// strip's snap points are windowed, so whenever a window's start moves the
	// count before the current item changes, and WebKit carried the strip to
	// whichever item now sat at the old count — then on to the next, as the
	// windows followed it there. The strip took each move for the user's scrub
	// and put the item on stage: a lightbox opened deep into the library ran
	// off towards its end. So when the snap points change under a strip at
	// rest, snapping goes off for one layout, which drops the browser's
	// snapped point, and back on: the browser then snaps to the nearest, the
	// current item the strip already rests on. During the user's own scroll
	// browsers don't re-snap, and a settle or the drive has snapping off.
	useLayoutEffect(() => {
		const el = scrollerRef.current
		if (!el || state.current.owner !== 'none' || el.style.scrollSnapType !== 'x mandatory') return
		setSnap(false)
		void el.scrollLeft
		setSnap(true)
	}, [windowsKey, setSnap])
	return (
		<div
			ref={scrollerRef}
			onScroll={onScroll}
			onTouchStart={onTouchStart}
			onTouchEnd={onTouchEnd}
			onTouchCancel={onTouchEnd}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			onPointerLeave={() => setHovered(null)}
			// Out of the tab order: the current thumb is the strip's tab stop, and a
			// focused scroller would scroll itself on the arrow keys that step
			tabIndex={-1}
			onClickCapture={(e) => {
				if (!state.current.suppressClick) return
				e.preventDefault()
				e.stopPropagation()
			}}
			className={cn(
				'umbrel-hide-scrollbar relative w-full touch-pan-x overflow-x-auto overflow-y-hidden overscroll-x-contain',
				// A regular strip's headroom lies over the stage, so only its band
				// takes hits (see REGULAR_HEIGHT). It also ends at the stage's
				// edges, mid-window: it fades out there rather than cut thumbs in half.
				// A compact strip is all hit target, gaps included — the viewer's
				// footer is transparent to hits, and that would otherwise carry down.
				regular
					? 'pointer-events-none cursor-grab [mask-image:linear-gradient(to_right,transparent,black_32px,black_calc(100%-32px),transparent)]'
					: 'pointer-events-auto',
			)}
			style={{height: regular ? REGULAR_HEIGHT : COMPACT_HEIGHT}}
		>
			{/* Content wide enough for every item to reach the centre: one slot per
			    item past the first, plus the strip's own width */}
			<div className='relative h-full' style={{width: `calc(100% + ${Math.max(0, last) * SLOT}px)`}}>
				{regular && <div ref={bandRef} className='pointer-events-auto absolute bottom-0 h-14 w-full' />}
				{/* The track's origin is the strip's centre at scroll 0, so item i is
				    centred when scrolled to i slots — whatever the strip's width,
				    which can change under it (the inspector sliding in) */}
				<div
					ref={trackRef}
					className='absolute inset-y-0'
					style={{left: `calc(50% - ${(Math.max(0, last) * SLOT) / 2}px)`}}
				>
					{windows.flatMap(({start, end}) =>
						items
							.slice(start, end + 1)
							.map((item, i) => (
								<span
									key={item.id}
									aria-hidden='true'
									className='pointer-events-none absolute top-0 h-px snap-center'
									style={{left: (start + i) * SLOT - THUMB / 2, width: THUMB}}
								/>
							)),
					)}
					{items.slice(range.start, range.end + 1).map((item, i) => {
						const index = range.start + i
						// Neighbours make room: left ones slide left, right ones slide right
						const shift = hovered === null ? 0 : index < hovered ? -SHIFT : index > hovered ? SHIFT : 0
						return (
							<Thumb
								key={item.id}
								item={item}
								left={index * SLOT - THUMB / 2}
								current={item.id === currentId}
								scale={hovered === index ? GROW : 1}
								shift={shift}
								onHover={growEnabled ? () => !state.current.press?.dragging && setHovered(index) : undefined}
								onSelect={select}
							/>
						)
					})}
				</div>
			</div>
		</div>
	)
}

const Thumb = memo(function Thumb({
	item,
	left,
	current,
	scale,
	shift,
	onHover,
	onSelect,
}: {
	item: Item
	left: number
	current: boolean
	scale: number
	shift: number
	onHover?: () => void
	onSelect: (id: string) => void
}) {
	return (
		<button
			type='button'
			onClick={() => onSelect(item.id)}
			onPointerEnter={(e) => e.pointerType === 'mouse' && onHover?.()}
			aria-label={item.kind}
			aria-current={current ? 'true' : undefined}
			// One tab stop, on the current item: ←/→ walk the rest
			tabIndex={current ? 0 : -1}
			style={{
				left,
				bottom: INSET,
				width: THUMB,
				height: THUMB,
				transform: `translateX(${shift}px) scale(${scale})`,
				transformOrigin: 'bottom center',
				zIndex: scale > 1 ? 2 : 1,
			}}
			className={cn(
				'pointer-events-auto absolute cursor-[inherit] overflow-hidden rounded-md ring-white outline-hidden transition-[transform,box-shadow,opacity] duration-200 ease-out focus-visible:ring-2',
				current ? 'opacity-100 ring-2' : 'opacity-75 hover:opacity-100',
			)}
		>
			{/* The strip's thumbs are 48px boxes: the 192 rendition is plenty */}
			<ItemThumbnail item={item} size={192} className='h-full w-full' />
		</button>
	)
})
