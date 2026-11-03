import {useReducedMotion} from 'motion/react'
import {useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject} from 'react'

import {PICTURE_RADIUS, type FlightStart} from '@/features/photos/components/viewer/picture-flight'
import {
	animate,
	createVelocityTracker,
	EDGE_SPRING,
	PAGE_SPRING,
	RETURN_SPRING,
	TAP_ZOOM_SPRING,
	ZOOM_SPRING,
	type Motion,
	type SpringConfig,
} from '@/features/photos/components/viewer/spring'
import type {StageLift, StripDrive} from '@/features/photos/components/viewer/viewer-channels'
import {
	bounds,
	canDecodeOriginal,
	clampView,
	FIT,
	isFit,
	maxZoom,
	renditionWidth,
	rubber,
	rubberScale,
	toBox,
	viewportClip,
	zoomAbout,
	zoomInAt,
	type Geometry,
	type Point,
	type View,
} from '@/features/photos/components/viewer/zoom'
import {itemOriginalUrl} from '@/features/photos/hooks/use-items'
import {useAuthorizedHttpUrl} from '@/modules/auth/http-auth'

// Sensitivity. Movement in px before the gesture picks its axis; the travel
// or the flick (px/ms) that commits a step or the dismissal; and how much of
// the finger's pull the picture follows where there is nothing to pull to.
const LOCK = 10
const STEP_TRAVEL = 72
const STEP_FLICK = 0.5
const DISMISS_TRAVEL = 120
const DISMISS_FLICK = 0.5
const OVERDRAG = 0.3
// How the picture recedes as it is pulled down — fully shrunk after 700px —
// and how quickly the backdrop clears to the timeline behind it (never fully:
// the picture still needs a floor to read against while the finger holds it)
const SHRINK = 1 / 1400
const SHRINK_FLOOR = 0.5
const CLEAR = 1 / 520
// The dark between panes as they slide with the finger — the neighbours ride
// one stage-width plus this to each side (the item viewer lays them out there)
export const PANE_GAP = 24
// The strip of a video the browser draws its controls in: a drag from there
// is a scrub, not a gesture
const VIDEO_CONTROLS_PX = 72
// A tap is a press that neither moved past LOCK nor stayed down this long;
// two of them this close in time and place are a double-tap
const TAP_MS = 250
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_SLOP = 40
// Where a double-tap (or a double-click) zooms to, fit being 1
const DOUBLE_TAP_ZOOM = 2.5
// A pinch that started at fit may go on below it — the picture shrinking
// under the fingers, the backdrop clearing as it would for a drag-down
// (this much per unit of scale lost) — and lets go into the close below
// CLOSE_BELOW, or below fit at all if the fingers were still closing
// faster than CLOSE_FLICK (scale per ms). It shrinks no smaller than this.
const CLOSE_BELOW = 0.75
const CLOSE_FLICK = -0.0015
const PINCH_FLOOR = 0.3
const PINCH_CLEAR = 1.8
// The zoom has to rest this long past the 1280's own pixels before the
// original is asked for: zooming through on the way to somewhere else
// costs no download
const SHARP_PAUSE = 250
// The 1280 is "soft" once the screen shows it this much larger than it is
const SOFT_AT = 1.15
// Wheel zooming has no release: it settles once the wheel has been quiet this long
const WHEEL_SETTLE_MS = 160
// How long a committed step waits for its id swap before giving up on it
const STEP_TIMEOUT_MS = 1000

// What the finger (or the mouse) is doing. `press` hasn't moved past LOCK
// yet; `step` slides the strip between items; `dismiss` pulls the picture
// down to close; `lift` is the info sheet's (when the viewer asks for one,
// see onLift); `pan` moves a zoomed picture about; `pinch` is two fingers;
// `dead` is a pointer that is down but does nothing (a second finger's
// leftover, a vertical drag with nowhere to go).
type Gesture =
	| {kind: 'press'; pointerId: number; x0: number; y0: number; t0: number; grabbed: boolean; onButton: boolean}
	| {kind: 'step'; pointerId: number; x0: number; y0: number; dx: number; base: number}
	| {kind: 'dismiss'; pointerId: number; x0: number; y0: number; base: Point}
	| {kind: 'lift'; pointerId: number; x0: number; y0: number; dy: number}
	| {kind: 'pan'; pointerId: number; x0: number; y0: number; from: Point; mouse: boolean}
	| {
			kind: 'pinch'
			ids: [number, number]
			from: View
			// The fingers' midpoint (box coordinates) and spread when it began
			m0: Point
			d0: number
			// It began at fit, so it may go on below it into the close
			closing: boolean
			// The chrome has stepped aside for that close
			lifted: boolean
			// Where it is now, and how fast the scale and the centre are moving
			// (per ms), for the close to carry on at that speed
			m: Point
			t: number
			vs: number
			centre: Point
			vc: Point
	  }
	| {kind: 'dead'; pointerId: number}

// A dismissal's pull: the finger's travel, and the picture's box at fit
type Pull = {dx: number; dy: number; w: number; h: number}

// The pulled picture, shrinking about its centre as it goes down (upward it
// only stretches): its transform's parts
function pulled({dx, dy, w, h}: Pull) {
	const k = dy > 0 ? Math.max(1 - dy * SHRINK, SHRINK_FLOOR) : 1
	return {x: dx + (w / 2) * (1 - k), y: (dy > 0 ? dy : dy * OVERDRAG) + (h / 2) * (1 - k), scale: k}
}

// Desktop Safari's trackpad pinch (it sends these instead of ctrl+wheel)
type GestureEvent = UIEvent & {scale: number; clientX: number; clientY: number}

