import {useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject} from 'react'

import {InfoPanel} from '@/features/photos/components/viewer/info-panel'
import {releaseTarget} from '@/features/photos/components/viewer/info-sheet-release'
import {composeStart, type FlightStart} from '@/features/photos/components/viewer/picture-flight'
import {springConfig, stepAxis, type Axis} from '@/features/photos/components/viewer/spring'
import type {StageLift} from '@/features/photos/components/viewer/viewer-channels'
import type {ItemDetail} from '@/features/photos/hooks/use-items'
import {cn} from '@/lib/utils'
import {tw} from '@/utils/tw'

// The phone's inspector, iOS Photos style: swipe the picture up and it lifts
// into the top of the screen while the info rises beneath it, both under the
// finger; let go and they settle open or back by where and how fast the
// finger was going. The sheet is as tall as what it has to say (measured, up
// to the stage's top), with a half and a full height when that is a lot; it
// drags by its grabber or its body, down to close and up to expand.
//
// Everything that moves per frame — the sheet, the lift of the stage, the
// scrim — is driven through inline transforms from one number, the sheet's
// visible height `h`, off React's render path. Releases settle on a spring
// (the lightbox's, see spring.ts) that starts at the finger's speed, run in
// one rAF loop with the picture's re-fit; reduced motion snaps them (dragging
// still tracks: that is direct manipulation, not motion).
//
// In a short landscape window there is no room under the picture: the sheet
// is a panel at the right instead, the picture sliding left to make room,
// and the same swipe up opens it.

// The lifted picture's breathing room above the sheet
const GAP = 12
// The half detent, of the screen's height — offered only when the content is
// taller than that by enough to make two heights worth having
const HALF = 0.5
const DETENT_SPREAD = 96
// The shortest the sheet is drawn at, so a sliver of info is still a sheet
const MIN_SHEET = 220
// How far the lifted picture may shrink to fit above the sheet
const MIN_SCALE = 0.4
// Resistance past the tallest detent, and what lies beneath it to show
// (the sheet's own surface continues below its box, see the skirt)
const OVERDRAG = 0.22
// A finger that rested this long before lifting carries no speed
const STILL_MS = 80
// The landscape panel's margin from the window's edge, and the vertical
// travel of the swipe that opens it all the way
const SIDE_MARGIN = 8
const SIDE_LIFT = 220
// The dim over the picture as the sheet climbs from half to full
const SCRIM_MAX = 0.45
// A settle on the sheet's height: opening just under critical damping (a
// hint of arrival), closing at it (no bounce back into view)
const SPRING_OPEN = springConfig(0.38, 0.9)
const SPRING_CLOSE = springConfig(0.34)
// Picture lift re-fitted for another item (a step while the sheet is open)
const REFIT_MS = 300

export type InfoSheetLayout = 'bottom' | 'side'

type Lift = {s: number; ex: number; ey: number}
type Geometry = {
	layout: InfoSheetLayout
	// The visible heights (or, at the side, travels) the sheet rests at, ascending
	detents: number[]
	// The picture at rest, relative to the stage (its top-left corner and
	// size), and its lift at the first detent, as the stage's transform about
	// its own corner: scale `s`, then translate (ex, ey)
	picture: {x: number; y: number; w: number; h: number} | null
	lifted: Lift
	// The bottom toolbar's height, floating over the sheet's foot
	toolbar: number
	// How far the filmstrip slides at the first detent (the side panel's: it
	// follows the picture into the room the panel leaves)
	strip: number
}

const IDENTITY: Lift = {s: 1, ex: 0, ey: 0}

// Where an element sits inside an ancestor, from layout alone — the stage is
// transformed while this is asked, and its transform must not count
function offsetWithin(element: HTMLElement, ancestor: HTMLElement) {
	let x = 0
	let y = 0
	let node: HTMLElement | null = element
	while (node && node !== ancestor) {
		x += node.offsetLeft
		y += node.offsetTop
		node = node.offsetParent as HTMLElement | null
	}
	return {x, y}
}

const rubber = (value: number, max: number) => (value > max ? max + (value - max) * OVERDRAG : Math.max(0, value))

