import {useReducedMotion} from 'motion/react'
import {useCallback, useEffect, useRef} from 'react'

import {
	monthStartUtc,
	scrollForMonth,
	scrollForTime,
	spansMonth,
	type MonthKey,
	type ScrollWindow,
} from '@/features/photos/components/listing/time-rail/rail-scale'
import type {Arrival, Seek} from '@/features/photos/components/listing/time-rail/use-seek'
import type {Layout} from '@/features/photos/components/listing/timeline-rows'

// Landings: an eased scroll nearby; across anything longer than this many
// viewports, a fade-through teleport — tweening 100k px is a smear, not motion
const TWEEN_MAX_VIEWPORTS = 12
// How long a landing waits for the grid to take up the list it was handed
const ADOPT_MS = 2000
// A scrub over months the list doesn't hold asks for one only once it has
// stayed on it this long — a pause, or the slow last stretch of a drag.
// Every month the pointer merely crosses would otherwise cost a request,
// and on a slow link their answers would arrive ahead of the one that is
// wanted.
const SCRUB_REST_MS = 100

export type CommittedView = {layout: Layout; height: number}
export type ElementRef<T> = {readonly current: T | null}

// A list on its way to the screen and where it should be scrolled to when it
// gets there: `first` is its first item, which is how the grid knows the
// list, and `top` the scrollTop for the layout the grid gives it. The grid
// takes it up in the commit that adopts the list (see TimelineGrid), so the
// list and its place arrive in one paint.
export type Landing = {first: string | undefined; top: (view: CommittedView) => number | undefined}