// Touch on the lightbox's stage, and the zoom for every pointer.
//
// At fit, a horizontal drag slides the strip — the picture tracks the finger
// with its neighbours riding one pane to each side (the viewer mounts them
// while `stepping`), and past a threshold or a flick the strip carries on
// until the neighbour rests at the centre — and a downward drag dismisses,
// the picture shrinking under the finger while the backdrop clears to the
// timeline behind it. Release short of either and everything springs back.
//
// Two fingers pinch: the content under them stays under them, scale and pan
// at once, rubber-banding past the limits. Zoomed, one finger pans with
// momentum and elastic edges, and a horizontal drag past an edge hands over
// to the strip (the step's own rules decide whether it pages). A pinch that
// begins at fit and goes on below it closes the viewer: let go small enough
// and the picture is handed to `onDismiss` where it is, for the flight home.
// A double-tap zooms to 2.5× around the tapped point and back; on desktop a
// double-click does, ctrl/⌘+wheel and the trackpad's pinch zoom about the
// cursor, the wheel and a mouse drag pan, and Escape or 0 return to fit
// before Escape can close.
//
// Every settle is a spring seeded with the finger's velocity (see spring.ts),
// and any new touch catches whatever is still moving where it is, in that
// frame: a step still carrying on lands at once — the arriving item becomes
// the current one — and the finger takes the strip from where it was, so
// quick flicks walk through photo after photo. Direct manipulation runs even
// under reduced motion (it is tracking, not motion); only the settles snap.
//
// Everything is written straight to the elements' inline styles, never
// through a render: the strip's travel on the picture and the panes, the
// zoom on the layer inside the picture (`zoomRef`; the picture's own
// transform is the flight's and the strip's) — or, below fit, on the picture
// itself — and a pull on the picture. Every frame of a horizontal drag and
// its settle also reports the strip's travel, in items, to `drive` (see
// StripDrive), for the filmstrip to follow; an upward drag at fit goes to
// `onLift` (see StageLift) when one is given.
export function useStageGestures({
	open,
	enabled,
	zoom,
	pictureRef,
	peekRefs,
	shownId,
	canStep,
	onStep,
	onDismissStart,
	onDismiss,
	drive,
	onLift,
}: {
	// The lightbox session: a new one starts with the chrome back in place
	open: boolean
	// Touch gestures (the stage being touched, and at rest enough to move)
	enabled: boolean
	// The zoom, for any pointer: whether the item on stage can be zoomed (a
	// still, at rest), its pixel size, and its file name — which says whether
	// the browser can draw the original once the 1280 goes soft
	zoom: {enabled: boolean; width: number; height: number; fileName: string | undefined}
	pictureRef: RefObject<HTMLElement | null>
	// The neighbours' panes, mounted by the viewer while `stepping` — they
	// follow the finger with the picture and are gone once the strip rests
	peekRefs: {prev: RefObject<HTMLElement | null>; next: RefObject<HTMLElement | null>}
	// The item on stage — a committed step's held end frame releases the
	// moment this changes (see the layout effect below)
	shownId: string | undefined
	canStep: (dir: 1 | -1) => boolean
	onStep: (dir: 1 | -1) => void
	// The dismissal locked: the timeline behind can get ready to be seen
	onDismissStart: () => void
	// … and committed, at `from` (where the picture was, its inline transform
	// just cleared, and how fast it was going)
	onDismiss: (from: FlightStart) => void
	drive: StripDrive
	onLift?: StageLift
}) {
	const reduceMotion = useReducedMotion() ?? false
	// What springs, timers and native listeners read: the latest of everything
	const latest = useRef({enabled, zoom, shownId, canStep, onStep, onDismissStart, onDismiss, onLift, reduceMotion})
	useLayoutEffect(() => {
		latest.current = {enabled, zoom, shownId, canStep, onStep, onDismissStart, onDismiss, onLift, reduceMotion}
	})

	const backdropRef = useRef<HTMLDivElement | null>(null)
	// The zoom layer: a child of the picture wrapping everything it draws
	const zoomRef = useRef<HTMLDivElement | null>(null)
	// The stage, for its size and for the listeners React can't attach
	// non-passively (wheel) or at all (Safari's gesture events)
	const surfaceRef = useRef<HTMLElement | null>(null)
	const [surface, setSurface] = useState<HTMLElement | null>(null)
	const surfaceCallback = useCallback((element: HTMLElement | null) => {
		surfaceRef.current = element
		setSurface(element)
	}, [])

	// While a dismissal is being dragged the chrome steps aside (a state, not
	// a per-frame style: it is a fade the moment the axis locks). It stays
	// aside once the dismissal commits — the close must not flash it back —
	// and returns only when the drag settles back, or for the next session.
	const [dismissing, setDismissing] = useState(false)
	// While a step is being dragged (and until its settle rests) the
	// neighbours' panes are on stage
	const [stepping, setStepping] = useState(false)

	// The state every frame is painted from
	const viewRef = useRef<View>(FIT)
	// The strip's travel, px (negative toward the next item)
	const stripRef = useRef(0)
	// One pane of the strip: the stage's width, measured when the strip is taken
	const paneRef = useRef(0)
	const pullRef = useRef<Pull | null>(null)
	const geoRef = useRef<Geometry | null>(null)
	const gestureRef = useRef<Gesture | null>(null)
	const pointersRef = useRef(new Map<number, Point>())
	const [tracker] = useState(createVelocityTracker)
	const lastTapRef = useRef<{t: number; x: number; y: number} | null>(null)
	// What is moving on its own, each catchable (see grab)
	const stripMotionRef = useRef<Motion | null>(null)
	const viewMotionRef = useRef<{motion: Motion; to: View} | null>(null)
	const pullMotionRef = useRef<Motion | null>(null)
	// The direction of a committed step still carrying on, and the travel the
	// strip owes the id swap once it lands (see the shownId effect)
	const committingRef = useRef<0 | 1 | -1>(0)
	const shiftRef = useRef(0)
	// Counts the id swaps landed, for a step to tell whether its own did
	const swapsRef = useRef(0)
	const wheelRef = useRef<{raw: number; timer: number} | null>(null)
	const safariPinchRef = useRef<{from: View; point: Point} | null>(null)

	const span = () => paneRef.current + PANE_GAP

	// Everything inline, from the state above. The picture carries the strip's
	// travel, or a pull, or — below fit — the zoom itself; above fit the zoom
	// is the layer's, and the picture becomes a window the size of the stage
	// onto it: its own box stops clipping and the stage's (with its corners)
	// takes over. The window travels with the strip, so a zoomed picture
	// paging away slides off as one pane.
	const paint = () => {
		const picture = pictureRef.current
		const layer = zoomRef.current
		const view = viewRef.current
		const tx = stripRef.current
		const pull = pullRef.current
		const zoomed = view.s > 1 + 1e-3
		if (picture) {
			if (pull) {
				const {x, y, scale} = pulled(pull)
				picture.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
			} else if (view.s < 1) {
				picture.style.transform = `translate(${view.x + tx}px, ${view.y}px) scale(${view.s})`
			} else picture.style.transform = tx ? `translateX(${tx}px)` : ''
			const geo = geoRef.current
			picture.style.overflow = zoomed ? 'visible' : ''
			picture.style.clipPath = zoomed && geo ? viewportClip(geo, FIT, PICTURE_RADIUS) : ''
		}
		if (layer) {
			layer.style.transform = view.s >= 1 && !isFit(view) ? `translate(${view.x}px, ${view.y}px) scale(${view.s})` : ''
			layer.toggleAttribute('data-zoomed', zoomed)
		}
		for (const peek of [peekRefs.prev.current, peekRefs.next.current]) {
			if (peek) peek.style.transform = tx ? `translateX(${tx}px)` : ''
		}
		const stage = surfaceRef.current
		if (stage) {
			const gesture = gestureRef.current
			stage.style.cursor = zoomed ? (gesture?.kind === 'pan' && gesture.mouse ? 'grabbing' : 'grab') : ''
		}
		drive.set(tx && paneRef.current ? Math.max(-1, Math.min(1, -tx / span())) : 0)
		// Back at fit before the pause was up (a double-tap in and out): no original
		if (zoomed) wantSharp()
		else clearTimeout(sharpTimerRef.current)
	}
	const setBackdrop = (opacity: number) => {
		const backdrop = backdropRef.current
		if (!backdrop) return
		const value = opacity >= 1 ? '' : String(opacity)
		if (backdrop.style.opacity !== value) backdrop.style.opacity = value
	}
	const pullBackdrop = (pull: Pull) => setBackdrop(1 - Math.min(Math.max(pull.dy, 0) * CLEAR, 0.9))
	const pinchBackdrop = (s: number) => setBackdrop(s < 1 ? 1 - Math.min((1 - s) * PINCH_CLEAR, 0.9) : 1)

	// The picture's fitted box and the stage around it, measured now — only
	// possible while the picture's own transform is no more than the strip's
	// travel; otherwise what was measured at fit still holds
	const measure = (): Geometry | null => {
		const picture = pictureRef.current
		const stage = surfaceRef.current
		if (!picture || !stage) return null
		if (viewRef.current.s < 1 || pullRef.current) return geoRef.current
		const box = picture.getBoundingClientRect()
		const room = stage.getBoundingClientRect()
		const left = box.left - stripRef.current
		const top = box.top
		geoRef.current = {
			left,
			top,
			width: box.width,
			height: box.height,
			viewport: {left: room.left - left, top: room.top - top, right: room.right - left, bottom: room.bottom - top},
		}
		return geoRef.current
	}
	// The best image's pixels across the picture's width, and so the zoom's limit
	const sourceWidth = () => {
		const {width, height, fileName} = latest.current.zoom
		if (!(width > 0) || !(height > 0)) return 0
		return canDecodeOriginal(fileName) ? width : renditionWidth(width, height)
	}
	const zoomLimit = (geo: Geometry) => maxZoom(geo.width, sourceWidth(), window.devicePixelRatio || 1)

	// The original, once the zoom has rested past the 1280's own pixels (see
	// SHARP_PAUSE): set for an id, so the next item starts on the 1280 again
	const [sharpFor, setSharpFor] = useState<string>()
	const sharpTimerRef = useRef(0)
	useEffect(() => () => clearTimeout(sharpTimerRef.current), [])
	const wantSharp = () => {
		clearTimeout(sharpTimerRef.current)
		const {zoom: info, shownId: id} = latest.current
		const geo = geoRef.current
		if (!id || id === sharpFor || !geo || !canDecodeOriginal(info.fileName)) return
		const rendition = renditionWidth(info.width, info.height)
		if (info.width <= rendition * 1.05) return
		if (geo.width * viewRef.current.s * (window.devicePixelRatio || 1) <= rendition * SOFT_AT) return
		sharpTimerRef.current = window.setTimeout(() => setSharpFor(id), SHARP_PAUSE)
	}
	const originalUrl = useDecodedOriginal(
		// Not gated on the zoom being enabled: a close (or the phone's sheet)
		// turns it off while the zoomed picture is still on screen, sharp
		sharpFor && sharpFor === shownId && canDecodeOriginal(zoom.fileName) ? sharpFor : undefined,
	)

	// The motions
	const stopStrip = () => {
		stripMotionRef.current?.stop()
		stripMotionRef.current = null
		committingRef.current = 0
	}
	const stopView = () => {
		viewMotionRef.current?.motion.stop()
		viewMotionRef.current = null
	}
	const stopPull = () => {
		pullMotionRef.current?.stop()
		pullMotionRef.current = null
	}

	// The strip carries on to the neighbour (`dir`) or back to the centre,
	// from the finger's speed (px/ms). A step that lands holds its end frame —
	// the neighbour at the centre, the old picture out of view — and only then
	// swaps the id: the new current mounts on the very thumbnail the pane was
	// showing, so nothing appears or jumps at the hand-over.
	const settleStrip = (velocity: number, dir?: 1 | -1) => {
		stopStrip()
		committingRef.current = dir ?? 0
		const to = dir ? -dir * span() : 0
		const motion = animate(
			// Rests within a pixel: the spring's last sub-pixel creep is
			// invisible, and the id swap (with everything that waits on it —
			// the resting image, the URL) shouldn't wait on it
			[{value: stripRef.current, velocity: velocity * 1000, to, config: PAGE_SPRING, clamp: true, precision: 1}],
			([tx]) => {
				stripRef.current = tx!
				paint()
			},
			{reduceMotion: latest.current.reduceMotion},
		)
		stripMotionRef.current = motion
		void motion.finished.then((rested) => {
			if (!rested) return
			stripMotionRef.current = null
			committingRef.current = 0
			if (dir) commitStep(dir)
			// Back at the centre: the panes go — unless a finger is on the strip
			// (a step, or a zoomed pan pushing past an edge) and still needs them
			else if (gestureRef.current?.kind !== 'step' && gestureRef.current?.kind !== 'pan') setStepping(false)
		})
	}
	// The id swap: the strip owes it one pane of travel, settled in the
	// commit that renders the new item
	const commitStep = (dir: 1 | -1) => {
		shiftRef.current += dir * span()
		const swaps = swapsRef.current
		latest.current.onStep(dir)
		// A step that didn't take (the neighbour gone from the list meanwhile)
		// must not leave the stage holding an empty end frame: the strip comes back
		window.setTimeout(() => {
			if (swapsRef.current !== swaps || !shiftRef.current) return
			shiftRef.current = 0
			if (!gestureRef.current) settleStrip(0)
		}, STEP_TIMEOUT_MS)
	}

	// The zoom to `to`, springing from where it is (velocities per second)
	const settleView = (
		to: View,
		{config = ZOOM_SPRING, velocity = [0, 0, 0]}: {config?: SpringConfig; velocity?: number[]} = {},
	) => {
		stopView()
		const from = viewRef.current
		const motion = animate(
			[
				{value: from.s, velocity: velocity[0]!, to: to.s, config, precision: 0.001},
				{value: from.x, velocity: velocity[1]!, to: to.x, config, precision: 0.3},
				{value: from.y, velocity: velocity[2]!, to: to.y, config, precision: 0.3},
			],
			([s, x, y]) => {
				viewRef.current = {s: s!, x: x!, y: y!}
				// Below fit, the backdrop clears with it (a pinch-close coming back)
				pinchBackdrop(s!)
				paint()
			},
			{reduceMotion: latest.current.reduceMotion},
		)
		viewMotionRef.current = {motion, to}
		void motion.finished.then((rested) => {
			if (!rested) return
			viewMotionRef.current = null
			if (isFit(to)) viewRef.current = FIT
			paint()
		})
	}
	// A zoomed picture let go: it glides on, slowing by friction, and bounces
	// back off whichever edge it runs into (px/ms)
	const glideView = (vx: number, vy: number) => {
		const geo = geoRef.current
		const view = viewRef.current
		if (!geo) return
		stopView()
		const b = bounds(geo, view.s)
		const to = {s: view.s, x: Math.min(Math.max(view.x, b.minX), b.maxX), y: Math.min(Math.max(view.y, b.minY), b.maxY)}
		const motion = animate(
			[
				{value: view.x, velocity: vx * 1000, min: b.minX, max: b.maxX, config: EDGE_SPRING, precision: 0.3},
				{value: view.y, velocity: vy * 1000, min: b.minY, max: b.maxY, config: EDGE_SPRING, precision: 0.3},
			],
			([x, y]) => {
				viewRef.current = {s: view.s, x: x!, y: y!}
				paint()
			},
			{reduceMotion: latest.current.reduceMotion},
		)
		viewMotionRef.current = {motion, to}
		void motion.finished.then((rested) => rested && (viewMotionRef.current = null))
	}
	// A pull let go short of dismissing: the picture comes home with its
	// backdrop, from the finger's speed (px/ms)
	const settlePull = (vx: number, vy: number) => {
		const pull = pullRef.current
		stopPull()
		if (!pull) return
		const motion = animate(
			[
				{value: pull.dx, velocity: vx * 1000, to: 0, config: RETURN_SPRING},
				{value: pull.dy, velocity: vy * 1000, to: 0, config: RETURN_SPRING},
			],
			([dx, dy]) => {
				pullRef.current = {...pull, dx: dx!, dy: dy!}
				pullBackdrop(pullRef.current)
				paint()
			},
			{reduceMotion: latest.current.reduceMotion},
		)
		pullMotionRef.current = motion
		void motion.finished.then((rested) => {
			if (!rested) return
			pullMotionRef.current = null
			pullRef.current = null
			setBackdrop(1)
			paint()
		})
	}

	// A new touch catches whatever is still moving, where it is, in this
	// frame. A committed step still on its way lands now: the id swaps — the
	// arriving item becomes the current one — and the strip keeps its place
	// in the new item's terms (see the shownId effect), for the finger to
	// carry on from. True if anything was caught.
	const grab = () => {
		let caught = false
		if (stripMotionRef.current) {
			const dir = committingRef.current
			stopStrip()
			if (dir) commitStep(dir)
			caught = true
		}
		if (viewMotionRef.current) {
			stopView()
			caught = true
		}
		if (pullMotionRef.current) {
			stopPull()
			caught = true
		}
		return caught
	}
	// Whatever the caught or unfinished state, put it back to rest (a press
	// let go without a gesture, a gesture another one interrupts)
	const resettle = () => {
		// The swap a grab started hasn't rendered yet: its effect settles the strip
		if (stripRef.current && !stripMotionRef.current && !shiftRef.current) settleStrip(0)
		if (pullRef.current && !pullMotionRef.current) settlePull(0, 0)
		const view = viewRef.current
		const geo = geoRef.current
		if (!viewMotionRef.current && geo && !isFit(view)) {
			const max = zoomLimit(geo)
			const rest = clampView(geo, {...view, s: Math.min(Math.max(view.s, 1), max)})
			if (rest.s !== view.s || rest.x !== view.x || rest.y !== view.y) settleView(rest)
		}
	}

	// A committed step's id swap lands in this commit, before anything
	// paints: the strip takes the pane of travel it owes (a step that rested
	// lands at exactly 0 — the held end frame is released here, so there is
	// never a frame with the old picture back at the centre; one caught
	// mid-flight keeps its place, now in the new item's terms). Stepped any
	// other way (keys, arrows, the strip), whatever the strip was doing is
	// moot. Either way the new item starts at fit, and the drive follows (see
	// StripDrive: its reset reaches the filmstrip through `subscribe`).
	useLayoutEffect(() => {
		swapsRef.current++
		stopView()
		viewRef.current = FIT
		geoRef.current = null
		const gesture = gestureRef.current
		const shift = shiftRef.current
		shiftRef.current = 0
		if (shift) {
			stripRef.current += shift
			if (gesture?.kind === 'step') gesture.base += shift
		} else {
			stopStrip()
			stripRef.current = 0
			if (gesture?.kind === 'step') gesture.base = -gesture.dx
		}
		if (Math.abs(stripRef.current) < 0.5 && gesture?.kind !== 'step') stripRef.current = 0
		paint()
		if (!stripRef.current && gesture?.kind !== 'step') setStepping(false)
		// A grab whose finger has already lifted: the arriving item comes on in
		else if (!gesture && !stripMotionRef.current) settleStrip(0)
	}, [shownId])
	// Panes mount a render after the strip is taken (and remount as the
	// neighbours change): they take up the strip's travel before they paint
	useLayoutEffect(() => {
		if (!stepping) return
		const tx = stripRef.current
		for (const peek of [peekRefs.prev.current, peekRefs.next.current]) {
			if (peek) peek.style.transform = tx ? `translateX(${tx}px)` : ''
		}
	})

	// Each session starts at rest, with the chrome in place
	useEffect(() => {
		if (open) {
			setDismissing(false)
			setStepping(false)
			return
		}
		stopStrip()
		stopView()
		stopPull()
		viewRef.current = FIT
		stripRef.current = 0
		pullRef.current = null
		geoRef.current = null
		gestureRef.current = null
		pointersRef.current.clear()
	}, [open])
	useEffect(
		() => () => {
			stripMotionRef.current?.stop()
			viewMotionRef.current?.motion.stop()
			pullMotionRef.current?.stop()
		},
		[],
	)

	// A zoomed picture that may no longer be zoomed (the phone's info sheet
	// rising over it) eases back to fit, the way the double-tap takes it there
	useLayoutEffect(() => {
		if (zoom.enabled) return
		const heading = viewMotionRef.current?.to
		if (isFit(viewRef.current) && !(heading && !isFit(heading))) return
		settleView(FIT, {config: TAP_ZOOM_SPRING})
	}, [zoom.enabled])

	// The stage changing size (a rotation, the inspector docking) moves the
	// fitted box under the zoom: it starts again from fit
	useEffect(() => {
		if (!surface) return
		const observer = new ResizeObserver(() => {
			if (isFit(viewRef.current) && !viewMotionRef.current) return
			stopView()
			viewRef.current = FIT
			geoRef.current = null
			setBackdrop(1)
			paint()
		})
		observer.observe(surface)
		return () => observer.disconnect()
	}, [surface])

	// The double-tap (or double-click): zoomed, back to fit; at fit, to 2.5×
	// about the point — brought to the middle for a finger, kept under the
	// pointer for a click
	// No zoom while the info sheet holds the picture up: the stage carries
	// the sheet's transform then, and the picture is a preview beside the info
	const canZoom = () => latest.current.zoom.enabled && !latest.current.onLift?.lifted?.()
	const toggleZoom = (point: Point, centre: boolean) => {
		if (!canZoom()) return
		const heading = viewMotionRef.current?.to
		stopView()
		const view = viewRef.current
		if (view.s > 1 + 1e-3 || (heading && heading.s > 1 + 1e-3)) {
			settleView(FIT, {config: TAP_ZOOM_SPRING})
			return
		}
		const geo = measure()
		if (!geo) return
		const s = Math.min(DOUBLE_TAP_ZOOM, zoomLimit(geo))
		settleView(zoomInAt(geo, view, toBox(geo, point), s, centre), {config: TAP_ZOOM_SPRING})
	}

	// A zoomed picture following the finger (or the mouse) from `from`, raw:
	// past an edge it rubber-bands — or, horizontally, with a neighbour that
	// way and the strip to show it in (touch), the travel past the edge
	// slides the strip instead
	const panTo = (raw: Point, handOff: boolean) => {
		const geo = geoRef.current
		if (!geo) return
		const view = viewRef.current
		const b = bounds(geo, view.s)
		const {canStep} = latest.current
		let x: number
		let tx = 0
		if (handOff && raw.x < b.minX && canStep(1)) {
			x = b.minX
			tx = raw.x - b.minX
		} else if (handOff && raw.x > b.maxX && canStep(-1)) {
			x = b.maxX
			tx = raw.x - b.maxX
		} else x = rubber(raw.x, b.minX, b.maxX, geo.viewport.right - geo.viewport.left)
		const y = rubber(raw.y, b.minY, b.maxY, geo.viewport.bottom - geo.viewport.top)
		if (tx && !stripRef.current) {
			paneRef.current = surfaceRef.current?.clientWidth ?? 0
			setStepping(true)
		}
		viewRef.current = {s: view.s, x, y}
		stripRef.current = tx
		paint()
	}

	// What a first finger was doing gives way to a second (a pinch), or to
	// the stage being taken away under it
	const abandon = (gesture: Gesture | null) => {
		if (gesture?.kind === 'lift') latest.current.onLift?.end(gesture.dy, 0, true)
		if (gesture?.kind === 'dismiss') setDismissing(false)
		resettle()
	}

	const startPinch = (ids: [number, number], t: number) => {
		const pointers = pointersRef.current
		const a = pointers.get(ids[0])!
		const b = pointers.get(ids[1])!
		const geo = pullRef.current || !canZoom() ? null : measure()
		if (!geo) {
			gestureRef.current = {kind: 'dead', pointerId: ids[1]}
			return
		}
		stopView()
		const view = viewRef.current
		const m = toBox(geo, {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2})
		gestureRef.current = {
			kind: 'pinch',
			ids,
			from: view,
			m0: m,
			d0: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1),
			closing: view.s <= 1 + 1e-2 && !stripRef.current,
			lifted: false,
			m,
			t,
			vs: 0,
			centre: {x: view.x + (view.s * geo.width) / 2, y: view.y + (view.s * geo.height) / 2},
			vc: {x: 0, y: 0},
		}
	}
	const movePinch = (gesture: Extract<Gesture, {kind: 'pinch'}>, t: number) => {
		const pointers = pointersRef.current
		const a = pointers.get(gesture.ids[0])
		const b = pointers.get(gesture.ids[1])
		const geo = geoRef.current
		if (!a || !b || !geo) return
		const m = toBox(geo, {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2})
		const raw = (gesture.from.s * Math.hypot(a.x - b.x, a.y - b.y)) / gesture.d0
		const s = gesture.closing && raw < 1 ? Math.max(raw, PINCH_FLOOR) : rubberScale(raw, 1, zoomLimit(geo))
		// The content point that was under the fingers stays under them, as
		// they spread and as they travel
		const p = {x: (gesture.m0.x - gesture.from.x) / gesture.from.s, y: (gesture.m0.y - gesture.from.y) / gesture.from.s}
		const view = {s, x: m.x - s * p.x, y: m.y - s * p.y}
		const dt = t - gesture.t
		if (dt > 0) {
			const centre = {x: view.x + (s * geo.width) / 2, y: view.y + (s * geo.height) / 2}
			gesture.vs = 0.7 * ((s - viewRef.current.s) / dt) + 0.3 * gesture.vs
			gesture.vc = {
				x: 0.7 * ((centre.x - gesture.centre.x) / dt) + 0.3 * gesture.vc.x,
				y: 0.7 * ((centre.y - gesture.centre.y) / dt) + 0.3 * gesture.vc.y,
			}
			gesture.centre = centre
			gesture.t = t
		}
		gesture.m = m
		if (gesture.closing && !gesture.lifted && s < 0.97) {
			gesture.lifted = true
			setDismissing(true)
			latest.current.onDismissStart()
		}
		viewRef.current = view
		if (gesture.closing) pinchBackdrop(s)
		paint()
	}
	const endPinch = (gesture: Extract<Gesture, {kind: 'pinch'}>, cancelled: boolean) => {
		const view = viewRef.current
		const geo = geoRef.current
		if (
			gesture.closing &&
			!cancelled &&
			latest.current.enabled &&
			view.s < 1 &&
			(view.s < CLOSE_BELOW || gesture.vs < CLOSE_FLICK)
		) {
			// Closed: the picture is handed over where it is, at the speed it
			// was going; the backdrop keeps what the pinch left it at and the
			// close fades it the rest of the way
			viewRef.current = FIT
			paint()
			latest.current.onDismiss({
				x: view.x,
				y: view.y,
				scale: view.s,
				velocity: {x: gesture.vc.x, y: gesture.vc.y, scale: gesture.vs},
			})
			return
		}
		if (gesture.lifted) setDismissing(false)
		if (!geo) return
		// Back inside the limits, about where the fingers last were
		const s = Math.min(Math.max(view.s, 1), zoomLimit(geo))
		settleView(clampView(geo, zoomAbout(view, gesture.m, s)))
	}

	// The axis a press picks once it has moved past LOCK
	const lock = (gesture: Extract<Gesture, {kind: 'press'}>, dx: number, dy: number) => {
		const picture = pictureRef.current
		const stage = surfaceRef.current
		const view = viewRef.current
		const base = {pointerId: gesture.pointerId, x0: gesture.x0, y0: gesture.y0}
		const horizontal = Math.abs(dx) > Math.abs(dy)
		let next: Gesture
		if (!picture || !stage) {
			next = dy < 0 && !horizontal && latest.current.onLift ? {kind: 'lift', ...base, dy: 0} : {kind: 'dead', ...base}
		} else if (view.s < 1 - 1e-3) {
			// A pinch-close springing back, caught: it carries on back
			resettle()
			next = {kind: 'dead', ...base}
		} else if (view.s > 1 + 1e-3) {
			// Zoomed, every direction pans; the strip's travel (a hand-off
			// springing back, caught) is part of where the content is
			measure()
			next = {kind: 'pan', ...base, from: {x: view.x + stripRef.current, y: view.y}, mouse: false}
		} else if (pullRef.current) {
			// A dismissal's return, caught: down carries on with it, anything
			// else lets it finish coming back
			if (!horizontal && dy > 0) next = {kind: 'dismiss', ...base, base: {x: pullRef.current.dx, y: pullRef.current.dy}}
			else {
				resettle()
				next = {kind: 'dead', ...base}
			}
		} else if (stripRef.current) {
			// The strip, caught mid-travel: sideways takes it from there
			if (horizontal) next = {kind: 'step', ...base, dx: 0, base: stripRef.current}
			else {
				resettle()
				next = {kind: 'dead', ...base}
			}
		} else if (horizontal) next = {kind: 'step', ...base, dx: 0, base: 0}
		// While the info sheet holds the picture up, down lowers it (see StageLift)
		else if (dy > 0 && !latest.current.onLift?.lifted?.()) next = {kind: 'dismiss', ...base, base: {x: 0, y: 0}}
		else next = latest.current.onLift ? {kind: 'lift', ...base, dy: 0} : {kind: 'dead', ...base}
		gestureRef.current = next
		if (next.kind === 'dead') return
		stage?.setPointerCapture(gesture.pointerId)
		if (next.kind === 'step') {
			paneRef.current = stage!.clientWidth
			setStepping(true)
		} else if (next.kind === 'dismiss' && !pullRef.current) {
			const rect = picture!.getBoundingClientRect()
			pullRef.current = {dx: 0, dy: 0, w: rect.width, h: rect.height}
			setDismissing(true)
			latest.current.onDismissStart()
		} else if (next.kind === 'dismiss') {
			setDismissing(true)
		}
	}

	const releaseTouch = (event: React.PointerEvent, cancelled: boolean) => {
		const pointers = pointersRef.current
		if (!pointers.delete(event.pointerId)) return
		const gesture = gestureRef.current
		if (!gesture) return
		if (gesture.kind === 'pinch') {
			if (!gesture.ids.includes(event.pointerId)) return
			endPinch(gesture, cancelled)
			// The finger left down does nothing more until it lifts (or is
			// joined by another, for a new pinch)
			const other = gesture.ids[0] === event.pointerId ? gesture.ids[1] : gesture.ids[0]
			gestureRef.current = pointers.has(other) ? {kind: 'dead', pointerId: other} : null
			return
		}
		if (gesture.pointerId !== event.pointerId) return
		gestureRef.current = null
		const velocity = tracker.velocity(event.timeStamp)
		const {canStep, enabled: live, onLift, onDismiss} = latest.current
		switch (gesture.kind) {
			case 'press': {
				resettle()
				if (gesture.grabbed || gesture.onButton || cancelled || event.timeStamp - gesture.t0 > TAP_MS) return
				const tap = {t: event.timeStamp, x: event.clientX, y: event.clientY}
				const last = lastTapRef.current
				if (last && tap.t - last.t < DOUBLE_TAP_MS && Math.hypot(tap.x - last.x, tap.y - last.y) < DOUBLE_TAP_SLOP) {
					lastTapRef.current = null
					toggleZoom(tap, true)
				} else lastTapRef.current = tap
				return
			}
			case 'lift':
				// The lift reports its end whatever happened, so the sheet never
				// hangs mid-drag; a close begun under it makes it a cancel
				onLift?.end(gesture.dy, velocity.y, cancelled || !live)
				return
			case 'dead':
				resettle()
				return
			case 'step': {
				// A close begun under the drag (another finger on ✕) owns the picture now
				if (!live) return
				const dir: 1 | -1 = gesture.dx < 0 ? 1 : -1
				const flick = Math.sign(velocity.x) === Math.sign(gesture.dx) && Math.abs(velocity.x) > STEP_FLICK
				if (!cancelled && canStep(dir) && (Math.abs(gesture.dx) > STEP_TRAVEL || flick)) settleStrip(velocity.x, dir)
				// The panes stay up for the ride back, and leave once it rests
				else settleStrip(cancelled ? 0 : velocity.x)
				return
			}
			case 'pan': {
				if (!live) return
				const tx = stripRef.current
				if (tx) {
					// Handed over to the strip past an edge: the step's own rules
					const dir: 1 | -1 = tx < 0 ? 1 : -1
					const flick = Math.sign(velocity.x) === Math.sign(tx) && Math.abs(velocity.x) > STEP_FLICK
					const commit = !cancelled && canStep(dir) && (Math.abs(tx) > STEP_TRAVEL || flick)
					settleStrip(velocity.x, commit ? dir : undefined)
					glideView(0, velocity.y)
				} else glideView(cancelled ? 0 : velocity.x, cancelled ? 0 : velocity.y)
				return
			}
			case 'dismiss': {
				const pull = pullRef.current
				if (!live || !pull) return
				if (!cancelled && (pull.dy > DISMISS_TRAVEL || velocity.y > DISMISS_FLICK)) {
					const {x, y, scale} = pulled(pull)
					const shrinking = pull.dy > 0 && scale > SHRINK_FLOOR
					pullRef.current = null
					paint()
					// The backdrop keeps the opacity the drag left it at; the
					// close animation fades it the rest of the way
					onDismiss({
						x,
						y,
						scale,
						velocity: {x: velocity.x, y: velocity.y, scale: shrinking ? -velocity.y * SHRINK : 0},
					})
				} else {
					setDismissing(false)
					settlePull(cancelled ? 0 : velocity.x, cancelled ? 0 : velocity.y)
				}
				return
			}
		}
	}

	const releaseMouse = (event: React.PointerEvent) => {
		const gesture = gestureRef.current
		if (gesture?.kind !== 'pan' || !gesture.mouse || gesture.pointerId !== event.pointerId) return
		gestureRef.current = null
		const velocity = tracker.velocity(event.timeStamp)
		glideView(velocity.x, velocity.y)
	}

	const handlers = {
		ref: surfaceCallback,
		onPointerDown: (event: React.PointerEvent) => {
			const target = event.target as Element
			if (event.pointerType !== 'touch') {
				// A mouse drags a zoomed picture about (its buttons stay theirs)
				if (!latest.current.zoom.enabled || event.button !== 0 || gestureRef.current) return
				if (viewRef.current.s <= 1 + 1e-3 || target.closest?.('button')) return
				grab()
				if (!measure()) return
				event.preventDefault()
				tracker.reset()
				tracker.add(event.timeStamp, event.clientX, event.clientY)
				const view = viewRef.current
				gestureRef.current = {
					kind: 'pan',
					pointerId: event.pointerId,
					x0: event.clientX,
					y0: event.clientY,
					from: {x: view.x, y: view.y},
					mouse: true,
				}
				surfaceRef.current?.setPointerCapture(event.pointerId)
				paint()
				return
			}
			if (!enabled) return
			const pointers = pointersRef.current
			if (pointers.size >= 2) return
			if (!pointers.size) {
				// A drag from a video's control strip is the browser's (scrubbing);
				// the rest of the video is stage like any other
				const video = target.closest?.('video')
				if (video && event.clientY > video.getBoundingClientRect().bottom - VIDEO_CONTROLS_PX) return
			}
			pointers.set(event.pointerId, {x: event.clientX, y: event.clientY})
			if (pointers.size === 1) {
				const grabbed = grab()
				tracker.reset()
				tracker.add(event.timeStamp, event.clientX, event.clientY)
				gestureRef.current = {
					kind: 'press',
					pointerId: event.pointerId,
					x0: event.clientX,
					y0: event.clientY,
					t0: event.timeStamp,
					grabbed,
					onButton: !!target.closest?.('button'),
				}
				return
			}
			// A second finger: a pinch, whatever the first had begun — never a
			// step that slides the picture under two fingers
			const gesture = gestureRef.current
			const first = [...pointers.keys()].find((id) => id !== event.pointerId)!
			grab()
			abandon(gesture)
			lastTapRef.current = null
			startPinch([first, event.pointerId], event.timeStamp)
		},
		onPointerMove: (event: React.PointerEvent) => {
			if (event.pointerType !== 'touch') {
				const gesture = gestureRef.current
				if (gesture?.kind !== 'pan' || !gesture.mouse || gesture.pointerId !== event.pointerId) return
				tracker.add(event.timeStamp, event.clientX, event.clientY)
				panTo({x: gesture.from.x + event.clientX - gesture.x0, y: gesture.from.y + event.clientY - gesture.y0}, false)
				return
			}
			const pointers = pointersRef.current
			if (!pointers.has(event.pointerId)) return
			pointers.set(event.pointerId, {x: event.clientX, y: event.clientY})
			let gesture = gestureRef.current
			if (!gesture) return
			if (!enabled) {
				// The stage was taken away mid-gesture (a close beginning)
				gestureRef.current = null
				pointers.clear()
				if (gesture.kind === 'lift') latest.current.onLift?.end(gesture.dy, 0, true)
				return
			}
			if (gesture.kind === 'pinch') {
				movePinch(gesture, event.timeStamp)
				return
			}
			if (gesture.pointerId !== event.pointerId || gesture.kind === 'dead') return
			tracker.add(event.timeStamp, event.clientX, event.clientY)
			const dx = event.clientX - gesture.x0
			const dy = event.clientY - gesture.y0
			if (gesture.kind === 'press') {
				if (Math.hypot(dx, dy) < LOCK) return
				lock(gesture, dx, dy)
				gesture = gestureRef.current
				if (!gesture || gesture.kind === 'dead' || gesture.kind === 'pinch') return
			}
			switch (gesture.kind) {
				case 'lift':
					// The phone info sheet's: it moves the picture and itself (see StageLift)
					gesture.dy = dy
					latest.current.onLift?.move(dy)
					return
				case 'step': {
					// The whole strip follows: the picture and the panes to its
					// sides, and the filmstrip through the drive — damped where
					// there is no neighbour to pull in
					gesture.dx = dx
					const travel = gesture.base + dx
					stripRef.current = canStep(travel < 0 ? 1 : -1) ? travel : travel * OVERDRAG
					paint()
					return
				}
				case 'dismiss': {
					const pull = pullRef.current
					if (!pull) return
					pullRef.current = {...pull, dx: gesture.base.x + dx, dy: gesture.base.y + dy}
					pullBackdrop(pullRef.current)
					paint()
					return
				}
				case 'pan':
					panTo({x: gesture.from.x + dx, y: gesture.from.y + dy}, true)
					return
			}
		},
		onPointerUp: (event: React.PointerEvent) =>
			event.pointerType === 'touch' ? releaseTouch(event, false) : releaseMouse(event),
		onPointerCancel: (event: React.PointerEvent) =>
			event.pointerType === 'touch' ? releaseTouch(event, true) : releaseMouse(event),
		onDoubleClick: (event: React.MouseEvent) => {
			// A finger's double-tap is the touch path's; a button's clicks are its own
			if (latest.current.enabled || (event.target as Element).closest?.('button')) return
			toggleZoom({x: event.clientX, y: event.clientY}, false)
		},
	}

	// The wheel (non-passive, to keep the page from zooming or scrolling):
	// with ctrl — a trackpad pinch, as Chrome and Firefox report it — or ⌘,
	// zoom about the cursor, rubber-banding past the limits until the wheel
	// goes quiet; without, a zoomed picture pans (hard against its edges: a
	// trackpad's own momentum would bounce off them forever). Desktop Safari
	// reports its trackpad pinch as gesture events instead.
	useEffect(() => {
		if (!surface) return
		const zoomTo = (raw: number, point: Point, from: View) => {
			const geo = geoRef.current
			if (!geo) return
			const s = rubberScale(raw, 1, zoomLimit(geo))
			const view = zoomAbout(from, toBox(geo, point), s)
			// Below fit (rubber-banding) it stays centred
			viewRef.current = s < 1 ? {s, x: (geo.width * (1 - s)) / 2, y: (geo.height * (1 - s)) / 2} : clampView(geo, view)
			paint()
		}
		const settleWheel = () => {
			wheelRef.current = null
			const geo = geoRef.current
			if (!geo) return
			const view = viewRef.current
			const s = Math.min(Math.max(view.s, 1), zoomLimit(geo))
			settleView(clampView(geo, zoomAbout(view, {x: geo.width / 2, y: geo.height / 2}, s)))
		}
		const onWheel = (event: WheelEvent) => {
			if (!latest.current.zoom.enabled || pointersRef.current.size || gestureRef.current) return
			const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.clientHeight : 1
			if (event.ctrlKey || event.metaKey) {
				event.preventDefault()
				stopView()
				if (!wheelRef.current && !measure()) return
				const wheel = (wheelRef.current ??= {raw: viewRef.current.s, timer: 0})
				// A mouse's notches are coarse (±100): each counts as a firm step,
				// where a trackpad's stream of small deltas zooms smoothly
				const delta = Math.max(-40, Math.min(40, event.deltaY * unit))
				wheel.raw *= Math.exp(-delta * 0.01)
				zoomTo(wheel.raw, {x: event.clientX, y: event.clientY}, viewRef.current)
				clearTimeout(wheel.timer)
				wheel.timer = window.setTimeout(settleWheel, WHEEL_SETTLE_MS)
				return
			}
			const view = viewRef.current
			if (view.s <= 1 + 1e-3) return
			event.preventDefault()
			stopView()
			const geo = measure()
			if (!geo) return
			const b = bounds(geo, view.s)
			viewRef.current = {
				s: view.s,
				x: Math.min(Math.max(view.x - event.deltaX * unit, b.minX), b.maxX),
				y: Math.min(Math.max(view.y - event.deltaY * unit, b.minY), b.maxY),
			}
			paint()
		}
		const onGestureStart = (event: Event) => {
			event.preventDefault()
			if (!latest.current.zoom.enabled || pointersRef.current.size || gestureRef.current) return
			const gesture = event as GestureEvent
			stopView()
			if (!measure()) return
			safariPinchRef.current = {from: viewRef.current, point: {x: gesture.clientX, y: gesture.clientY}}
		}
		const onGestureChange = (event: Event) => {
			event.preventDefault()
			const pinch = safariPinchRef.current
			if (!pinch) return
			zoomTo(pinch.from.s * (event as GestureEvent).scale, pinch.point, pinch.from)
		}
		const onGestureEnd = (event: Event) => {
			event.preventDefault()
			if (!safariPinchRef.current) return
			safariPinchRef.current = null
			settleWheel()
		}
		surface.addEventListener('wheel', onWheel, {passive: false})
		surface.addEventListener('gesturestart', onGestureStart)
		surface.addEventListener('gesturechange', onGestureChange)
		surface.addEventListener('gestureend', onGestureEnd)
		return () => {
			surface.removeEventListener('wheel', onWheel)
			surface.removeEventListener('gesturestart', onGestureStart)
			surface.removeEventListener('gesturechange', onGestureChange)
			surface.removeEventListener('gestureend', onGestureEnd)
			clearTimeout(wheelRef.current?.timer)
			wheelRef.current = null
		}
	}, [surface])

	// Escape (or 0) returns a zoomed picture to fit before anything else
	// hears it — the window's capture phase runs ahead of the dialog's own
	// Escape (Radix listens on the document), so the first Escape unzooms and
	// only the next one closes: even while the unzoom is still on its way,
	// or a quick Escape, Escape would never get to close. An open menu keeps
	// its Escape.
	useEffect(() => {
		if (!open) return
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Escape' && !(event.key === '0' && !event.metaKey && !event.ctrlKey && !event.altKey)) return
			const target = event.target as HTMLElement | null
			if (target?.closest?.('input, textarea, [contenteditable="true"], [role="menu"]')) return
			// A dialog over the lightbox (a confirm) keeps its Escape
			const dialog = target?.closest?.('[role="dialog"], [role="alertdialog"]')
			if (dialog && dialog !== surfaceRef.current?.closest('[role="dialog"]')) return
			const heading = viewMotionRef.current?.to
			if (heading ? isFit(heading) : isFit(viewRef.current)) return
			event.preventDefault()
			event.stopImmediatePropagation()
			settleView(FIT, {config: TAP_ZOOM_SPRING})
		}
		window.addEventListener('keydown', onKey, true)
		return () => window.removeEventListener('keydown', onKey, true)
	}, [open])

	return {
		handlers,
		backdropRef,
		zoomRef,
		dismissing,
		stepping,
		// The original, decoded and ready to lay over the 1280, once the zoom
		// has gone past what the 1280 can show (see wantSharp)
		originalUrl,
		// For a close begun while zoomed (the ✕): the zoom is
		// flattened onto the picture itself — its transform, and the stage's
		// window as its clip — and handed back for the flight home to start
		// from, so the picture leaves from exactly what was on screen.
		// Nothing when at fit.
		// The same goes for a strip or a pull still springing back, or a step
		// still on its way (which then never lands: the close is on this item):
		// the flight measures the picture at rest, so whatever is drawn is
		// handed over rather than left inline.
		flatten: (): FlightStart | undefined => {
			stopView()
			stopStrip()
			stopPull()
			shiftRef.current = 0
			const view = viewRef.current
			const geo = geoRef.current
			const tx = stripRef.current
			const pull = pullRef.current
			viewRef.current = FIT
			stripRef.current = 0
			pullRef.current = null
			paint()
			setStepping(false)
			if (pull) return pulled(pull)
			if (!isFit(view) && geo)
				return {
					x: view.x + tx,
					y: view.y,
					scale: view.s,
					clipPath: view.s > 1 ? viewportClip(geo, view, PICTURE_RADIUS) : undefined,
				}
			return tx ? {x: tx, y: 0, scale: 1} : undefined
		},
	}
}

// The original of `id`, once it is downloaded and decoded off the main
// thread — only then is it handed back to be drawn, over the 1280 that
// stays underneath, so the sharpening never flashes. Undefined for no id.
function useDecodedOriginal(id: string | undefined) {
	const url = useAuthorizedHttpUrl(id ? itemOriginalUrl(id) : undefined)
	const [decoded, setDecoded] = useState<string>()
	useEffect(() => {
		if (!url) return
		let live = true
		const image = new Image()
		image.decoding = 'async'
		image.src = url
		image.decode().then(
			() => live && setDecoded(url),
			// Undecodable after all: the 1280 is what there is
			() => {},
		)
		return () => {
			live = false
		}
	}, [url])
	return url && decoded === url ? url : undefined
}
