import {cornerInset, dragToScroll, intersect, thumbMetrics, type Axis, type Box} from './geometry'

// Scrollbars in umbrelOS take no room.
//
// A browser's own scrollbar is one of two kinds. An overlay scrollbar floats
// over the content and comes and goes with scrolling (a Mac with a trackpad,
// phones, tablets). A classic one takes a strip of its scroller for as long
// as the content overflows (Windows, Linux, a Mac with a mouse or set to
// always show scrollbars), so the content moves sideways whenever a list
// grows past its box, a document finishes loading or a search narrows its
// results. Reserving the strip up front (scrollbar-gutter) trades that for
// content that sits off centre, and styling ::-webkit-scrollbar turns every
// scrollbar into the classic kind.
//
// So wherever a mouse is around or the browser's scrollbars are classic, they
// are hidden (html[data-overlay-scrollbars], see index.css) and one thumb is
// drawn here for the scroller in use: while it scrolls, and while the pointer
// is at the edge its scrollbar lives on. The thumb floats in a layer over the
// page, so nothing can be laid out around it. Touch screens keep the overlay
// scrollbars they already have.
//
// Nothing opts in: whatever scrolls gets a thumb. `umbrel-hide-scrollbar`
// opts out, and so do the scroll areas that draw a scrollbar of their own
// (components/ui/scroll-area.tsx). `--scrollbar-top` and `--scrollbar-bottom`
// on a scroller keep its vertical thumb clear of what floats over that end.

const OPT_OUT =
	'.umbrel-hide-scrollbar, [data-scrollbar-hidden], [data-radix-scroll-area-viewport], [data-radix-select-viewport]'

// A thumb stays this long after the last scroll
const IDLE_MS = 900
// The fade in index.css (.umbrel-scrollbar)
const FADE_MS = 250
// How close to the scrollbar's edge the pointer brings the thumb up
const EDGE = 14
// The strip a thumb sits in, and what its track keeps from each end
const THICKNESS = 11
const END = 2
// How often a thumb takes its scroller's full measure again. Whether the
// scroller is still where it was is checked every frame.
const MEASURE_MS = 100

type Flags = {x: boolean; y: boolean; rtl: boolean}

type Metrics = {
	// Where the scroller was on screen when measured (the page's own scroller is always the viewport)
	rect: {left: number; top: number; width: number; height: number} | null
	// Where the strip starts across the scroll axis, where the track starts along it and how long it is
	cross: number
	start: number
	track: number
	client: number
	scroll: number
	rtl: boolean
}

type Bar = {
	scroller: HTMLElement
	axis: Axis
	el: HTMLDivElement
	metrics: Metrics | null
	measuredAt: number
	thumb: ReturnType<typeof thumbMetrics>
	painted: string
	hideTimer: number
	removeTimer: number
	// Frames its scroller has stayed put since the thumb was made. It shows from the second.
	frames: number
	leaving: boolean
	hovered: boolean
	near: boolean
	dragging: boolean
}

let layer: HTMLDivElement | null = null
let active = false
let frame = 0
let lastPointer = 0
let pointerTimer = 0
let uninstall: (() => void) | null = null

const bars = new Map<HTMLElement, Partial<Record<Axis, Bar>>>()
let flagCache = new WeakMap<Element, {at: number; flags: Flags | null}>()
let positions = new WeakMap<Element, {top: number; left: number}>()
// Scrollers that turned out to have no place for a thumb, and until when that is taken as read
let refused = new WeakMap<Element, Partial<Record<Axis, number>>>()

function* allBars() {
	for (const pair of bars.values()) {
		if (pair.y) yield pair.y
		if (pair.x) yield pair.x
	}
}

// How wide the browser's own scrollbar is where it takes room, 0 where it floats over the content
function classicScrollbarWidth() {
	const probe = document.createElement('div')
	probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll'
	document.body.append(probe)
	const width = probe.offsetWidth - probe.clientWidth
	probe.remove()
	return width
}

const isRoot = (el: Element) => el === document.scrollingElement

// The viewport scrolls by the root's overflow, or by the body's when the root leaves it unset
function viewportTakesBodyOverflow() {
	const style = getComputedStyle(document.documentElement)
	return style.overflowX === 'visible' && style.overflowY === 'visible'
}

