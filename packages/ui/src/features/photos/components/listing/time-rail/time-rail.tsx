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
	labelUnit,
	monthAtRailY,
	monthSpan,
	monthStartUtc,
	pickMonthLabels,
	pickYearLabels,
	railYForMonth,
	settleOnLabel,
	timeAtFraction,
	timeAtScroll,
	yearMarks,
	yearOf,
	type MonthBucket,
	type MonthKey,
} from '@/features/photos/components/listing/time-rail/rail-scale'
import {
	useLanding,
	type CommittedView,
	type ElementRef,
	type Landing,
} from '@/features/photos/components/listing/time-rail/use-landing'
import type {Seek} from '@/features/photos/components/listing/time-rail/use-seek'
import {useLargerText} from '@/hooks/use-accessibility'
import {cn} from '@/lib/utils'
import {capitalizeDate} from '@/utils/date-time'
import {formatNumberI18n} from '@/utils/number'

// When the rail earns its edge: when scrolling the listing is actual work.
// That is a length in *viewports* — the full timeline's height, extrapolated
// over the filter's total — not an item count: a thousand photos at huge
// tiles are a hundred screens of scrolling, and twenty thousand in the
// mosaic are two flicks. Zoom and window size fall out of it naturally, and
// zoomed all the way out the rail stands down — the mosaic IS the overview.
// Hysteresis (appear long, vanish shorter) so a pinch crossing the boundary
// can't flap it. There is no span floor: a short domain changes what the
// rail *labels* (months instead of years, days in the pill — see labelUnit
// and DAY_PILL_MAX_MONTHS), never whether a long scroll gets an index.
export const RAIL_SHOW_VIEWPORTS = 8
export const RAIL_HIDE_VIEWPORTS = 6
// Up to this span the pill names the day under the pointer, not the month:
// on a ten-week listing every spot on the rail is the same two or three
// month names, and the day is the signal
const DAY_PILL_MAX_MONTHS = 3

// The overlay: labels, ticks and scrim. Only the STRIP takes the pointer —
// the rest lets every event through to the grid beneath.
const RAIL_WIDTH = 72
const STRIP_WIDTH = 24
const TRACK_PAD = 14
const THUMB_HEIGHT = 28
// Year labels keep at least this far apart, plus what larger text adds to
// their height; decades win the crowding
const LABEL_MIN_GAP = 18
// A month gets its own hairline tick only with this much rail to its name
const MONTH_TICK_MIN_SPAN = 8
// The rail shows itself while scrolling and rests this long after
const HIDE_AFTER_MS = 1200
// Below this much track the rail reads as noise: leave the edge alone
const MIN_TRACK = 160
// A press that travels no further than this is a click, not a scrub
const DRAG_SLOP_PX = 3
// How far above its mark a pointer is still on a label (see settleOnLabel):
// half the label's height at rest. Under the lens the label is drawn nearly
// twice the size but is also pushed away from the pointer, three quarters of
// a px for each px the pointer is short of the mark, which comes to the same.
const LABEL_REACH = 6

// ── The lens ──
// Hovering magnifies the pointer's neighbourhood the way the dock does:
// labels and ticks near the cursor scale up (a Gaussian falloff) and spread
// apart (a local push that peaks a little off the cursor and returns to rest
// within a couple of radii — the element right under the finger barely
// moves, so aim stays true), with the amplitude eased in and out so the lens
// blooms rather than pops. Pure compositor work: a rAF loop writes
// transforms straight to the elements — React renders nothing per frame, the
// discipline the zoom gesture set. Visual only: the track's month mapping is
// untouched, and the pill always names exactly what a click will get.
const LENS_RADIUS = 72
const LENS_LABEL_SCALE = 1.9
const LENS_TICK_SCALE = 1.6
const LENS_PUSH = 14
// Where the push peaks, as a fraction of the radius
const LENS_PUSH_PEAK = 0.7
// Amplitude easing time constant: quick enough to feel liquid, no lag
const LENS_EASE_MS = 80