export function useInfoSheet({
	enabled,
	session,
	open,
	onOpenChange,
	layout,
	stageRef,
	pictureRef,
	toolbarRef,
	stripRef,
	refitKey,
	reduceMotion,
}: {
	// Phones only; off, nothing here touches the DOM
	enabled: boolean
	// The lightbox is open: a new session starts closed and unlifted
	session: boolean
	open: boolean
	onOpenChange: (open: boolean) => void
	layout: InfoSheetLayout
	// The stage (lifted as a whole, so a swipe to the next item still slides
	// within it) and the picture in it (what the lift fits above the sheet)
	stageRef: RefObject<HTMLElement | null>
	pictureRef: RefObject<HTMLElement | null>
	// The bottom toolbar, which floats over the sheet's foot
	toolbarRef: RefObject<HTMLElement | null>
	// The filmstrip's box, kept under the picture as the side panel opens
	stripRef: RefObject<HTMLElement | null>
	// Changes when the picture's box may have: the lift is fitted again
	refitKey: string
	reduceMotion: boolean
}) {
	const sheetRef = useRef<HTMLDivElement | null>(null)
	const scrimRef = useRef<HTMLDivElement | null>(null)
	const panelRef = useRef<HTMLElement | null>(null)
	const scrollRef = useRef<HTMLDivElement | null>(null)
	const contentRef = useRef<HTMLDivElement | null>(null)
	// … held in state too: the panel (and so its content) can mount after the
	// sheet has opened — a deep link's detail still on its way — and the
	// observer below must attach whenever it does
	const [content, setContent] = useState<HTMLDivElement | null>(null)
	const setContentRef = useCallback((element: HTMLDivElement | null) => {
		contentRef.current = element
		setContent(element)
	}, [])
	// The content is built for the first lift of a session, not before
	const [primed, setPrimed] = useState(false)

	const state = useRef({
		h: 0,
		// Where the sheet is headed (or rests): what open/close requests compare against
		target: 0,
		velocity: 0,
		spring: null as Axis | null,
		// A re-fit for another picture, blending from the old lift
		refit: null as null | {from: Lift; start: number},
		raf: 0,
		last: 0,
		dragging: false,
		// The close has taken the picture over (see handOff): the stage is left alone
		released: false,
		geometry: {layout, detents: [MIN_SHEET], picture: null, lifted: IDENTITY, toolbar: 0, strip: 0} as Geometry,
	}).current

	const liftAt = (geometry: Geometry, h: number): Lift => {
		const first = geometry.detents[0]!
		const t = Math.min(Math.max(h, 0), first) / first
		const {s, ex, ey} = geometry.lifted
		return {s: 1 + (s - 1) * t, ex: ex * t, ey: ey * t}
	}

	// Paint the current `h`: the sheet's offset, the stage's lift, the scrim
	// The lift being drawn: the detent's, or — while a refit blends from the
	// old shape to the new — the blend between them
	const currentLift = (): Lift => {
		const lift = liftAt(state.geometry, state.h)
		if (!state.refit) return lift
		const k = Math.min((performance.now() - state.refit.start) / REFIT_MS, 1)
		const eased = 1 - (1 - k) ** 3
		const from = state.refit.from
		return {
			s: from.s + (lift.s - from.s) * eased,
			ex: from.ex + (lift.ex - from.ex) * eased,
			ey: from.ey + (lift.ey - from.ey) * eased,
		}
	}
	const apply = () => {
		const sheet = sheetRef.current
		if (!sheet) return
		const {geometry, h} = state
		const max = geometry.detents[geometry.detents.length - 1]!
		sheet.style.transform =
			geometry.layout === 'side' ? `translate3d(${max - h}px, 0, 0)` : `translate3d(0, ${max - h}px, 0)`
		sheet.style.visibility = h > 0.5 ? 'visible' : 'hidden'
		const scrim = scrimRef.current
		if (scrim) {
			const [half, full] = geometry.detents
			scrim.style.opacity =
				full === undefined ? '0' : String(SCRIM_MAX * Math.min(Math.max((h - half!) / (full - half!), 0), 1))
		}
		// The toolbar takes on a floor as the sheet passes under it, so the
		// content rising beneath never runs through its glyphs
		const toolbar = toolbarRef.current
		if (toolbar) {
			const band = geometry.toolbar || 1
			toolbar.style.setProperty('--sheet-under', String(Math.min(Math.max((h - band / 2) / band, 0), 1)))
		}
		// The strip stays centred under the picture as it slides aside: on
		// `translate`, which the chrome's own entrance and exit (keyframes on
		// `transform`) leave alone
		const strip = stripRef.current
		if (strip) {
			const x = geometry.strip * (Math.min(Math.max(h, 0), geometry.detents[0]!) / geometry.detents[0]!)
			strip.style.translate = Math.abs(x) > 0.01 ? `${x}px 0` : ''
		}
		const stage = stageRef.current
		if (!stage || state.released) return
		const lift = currentLift()
		if (state.refit && performance.now() - state.refit.start >= REFIT_MS) state.refit = null
		stage.style.transform =
			lift.s === 1 && lift.ex === 0 && lift.ey === 0
				? ''
				: `translate3d(${lift.ex}px, ${lift.ey}px, 0) scale(${lift.s})`
	}

	// The sheet's natural height: its chrome plus all of its content, as if
	// nothing scrolled
	const naturalHeight = () => {
		const panel = panelRef.current
		const scroll = scrollRef.current
		const content = contentRef.current
		if (!panel || !scroll || !content) return undefined
		return panel.offsetHeight - scroll.clientHeight + content.offsetHeight
	}

	// Measure everything the motion is made of: the detents from the content,
	// the picture's box and where it lifts to. Layout reads only, and only at
	// a gesture's start, an open, or when something has actually changed.
	const measure = () => {
		const sheet = sheetRef.current
		const stage = stageRef.current
		const root = sheet?.offsetParent as HTMLElement | null
		if (!sheet || !stage || !root) return
		const H = root.clientHeight
		const W = root.clientWidth
		const stageTop = stage.offsetTop
		const picture = pictureRef.current && stage.contains(pictureRef.current) ? pictureRef.current : null
		const box = picture ? {...offsetWithin(picture, stage), w: picture.offsetWidth, h: picture.offsetHeight} : null
		let detents: number[]
		let lifted = IDENTITY
		let strip = 0
		const toolbar = layout === 'side' ? 0 : (toolbarRef.current?.offsetHeight ?? 0)
		if (layout === 'side') {
			sheet.style.top = `${stageTop}px`
			sheet.style.height = ''
			sheet.style.setProperty('--sheet-inset', '0px')
			const width = sheet.offsetWidth
			detents = [width + SIDE_MARGIN]
			if (box) {
				// Fit the picture into what the panel leaves, centred there
				const right = W - width - SIDE_MARGIN - GAP
				const left = stage.offsetLeft
				const s = Math.min(Math.max((right - left) / box.w, MIN_SCALE), 1)
				const cx = stage.offsetLeft + box.x + box.w / 2
				const tx = (left + right) / 2 - cx
				// The scale is about the picture's centre, written about the stage's corner
				lifted = {s, ex: tx + (1 - s) * (box.x + box.w / 2), ey: (1 - s) * (box.y + box.h / 2)}
				strip = (left + right) / 2 - W / 2
			}
		} else {
			sheet.style.top = ''
			// The toolbar floats over the sheet's foot: the content scrolls clear of it
			sheet.style.setProperty('--sheet-inset', `${toolbar}px`)
			const cap = H - stageTop
			const natural = naturalHeight() ?? Math.round(H * HALF)
			const half = Math.round(H * HALF)
			const full = Math.min(Math.max(natural, MIN_SHEET), cap)
			detents = full - half >= DETENT_SPREAD ? [half, full] : [full]
			sheet.style.height = `${full}px`
			if (box) {
				// Shrink only as much as the space above the first detent needs,
				// and rise only until the picture's foot clears the sheet
				const bottom = H - detents[0]! - GAP
				const s = Math.min(Math.max((bottom - stageTop) / box.h, MIN_SCALE), 1)
				const cy = stageTop + box.y + box.h / 2
				const ty = Math.min(0, bottom - (s * box.h) / 2 - cy)
				lifted = {s, ex: (1 - s) * (box.x + box.w / 2), ey: ty + (1 - s) * (box.y + box.h / 2)}
			}
		}
		stage.style.transformOrigin = '0 0'
		// The dim covers the stage, never the header above it
		if (scrimRef.current) scrimRef.current.style.top = `${stageTop}px`
		state.geometry = {layout, detents, picture: box, lifted, toolbar, strip}
	}

	const tick = (now: number) => {
		state.raf = 0
		const axis = state.spring
		if (axis) {
			// In small fixed steps, as the lightbox's own motion does: a dropped
			// frame changes nothing but how many steps it takes. rAF's stamp can
			// fall before the settle began; that frame still moves one frame.
			let elapsed = (now - state.last) / 1000
			if (elapsed <= 0) elapsed = 1 / 60
			elapsed = Math.min(elapsed, 1 / 20)
			const steps = Math.ceil(elapsed * 240)
			let rested = false
			for (let i = 0; i < steps && !rested; i++) rested = stepAxis(axis, elapsed / steps)
			state.h = axis.value
			state.velocity = axis.velocity / 1000
			if (rested) state.spring = null
		}
		state.last = Math.max(now, state.last)
		apply()
		if (state.spring || state.refit) state.raf = requestAnimationFrame(tick)
		else if (!state.dragging) promote(false)
	}
	// The stage on a layer of its own while it moves, so its scale is the
	// compositor's rather than a repaint of the picture every frame; at rest
	// it is drawn crisp again at whatever size it settled on
	const promote = (moving: boolean) => {
		const stage = stageRef.current
		if (stage) stage.style.willChange = moving && !state.released ? 'transform' : ''
	}
	const run = () => {
		promote(true)
		if (state.raf) return
		state.last = performance.now()
		state.raf = requestAnimationFrame(tick)
	}
	const stop = () => {
		state.spring = null
		state.velocity = 0
		cancelAnimationFrame(state.raf)
		state.raf = 0
	}

	// Settle at `to`, starting at `velocity` (of h, px/ms)
	const settle = (to: number, velocity = 0) => {
		state.target = to
		if (reduceMotion || !sheetRef.current) {
			stop()
			state.h = to
			state.refit = null
			apply()
			promote(false)
			return
		}
		state.velocity = velocity
		state.spring = {value: state.h, velocity: velocity * 1000, to, config: to > 0 ? SPRING_OPEN : SPRING_CLOSE}
		run()
	}

	// Where a release goes (see releaseTarget), and the open state with it
	const release = (velocity: number, h0: number) => {
		const to = releaseTarget([0, ...state.geometry.detents], state.h, h0, velocity)
		settle(to, velocity)
		if (to > 0 !== open) onOpenChange(to > 0)
	}

	// A drag on the stage or the sheet begins: the finger takes the sheet
	// wherever it is, mid-settle included
	const begin = () => {
		stop()
		// A sheet coming up from closed starts at the top of what it says
		if (state.h < 0.5) scrollRef.current?.scrollTo(0, 0)
		state.dragging = true
		promote(true)
		if (!primed) setPrimed(true)
		measure()
		return state.h
	}
	const dragTo = (h: number) => {
		const {detents} = state.geometry
		state.h = rubber(h, detents[detents.length - 1]!)
		apply()
	}
	const end = (velocity: number, cancelled: boolean, h0: number) => {
		state.dragging = false
		if (cancelled) {
			const {detents} = state.geometry
			const back = h0 > 0 ? detents.reduce((a, b) => (Math.abs(b - h0) < Math.abs(a - h0) ? b : a)) : 0
			settle(back)
			return
		}
		release(velocity, h0)
	}

	// The stage's swipe (see StageLift). Upward is +h; at the side, the swipe's
	// height maps onto the panel's travel.
	const liftDrag = useRef({h0: 0, at: 0})
	const lift: StageLift & {lifted: () => boolean} = {
		move(dy) {
			if (!enabled) return
			if (!state.dragging) liftDrag.current.h0 = begin()
			liftDrag.current.at = performance.now()
			const ratio = state.geometry.layout === 'side' ? state.geometry.detents[0]! / SIDE_LIFT : 1
			dragTo(liftDrag.current.h0 - dy * ratio)
		},
		end(_dy, vy, cancelled) {
			if (!enabled || !state.dragging) return
			const ratio = state.geometry.layout === 'side' ? state.geometry.detents[0]! / SIDE_LIFT : 1
			// The stage's velocity is its last move's: a finger that has since
			// rested lifts with none
			const still = performance.now() - liftDrag.current.at > STILL_MS
			end(still ? 0 : -vy * ratio, cancelled, liftDrag.current.h0)
		},
		// While the sheet holds the picture up, a downward swipe on it lowers
		// the sheet rather than dismissing the viewer
		lifted: () => enabled && (state.h > 0.5 || state.target > 0),
	}

	// Open and close asked for from outside (the Info button, `i`, the close):
	// the sheet goes to its first detent, or away. A release has already set
	// its own course before it reports, so it isn't asked twice.
	useLayoutEffect(() => {
		if (!enabled || state.dragging) return
		if (open && state.target === 0) {
			if (state.h < 0.5) scrollRef.current?.scrollTo(0, 0)
			measure()
			settle(state.geometry.detents[0]!)
		} else if (!open && state.target !== 0) settle(0)
	}, [open, enabled])

	// Something changed under a sheet that is up — the content's height (the
	// map arriving, another item's facts), the window, the picture's box: the
	// geometry is measured again and the sheet goes to the same detent of the
	// new set, the picture blending to its new lift.
	const refit = useCallback(() => {
		if (!enabled || !sheetRef.current) return
		const before = state.released ? IDENTITY : liftAt(state.geometry, state.h)
		const index = state.geometry.detents.indexOf(state.target)
		measure()
		// A drag carries on over the new geometry; a closed or closing sheet
		// stays on its way down
		if (state.dragging || state.target === 0) return apply()
		const {detents} = state.geometry
		const to = detents[Math.min(Math.max(index, 0), detents.length - 1)]!
		const after = liftAt(state.geometry, to)
		if (!reduceMotion && (before.s !== after.s || before.ex !== after.ex || before.ey !== after.ey)) {
			state.refit = {from: before, start: performance.now()}
		}
		if (to !== state.target || state.h !== to) settle(to, state.velocity)
		else if (state.refit) run()
		else apply()
	}, [enabled, layout, reduceMotion])

	useLayoutEffect(() => {
		if (!enabled) return
		refit()
	}, [enabled, refitKey, layout, refit])

	useEffect(() => {
		if (!enabled || !content) return
		const observer = new ResizeObserver(() => refit())
		observer.observe(content)
		const onResize = () => refit()
		window.addEventListener('resize', onResize)
		return () => {
			observer.disconnect()
			window.removeEventListener('resize', onResize)
		}
	}, [enabled, content, refit])

	// A new session starts with everything down; leaving the phone layout
	// (a window widened past it) hands the stage back
	useLayoutEffect(() => {
		if (session && enabled) return
		stop()
		state.h = 0
		state.target = 0
		state.velocity = 0
		state.refit = null
		state.dragging = false
		state.released = false
		const stage = stageRef.current
		if (stage) {
			stage.style.transform = ''
			stage.style.transformOrigin = ''
			stage.style.willChange = ''
		}
		if (stripRef.current) stripRef.current.style.translate = ''
		if (sheetRef.current) apply()
		if (!session) setPrimed(false)
	}, [session, enabled])
	useEffect(() => () => cancelAnimationFrame(state.raf), [state])

	// The close takes the picture over from the lift: the stage is let go of
	// at once, and the lift folded into the picture's own transform instead —
	// the same pixels — for the flight home to start from (see
	// picture-flight's `back(from)`). `from` is a transform the picture is
	// already drawn at (a drag's, a pinch's), composed inside the lift.
	const handOff = (from?: FlightStart): FlightStart | undefined => {
		if (!enabled || state.released) return from
		state.released = true
		const stage = stageRef.current
		const {picture} = state.geometry
		// Mid-refit too: the blend on screen, not where it was heading
		const lift = currentLift()
		state.refit = null
		if (stage) {
			stage.style.transform = ''
			stage.style.willChange = ''
		}
		if (!lift || !picture || (lift.s === 1 && lift.ex === 0 && lift.ey === 0)) return from
		// A point p of the picture is drawn at e + s·(corner + p): as the
		// picture's own transform about its corner, translate(e + (s − 1)·corner)
		// then scale(s)
		const x = lift.ex + (lift.s - 1) * picture.x
		const y = lift.ey + (lift.s - 1) * picture.y
		return composeStart({x, y, scale: lift.s}, from)
	}

	// The sheet's own drag, by touch: the grabber and the title bar always
	// drag it; the body drags it unless it is at full height and either
	// scrolled or being pushed up — then it is the content's scroll, and the
	// browser's. At the side it drags sideways, to the right to close. The
	// listeners stay put for the sheet's life, so they reach the drag through
	// `drag` — this render's begin/dragTo/end, with its layout (a rotation
	// turns the bottom sheet into the side panel under them) and motion
	// preference — never the ones the listeners were attached with.
	const drag = useRef({begin, dragTo, end})
	useLayoutEffect(() => {
		drag.current = {begin, dragTo, end}
	})
	useEffect(() => {
		const sheet = sheetRef.current
		if (!enabled || !sheet) return
		const LOCK = 8
		let touch: null | {
			id: number
			x0: number
			y0: number
			t: number
			v: number
			last: number
			h0: number
			fromBody: boolean
			mode: 'drag' | 'native' | null
		} = null
		const onStart = (event: TouchEvent) => {
			if (event.touches.length > 1) {
				if (touch?.mode === 'drag') drag.current.end(0, true, touch.h0)
				touch = null
				return
			}
			const point = event.changedTouches[0]!
			const scroll = scrollRef.current
			touch = {
				id: point.identifier,
				x0: point.clientX,
				y0: point.clientY,
				t: event.timeStamp,
				v: 0,
				last: 0,
				h0: state.h,
				fromBody: !!scroll && scroll.contains(event.target as Node),
				mode: null,
			}
		}
		const onMove = (event: TouchEvent) => {
			if (!touch) return
			const point = [...event.changedTouches].find((candidate) => candidate.identifier === touch!.id)
			if (!point) return
			const side = state.geometry.layout === 'side'
			const dx = point.clientX - touch.x0
			const dy = point.clientY - touch.y0
			if (touch.mode === null) {
				if (Math.hypot(dx, dy) < LOCK) return
				const along = side ? Math.abs(dx) > Math.abs(dy) && dx > 0 : Math.abs(dy) > Math.abs(dx)
				const top = state.geometry.detents[state.geometry.detents.length - 1]!
				const scroll = scrollRef.current
				const scrolls = !side && touch.fromBody && state.h >= top - 1 && (dy < 0 || (scroll?.scrollTop ?? 0) > 0)
				touch.mode = along && !scrolls ? 'drag' : 'native'
				if (touch.mode === 'native') return
				// Re-based where the axis locked, so the sheet doesn't jump the slop
				touch.x0 = point.clientX
				touch.y0 = point.clientY
				touch.h0 = drag.current.begin()
				touch.t = event.timeStamp
				return event.preventDefault()
			}
			if (touch.mode !== 'drag') return
			event.preventDefault()
			const travel = side ? point.clientX - touch.x0 : point.clientY - touch.y0
			const dt = event.timeStamp - touch.t
			if (dt > 0) {
				touch.v = 0.8 * ((travel - touch.last) / dt) + 0.2 * touch.v
				touch.t = event.timeStamp
			}
			touch.last = travel
			drag.current.dragTo(touch.h0 - travel)
		}
		const onEnd = (event: TouchEvent) => {
			if (!touch || ![...event.changedTouches].some((candidate) => candidate.identifier === touch!.id)) return
			const done = touch
			touch = null
			if (done.mode !== 'drag') return
			// A finger that stopped before lifting carries no momentum
			const still = event.timeStamp - done.t > STILL_MS
			drag.current.end(still ? 0 : -done.v, event.type === 'touchcancel', done.h0)
		}
		sheet.addEventListener('touchstart', onStart, {passive: true})
		sheet.addEventListener('touchmove', onMove, {passive: false})
		sheet.addEventListener('touchend', onEnd)
		sheet.addEventListener('touchcancel', onEnd)
		return () => {
			sheet.removeEventListener('touchstart', onStart)
			sheet.removeEventListener('touchmove', onMove)
			sheet.removeEventListener('touchend', onEnd)
			sheet.removeEventListener('touchcancel', onEnd)
		}
	}, [enabled, open])

	// … and by mouse or pen, on the grabber: drag, or click to switch heights
	const grabber = {
		onPointerDown: (event: React.PointerEvent) => {
			if (event.pointerType === 'touch' || event.button !== 0) return
			const target = event.currentTarget as HTMLElement
			target.setPointerCapture(event.pointerId)
			const side = state.geometry.layout === 'side'
			const start = {x: event.clientX, y: event.clientY, h0: begin(), t: event.timeStamp, v: 0, last: 0, moved: false}
			const onMove = (move: PointerEvent) => {
				const travel = side ? move.clientX - start.x : move.clientY - start.y
				if (Math.abs(travel) > 4) start.moved = true
				const dt = move.timeStamp - start.t
				if (dt > 0) start.v = 0.8 * ((travel - start.last) / dt) + 0.2 * start.v
				start.t = move.timeStamp
				start.last = travel
				dragTo(start.h0 - travel)
			}
			const onUp = (up: PointerEvent) => {
				target.removeEventListener('pointermove', onMove)
				target.removeEventListener('pointerup', onUp)
				target.removeEventListener('pointercancel', onUp)
				if (start.moved)
					return end(up.timeStamp - start.t > STILL_MS ? 0 : -start.v, up.type === 'pointercancel', start.h0)
				// A click: the other height, or closed when there is only one
				state.dragging = false
				const {detents} = state.geometry
				const next = detents.length > 1 && state.target === detents[0] ? detents[1]! : detents[0]!
				settle(next === state.target && detents.length === 1 ? 0 : next)
				if (next === state.target && detents.length === 1) onOpenChange(false)
			}
			target.addEventListener('pointermove', onMove)
			target.addEventListener('pointerup', onUp)
			target.addEventListener('pointercancel', onUp)
		},
	}

	return {
		lift,
		handOff,
		primed,
		layout,
		sheetRef,
		scrimRef,
		panelRef,
		scrollRef,
		contentRef: setContentRef,
		grabber,
		open,
	}
}