// Which ways an element can scroll, null when neither or when it keeps no thumb.
// Asked on every scroll and pointer move, so the answer is kept for a moment.
function scrollable(el: Element): Flags | null {
	const now = performance.now()
	const cached = flagCache.get(el)
	if (cached && now - cached.at < 1000) return cached.flags
	let flags: Flags | null = null
	if (el instanceof HTMLElement && !el.matches(OPT_OUT)) {
		const root = isRoot(el)
		const propagated = viewportTakesBodyOverflow()
		if (!(el === document.body && propagated)) {
			const own = getComputedStyle(el)
			const style = root && propagated ? getComputedStyle(document.body) : own
			const can = (overflow: string) =>
				root ? overflow !== 'hidden' && overflow !== 'clip' : overflow === 'auto' || overflow === 'scroll'
			const x = can(style.overflowX)
			const y = can(style.overflowY)
			if (x || y) flags = {x, y, rtl: own.direction === 'rtl'}
		}
	}
	flagCache.set(el, {at: now, flags})
	return flags
}

const overflows = (el: Element, axis: Axis) =>
	axis === 'y' ? el.scrollHeight - el.clientHeight >= 1 : el.scrollWidth - el.clientWidth >= 1

// Where a scroller's track is on screen. Null when there is nothing to scroll
// or the edge its scrollbar lives on is out of view.
function measure(bar: Bar): Metrics | null {
	const {scroller, axis} = bar
	if (!scroller.isConnected) return null
	const flags = scrollable(scroller)
	if (!flags?.[axis]) return null
	const client = axis === 'y' ? scroller.clientHeight : scroller.clientWidth
	const scroll = axis === 'y' ? scroller.scrollHeight : scroller.scrollWidth
	if (scroll - client < 1) return null

	const style = getComputedStyle(scroller)
	if (style.visibility === 'hidden') return null
	const viewport = {left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight}
	const root = isRoot(scroller)
	// Its padding box on screen
	let box: Box
	let rect: Metrics['rect'] = null
	// A scroller drawn at another size (a window zooming open) has its borders and insets drawn at that size too
	let scaleX = 1
	let scaleY = 1
	if (root) {
		box = {left: 0, top: 0, right: scroller.clientWidth, bottom: scroller.clientHeight}
	} else {
		rect = scroller.getBoundingClientRect()
		if (scroller.offsetWidth) scaleX = rect.width / scroller.offsetWidth
		if (scroller.offsetHeight) scaleY = rect.height / scroller.offsetHeight
		const left = rect.left + scroller.clientLeft * scaleX
		const top = rect.top + scroller.clientTop * scaleY
		box = {left, top, right: left + scroller.clientWidth * scaleX, bottom: top + scroller.clientHeight * scaleY}
	}

	// What an ancestor clips of it. A fixed box answers to the viewport instead.
	let clip: Box | null = intersect(box, viewport)
	if (!root) {
		for (let el: Element = scroller; clip; ) {
			if (getComputedStyle(el).position === 'fixed') break
			const parent: Element | null = el.parentElement
			if (!parent || parent === document.documentElement) break
			const parentStyle = getComputedStyle(parent)
			const clipsX = parentStyle.overflowX !== 'visible'
			const clipsY = parentStyle.overflowY !== 'visible'
			if (clipsX || clipsY) {
				const bounds = parent.getBoundingClientRect()
				clip = intersect(clip, {
					left: clipsX ? bounds.left : -Infinity,
					right: clipsX ? bounds.right : Infinity,
					top: clipsY ? bounds.top : -Infinity,
					bottom: clipsY ? bounds.bottom : Infinity,
				})
			}
			el = parent
		}
	}
	if (!clip) return null

	const rtl = style.direction === 'rtl'
	const radius = (corner: string) => cornerInset(parseFloat(style.getPropertyValue(corner)) || 0)
	const length = (property: string) => parseFloat(style.getPropertyValue(property)) || 0
	// Where both ways scroll, the two thumbs leave each other the corner
	const corner = flags[axis === 'y' ? 'x' : 'y'] && overflows(scroller, axis === 'y' ? 'x' : 'y') ? THICKNESS : 0

	let cross: number
	let start: number
	let end: number
	if (axis === 'y') {
		const side = rtl ? 'left' : 'right'
		if (rtl ? box.left < clip.left - 0.5 : box.right > clip.right + 0.5) return null
		const top = Math.max(END, radius(`border-top-${side}-radius`)) + length('--scrollbar-top')
		const bottom = Math.max(END, radius(`border-bottom-${side}-radius`)) + length('--scrollbar-bottom')
		start = Math.max(box.top + top * scaleY, clip.top + END)
		end = Math.min(box.bottom - (bottom + corner) * scaleY, clip.bottom - END)
		cross = rtl ? box.left : box.right - THICKNESS
	} else {
		if (box.bottom > clip.bottom + 0.5) return null
		const left = Math.max(END, radius('border-bottom-left-radius')) + (rtl ? corner : 0)
		const right = Math.max(END, radius('border-bottom-right-radius')) + (rtl ? 0 : corner)
		start = Math.max(box.left + left * scaleX, clip.left + END)
		end = Math.min(box.right - right * scaleX, clip.right - END)
		cross = box.bottom - THICKNESS
	}
	// Too little of it in view to hold a thumb worth having
	if (end - start < 16) return null
	return {rect, cross, start, track: end - start, client, scroll, rtl}
}

