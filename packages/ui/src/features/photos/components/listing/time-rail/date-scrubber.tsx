import {useReducedMotion} from 'motion/react'
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
} from 'react'
import {useTranslation} from 'react-i18next'
import {TbLoader} from 'react-icons/tb'

import type {Frame} from '@/features/photos/components/listing/surface'
import {
	bucketIndexFor,
	buildScale,
	monthAtRailY,
	monthNamedAt,
	monthStartUtc,
	railYForMonth,
	scrollNamingMonth,
	timeAtScroll,
	type MonthBucket,
	type MonthKey,
	type ScrollWindow,
} from '@/features/photos/components/listing/time-rail/rail-scale'
import {
	useLanding,
	type CommittedView,
	type ElementRef,
} from '@/features/photos/components/listing/time-rail/use-landing'
import type {Seek} from '@/features/photos/components/listing/time-rail/use-seek'
import type {Layout} from '@/features/photos/components/listing/timeline-rows'
import {cn} from '@/lib/utils'
import {capitalizeDate} from '@/utils/date-time'

// The handle shows while the grid scrolls and rests this long after
const HIDE_AFTER_MS = 1500
// … but not for a pinch's scrolling, nor the settle this long after it
const PINCH_QUIET_MS = 700
// The handle's centre travels the track; the track keeps this far clear of
// the bar above and the dock below, so the capsule never tucks under either
const TRACK_PAD = 24
// Under this much track a drag can't tell months apart: leave the edge alone
const MIN_TRACK = 72
// What the eye sees and what the thumb gets: a sliver of a capsule, and a
// hit area around it as wide as a fingertip and then some
const CAPSULE_WIDTH = 5
const CAPSULE_HEIGHT = 40
const HIT_WIDTH = 48
const HIT_HEIGHT = 72
// The bubble sits this far in from the edge, clear of the thumb on the
// handle, so the month it names is beside the finger rather than under it
const BUBBLE_INSET = 56
// Springs, as CSS can draw them: an overshooting ease for what arrives, a
// plain one for what leaves
const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'

// How far down the track the end of the timeline is. The handle reads the
// time at the top of what the eye can see, so fully scrolled it sits a
// viewport's worth of time short of the track's foot — an indicator that
// never reaches the bottom when the list has. Once every page is loaded the
// track is stretched by exactly that shortfall, both ways (the drag divides
// by it), so the handle meets the foot at the end and a drag to the foot
// lands there; while pages remain the foot is the unloaded past, and the
// scale is left as it is.
function reachOf(layout: Layout, scale: ReturnType<typeof buildScale>, where: ScrollWindow) {
	if (layout.hasMore || scale.height <= 0) return 1
	const end = Math.max(0, layout.total + where.trailing - where.viewport)
	const at = timeAtScroll(layout, end + where.inset)
	if (!at) return 1
	const y = railYForMonth(scale, at.key, at.fraction)
	return y > 0 ? Math.min(2, Math.max(1, scale.height / y)) : 1
}