export type InfoSheetController = ReturnType<typeof useInfoSheet>

const leave = tw`motion-safe:animate-out motion-safe:fade-out motion-safe:duration-150 motion-safe:fill-mode-forwards`

// The sheet itself, positioned and moved by its controller. Its content is
// the inspector's own (InfoPanel), built on the first lift or open.
export function InfoSheet({
	sheet,
	item,
	built,
	closing,
	onClose,
}: {
	sheet: InfoSheetController
	item: ItemDetail | undefined
	// The inspector has been asked for this session (or the sheet primed by a lift)
	built: boolean
	// The lightbox is leaving: the sheet fades with the chrome
	closing: boolean
	onClose: () => void
}) {
	const side = sheet.layout === 'side'
	return (
		<>
			{/* Dims the picture as the sheet climbs past its half height */}
			<div
				ref={sheet.scrimRef}
				aria-hidden='true'
				className='pointer-events-none absolute inset-0 z-[15] bg-black opacity-0'
			/>
			<div
				ref={sheet.sheetRef}
				inert={!sheet.open}
				className={cn(
					'[visibility:hidden] absolute z-20 will-change-transform',
					side ? 'right-2 bottom-2 w-[min(380px,46vw)]' : 'inset-x-0 bottom-0',
					closing && leave,
				)}
			>
				{item && (built || sheet.primed) && (
					<InfoPanel
						item={item}
						showing={sheet.open}
						onClose={onClose}
						sheet={side ? 'side' : 'bottom'}
						panelRef={sheet.panelRef}
						scrollRef={sheet.scrollRef}
						contentRef={sheet.contentRef}
					/>
				)}
				{!side && (
					<>
						{/* The grabber: drawn at the top, its hit area the whole band
						    above the title; touch drags it with the rest of the sheet */}
						<div
							aria-hidden='true'
							className='absolute inset-x-0 top-0 flex h-6 cursor-grab touch-none justify-center pt-2 active:cursor-grabbing'
							{...sheet.grabber}
						>
							<span className='h-[5px] w-9 rounded-full bg-white/30' />
						</div>
						{/* The sheet's surface carries on below its box, seen only while it
						    is pulled up past its tallest height */}
						<div
							aria-hidden='true'
							className='umbrel-material umbrel-material-modal absolute inset-x-0 top-[calc(100%-24px)] -z-10 h-[50vh] rounded-none'
						/>
					</>
				)}
			</div>
		</>
	)
}
