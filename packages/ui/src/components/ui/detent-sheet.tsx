import {
	animate,
	AnimatePresence,
	motion,
	useMotionValue,
	usePresence,
	useReducedMotion,
	useTransform,
	type AnimationPlaybackControls,
} from 'motion/react'
import {useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {useTranslation} from 'react-i18next'

import {cn} from '@/lib/utils'

// A sheet that rises from the foot of the box it is placed in and rests at
// detents — the heights it settles to, as an iOS sheet does — over what is
// behind it, which stays in use: it isn't modal, and it lives in its box
// rather than in a portal over the page (vaul's Drawer is a Radix dialog,
// measures its snap points against the window and leaves the foot of its
// content off screen at the lower ones, so it can't be this).
//
// It moves by its grabber, by anything in it that doesn't scroll, and by its
// content: below the top detent a vertical drag anywhere moves the sheet,
// and at the top one the content scrolls — until it is back at its start,
// when a drag down takes the sheet with it. A flick goes one detent its way;
// a slower release goes where it was heading; down past the lowest, it goes
// away. Sideways drags are left alone.
//
// What shows is laid out at the detent's height, so the content's foot is on
// screen at every detent: a scroller in it runs to the box's foot, under
// whatever floats there (the dock), and pads its own end to clear it. While
// it moves it is laid out the box's full height and only translated. The
// box is its parent, which should be positioned and clip what overflows it.

// A detent: a fraction of the box's height, or all the room there is
export type Detent = number | 'full'

// As far as a drag moves before it is taken to be one, and which way
const SLOP = 4
// A release this fast (px/s) is a flick: one detent its way
const FLICK = 500
// How far a slower release is carried on, in seconds of its speed
const PROJECTION = 0.15
// Let go below this much of the lowest detent, it goes away
const DISMISS_AT = 0.7
// A click this soon after a drag lets go is the drag's
const CLICK_AFTER_DRAG_MS = 400
// The speeds that count are the last moment's; a finger still this long
// before it lifts had come to rest
const VELOCITY_WINDOW_MS = 100
const REST_MS = 80
// The sheet's own spring: quick, with the least settle
const SPRING = {type: 'spring', visualDuration: 0.4, bounce: 0.12} as const

export function DetentSheet({open, ...props}: {open: boolean} & PanelProps) {
	return <AnimatePresence>{open && <Panel key='sheet' {...props} />}</AnimatePresence>
}

type PanelProps = {
	// Asked to close (swiped away); the sheet goes as `open` turns false
	onOpenChange: (open: boolean) => void
	// Smallest first. It opens at `defaultDetent`
	detents: readonly Detent[]
	defaultDetent?: number
	// Set, the detent is the caller's: a change moves the sheet to it
	detent?: number
	onDetentChange?: (index: number) => void
	// What 'full' leaves clear above it, from the box's top
	topInset?: number
	dismissible?: boolean
	className?: string
	children: ReactNode
	'aria-label'?: string
}

function Panel({
	onOpenChange,
	detents,
	defaultDetent = 0,
	detent: detentProp,
	onDetentChange,
	topInset = 0,
	dismissible = true,
	className,
	children,
	'aria-label': ariaLabel,
}: PanelProps) {
	const {t} = useTranslation()
	const reduceMotion = useReducedMotion() ?? false
	const [isPresent, safeToRemove] = usePresence()
	const ref = useRef<HTMLElement>(null)

	// How much of the sheet shows above the box's foot, and how tall it is
	// laid out: what shows, at rest; the whole box while it moves (and any
	// overshoot past that)
	const shown = useMotionValue(0)
	const laid = useMotionValue(0)
	const height = useTransform(() => Math.max(laid.get(), shown.get()))
	const y = useTransform(() => height.get() - shown.get())

	const [box, setBox] = useState(0)
	useLayoutEffect(() => {
		const parent = ref.current?.parentElement
		if (!parent) return
		const measure = () => setBox(parent.clientHeight)
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(parent)
		return () => observer.disconnect()
	}, [])
	const stops = useMemo(() => detentHeights(detents, box, topInset), [detents, box, topInset])
	const [index, setIndex] = useState(detentProp ?? defaultDetent)

	// The gesture and the motion, which live between renders
	const live = useRef({
		animation: undefined as AnimationPlaybackControls | undefined,
		// Where it is going: a detent, or away
		target: undefined as number | 'away' | undefined,
		drag: undefined as {from: number; base: number; samples: Sample[]} | undefined,
		// Until when the click a drag ends in is swallowed: it wasn't one
		swallowClickUntil: 0,
		arrived: false,
	}).current
	// What the handlers read, as of the last render
	const latest = useRef({
		stops,
		box,
		index,
		reduceMotion,
		dismissible,
		isPresent,
		safeToRemove,
		onOpenChange,
		onDetentChange,
	})
	latest.current = {stops, box, index, reduceMotion, dismissible, isPresent, safeToRemove, onOpenChange, onDetentChange}

	// The one way it moves on its own: to a height, from wherever it is, as
	// fast as it was going
	const run = (goal: number, velocity: number, done: () => void) => {
		live.animation?.stop()
		const {box, reduceMotion} = latest.current
		if (reduceMotion) {
			live.animation = undefined
			shown.set(goal)
			return done()
		}
		laid.set(Math.max(box, laid.get()))
		live.animation = animate(shown, goal, {
			...SPRING,
			velocity,
			onComplete: () => {
				live.animation = undefined
				done()
			},
		})
	}
	const settle = (to: number | 'away', velocity = 0) => {
		const {stops, index, onOpenChange, onDetentChange} = latest.current
		live.target = to
		if (to === 'away') {
			onOpenChange(false)
			return run(0, velocity, () => {
				if (!latest.current.isPresent) return latest.current.safeToRemove?.()
				// Not closed yet: it is, by the time this runs — or it was kept
				// open after all, and comes back up
				setTimeout(() => {
					if (latest.current.isPresent && live.target === 'away') settle(0)
				})
			})
		}
		if (to !== index) {
			setIndex(to)
			onDetentChange?.(to)
		}
		const goal = stops[to] ?? 0
		run(goal, velocity, () => laid.set(goal))
	}

	// In, once it knows its box; then kept at its detent as the box changes
	// (by value: a caller's detents needn't be one array from render to render)
	const stopsKey = stops.join(' ')
	useLayoutEffect(() => {
		if (box === 0 || live.drag || live.target === 'away') return
		if (!live.arrived) {
			live.arrived = true
			return settle(index)
		}
		if (live.animation) return settle(index, shown.getVelocity())
		shown.set(stops[index] ?? 0)
		laid.set(stops[index] ?? 0)
	}, [stopsKey])
	useEffect(() => {
		if (detentProp !== undefined && detentProp !== latest.current.index) settle(detentProp)
	}, [detentProp])
	// Out, the way it would be swiped (unless it already is), and back if it
	// is opened again on its way
	useEffect(() => {
		if (isPresent) {
			if (live.target === 'away') settle(latest.current.index)
			return
		}
		if (live.target === 'away') {
			if (!live.animation) safeToRemove?.()
			return
		}
		live.target = 'away'
		live.drag = undefined
		run(0, shown.getVelocity(), () => latest.current.safeToRemove?.())
	}, [isPresent])

	const begin = (clientY: number, time: number) => {
		live.animation?.stop()
		live.animation = undefined
		laid.set(Math.max(latest.current.box, laid.get()))
		live.drag = {from: clientY, base: shown.get(), samples: [{time, at: shown.get()}]}
	}
	const move = (clientY: number, time: number) => {
		const drag = live.drag
		if (!drag) return
		const at = drag.base + drag.from - clientY
		const {stops, box, dismissible} = latest.current
		shown.set(resisted(at, stops, box, dismissible))
		const recent = drag.samples.filter((sample) => sample.time > time - VELOCITY_WINDOW_MS)
		drag.samples = [...(recent.length > 0 ? recent : drag.samples.slice(-1)), {time, at}]
	}
	const end = (time: number) => {
		const drag = live.drag
		if (!drag) return
		live.drag = undefined
		live.swallowClickUntil = performance.now() + CLICK_AFTER_DRAG_MS
		const velocity = releaseVelocity(drag.samples, time)
		const {stops, dismissible} = latest.current
		const to = settleTarget({position: shown.get(), velocity, stops, dismissible})
		settle(to === 'dismiss' ? 'away' : to, velocity)
	}
	// Whether a vertical drag (down, for a positive dy) is the sheet's, not
	// the content's: a sheet on its way somewhere is caught; below its top
	// detent the sheet moves; at it, the content scrolls — unless it is at
	// its start and the drag is down
	const sheetTakes = (scroller: HTMLElement | undefined, dy: number) => {
		if (live.animation) return true
		const top = latest.current.stops.at(-1) ?? 0
		if (shown.get() < top - 1 || !scroller) return true
		return dy > 0 && scroller.scrollTop <= 0
	}

	// Touch, from anywhere in the sheet: a touch that moves is either the
	// sheet's or the browser's, which the first move decides. A mouse or pen
	// moves it by what doesn't scroll (a drag over the content is the
	// content's: a marquee, say), followed past the sheet's edge. Native
	// listeners, since only a non-passive one can keep the browser from
	// scrolling (React's are passive). Each drag tracks from where it was
	// pressed, so the sheet stays under the finger
	const handlers = useRef({begin, move, end, sheetTakes})
	handlers.current = {begin, move, end, sheetTakes}
	useEffect(() => {
		const sheet = ref.current
		if (!sheet) return
		let touch: {id: number; x: number; y: number; scroller?: HTMLElement; mode?: 'sheet' | 'content'} | undefined
		const find = (event: TouchEvent) =>
			touch && Array.from(event.changedTouches).find((point) => point.identifier === touch!.id)
		const onTouchStart = (event: TouchEvent) => {
			// A second finger is a pinch, not a drag
			if (event.touches.length !== 1 || live.target === 'away') {
				if (touch?.mode === 'sheet') handlers.current.end(event.timeStamp)
				touch = undefined
				return
			}
			const point = event.touches[0]!
			touch = {id: point.identifier, x: point.clientX, y: point.clientY, scroller: scrollerAt(event.target, sheet)}
		}
		const onTouchMove = (event: TouchEvent) => {
			const point = find(event)
			if (!touch || !point) return
			if (!touch.mode) {
				const [dx, dy] = [point.clientX - touch.x, point.clientY - touch.y]
				if (Math.hypot(dx, dy) < SLOP) return
				const vertical = Math.abs(dy) > Math.abs(dx)
				touch.mode =
					event.cancelable && vertical && handlers.current.sheetTakes(touch.scroller, dy) ? 'sheet' : 'content'
				if (touch.mode === 'sheet') handlers.current.begin(touch.y, event.timeStamp)
			}
			if (touch.mode !== 'sheet') return
			event.preventDefault()
			handlers.current.move(point.clientY, event.timeStamp)
		}
		const onTouchEnd = (event: TouchEvent) => {
			if (!find(event)) return
			if (touch?.mode === 'sheet') handlers.current.end(event.timeStamp)
			touch = undefined
		}

		let releasePress: (() => void) | undefined
		const onPointerDown = (event: PointerEvent) => {
			if (event.pointerType === 'touch' || event.button !== 0 || live.target === 'away') return
			if (scrollerAt(event.target, sheet)) return
			const press = {id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false}
			const onMove = (event: PointerEvent) => {
				if (event.pointerId !== press.id) return
				if (!press.dragging) {
					const [dx, dy] = [event.clientX - press.x, event.clientY - press.y]
					if (Math.hypot(dx, dy) < SLOP) return
					if (Math.abs(dx) > Math.abs(dy)) return release()
					press.dragging = true
					handlers.current.begin(press.y, event.timeStamp)
				}
				handlers.current.move(event.clientY, event.timeStamp)
			}
			const onUp = (event: PointerEvent) => {
				if (event.pointerId !== press.id) return
				if (press.dragging) handlers.current.end(event.timeStamp)
				release()
			}
			const release = () => {
				releasePress = undefined
				window.removeEventListener('pointermove', onMove)
				window.removeEventListener('pointerup', onUp)
				window.removeEventListener('pointercancel', onUp)
			}
			window.addEventListener('pointermove', onMove)
			window.addEventListener('pointerup', onUp)
			window.addEventListener('pointercancel', onUp)
			releasePress = release
		}

		// Wherever the drag let go — a fresh press clicks as it should
		const onAnyPress = () => (live.swallowClickUntil = 0)
		const onAnyClick = (event: MouseEvent) => {
			if (performance.now() > live.swallowClickUntil) return
			live.swallowClickUntil = 0
			event.preventDefault()
			event.stopPropagation()
		}

		sheet.addEventListener('touchstart', onTouchStart, {passive: true})
		sheet.addEventListener('touchmove', onTouchMove, {passive: false})
		sheet.addEventListener('touchend', onTouchEnd)
		sheet.addEventListener('touchcancel', onTouchEnd)
		sheet.addEventListener('pointerdown', onPointerDown)
		window.addEventListener('pointerdown', onAnyPress, {capture: true})
		window.addEventListener('click', onAnyClick, {capture: true})
		return () => {
			releasePress?.()
			sheet.removeEventListener('touchstart', onTouchStart)
			sheet.removeEventListener('touchmove', onTouchMove)
			sheet.removeEventListener('touchend', onTouchEnd)
			sheet.removeEventListener('touchcancel', onTouchEnd)
			sheet.removeEventListener('pointerdown', onPointerDown)
			window.removeEventListener('pointerdown', onAnyPress, {capture: true})
			window.removeEventListener('click', onAnyClick, {capture: true})
		}
	}, [])

	const last = stops.length - 1
	return (
		<motion.section
			ref={ref}
			aria-label={ariaLabel}
			className={cn('absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-[22px]', className)}
			style={{height, y}}
		>
			{/* The grabber: a drag, or a press that steps through the detents
			    (the arrows step up and down them) */}
			{last > 0 ? (
				<button
					type='button'
					aria-label={t(index < last ? 'detent-sheet.expand' : 'detent-sheet.collapse')}
					className='group flex h-5 w-full shrink-0 cursor-grab touch-none items-end justify-center outline-hidden active:cursor-grabbing'
					onClick={() => settle(index < last ? index + 1 : 0)}
					onKeyDown={(event) => {
						const by = {ArrowUp: 1, ArrowDown: -1}[event.key]
						if (by === undefined) return
						event.preventDefault()
						settle(Math.min(last, Math.max(0, index + by)))
					}}
				>
					<span className='h-1 w-9 rounded-full bg-white/25 transition-colors group-hover:bg-white/40 group-focus-visible:bg-white/60 group-focus-visible:ring-2 group-focus-visible:ring-white/30' />
				</button>
			) : (
				<div aria-hidden className='flex h-5 shrink-0 items-end justify-center'>
					<span className='h-1 w-9 rounded-full bg-white/25' />
				</div>
			)}
			<div className='flex min-h-0 flex-1 flex-col'>{children}</div>
		</motion.section>
	)
}

// The nearest scroller with somewhere to scroll, between a target and the sheet
function scrollerAt(target: EventTarget | null, sheet: Element) {
	for (let element = target instanceof Element ? target : null; element && element !== sheet; ) {
		if (element instanceof HTMLElement && element.scrollHeight > element.clientHeight + 1) {
			const {overflowY} = getComputedStyle(element)
			if (overflowY === 'auto' || overflowY === 'scroll') return element
		}
		element = element.parentElement
	}
	return undefined
}

type Sample = {time: number; at: number}

// The detents' heights in px, as given: each a fraction of the box (or all
// of it), never past the room 'full' has
export function detentHeights(detents: readonly Detent[], box: number, topInset: number) {
	const room = Math.max(0, box - topInset)
	return detents.map((detent) => (detent === 'full' ? room : Math.min(room, Math.round(detent * box))))
}

// Past the top detent (or below the lowest, when it can't be swiped away) a
// drag meets more and more resistance, as a scroll view's edge does — never
// further than `room` past it
export function rubberBand(overshoot: number, room: number) {
	if (room <= 0) return 0
	return (1 - 1 / ((overshoot * 0.55) / room + 1)) * room
}

export function resisted(at: number, stops: readonly number[], box: number, dismissible: boolean) {
	const [lowest = 0, top = 0] = [stops[0], stops.at(-1)]
	if (at > top) return top + rubberBand(at - top, Math.max(0, box - top))
	if (at < lowest && !dismissible) return lowest - rubberBand(lowest - at, lowest)
	return Math.max(0, at)
}

// The speed at release, in px/s (up is positive), over the drag's last
// moment — at least its last two moves, however far apart a slow device
// sends them; a finger that came to rest before letting go has none
export function releaseVelocity(samples: readonly Sample[], time: number) {
	const last = samples.at(-1)
	if (!last || time - last.time > REST_MS) return 0
	const recent = samples.filter((sample) => sample.time >= last.time - VELOCITY_WINDOW_MS)
	const first = recent.length > 1 ? recent[0] : samples.at(-2)
	if (!first || last.time - first.time < 1) return 0
	return ((last.at - first.at) / (last.time - first.time)) * 1000
}

// Where a release goes: a flick, to the next detent its way (or away, down
// past the lowest); a slower release, to the detent nearest where it was
// heading — away, if that is well below the lowest
export function settleTarget({
	position,
	velocity,
	stops,
	dismissible,
}: {
	position: number
	velocity: number
	stops: readonly number[]
	dismissible: boolean
}): number | 'dismiss' {
	const last = stops.length - 1
	if (velocity >= FLICK) {
		const above = stops.findIndex((stop) => stop > position + 1)
		return above === -1 ? last : above
	}
	if (velocity <= -FLICK) {
		const below = stops.findLastIndex((stop) => stop < position - 1)
		return below !== -1 ? below : dismissible ? 'dismiss' : 0
	}
	const projected = position + velocity * PROJECTION
	if (dismissible && projected < (stops[0] ?? 0) * DISMISS_AT) return 'dismiss'
	let nearest = 0
	for (let index = 1; index <= last; index++) {
		if (Math.abs(stops[index]! - projected) < Math.abs(stops[nearest]! - projected)) nearest = index
	}
	return nearest
}
