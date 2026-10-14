import * as SliderPrimitive from '@radix-ui/react-slider'
import {Minus, Plus} from 'lucide-react'
import {useEffect, useRef, useState, useSyncExternalStore} from 'react'
import {useTranslation} from 'react-i18next'

import {PillButtonGroup, PillButtonGroupItem} from '@/components/ui/edge-controls'
import {
	clickColumns,
	columnValue,
	trackColumns,
	trackPosition,
	zoomTrack,
} from '@/features/photos/components/listing/timeline-rows'
import {usePhotosView} from '@/features/photos/components/view-context'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {tw} from '@/utils/tw'

// Keyboard steps, in columns — the arrows keep single-stop precision. The
// track runs from the widest grid on the left to the biggest tiles on the
// right, so → and ↑ zoom in; Home/End go to its ends, and the Page keys take
// the buttons' perceptual step (see clickColumns), three columns at the least.
const KEY_STEPS: Record<string, number> = {
	ArrowRight: -1,
	ArrowUp: -1,
	ArrowLeft: 1,
	ArrowDown: 1,
}
const PAGE_STEPS: Record<string, 1 | -1> = {PageUp: -1, PageDown: 1}
// Holding − or + keeps zooming, stepper-style: one step on the press, the
// rest on a timer while the pointer stays down
const HOLD_DELAY_MS = 350
const HOLD_REPEAT_MS = 100
// A wheel over the slider zooms by distance: a step per this much scrolling,
// whether it comes as one notch of a mouse wheel or as a run of small
// trackpad deltas — a step per event would let a flick cross the whole
// track. Firefox counts a mouse wheel in lines. What is left over is
// forgotten once the wheel goes quiet, so the next spin starts even.
const WHEEL_STEP_PX = 40
const WHEEL_LINE_PX = 14
const WHEEL_IDLE_MS = 200

// The slider's look, which the map's zoom shares
export const sliderRootClass = tw`relative hidden h-8 w-24 touch-none items-center px-1.5 select-none data-disabled:opacity-50 xl:flex`
export const sliderTrackClass = tw`relative h-1 grow rounded-full bg-white/15`
export const sliderThumbClass = tw`block size-3.5 rounded-full bg-white shadow-[0_1px_4px_rgb(0_0_0/0.45)] outline-hidden transition-transform duration-150 ease-out hover:scale-110 focus-visible:ring-2 focus-visible:ring-white/40 active:scale-110`

// No grid, no live zoom to hear
const noLiveColumns = () => () => {}