// The thumb's length and place for where the scroller is now
function compute(bar: Bar) {
	const metrics = bar.metrics
	if (!metrics) return (bar.thumb = null)
	const {scroller, axis} = bar
	const raw = axis === 'y' ? scroller.scrollTop : scroller.scrollLeft
	// A right-to-left scroller counts down from 0 as it scrolls away from its start on the right
	const position = axis === 'x' && metrics.rtl ? raw + (metrics.scroll - metrics.client) : raw
	return (bar.thumb = thumbMetrics({track: metrics.track, client: metrics.client, scroll: metrics.scroll, position}))
}

// Whether something else is drawn over the thumb's place: a dialog opened over
// the scroller, a menu, the dock. The layer is above everything, so the thumb
// would show through whatever covers its scroller. What is found there is the
// scroller's own when it is inside it, or around it (an ancestor's fade drawn
// over its edge).
function covered(bar: Bar) {
	const {metrics, thumb, scroller} = bar
	if (!metrics || !thumb || !layer) return true
	if (isRoot(scroller)) return false
	const along = metrics.start + thumb.offset + thumb.length / 2
	const across = metrics.cross + THICKNESS / 2
	const [x, y] = bar.axis === 'y' ? [across, along] : [along, across]
	for (const el of document.elementsFromPoint(x, y)) {
		if (layer.contains(el)) continue
		return !(scroller.contains(el) || el.contains(scroller))
	}
	return false
}

function paint(bar: Bar) {
	const {metrics, thumb, el, axis} = bar
	if (!metrics || !thumb) return
	// On whole device pixels, or the thin pill blurs as it moves
	const ratio = window.devicePixelRatio || 1
	const snap = (value: number) => Math.round(value * ratio) / ratio
	const along = snap(metrics.start + thumb.offset)
	const across = snap(metrics.cross)
	const length = snap(thumb.length)
	const painted = `${along},${across},${length}`
	if (painted === bar.painted) return
	bar.painted = painted
	if (axis === 'y') {
		el.style.transform = `translate3d(${across}px, ${along}px, 0)`
		el.style.height = `${length}px`
	} else {
		el.style.transform = `translate3d(${along}px, ${across}px, 0)`
		el.style.width = `${length}px`
	}
}

// Straight there, whatever smooth scrolling the scroller has of its own. A
// browser that doesn't know `instant` refuses the whole call, and gets the plain one.
function jump(scroller: HTMLElement, to: {top?: number; left?: number}) {
	try {
		scroller.scrollTo({...to, behavior: 'instant'})
	} catch {
		scroller.scrollTo(to)
	}
}