// The phone's way through a long timeline: the scroll indicator, made
// something to hold — iOS Photos' own idiom. A slim capsule rides the right
// edge while the grid scrolls, placed where the viewport is in time on the
// time rail's count-weighted scale (see rail-scale.ts), and fades once the
// grid rests. Holding it scrubs: it follows the thumb exactly, a bubble beside
// it names the month beneath, and the grid travels there live — through
// everything loaded, and past the loading frontier on release, by the same
// seek the desktop rail uses (see use-seek.ts). Letting go leaves the grid
// where it is. Only a touch that starts on the handle scrubs; everywhere else
// the grid scrolls as it always has. The handle follows the scroll by
// transform, off React's render path; the only renders while scrubbing are
// the bubble's, once per month crossed.
export function DateScrubber({
	buckets,
	scrollerRef,
	contentRef,
	viewRef,
	frame,
	height,
	endSpacer,
	hasMore,
	seek,
}: {
	buckets: MonthBucket[]
	scrollerRef: ElementRef<HTMLDivElement>
	contentRef: ElementRef<HTMLDivElement>
	viewRef: ElementRef<CommittedView>
	frame: Frame
	height: number
	endSpacer: number
	hasMore: boolean
	seek: Seek
}) {
	const {t, i18n} = useTranslation()
	const reduceMotion = useReducedMotion() ?? false
	const trackHeight = Math.max(0, height - frame.inset - endSpacer - TRACK_PAD * 2)
	const scale = useMemo(() => buildScale(buckets, trackHeight), [buckets, trackHeight])
	const monthLabel = useMemo(() => {
		const format = new Intl.DateTimeFormat(i18n.language, {month: 'long', year: 'numeric', timeZone: 'UTC'})
		return (key: MonthKey) => capitalizeDate(format.format(monthStartUtc(key)), i18n.language)
	}, [i18n.language])

	// Where a month sits for this scrubber: where the rail would put it, but
	// never with the bar naming the month before (see scrollNamingMonth)
	const {handoff} = frame
	const resolve = useCallback(
		(layout: Layout, key: MonthKey, fraction: number, where: ScrollWindow) =>
			scrollNamingMonth(layout, key, fraction, {...where, handoff}),
		[handoff],
	)
	const {scrollWindow, stopTween, jump} = useLanding({
		scrollerRef,
		contentRef,
		viewRef,
		inset: frame.inset,
		endSpacer,
		hasMore,
		seek,
		resolve,
	})

	const [awake, setAwake] = useState(false)
	const [grabbed, setGrabbed] = useState(false)
	// What the bubble names while the handle is held: the month under it, and
	// whether it is past what is loaded (the grid holds at the frontier and
	// the release seeks). Kept after letting go, so the bubble fades out
	// still saying it.
	const [named, setNamed] = useState<{key: MonthKey; pending: boolean} | null>(null)
	// For the slider's announced value — updated from scroll, bailing when unchanged
	const [currentKey, setCurrentKey] = useState<MonthKey | null>(null)

	const overlayRef = useRef<HTMLDivElement>(null)
	const handleRef = useRef<HTMLDivElement>(null)
	// The handle's centre, in track px
	const centre = useRef(0)
	// `moved`: whether the thumb has taken the handle anywhere yet — a press
	// let go where it began is a touch, not a scrub, and moves nothing
	const dragRef = useRef<{
		pointerId: number
		grab: number
		y: number
		key: MonthKey
		fraction: number
		moved: boolean
	} | null>(null)
	// After a drag the handle stays where the thumb left it — read back from
	// the scroll it would sit a few px off, quantized to rows — until the user
	// next takes the grid in hand
	const heldRef = useRef(false)
	const hideTimer = useRef<number | undefined>(undefined)

	const place = useCallback((y: number) => {
		centre.current = y
		const handle = handleRef.current
		if (handle) handle.style.transform = `translate3d(0, ${TRACK_PAD + y}px, 0)`
	}, [])

	const wake = useCallback(() => {
		setAwake(true)
		window.clearTimeout(hideTimer.current)
		const rest = () => {
			// Never out from under a thumb that is still on it
			if (dragRef.current) hideTimer.current = window.setTimeout(rest, HIDE_AFTER_MS)
			else setAwake(false)
		}
		hideTimer.current = window.setTimeout(rest, HIDE_AFTER_MS)
	}, [])

	// ── Following the scroll ──
	const sync = useCallback(() => {
		if (dragRef.current || heldRef.current) return
		const view = viewRef.current
		const scroller = scrollerRef.current
		if (!view || !scroller) return
		const where = scrollWindow(view)
		const at = timeAtScroll(view.layout, scroller.scrollTop + where.inset)
		if (!at) return
		const y = railYForMonth(scale, at.key, at.fraction) * reachOf(view.layout, scale, where)
		place(Math.min(trackHeight, Math.max(0, y)))
		setCurrentKey((previous) => (previous === at.key ? previous : at.key))
	}, [viewRef, scrollerRef, scrollWindow, scale, trackHeight, place])

	useEffect(() => {
		const scroller = scrollerRef.current
		if (!scroller) return
		let raf = 0
		// A pinch moves the scroll too — it keeps the tile under the fingers
		// still — but nobody pinching is looking for a way through time: the
		// handle stays down through it and the settle after it
		let pinchUntil = 0
		const onTouch = (event: TouchEvent) => {
			if (event.touches.length > 1) pinchUntil = performance.now() + PINCH_QUIET_MS
		}
		const onScroll = () => {
			if (performance.now() >= pinchUntil) wake()
			if (raf === 0)
				raf = requestAnimationFrame(() => {
					raf = 0
					sync()
				})
		}
		// The user's own hand on the grid: the handle reads the scroll again
		const release = () => {
			heldRef.current = false
		}
		const takeBack = ['touchstart', 'wheel', 'pointerdown'] as const
		scroller.addEventListener('scroll', onScroll, {passive: true})
		scroller.addEventListener('touchstart', onTouch, {passive: true})
		scroller.addEventListener('touchmove', onTouch, {passive: true})
		for (const type of takeBack) scroller.addEventListener(type, release, {passive: true})
		sync()
		return () => {
			scroller.removeEventListener('scroll', onScroll)
			scroller.removeEventListener('touchstart', onTouch)
			scroller.removeEventListener('touchmove', onTouch)
			for (const type of takeBack) scroller.removeEventListener(type, release)
			cancelAnimationFrame(raf)
		}
	}, [scrollerRef, sync, wake])

	useEffect(() => () => window.clearTimeout(hideTimer.current), [])

	// ── The thumb on the handle ──
	const trackY = (clientY: number) => clientY - (overlayRef.current?.getBoundingClientRect().top ?? 0) - TRACK_PAD

	// The scrollTop for a handle position: the month under it, landed so the
	// bar names it — and the track's two ends are the list's, exactly, so a
	// drag to either is the top or the last row rather than a row's worth
	// short of it. Undefined past the loading frontier.
	const targetFor = (view: CommittedView, y: number, key: MonthKey, fraction: number) => {
		const where = scrollWindow(view)
		if (y <= 0) return 0
		if (y >= trackHeight && !view.layout.hasMore) return Math.max(0, view.layout.total + endSpacer - view.height)
		return resolve(view.layout, key, fraction, where)
	}

	// Take the grid to a handle position, and name where it is. Loaded
	// territory scrubs live under the thumb; past the frontier the grid holds
	// at the deepest loaded row and the bubble names the month the release
	// will seek. Otherwise the bubble names what the bar does — the month
	// under the thumb everywhere but the foot of the list, where the grid can
	// travel no further and the top of the last screen is what it shows.
	const scrubTo = (y: number, move: boolean) => {
		const view = viewRef.current
		const scroller = scrollerRef.current
		const drag = dragRef.current
		if (!view || !scroller || !drag) return
		const where = scrollWindow(view)
		const at = monthAtRailY(scale, y / reachOf(view.layout, scale, where))
		if (!at) return
		drag.y = y
		drag.key = at.key
		drag.fraction = at.fraction
		const target = targetFor(view, y, at.key, at.fraction)
		const pending = target === undefined && hasMore
		if (move) {
			stopTween()
			scroller.scrollTop = target ?? Math.max(0, view.layout.total + endSpacer - view.height)
		}
		const key = pending
			? at.key
			: (monthNamedAt(view.layout, scroller.scrollTop, {inset: where.inset, handoff}) ?? at.key)
		setNamed((previous) => (previous?.key === key && previous.pending === pending ? previous : {key, pending}))
		setCurrentKey((previous) => (previous === key ? previous : key))
	}
	const scrubRef = useRef(scrubTo)
	useEffect(() => {
		scrubRef.current = scrubTo
	})
	// A thumb held still past the frontier moves nothing, but the grid's own
	// paging keeps landing beneath it: look again on a beat, so the grid goes
	// the moment the month arrives and the bubble drops its spinner
	const waiting = grabbed && named?.pending === true
	useEffect(() => {
		if (!waiting) return
		const timer = window.setInterval(() => scrubRef.current(centre.current, true), 120)
		return () => window.clearInterval(timer)
	}, [waiting])

	const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.pointerType === 'mouse' && event.button !== 0) return
		event.currentTarget.setPointerCapture(event.pointerId)
		if (seek.busy) seek.cancel()
		stopTween()
		heldRef.current = false
		// Held where it was touched: the handle never jumps to the thumb, it
		// moves with it
		dragRef.current = {
			pointerId: event.pointerId,
			grab: trackY(event.clientY) - centre.current,
			y: centre.current,
			key: 0,
			fraction: 0,
			moved: false,
		}
		setGrabbed(true)
		wake()
		scrubTo(centre.current, false)
	}

	const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current
		if (!drag || drag.pointerId !== event.pointerId) return
		const y = Math.min(trackHeight, Math.max(0, trackY(event.clientY) - drag.grab))
		if (!drag.moved && Math.abs(y - drag.y) < 0.5) return
		drag.moved = true
		place(y)
		scrubTo(y, true)
	}

	const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current
		if (!drag || drag.pointerId !== event.pointerId) return
		dragRef.current = null
		heldRef.current = true
		setGrabbed(false)
		wake()
		// A touch that never moved leaves the grid where it rests: working the
		// scroll back out from the handle would land it on a row's top instead
		if (!drag.moved) return
		// Settle exactly where the thumb left it — a page that landed since the
		// last move has reflowed the grid under it — or, let go past the
		// frontier, seek what the drag ran out to
		const view = viewRef.current
		const scroller = scrollerRef.current
		if (!view || !scroller) return
		const where = scrollWindow(view)
		const target = targetFor(view, drag.y, drag.key, drag.fraction)
		if (target === undefined) return jump(drag.key, drag.fraction)
		scroller.scrollTop = target
		// … and the bubble fades out naming where the grid settled
		const key = monthNamedAt(view.layout, scroller.scrollTop, {inset: where.inset, handoff})
		if (key !== undefined) setNamed({key, pending: false})
	}

	// ── The keyboard (and a screen reader's adjust gestures) ──
	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (buckets.length === 0) return
		const from = currentKey ?? buckets[0]!.key
		const index = bucketIndexFor(buckets, from)
		let next: number
		if (event.key === 'ArrowUp') next = index - 1
		else if (event.key === 'ArrowDown') next = index + 1
		else if (event.key === 'PageUp') next = bucketIndexFor(buckets, from + 12)
		else if (event.key === 'PageDown') next = bucketIndexFor(buckets, from - 12)
		else if (event.key === 'Home') next = 0
		else if (event.key === 'End') next = buckets.length - 1
		else return
		event.preventDefault()
		heldRef.current = false
		wake()
		jump(buckets[Math.min(buckets.length - 1, Math.max(0, next))]!.key, 0)
	}

	if (trackHeight < MIN_TRACK || scale.segments.length === 0) return null

	// A seek outlives the drag that started it: the bubble stays up naming the
	// destination, with the frontier's spinner, until the grid lands
	const seeking = seek.target !== null
	const bubble = seeking ? {key: seek.target!, pending: true} : named
	const showBubble = (grabbed || seeking) && bubble !== null
	const shown = awake || grabbed || seeking

	return (
		<div
			ref={overlayRef}
			className='pointer-events-none absolute right-0 z-30 select-none'
			style={{top: frame.inset, height: trackHeight + TRACK_PAD * 2, width: HIT_WIDTH}}
		>
			<div ref={handleRef} className='absolute top-0 right-0 will-change-transform'>
				{/* Arrives from the edge and leaves into it, the way the system's
				    own scroll indicator does */}
				<div
					aria-hidden
					className='absolute right-[3px] rounded-full bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.25),0_1px_4px_rgb(0_0_0/0.45)]'
					style={{
						top: -CAPSULE_HEIGHT / 2,
						width: CAPSULE_WIDTH,
						height: CAPSULE_HEIGHT,
						transformOrigin: 'right center',
						opacity: shown ? (grabbed ? 1 : 0.8) : 0,
						transform: `translateX(${shown || reduceMotion ? 0 : 4}px) scale(${grabbed ? 1.4 : 1}, ${grabbed ? 1.15 : 1})`,
						transition: shown
							? `opacity 160ms ease-out, transform ${reduceMotion ? 0 : 320}ms ${SPRING}`
							: 'opacity 420ms ease-in, transform 420ms ease-in',
					}}
				/>
				<div
					aria-hidden={!showBubble}
					className='absolute flex items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3.5 py-2 whitespace-nowrap shadow-lg backdrop-blur-xl'
					style={{
						right: BUBBLE_INSET,
						top: 0,
						transformOrigin: 'right center',
						opacity: showBubble ? 1 : 0,
						transform: `translateY(-50%) scale(${showBubble || reduceMotion ? 1 : 0.85})`,
						transition: showBubble
							? `opacity 140ms ease-out, transform ${reduceMotion ? 0 : 360}ms ${SPRING}`
							: 'opacity 200ms ease-in, transform 200ms ease-in',
					}}
				>
					{bubble && (
						<>
							<span className='text-15 leading-none font-semibold text-white/95 tabular-nums'>
								{monthLabel(bubble.key)}
							</span>
							{bubble.pending && <TbLoader className='size-3.5 animate-spin text-white/60' />}
						</>
					)}
				</div>
				<div
					role='slider'
					tabIndex={0}
					aria-orientation='vertical'
					aria-label={t('photos-rail.label')}
					aria-valuemin={0}
					aria-valuemax={buckets.length - 1}
					aria-valuenow={bucketIndexFor(buckets, currentKey ?? buckets[0]!.key)}
					aria-valuetext={monthLabel(currentKey ?? buckets[0]!.key)}
					className={cn(
						'absolute right-0 touch-none rounded-l-full outline-none focus-visible:bg-white/10',
						shown ? 'pointer-events-auto' : 'pointer-events-none',
					)}
					style={{top: -HIT_HEIGHT / 2, width: HIT_WIDTH, height: HIT_HEIGHT}}
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerEnd}
					onPointerCancel={onPointerEnd}
					onKeyDown={onKeyDown}
					onFocus={wake}
				/>
			</div>
		</div>
	)
}