// Grid zoom: −, a slider, +. The buttons step by feel rather than by column —
// a slice of the track per click (see clickColumns), and holding one repeats
// it — so the far end of the mosaic is a few clicks away, not sixty; the
// slider keeps every stop for precision. The slider spans every column count
// the timeline can show at its current width — all the way out to what its
// renderer can draw, which on the canvas is far past what elements can — laid
// along the track so that the mosaic takes the first fifth of it and the
// sizes people browse at keep the rest (see `zoomTrack`). Dragging it *is* a
// zoom gesture:
// the grid follows the thumb continuously and settles on the nearest whole
// count when it is let go. What persists is the tile size that position gives, which
// carries over to other widths and devices as the nearest stop.
// The track itself is a wide-screen luxury: below xl the bar's room runs out
// (and phones pinch), so the pill folds to its − and + alone.
export function ZoomSlider() {
	const {t} = useTranslation()
	const isMobile = useIsMobile()
	const {tileSize, grid} = usePhotosView()
	// The thumb is the control's own from the moment it is touched until the
	// grid catches up with it: while a finger is on it the grid is following,
	// and when it is let go the grid springs to the whole count it landed on
	// and only persists the tile size when it gets there. A thumb that snapped
	// back to where it started for the length of that spring would read as the
	// control losing the gesture. Anything that moves the grid another way
	// (a pinch, the wheel) hands it back.
	const [held, setHeld] = useState<{columns: number; live: boolean} | null>(null)
	const wheel = useRef({distance: 0, at: 0})
	// No grid on screen (a collections page): the control shows, but idle —
	// keeping the thumb where the last grid left it instead of collapsing to
	// the track's end (with no grid yet this session, it rests there anyway)
	const disabled = !grid
	const lastGeometry = useRef<{width: number; floor: number | undefined}>({width: 0, floor: undefined})
	if (grid) lastGeometry.current = {width: grid.width, floor: grid.floor}
	const {width, floor} = grid ? {width: grid.width, floor: grid.floor} : lastGeometry.current
	const track = zoomTrack(width, isMobile, floor)
	const committed = columnValue(width, tileSize, isMobile, floor)
	const shown = useRef(committed)
	useEffect(() => {
		if (shown.current === committed) return
		shown.current = committed
		setHeld((current) => (current?.live ? current : null))
	}, [committed])
	// A pinch on the grid (and the spring settling it) moves the zoom off
	// React's render path; the grid notifies from its frame loop, and while it
	// does the thumb follows the fractional count it is at. Clamped, because a
	// pinch can rubber-band past the ends of the track but the thumb stops
	// there. A step or a drag of the slider's own (`held`) still wins.
	const live = useSyncExternalStore(grid?.onLiveColumns ?? noLiveColumns, () => grid?.liveColumns() ?? null)
	const value = held?.columns ?? (live === null ? committed : Math.min(track.max, Math.max(track.min, live)))
	const columns = Math.round(value)
	const zoomTo = (columns: number, live: boolean) =>
		grid?.setColumns(Math.min(track.max, Math.max(track.min, columns)), live)
	// A step from a key or the wheel: the thumb takes the stop at once, so a
	// run of steps counts from where the last one is headed rather than from
	// where the grid has got to
	const step = (by: number) => {
		const next = Math.min(track.max, Math.max(track.min, columns + by))
		if (next === columns) return
		setHeld({columns: next, live: false})
		zoomTo(next, false)
	}
	// A click of − or +: a perceptual step (see clickColumns), taken the same way
	const click = (by: 1 | -1, atLeast = 1) => {
		const next = clickColumns(track, columns, by, atLeast)
		if (next === columns) return
		setHeld({columns: next, live: false})
		zoomTo(next, false)
	}
	// A held button repeats its click. The session counts from its own running
	// target, so repeats stack up even while the spring is still carrying the
	// grid to the last one; a step that can go no further ends it. Release is
	// watched on the window, because at the track's end the button under the
	// pointer disables (pointer-events: none) and would never deliver its own
	// pointerup.
	const hold = useRef<(() => void) | null>(null)
	useEffect(() => () => hold.current?.(), [])
	const press = (by: 1 | -1) => (event: {button: number}) => {
		if (event.button !== 0 || hold.current) return
		let target = columns
		const advance = () => {
			const next = clickColumns(track, target, by)
			if (next === target) return false
			target = next
			setHeld({columns: next, live: false})
			zoomTo(next, false)
			return true
		}
		let timer = 0
		const stop = () => {
			clearTimeout(timer)
			removeEventListener('pointerup', stop)
			removeEventListener('pointercancel', stop)
			hold.current = null
		}
		const tick = () => {
			if (advance()) timer = window.setTimeout(tick, HOLD_REPEAT_MS)
			else stop()
		}
		addEventListener('pointerup', stop)
		addEventListener('pointercancel', stop)
		hold.current = stop
		advance()
		timer = window.setTimeout(tick, HOLD_DELAY_MS)
	}

	return (
		<PillButtonGroup role='group' aria-label={t('photos-actions.grid-size')}>
			<PillButtonGroupItem
				icon={Minus}
				aria-label={t('photos-actions.zoom-out')}
				disabled={disabled || columns >= track.max}
				className='touch-none'
				onPointerDown={press(1)}
				// Keyboard activation arrives as a click with no pointer behind it
				onClick={(event) => event.detail === 0 && click(1)}
			/>
			<SliderPrimitive.Root
				className={sliderRootClass}
				min={0}
				max={1}
				// A step under a pixel of the 96px track: the thumb is continuous
				step={0.001}
				disabled={disabled}
				value={[trackPosition(track, value)]}
				onValueChange={([next]) => {
					const columns = trackColumns(track, next!)
					setHeld({columns, live: true})
					zoomTo(columns, true)
				}}
				onValueCommit={([next]) => {
					const columns = trackColumns(track, next!)
					// Above the seam the grid is already at the stop it was let go
					// on, so the thumb takes its place there rather than keeping
					// the fraction the finger stopped at
					setHeld(Math.round(columns) === Math.round(committed) ? null : {columns, live: false})
					zoomTo(columns, false)
				}}
				// A mouse with no trackpad has no other way in
				onWheel={(event) => {
					if (event.timeStamp - wheel.current.at > WHEEL_IDLE_MS) wheel.current.distance = 0
					wheel.current.at = event.timeStamp
					wheel.current.distance +=
						event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * WHEEL_LINE_PX : event.deltaY
					const steps = Math.trunc(wheel.current.distance / WHEEL_STEP_PX)
					if (steps === 0) return
					wheel.current.distance -= steps * WHEEL_STEP_PX
					step(steps)
				}}
				onKeyDown={(event) => {
					const page = PAGE_STEPS[event.key]
					if (page !== undefined) {
						event.preventDefault()
						click(page, 3)
						return
					}
					const by = event.key === 'Home' ? Infinity : event.key === 'End' ? -Infinity : KEY_STEPS[event.key]
					if (by === undefined) return
					event.preventDefault()
					step(by)
				}}
			>
				<SliderPrimitive.Track className={sliderTrackClass} />
				<SliderPrimitive.Thumb
					aria-label={t('photos-actions.grid-size')}
					aria-valuetext={t('photos-actions.grid-size-value', {count: columns})}
					className={sliderThumbClass}
				/>
			</SliderPrimitive.Root>
			<PillButtonGroupItem
				icon={Plus}
				aria-label={t('photos-actions.zoom-in')}
				disabled={disabled || columns <= track.min}
				className='touch-none'
				onPointerDown={press(-1)}
				onClick={(event) => event.detail === 0 && click(-1)}
			/>
		</PillButtonGroup>
	)
}