function create(scroller: HTMLElement, axis: Axis): Bar {
	const el = document.createElement('div')
	el.className = 'umbrel-scrollbar'
	el.dataset.axis = axis
	el.dataset.state = 'hidden'
	const thumb = document.createElement('div')
	thumb.className = 'umbrel-scrollbar-thumb'
	el.append(thumb)

	const bar: Bar = {
		scroller,
		axis,
		el,
		metrics: null,
		measuredAt: 0,
		thumb: null,
		painted: '',
		hideTimer: 0,
		removeTimer: 0,
		frames: 0,
		leaving: false,
		hovered: false,
		near: false,
		dragging: false,
	}

	// The thumb is outside every dialog, popover and menu, so to them a press on
	// it is a press outside, which closes them. It never gets that far.
	const stop = (event: Event) => event.stopPropagation()
	for (const type of ['mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend']) {
		el.addEventListener(type, stop, {passive: true})
	}

	el.addEventListener('pointerenter', () => {
		bar.hovered = true
		rest(bar)
	})
	el.addEventListener('pointerleave', () => {
		bar.hovered = false
		rest(bar)
	})

	el.addEventListener('pointerdown', (event) => {
		event.stopPropagation()
		if (event.button !== 0) return
		// Keeps the focus where it is and the page's text unselected
		event.preventDefault()
		const from = axis === 'y' ? event.clientY : event.clientX
		const scrolled = axis === 'y' ? scroller.scrollTop : scroller.scrollLeft
		el.setPointerCapture(event.pointerId)
		bar.dragging = true
		el.dataset.dragging = ''
		rest(bar)

		const move = (event: PointerEvent) => {
			const {metrics, thumb} = bar
			if (!metrics || !thumb) return
			const delta = (axis === 'y' ? event.clientY : event.clientX) - from
			const by = dragToScroll({delta, travel: thumb.travel, client: metrics.client, scroll: metrics.scroll})
			jump(scroller, axis === 'y' ? {top: scrolled + by} : {left: scrolled + by})
		}
		const end = () => {
			el.removeEventListener('pointermove', move)
			el.removeEventListener('pointerup', end)
			el.removeEventListener('pointercancel', end)
			bar.dragging = false
			delete el.dataset.dragging
			rest(bar)
		}
		el.addEventListener('pointermove', move)
		el.addEventListener('pointerup', end)
		el.addEventListener('pointercancel', end)
	})

	// The wheel over the thumb scrolls what the thumb belongs to
	el.addEventListener(
		'wheel',
		(event) => {
			const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight : 1
			jump(scroller, {left: scroller.scrollLeft + event.deltaX * unit, top: scroller.scrollTop + event.deltaY * unit})
		},
		{passive: true},
	)

	const pair = bars.get(scroller) ?? {}
	pair[axis] = bar
	bars.set(scroller, pair)
	layer?.append(el)
	if (!frame) frame = requestAnimationFrame(watch)
	return bar
}

function destroy(bar: Bar) {
	window.clearTimeout(bar.hideTimer)
	window.clearTimeout(bar.removeTimer)
	bar.el.remove()
	const pair = bars.get(bar.scroller)
	if (pair?.[bar.axis] === bar) {
		delete pair[bar.axis]
		if (!pair.x && !pair.y) bars.delete(bar.scroller)
	}
	if (bars.size === 0 && frame) {
		cancelAnimationFrame(frame)
		frame = 0
	}
}

// Fades an idle thumb out and takes it away
function dismiss(bar: Bar) {
	window.clearTimeout(bar.hideTimer)
	if (bar.leaving) return
	bar.leaving = true
	bar.el.dataset.state = 'hidden'
	bar.removeTimer = window.setTimeout(() => destroy(bar), FADE_MS)
}

// Takes a thumb away at once: it no longer belongs where it is (its scroller
// moved, went, stopped overflowing or is under something), and a thumb fading
// in the wrong place is worse than one that is gone. The scroller isn't asked
// again for a moment, so it doesn't flash a thumb on every scroll event meanwhile.
function drop(bar: Bar, wait = 250) {
	refused.set(bar.scroller, {...refused.get(bar.scroller), [bar.axis]: performance.now() + wait})
	destroy(bar)
}

// Starts the wait after which an idle thumb goes, unless something is holding it
function rest(bar: Bar) {
	window.clearTimeout(bar.hideTimer)
	if (bar.leaving || bar.hovered || bar.near || bar.dragging) return
	bar.hideTimer = window.setTimeout(() => dismiss(bar), IDLE_MS)
}