// Travelling to a month: what the desktop rail and the phone's scrubber both
// do once they know where the user wants to be. A month the list on screen
// holds is a scroll away — tweened nearby, faded through across a long way;
// one beyond it is a seek (see use-seek.ts), which puts the month's own
// stretch of the timeline on screen with the grid landed on it. A jump
// fades through to that; a scrub is followed there as its photographs
// arrive, the way it is followed through what is already loaded. The user's
// own scroll or press while a jump's seek is awaited means "never mind".
export function useLanding({
	scrollerRef,
	contentRef,
	viewRef,
	landingRef,
	inset,
	endSpacer,
	seek,
	resolve = scrollForMonth,
}: {
	scrollerRef: ElementRef<HTMLDivElement>
	contentRef: ElementRef<HTMLDivElement>
	viewRef: ElementRef<CommittedView>
	landingRef: {current: Landing | null}
	inset: number
	endSpacer: number
	seek: Seek
	// The scrollTop that shows a month the list holds (scrollForMonth unless
	// the caller has its own idea of where a month sits)
	resolve?: (layout: Layout, key: MonthKey, fraction: number, window: ScrollWindow) => number | undefined
}) {
	const reduceMotion = useReducedMotion() ?? false
	const pollRaf = useRef(0)
	const tweenRef = useRef<{stop: () => void} | null>(null)
	const timersRef = useRef<number[]>([])
	// The month a scrub beyond the list is resting on, and the timer that asks for it
	const rest = useRef<{key: MonthKey; timer: number} | null>(null)
	const mounted = useRef(true)
	// The fade-through under way: a later one takes the grid over while it is
	// out, and the earlier one leaves bringing it back to that
	const fade = useRef(0)

	const scrollWindow = useCallback(
		(view: CommittedView): ScrollWindow => ({inset, viewport: view.height, trailing: endSpacer}),
		[inset, endSpacer],
	)

	// Where a month is in the list on screen: the scrollTop that shows it — or
	// its neighbour, when the list runs through where it would be and holds
	// none of it. Undefined when the month is beyond what the list holds, and
	// going there is a seek.
	const locate = useCallback(
		(view: CommittedView, key: MonthKey, fraction: number) => {
			const where = scrollWindow(view)
			const target = resolve(view.layout, key, fraction, where)
			if (target !== undefined || !spansMonth(view.layout, key)) return target
			return scrollForTime(view.layout, monthStartUtc(key + 1), where)
		},
		[scrollWindow, resolve],
	)

	const stopTween = useCallback(() => {
		tweenRef.current?.stop()
		tweenRef.current = null
	}, [])

	const tween = useCallback(
		(target: number) => {
			const scroller = scrollerRef.current
			const view = viewRef.current
			if (!scroller || !view) return
			stopTween()
			const from = scroller.scrollTop
			const distance = Math.abs(target - from)
			if (distance < 1) return
			const duration = Math.min(650, 350 + (distance / Math.max(1, view.height)) * 30)
			const started = performance.now()
			let raf = 0
			// The user's own input takes the scroll back mid-flight
			const cancelOn = ['wheel', 'pointerdown', 'touchstart'] as const
			const stop = () => {
				cancelAnimationFrame(raf)
				for (const type of cancelOn) scroller.removeEventListener(type, stop)
			}
			for (const type of cancelOn) scroller.addEventListener(type, stop, {passive: true})
			const ease = (progress: number) => (progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2)
			const step = (now: number) => {
				const progress = Math.min(1, (now - started) / duration)
				scroller.scrollTop = from + (target - from) * ease(progress)
				if (progress < 1) raf = requestAnimationFrame(step)
				else stop()
			}
			raf = requestAnimationFrame(step)
			tweenRef.current = {stop}
		},
		[scrollerRef, viewRef, stopTween],
	)

	const later = useCallback((fn: () => void, ms: number) => {
		timersRef.current.push(window.setTimeout(fn, ms))
	}, [])

	// Across a distance no tween survives: fade the grid through. `arrive`
	// puts the destination under it while it is out, and the commit mounts
	// that before the grid fades back — arrivals then wash in as their
	// thumbnails land, which is the transition
	const through = useCallback(
		(arrive: () => void | Promise<void>) => {
			const content = contentRef.current
			if (!content) return void arrive()
			const id = ++fade.current
			const latest = () => mounted.current && fade.current === id
			content.style.transition = 'opacity 130ms ease-out'
			content.style.opacity = '0'
			later(async () => {
				await arrive()
				if (!latest()) return
				requestAnimationFrame(() =>
					requestAnimationFrame(() => {
						if (!latest()) return
						content.style.transition = 'opacity 240ms ease-in'
						content.style.opacity = '1'
						later(() => {
							if (!latest()) return
							content.style.transition = ''
							content.style.opacity = ''
						}, 260)
					}),
				)
			}, 140)
		},
		[contentRef, later],
	)

	const land = useCallback(
		(target: number) => {
			const scroller = scrollerRef.current
			const view = viewRef.current
			if (!scroller || !view) return
			stopTween()
			const distance = Math.abs(target - scroller.scrollTop)
			if (reduceMotion || distance > TWEEN_MAX_VIEWPORTS * view.height) {
				through(() => {
					scroller.scrollTop = target
				})
			} else tween(target)
		},
		[reduceMotion, scrollerRef, viewRef, stopTween, through, tween],
	)

	// A seek has the month's photographs: put their list on screen with the
	// grid on the month — or on whatever the list has nearest it. Resolves
	// once the grid has taken the list up.
	const arrive = useCallback(
		(key: MonthKey, fraction: number, {first, show}: Arrival) => {
			stopTween()
			const top = (view: CommittedView) => {
				const where = scrollWindow(view)
				return resolve(view.layout, key, fraction, where) ?? scrollForTime(view.layout, monthStartUtc(key + 1), where)
			}
			const view = viewRef.current
			const scroller = scrollerRef.current
			// Already the list on screen: only the scroll is left to do
			if (view && scroller && (first === undefined || view.layout.items[0]?.id === first)) {
				show()
				const target = top(view)
				if (target !== undefined) scroller.scrollTop = target
				return Promise.resolve()
			}
			const landing = {first, top}
			landingRef.current = landing
			show()
			return new Promise<void>((taken) => {
				cancelAnimationFrame(pollRaf.current)
				const deadline = performance.now() + ADOPT_MS
				const look = () => {
					if (landingRef.current !== landing) return taken()
					if (performance.now() < deadline) return void (pollRaf.current = requestAnimationFrame(look))
					landingRef.current = null
					taken()
				}
				look()
			})
		},
		[stopTween, scrollWindow, resolve, viewRef, scrollerRef, landingRef],
	)

	// A scrub has come back onto what the list holds, or ended there
	const scrubWithin = useCallback(() => {
		window.clearTimeout(rest.current?.timer)
		rest.current = null
	}, [])

	const jump = useCallback(
		(key: MonthKey, fraction: number) => {
			scrubWithin()
			const view = viewRef.current
			if (!view) return
			const target = locate(view, key, fraction)
			if (target !== undefined) return land(target)
			seek.start(key, (arrival) => through(() => arrive(key, fraction, arrival)))
		},
		[scrubWithin, viewRef, locate, land, seek, through, arrive],
	)

	// A scrub has come onto a month the list doesn't hold. Once it rests
	// there (see SCRUB_REST_MS), or ends there, the month's stretch of the
	// timeline is asked for and put on screen as it arrives: the grid follows
	// the scrub beyond the list as it does through it, a beat behind.
	const scrubBeyond = useCallback(
		(key: MonthKey, fraction: number, ended = false) => {
			// Still on the month it was already resting on: that wait stands
			if (!ended && rest.current?.key === key) return
			scrubWithin()
			const ask = () => seek.start(key, (arrival) => void arrive(key, fraction, arrival))
			if (ended) ask()
			else rest.current = {key, timer: window.setTimeout(ask, SCRUB_REST_MS)}
		},
		[scrubWithin, seek, arrive],
	)

	// The user's own scroll or press while a seek is awaited means "never mind"
	const seeking = seek.target !== null
	const cancelSeek = seek.cancel
	useEffect(() => {
		if (!seeking) return
		const scroller = scrollerRef.current
		if (!scroller) return
		const on = ['wheel', 'pointerdown', 'touchstart'] as const
		for (const type of on) scroller.addEventListener(type, cancelSeek, {passive: true})
		return () => {
			for (const type of on) scroller.removeEventListener(type, cancelSeek)
		}
	}, [seeking, cancelSeek, scrollerRef])

	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			cancelAnimationFrame(pollRaf.current)
			window.clearTimeout(rest.current?.timer)
			for (const timer of timersRef.current) window.clearTimeout(timer)
			stopTween()
			// … nor leave the grid a landing nobody is waiting on any more
			landingRef.current = null
			// A fade-through interrupted by this unmount (a zoom-out crossing the
			// rail's threshold mid-landing) must not strand the grid faded out:
			// the content div outlives the rail, and its restore timers just died
			const content = contentRef.current
			if (content) {
				content.style.transition = ''
				content.style.opacity = ''
			}
		}
	}, [stopTween, contentRef, landingRef])

	return {scrollWindow, locate, stopTween, land, jump, scrubBeyond, scrubWithin}
}
