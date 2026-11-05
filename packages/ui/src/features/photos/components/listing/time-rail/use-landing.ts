import {useReducedMotion} from 'motion/react'
import {useCallback, useEffect, useRef} from 'react'

import {
	monthStartUtc,
	scrollForMonth,
	scrollForTime,
	type MonthKey,
	type ScrollWindow,
} from '@/features/photos/components/listing/time-rail/rail-scale'
import type {Seek} from '@/features/photos/components/listing/time-rail/use-seek'
import type {Layout} from '@/features/photos/components/listing/timeline-rows'

// Landings: an eased scroll nearby; across anything longer than this many
// viewports, a fade-through teleport — tweening 100k px is a smear, not motion
const TWEEN_MAX_VIEWPORTS = 12

export type CommittedView = {layout: Layout; height: number}
export type ElementRef<T> = {readonly current: T | null}

// Travelling to a month: what the desktop rail and the phone's scrubber both
// do once they know where the user wants to be. A month already loaded is a
// scroll away — tweened nearby, faded through across a long way; one past the
// loading frontier is a seek (see use-seek.ts) that pages toward it, then a
// landing on the real thing once the grid has adopted the pages. The user's
// own scroll or press during a seek means "never mind".
export function useLanding({
	scrollerRef,
	contentRef,
	viewRef,
	inset,
	endSpacer,
	hasMore,
	seek,
	resolve = scrollForMonth,
}: {
	scrollerRef: ElementRef<HTMLDivElement>
	contentRef: ElementRef<HTMLDivElement>
	viewRef: ElementRef<CommittedView>
	inset: number
	endSpacer: number
	hasMore: boolean
	seek: Seek
	// The scrollTop that shows a month, once it is loaded (scrollForMonth
	// unless the caller has its own idea of where a month sits)
	resolve?: (layout: Layout, key: MonthKey, fraction: number, window: ScrollWindow) => number | undefined
}) {
	const reduceMotion = useReducedMotion() ?? false
	const pollRaf = useRef(0)
	const tweenRef = useRef<{stop: () => void} | null>(null)
	const timersRef = useRef<number[]>([])

	const scrollWindow = useCallback(
		(view: CommittedView): ScrollWindow => ({inset, viewport: view.height, trailing: endSpacer}),
		[inset, endSpacer],
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

	// Across a distance no tween survives: fade the grid through, jump, and
	// let the commit mount the destination before fading back — arrivals then
	// wash in as their thumbnails land, which is the transition
	const teleport = useCallback(
		(target: number) => {
			const scroller = scrollerRef.current
			const content = contentRef.current
			if (!scroller) return
			if (!content) {
				scroller.scrollTop = target
				return
			}
			content.style.transition = 'opacity 130ms ease-out'
			content.style.opacity = '0'
			later(() => {
				scroller.scrollTop = target
				requestAnimationFrame(() =>
					requestAnimationFrame(() => {
						content.style.transition = 'opacity 240ms ease-in'
						content.style.opacity = '1'
						later(() => {
							content.style.transition = ''
							content.style.opacity = ''
						}, 260)
					}),
				)
			}, 140)
		},
		[contentRef, scrollerRef, later],
	)

	const land = useCallback(
		(target: number) => {
			const scroller = scrollerRef.current
			const view = viewRef.current
			if (!scroller || !view) return
			stopTween()
			const distance = Math.abs(target - scroller.scrollTop)
			if (reduceMotion || distance > TWEEN_MAX_VIEWPORTS * view.height) teleport(target)
			else tween(target)
		},
		[reduceMotion, scrollerRef, viewRef, stopTween, teleport, tween],
	)

	// After a seek: the pages are in the cache but the grid adopts them on its
	// own paced beat — poll the committed layout for the month, briefly. A
	// seek that ran the list dry without finding the month ('exhausted': it
	// was an estimate, or the filter skips it) has nothing further to wait
	// for: land at the month's neighbour the moment the final pages commit,
	// not after the full deadline.
	const landOnMonth = useCallback(
		(key: MonthKey, fraction: number, exhausted = false) => {
			cancelAnimationFrame(pollRaf.current)
			const deadline = performance.now() + 2000
			const attempt = () => {
				const view = viewRef.current
				if (!view) return
				const where = scrollWindow(view)
				const target = resolve(view.layout, key, fraction, where)
				if (target !== undefined) return land(target)
				const settled = exhausted && !view.layout.hasMore
				if (!settled && performance.now() < deadline) {
					pollRaf.current = requestAnimationFrame(attempt)
					return
				}
				// The listing turned out not to hold the month: its neighbour
				const fallback = scrollForTime(view.layout, monthStartUtc(key + 1), where)
				if (fallback !== undefined) land(fallback)
			}
			attempt()
		},
		[viewRef, scrollWindow, land, resolve],
	)

	const jump = useCallback(
		(key: MonthKey, fraction: number) => {
			const view = viewRef.current
			if (!view) return
			const where = scrollWindow(view)
			const direct = resolve(view.layout, key, fraction, where)
			if (direct !== undefined) return land(direct)
			if (!hasMore) {
				const nearest = scrollForTime(view.layout, monthStartUtc(key + 1), where)
				if (nearest !== undefined) land(nearest)
				return
			}
			seek.start(key, (outcome) => {
				if (outcome === 'cancelled') return
				landOnMonth(key, fraction, outcome === 'exhausted')
			})
		},
		[viewRef, scrollWindow, land, hasMore, seek, landOnMonth, resolve],
	)

	// The user's own scroll or press during a seek means "never mind"
	useEffect(() => {
		if (!seek.busy) return
		const scroller = scrollerRef.current
		if (!scroller) return
		const abandon = () => seek.cancel()
		const on = ['wheel', 'pointerdown', 'touchstart'] as const
		for (const type of on) scroller.addEventListener(type, abandon, {passive: true})
		return () => {
			for (const type of on) scroller.removeEventListener(type, abandon)
		}
	}, [seek, scrollerRef])

	useEffect(
		() => () => {
			cancelAnimationFrame(pollRaf.current)
			for (const timer of timersRef.current) window.clearTimeout(timer)
			stopTween()
			// A teleport interrupted by this unmount (a zoom-out crossing the
			// rail's threshold mid-landing) must not strand the grid faded out:
			// the content div outlives the rail, and its restore timers just died
			const content = contentRef.current
			if (content) {
				content.style.transition = ''
				content.style.opacity = ''
			}
		},
		[stopTween, contentRef],
	)

	return {scrollWindow, stopTween, land, jump}
}