// Takes the scroller's measure and puts the thumb there. False when there is no place for one.
function refresh(bar: Bar) {
	bar.metrics = measure(bar)
	bar.measuredAt = performance.now()
	if (!compute(bar) || covered(bar)) {
		drop(bar)
		return false
	}
	paint(bar)
	return true
}

// Brings up a scroller's thumb, or moves the one it has to where the scroller is now
function show(scroller: HTMLElement, axis: Axis): Bar | null {
	const now = performance.now()
	let bar = bars.get(scroller)?.[axis]
	if (!bar) {
		if (now < (refused.get(scroller)?.[axis] ?? 0) || !overflows(scroller, axis)) return null
		bar = create(scroller, axis)
	}
	if (!bar.metrics || now - bar.measuredAt >= MEASURE_MS) {
		if (!refresh(bar)) return null
	} else if (compute(bar)) {
		paint(bar)
	} else {
		drop(bar)
		return null
	}
	if (bar.leaving) {
		window.clearTimeout(bar.removeTimer)
		bar.leaving = false
	}
	if (bar.frames >= 2) bar.el.dataset.state = 'visible'
	rest(bar)
	return bar
}

// Every frame a thumb is around, it checks on its scroller: gone with it,
// gone the moment it moves (a window opening or closing, a panel sliding),
// resized with it, and now and then measured in full, which also finds it
// covered. A new thumb is held back until its scroller has stayed put from
// one frame to the next, so nothing in motion ever shows one.
function watch() {
	frame = 0
	const now = performance.now()
	for (const bar of [...allBars()]) {
		const {scroller, metrics} = bar
		if (!scroller.isConnected) {
			destroy(bar)
			continue
		}
		if (metrics?.rect && !bar.dragging) {
			const rect = scroller.getBoundingClientRect()
			if (Math.abs(rect.left - metrics.rect.left) > 1 || Math.abs(rect.top - metrics.rect.top) > 1) {
				drop(bar)
				continue
			}
			const resized = Math.abs(rect.width - metrics.rect.width) > 1 || Math.abs(rect.height - metrics.rect.height) > 1
			if (resized && !refresh(bar)) continue
		}
		if (bar.leaving) continue
		if (bar.frames < 2) {
			if (++bar.frames === 2) bar.el.dataset.state = 'visible'
			continue
		}
		if (now - bar.measuredAt >= MEASURE_MS) refresh(bar)
	}
	if (bars.size) frame = requestAnimationFrame(watch)
}

function onScroll(event: Event) {
	const target = event.target
	const scroller = target === document ? document.scrollingElement : target
	if (!(scroller instanceof HTMLElement)) return
	// What scrolls inside this one has moved on screen, and its thumb is no longer where it belongs
	if (bars.size) {
		for (const bar of [...allBars()]) {
			if (bar.scroller !== scroller && scroller.contains(bar.scroller)) drop(bar, 0)
		}
	}
	const flags = scrollable(scroller)
	if (!flags) return
	const top = scroller.scrollTop
	const left = scroller.scrollLeft
	const last = positions.get(scroller)
	positions.set(scroller, {top, left})
	// The thumb of the way it moved. Seen for the first time, that is taken to be down.
	const y = flags.y && (last ? last.top !== top : true)
	const x = flags.x && (last ? last.left !== left : !flags.y || !overflows(scroller, 'y'))
	if (y) show(scroller, 'y')
	if (x) show(scroller, 'x')
}