// The Time Machine-style index down a long timeline's right edge: a thumb
// marking where in time the viewport is, year ticks and labels, and a pill
// naming the month under the pointer. A click or a released drag travels
// there; a drag scrubs the grid live — through everything the list holds,
// and beyond it by a seek (see use-seek.ts) that puts each month it comes to
// on screen as its photographs arrive, the pill naming where the drag is
// heading meanwhile. Renders nothing per scroll frame — the thumb follows by
// transform, off React's render path, the discipline the zoom control set.
export function TimeRail({
	buckets,
	scrollerRef,
	contentRef,
	viewRef,
	landingRef,
	frame,
	height,
	endSpacer,
	seek,
}: {
	buckets: MonthBucket[]
	scrollerRef: ElementRef<HTMLDivElement>
	contentRef: ElementRef<HTMLDivElement>
	viewRef: ElementRef<CommittedView>
	landingRef: {current: Landing | null}
	frame: Frame
	height: number
	endSpacer: number
	seek: Seek
}) {
	const {t, i18n} = useTranslation()
	const reduceMotion = useReducedMotion() ?? false
	const trackHeight = Math.max(0, height - frame.inset - endSpacer - 8 - TRACK_PAD * 2)
	const scale = useMemo(() => buildScale(buckets, trackHeight), [buckets, trackHeight])
	const marks = useMemo(() => yearMarks(scale), [scale])
	// The axis formats itself to the domain: years over a long one, short
	// month names over anything under two years — Januaries and the topmost
	// label carry the year (see labelUnit)
	const unit = labelUnit(buckets)
	const spanMonths = monthSpan(buckets)
	const largerText = useLargerText()
	const labelGap = LABEL_MIN_GAP + largerText
	const yearLabels = useMemo(() => (unit === 'years' ? pickYearLabels(marks, labelGap) : []), [unit, marks, labelGap])
	const monthLabels = useMemo(
		() => (unit === 'months' ? pickMonthLabels(scale, labelGap) : []),
		[unit, scale, labelGap],
	)
	// Month hairlines, where there is room — skipping each year's first month,
	// whose line is the year tick itself
	const monthTicks = useMemo(() => {
		const ticks: {key: MonthKey; top: number}[] = []
		let year: number | undefined
		for (const segment of scale.segments) {
			const first = yearOf(segment.key) !== year
			year = yearOf(segment.key)
			if (!first && segment.span >= MONTH_TICK_MIN_SPAN) ticks.push({key: segment.key, top: segment.top})
		}
		return ticks
	}, [scale])
	const monthLabel = useMemo(() => {
		const format = new Intl.DateTimeFormat(i18n.language, {month: 'long', year: 'numeric', timeZone: 'UTC'})
		return (key: MonthKey) => capitalizeDate(format.format(monthStartUtc(key)), i18n.language)
	}, [i18n.language])
	const monthMarkLabel = useMemo(() => {
		const short = new Intl.DateTimeFormat(i18n.language, {month: 'short', timeZone: 'UTC'})
		const shortYear = new Intl.DateTimeFormat(i18n.language, {month: 'short', year: 'numeric', timeZone: 'UTC'})
		return (key: MonthKey, withYear: boolean) =>
			capitalizeDate((withYear ? shortYear : short).format(monthStartUtc(key)), i18n.language)
	}, [i18n.language])
	// A short-span pill names the day under the pointer — on a ten-week
	// listing every spot is the same two month names, and the day is the
	// signal. The year comes along only when the domain crosses one.
	const dayPill = spanMonths > 0 && spanMonths <= DAY_PILL_MAX_MONTHS
	const crossesYears = buckets.length > 0 && yearOf(buckets[0]!.key) !== yearOf(buckets[buckets.length - 1]!.key)
	const dayLabel = useMemo(() => {
		const day = new Intl.DateTimeFormat(i18n.language, {
			month: 'long',
			day: 'numeric',
			timeZone: 'UTC',
			...(crossesYears ? {year: 'numeric'} : {}),
		})
		return (takenAt: number) => capitalizeDate(day.format(takenAt), i18n.language)
	}, [i18n.language, crossesYears])
	const pillLabel = (key: MonthKey, fraction: number) => {
		if (dayPill) {
			const takenAt = timeAtFraction(viewRef.current?.layout.items ?? [], key, fraction)
			if (takenAt !== undefined) return dayLabel(takenAt)
		}
		return monthLabel(key)
	}

	const [engaged, setEngaged] = useState(false)
	const [awake, setAwake] = useState(false)
	const [hover, setHover] = useState<{y: number; key: MonthKey; fraction: number; pending: boolean} | null>(null)
	// For the slider's announced value — updated from scroll, bailing when unchanged
	const [currentKey, setCurrentKey] = useState<MonthKey | null>(null)

	const stripRef = useRef<HTMLDivElement>(null)
	const thumbRef = useRef<HTMLDivElement>(null)
	const lensRoot = useRef<HTMLDivElement>(null)
	const lensRef = useRef<{
		amp: number
		target: number
		y: number
		raf: number
		last: number
		// The elements the lens moves, collected lazily from [data-rail-y] and
		// dropped whenever a render can have changed the set
		els: {el: HTMLElement; y: number; label: boolean}[] | null
	}>({amp: 0, target: 0, y: 0, raf: 0, last: 0, els: null})
	const hideTimer = useRef<number | undefined>(undefined)
	const dragRef = useRef<{startY: number; scrubbing: boolean} | null>(null)
	const moveRaf = useRef(0)
	const pendingY = useRef(0)

	const {locate, stopTween, jump, scrubBeyond, scrubWithin} = useLanding({
		scrollerRef,
		contentRef,
		viewRef,
		landingRef,
		inset: frame.inset,
		endSpacer,
		seek,
	})

	const wake = useCallback(() => {
		setAwake(true)
		window.clearTimeout(hideTimer.current)
		hideTimer.current = window.setTimeout(() => setAwake(false), HIDE_AFTER_MS)
	}, [])
	// Announce the rail once when a listing that warrants it appears
	useEffect(() => wake(), [wake])

	// ── The lens loop ──
	// One frame: ease the amplitude toward its target, then write every
	// tick's and label's transform from its distance to the lens centre. The
	// loop runs only while the lens is alive (hover or its ease-out) and
	// stops the moment it rests with everything cleared.
	const lensFrame = useCallback((now: number) => {
		const lens = lensRef.current
		const dt = Math.min(64, now - lens.last)
		lens.last = now
		lens.amp += (lens.target - lens.amp) * (1 - Math.exp(-dt / LENS_EASE_MS))
		if (lens.target === 0 && lens.amp < 0.02) lens.amp = 0
		if (!lens.els) {
			const root = lensRoot.current
			lens.els = root
				? [...root.querySelectorAll<HTMLElement>('[data-rail-y]')].map((el) => ({
						el,
						y: Number(el.dataset.railY),
						label: el.dataset.railLens === 'label',
					}))
				: []
		}
		for (const {el, y, label} of lens.els) {
			if (lens.amp === 0) {
				if (el.style.transform) el.style.transform = ''
				continue
			}
			const distance = y - lens.y
			const t = Math.abs(distance) / LENS_RADIUS
			const grow = (label ? LENS_LABEL_SCALE : LENS_TICK_SCALE) - 1
			const scaleBy = 1 + grow * Math.exp(-t * t) * lens.amp
			const push = Math.sign(distance) * LENS_PUSH * (t / LENS_PUSH_PEAK) * Math.exp(1 - t / LENS_PUSH_PEAK) * lens.amp
			// Labels centre themselves on their tick with the class's
			// -translate-y-1/2, which is the `translate` property: it stays in
			// force beside this inline `transform`, so the push and the scale are
			// all that is written here. (Carrying the half-height in both lifted
			// every label clear above its tick while the lens was on, over the
			// year before the one it names.)
			el.style.transform = label
				? `translateY(${push}px) scale(${scaleBy})`
				: `translateY(${push}px) scaleX(${scaleBy})`
		}
		lens.raf = lens.amp === 0 && lens.target === 0 ? 0 : requestAnimationFrame(lensFrame)
	}, [])
	const lensTo = useCallback(
		(target: number, y?: number) => {
			const lens = lensRef.current
			lens.target = reduceMotion ? 0 : target
			if (y !== undefined) lens.y = y
			if (lens.raf === 0 && (lens.target !== 0 || lens.amp !== 0)) {
				lens.last = performance.now()
				lens.raf = requestAnimationFrame(lensFrame)
			}
		},
		[reduceMotion, lensFrame],
	)
	// A render may have re-keyed ticks or labels: collect them afresh
	useEffect(() => {
		lensRef.current.els = null
	}, [scale])

	// ── Following the scroll ──
	const syncThumb = useCallback(() => {
		const view = viewRef.current
		const scroller = scrollerRef.current
		const thumb = thumbRef.current
		if (!view || !scroller || !thumb) return
		const at = timeAtScroll(view.layout, scroller.scrollTop)
		if (!at) return
		const y = railYForMonth(scale, at.key, at.fraction)
		const top = TRACK_PAD + Math.min(Math.max(0, y - THUMB_HEIGHT / 2), Math.max(0, trackHeight - THUMB_HEIGHT))
		thumb.style.transform = `translateY(${top}px)`
		setCurrentKey((previous) => (previous === at.key ? previous : at.key))
	}, [scale, trackHeight, viewRef, scrollerRef])

	useEffect(() => {
		const scroller = scrollerRef.current
		if (!scroller) return
		let raf = 0
		const onScroll = () => {
			wake()
			if (raf === 0)
				raf = requestAnimationFrame(() => {
					raf = 0
					syncThumb()
				})
		}
		scroller.addEventListener('scroll', onScroll, {passive: true})
		syncThumb()
		return () => {
			scroller.removeEventListener('scroll', onScroll)
			cancelAnimationFrame(raf)
		}
	}, [scrollerRef, syncThumb, wake])

	// Wheel over the strip, attached by hand: React's root wheel listener is
	// passive (the filmstrip pulls the same trick), and this one must claim
	// the event — a trackpad pinch over the strip belongs to the grid's zoom,
	// not the browser's page zoom, so it is forwarded to the scroller where
	// attachPinch listens (a synthetic event runs listeners without native
	// scrolling). A plain wheel scrolls the grid so the strip never deadens
	// the screen's edge, with line- and page-mode deltas normalized to px.
	useEffect(() => {
		const strip = stripRef.current
		const scroller = scrollerRef.current
		if (!strip || !scroller) return
		const onWheel = (event: WheelEvent) => {
			event.preventDefault()
			if (event.ctrlKey || event.metaKey) {
				scroller.dispatchEvent(
					new WheelEvent('wheel', {
						deltaY: event.deltaY,
						ctrlKey: event.ctrlKey,
						metaKey: event.metaKey,
						clientX: event.clientX,
						clientY: event.clientY,
					}),
				)
				return
			}
			// Scrolling by assignment fires no wheel on the scroller, so the
			// seek's own never-mind listener wouldn't hear it — same intent,
			// same abandonment
			seek.cancel()
			const step = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight : 1
			scroller.scrollTop += event.deltaY * step
		}
		strip.addEventListener('wheel', onWheel, {passive: false})
		return () => strip.removeEventListener('wheel', onWheel)
	}, [scrollerRef, seek.cancel])

	useEffect(
		() => () => {
			window.clearTimeout(hideTimer.current)
			cancelAnimationFrame(moveRaf.current)
			cancelAnimationFrame(lensRef.current.raf)
		},
		[],
	)

	// ── The pointer on the strip ──
	const railY = useCallback((clientY: number) => {
		const strip = stripRef.current
		if (!strip) return null
		return clientY - strip.getBoundingClientRect().top - TRACK_PAD
	}, [])
	// What a point on the rail means to a pointer resting on it or clicking: the
	// month under it, or the label it is on. A scrub reads the rail as it is,
	// every month in turn.
	const labels = unit === 'years' ? yearLabels : monthLabels
	const pointed = useCallback(
		(y: number, scrub: boolean) =>
			monthAtRailY(scale, scrub ? y : settleOnLabel(y, labels, LABEL_REACH + largerText / 2)),
		[scale, labels, largerText],
	)

	const applyPointer = useCallback(
		(clientY: number, scrub: boolean) => {
			const y = railY(clientY)
			if (y === null) return
			const at = pointed(y, scrub)
			if (!at) return
			const view = viewRef.current
			const scroller = scrollerRef.current
			const target = view ? locate(view, at.key, at.fraction) : undefined
			const clamped = Math.min(Math.max(0, y), trackHeight)
			lensRef.current.y = clamped + TRACK_PAD
			setHover({
				y: clamped,
				key: at.key,
				fraction: at.fraction,
				pending: view !== null && target === undefined,
			})
			if (!scrub || !view || !scroller) return
			stopTween()
			// What the list holds scrubs live under the finger; beyond it the
			// pill says where this is heading and the grid follows as that
			// arrives
			if (target === undefined) return scrubBeyond(at.key, at.fraction)
			scrubWithin()
			scroller.scrollTop = target
		},
		[railY, pointed, viewRef, scrollerRef, locate, trackHeight, stopTween, scrubBeyond, scrubWithin],
	)

	const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.pointerType === 'mouse' && event.button !== 0) return
		event.currentTarget.setPointerCapture(event.pointerId)
		dragRef.current = {startY: event.clientY, scrubbing: false}
		seek.cancel()
		stopTween()
		wake()
		applyPointer(event.clientY, false)
	}

	const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		wake()
		const drag = dragRef.current
		if (drag && !drag.scrubbing && Math.abs(event.clientY - drag.startY) > DRAG_SLOP_PX) drag.scrubbing = true
		pendingY.current = event.clientY
		if (moveRaf.current === 0)
			moveRaf.current = requestAnimationFrame(() => {
				moveRaf.current = 0
				applyPointer(pendingY.current, dragRef.current?.scrubbing === true)
			})
	}

	const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current
		dragRef.current = null
		if (!drag) return
		cancelAnimationFrame(moveRaf.current)
		moveRaf.current = 0
		const y = railY(event.clientY)
		const at = y === null ? undefined : pointed(y, drag.scrubbing)
		if (!at) return
		if (!drag.scrubbing) return jump(at.key, at.fraction)
		// Released after a live scrub: settle exactly, or on what the drag ran
		// beyond the list for once that is here
		const view = viewRef.current
		const target = view ? locate(view, at.key, at.fraction) : undefined
		if (target === undefined) return scrubBeyond(at.key, at.fraction, true)
		scrubWithin()
		if (scrollerRef.current) scrollerRef.current.scrollTop = target
	}

	const onPointerCancel = () => {
		dragRef.current = null
		cancelAnimationFrame(moveRaf.current)
		moveRaf.current = 0
		scrubWithin()
	}

	// ── The keyboard on the slider ──
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
		jump(buckets[Math.min(buckets.length - 1, Math.max(0, next))]!.key, 0)
	}

	if (trackHeight < MIN_TRACK || scale.segments.length === 0) return null

	// While a seek is awaited its pill pins at the destination; otherwise the
	// pill follows the pointer
	const pill =
		seek.target !== null
			? {
					y: Math.min(Math.max(0, railYForMonth(scale, seek.target)), trackHeight),
					key: seek.target,
					fraction: 0,
					pending: true,
				}
			: hover
	const pillCount = (() => {
		if (!pill) return null
		const bucket = buckets[bucketIndexFor(buckets, pill.key)]
		return bucket && bucket.key === pill.key && !bucket.estimated ? bucket.count : null
	})()
	// The rail is always present — quiet at rest so the timeline can be seen
	// to have this axis at all, clearer while scrolling, full on approach
	const presence = engaged || seek.target !== null ? 'opacity-100' : awake ? 'opacity-90' : 'opacity-60'

	return (
		// The mount fades in: the rail can arrive from a zoom-in or a window
		// resize making the timeline long, and it should appear, not pop
		<div
			className='pointer-events-none absolute right-0 z-30 animate-in duration-300 select-none fade-in'
			style={{top: frame.inset, height: trackHeight + TRACK_PAD * 2, width: RAIL_WIDTH}}
		>
			{/* A whisper of scrim so labels read over bright photographs (more
			    than a whisper under increased contrast). Masked so it breathes
			    out at both ends — without it the band stops in a hard horizontal
			    line across whatever photo sits at the edge. */}
			<div
				className={cn(
					'absolute inset-0 transition-opacity duration-300 [--scrim:0.45] contrast-more:[--scrim:0.8]',
					engaged ? 'opacity-100' : 'opacity-0',
				)}
				style={{
					background: 'linear-gradient(to left, rgb(0 0 0 / var(--scrim)), transparent)',
					maskImage: 'linear-gradient(to bottom, transparent, black 72px, black calc(100% - 72px), transparent)',
					WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 72px, black calc(100% - 72px), transparent)',
				}}
			/>
			<div ref={lensRoot}>
				<div className={cn('transition-opacity duration-300', engaged ? 'opacity-100' : 'opacity-0')}>
					{monthTicks.map(({key, top}) => (
						<div
							key={key}
							data-rail-y={TRACK_PAD + top}
							className='absolute right-[9px] h-px w-1.5 origin-right bg-white/25 contrast-more:bg-white/60'
							style={{top: TRACK_PAD + top}}
						/>
					))}
				</div>
				<div className={cn('transition-opacity duration-300', presence)}>
					{marks.map(({year, y}) => (
						<div
							key={year}
							data-rail-y={TRACK_PAD + y}
							className='absolute right-[7px] h-px w-2.5 origin-right bg-white/45 contrast-more:bg-white/80'
							style={{top: TRACK_PAD + y}}
						/>
					))}
				</div>
				{/* Labels only bloom on approach: at rest they would hang over the
				    photographs themselves, past the ticks' own sliver of edge */}
				<div className={cn('transition-opacity duration-300', engaged ? 'opacity-100' : 'opacity-0')}>
					{yearLabels.map(({year, y}) => (
						<div
							key={year}
							data-rail-y={TRACK_PAD + y}
							data-rail-lens='label'
							className='absolute right-5 origin-right -translate-y-1/2 text-11 leading-none font-medium tracking-wide text-white/60 tabular-nums [text-shadow:0_1px_2px_rgba(0,0,0,0.6)] contrast-more:[text-shadow:0_0_3px_rgb(0_0_0),0_1px_2px_rgb(0_0_0)]'
							style={{top: TRACK_PAD + y}}
						>
							{year}
						</div>
					))}
					{monthLabels.map(({key, y}, index) => (
						<div
							key={key}
							data-rail-y={TRACK_PAD + y}
							data-rail-lens='label'
							className='absolute right-5 origin-right -translate-y-1/2 text-11 leading-none font-medium tracking-wide whitespace-nowrap text-white/60 tabular-nums [text-shadow:0_1px_2px_rgba(0,0,0,0.6)] contrast-more:[text-shadow:0_0_3px_rgb(0_0_0),0_1px_2px_rgb(0_0_0)]'
							style={{top: TRACK_PAD + y}}
						>
							{monthMarkLabel(key, index === 0 || (((key % 12) + 12) % 12 === 0 && spanMonths > 1))}
						</div>
					))}
				</div>
			</div>
			<div
				ref={thumbRef}
				className={cn(
					'absolute top-0 right-1 w-[3px] rounded-full bg-white/60 transition-opacity duration-300 contrast-more:bg-white',
					presence,
				)}
				style={{height: THUMB_HEIGHT}}
			/>
			{pill && (
				<div
					className={cn(
						'absolute right-8 z-10 flex -translate-y-1/2 items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3 py-1.5 whitespace-nowrap shadow-lg backdrop-blur-xl',
						seek.target !== null && 'transition-[top] duration-200',
					)}
					style={{top: TRACK_PAD + pill.y}}
				>
					<span className='text-13 leading-none font-medium text-white/90'>{pillLabel(pill.key, pill.fraction)}</span>
					{pill.pending ? (
						<TbLoader className='size-3 animate-spin text-white/60' />
					) : (
						pillCount !== null && (
							<span className='text-12 leading-none text-white/50'>
								{t('photos-actions.item-count', {
									count: pillCount,
									formattedCount: formatNumberI18n({n: pillCount, showDecimals: false, locale: i18n.language}),
								})}
							</span>
						)
					)}
				</div>
			)}
			{/* The interactive edge: the only part of the overlay that takes the
			    pointer. Wheel passes through by hand so the strip never deadens
			    scrolling at the screen's edge. */}
			<div
				ref={stripRef}
				role='slider'
				tabIndex={0}
				aria-orientation='vertical'
				aria-label={t('photos-rail.label')}
				aria-valuemin={0}
				aria-valuemax={buckets.length - 1}
				aria-valuenow={bucketIndexFor(buckets, currentKey ?? buckets[0]!.key)}
				aria-valuetext={monthLabel(currentKey ?? buckets[0]!.key)}
				className='pointer-events-auto absolute inset-y-0 right-0 touch-none outline-none focus-visible:bg-white/5'
				style={{width: STRIP_WIDTH}}
				onPointerEnter={(event) => {
					setEngaged(true)
					wake()
					const y = railY(event.clientY)
					if (y !== null) lensTo(1, Math.min(Math.max(0, y), trackHeight) + TRACK_PAD)
					applyPointer(event.clientY, false)
				}}
				onPointerLeave={() => {
					setEngaged(false)
					lensTo(0)
					if (!dragRef.current) setHover(null)
				}}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerCancel}
				onKeyDown={onKeyDown}
				onFocus={() => setEngaged(true)}
				onBlur={() => setEngaged(false)}
			/>
		</div>
	)
}