// The pointer at the edge a scrollbar lives on brings its thumb up, so it can
// be grabbed without scrolling first
function onPointerMove(event: PointerEvent) {
	if (event.pointerType === 'touch' || event.buttons !== 0) return
	// A few times a second is plenty, as long as the place the pointer comes to rest is looked at too
	window.clearTimeout(pointerTimer)
	const now = performance.now()
	if (now - lastPointer < 50) {
		pointerTimer = window.setTimeout(() => onPointerMove(event), 50)
		return
	}
	lastPointer = now
	const target = event.target
	if (!(target instanceof Element) || layer?.contains(target)) return
	const {clientX, clientY} = event

	const near = new Set<Bar>()
	const found = {x: false, y: false}
	// The scrollers around an element whose scrollbar edge the pointer is at
	const seek = (from: Element | null, axes: Axis[]) => {
		for (let el = from; el && axes.some((axis) => !found[axis]); el = el.parentElement) {
			const flags = scrollable(el)
			if (!flags || !(el instanceof HTMLElement)) continue
			// So the first scroll here knows which way it went
			if (!positions.has(el)) positions.set(el, {top: el.scrollTop, left: el.scrollLeft})
			const rect = isRoot(el)
				? {left: 0, top: 0, right: el.clientWidth, bottom: el.clientHeight}
				: el.getBoundingClientRect()
			if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue
			for (const axis of axes) {
				if (found[axis] || !flags[axis] || !overflows(el, axis)) continue
				const fromEdge = axis === 'x' ? rect.bottom - clientY : flags.rtl ? clientX - rect.left : rect.right - clientX
				if (fromEdge > EDGE) continue
				found[axis] = true
				const bar = show(el, axis)
				if (bar) near.add(bar)
			}
		}
	}
	seek(target, ['x', 'y'])
	// A scrollbar can live in a margin its scroller's content never reaches (the
	// Files listing's), where the pointer is over something else: look just
	// inside from the pointer too
	if (!found.y) seek(document.elementFromPoint(clientX - EDGE, clientY), ['y'])
	if (!found.x) seek(document.elementFromPoint(clientX, clientY - EDGE), ['x'])
	setNear(near)
}

function setNear(near: Set<Bar>) {
	for (const bar of allBars()) {
		const was = bar.near
		bar.near = near.has(bar)
		if (was !== bar.near) rest(bar)
	}
}

const onPointerGone = () => setNear(new Set())

// A full screen element is drawn over everything outside it, the layer
// included, so the layer moves inside one that can hold it (the whole page
// going full screen needs nothing)
function onFullscreenChange() {
	if (!layer) return
	const element = document.fullscreenElement
	const holds =
		element instanceof HTMLElement &&
		element !== document.documentElement &&
		!/^(VIDEO|CANVAS|IFRAME|IMG)$/.test(element.tagName)
	;(holds ? element : document.body).append(layer)
}

function setActive(next: boolean) {
	if (next === active) return
	active = next
	if (active) {
		layer = document.createElement('div')
		layer.className = 'umbrel-scrollbars'
		layer.setAttribute('aria-hidden', 'true')
		document.body.append(layer)
		document.documentElement.setAttribute('data-overlay-scrollbars', '')
		document.addEventListener('scroll', onScroll, {capture: true, passive: true})
		document.addEventListener('pointermove', onPointerMove, {capture: true, passive: true})
		document.documentElement.addEventListener('pointerleave', onPointerGone)
		window.addEventListener('blur', onPointerGone)
		document.addEventListener('fullscreenchange', onFullscreenChange)
		onFullscreenChange()
	} else {
		document.removeEventListener('scroll', onScroll, {capture: true})
		document.removeEventListener('pointermove', onPointerMove, {capture: true})
		document.documentElement.removeEventListener('pointerleave', onPointerGone)
		window.removeEventListener('blur', onPointerGone)
		document.removeEventListener('fullscreenchange', onFullscreenChange)
		window.clearTimeout(pointerTimer)
		for (const bar of [...allBars()]) destroy(bar)
		document.documentElement.removeAttribute('data-overlay-scrollbars')
		layer?.remove()
		layer = null
		flagCache = new WeakMap()
		positions = new WeakMap()
		refused = new WeakMap()
	}
}

// Call once at startup. Returns what undoes it.
export function installOverlayScrollbars() {
	if (uninstall) return uninstall
	// Measured before anything is hidden. A browser whose scrollbars take room
	// gets ours whatever it is pointed with; one whose scrollbars float gets
	// ours once a mouse or trackpad is there to grab them with.
	const classic = classicScrollbarWidth() > 0
	const fine = window.matchMedia('(any-pointer: fine)')
	const sync = () => setActive(classic || fine.matches)
	fine.addEventListener('change', sync)
	sync()
	uninstall = () => {
		fine.removeEventListener('change', sync)
		setActive(false)
		uninstall = null
	}
	return uninstall
}
