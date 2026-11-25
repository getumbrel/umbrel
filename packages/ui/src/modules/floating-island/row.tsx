import {AnimatePresence, motion, useIsPresent, useReducedMotion} from 'motion/react'
import {useLayoutEffect, useRef} from 'react'

import {cn} from '@/lib/utils'
import {useDockClearance} from '@/modules/desktop/dock'

import {attachRow, ISLAND_HEIGHT, LANE_EDGE, LANE_GAP, SEARCH_DOCK_GAP, SEARCH_HEIGHT, useLaneStore} from './lane'

// The one spring everything in the row moves on. Critically damped: a card
// opens, an island arrives, the row makes way, and nothing overshoots.
export const laneSpring = {type: 'spring' as const, stiffness: 400, damping: 40}

// Room above and below the islands, so the strip doesn't clip their shadows
const SHADOW_ROOM = 32

// How far the row's baseline sits above the bottom of the screen: islands rest
// on Search's row, centred on its line, above the dock
export function useLaneBottom() {
	return useDockClearance() + SEARCH_DOCK_GAP - (ISLAND_HEIGHT - SEARCH_HEIGHT) / 2
}

// The islands' row, the same at every size: a strip across the bottom of the
// screen with the islands centred in it, in normal layout. So a card opening
// in the middle of the row pushes its neighbours aside as it grows, with no
// measuring and nothing to catch up. If the row outgrows the screen (a phone
// with a card open, a tablet with many jobs running) the strip scrolls
// sideways, and an open card is kept in view (lane.ts).
//
// Only the islands take pointer events, so the strip never blocks what is
// beneath it, yet a swipe on any of them scrolls it.
export function IslandRow({children, className}: {children: React.ReactNode; className?: string}) {
	const bottom = useLaneBottom()
	const setSearchSlot = useLaneStore((state) => state.setSearchSlot)
	const scrollerRef = useRef<HTMLDivElement>(null)
	const trackRef = useRef<HTMLDivElement>(null)
	const islandsRef = useRef<HTMLDivElement>(null)

	useLayoutEffect(() => {
		const [scroller, track, islands] = [scrollerRef.current, trackRef.current, islandsRef.current]
		if (!scroller || !track || !islands) return
		return attachRow({scroller, track, islands})
	}, [])

	return (
		<div
			ref={scrollerRef}
			data-island-row
			className={cn(
				// Between the safe areas, so the row centres where the dock does
				'umbrel-hide-scrollbar pointer-events-none fixed right-(--safe-right) left-(--safe-left) overflow-x-auto overflow-y-hidden overscroll-x-contain',
				className,
			)}
			style={{bottom: bottom - SHADOW_ROOM}}
		>
			<div
				ref={trackRef}
				className='mx-auto flex w-max items-end'
				// With each island's own half gap, the row keeps LANE_EDGE from the
				// edges: as much as a card does, so one card alone never scrolls
				style={{paddingBlock: SHADOW_ROOM, paddingInline: LANE_EDGE - LANE_GAP / 2}}
			>
				{/* On phones Search renders itself in here (desktop-misc.tsx) */}
				<div ref={setSearchSlot} className='contents' />
				<div ref={islandsRef} className='flex items-end'>
					<AnimatePresence initial={false}>{children}</AnimatePresence>
				</div>
			</div>
		</div>
	)
}

// An island on its way in or out is never drawn smaller than this
const SMALLEST_SCALE = 0.7
// ...and fades across this stretch of its room opening
const FADE = {from: 0.4, to: 0.9}

// One place in the row. Its room opens as the island arrives and closes as it
// leaves, on the row's spring, so the neighbours (and Search) glide apart and
// back together instead of jumping.
//
// One number drives all of it: --island-room, 0 with no room and 1 with all
// of it. The room is that fraction of whatever the island measures right now
// (so a card that opens while it is still arriving is followed exactly), and
// the island is scaled to the same fraction, about the edge it rests on, and
// fades with it. So while it can be seen it fills the room it has, instead of
// lying over a neighbour or Search on its way in or out, and it grows out of
// that edge rather than from nothing.
//
// Each item carries half the lane's gap on either side, so a row of them is
// symmetric about its centre whatever is coming or going.
//
// An island usually leaves because what it showed is over: the song was
// closed, the clipboard emptied, the backup finished. Its content empties in
// the same commit that asks it to leave. So what leaves is a still copy of
// the island as it last looked (the ghost), taken before that commit touches
// the DOM, and the room keeps the width it had.
export function LaneItem({children}: {children: React.ReactNode}) {
	const reducedMotion = useReducedMotion()
	const isPresent = useIsPresent()
	const roomRef = useRef<HTMLDivElement>(null)
	const islandRef = useRef<HTMLDivElement>(null)
	const ghostRef = useRef<HTMLElement>(null)

	// Rendering comes before the commit, so the island is still whole here
	if (!isPresent && !ghostRef.current && islandRef.current) ghostRef.current = stillCopy(islandRef.current)

	useLayoutEffect(() => {
		const [room, island, ghost] = [roomRef.current, islandRef.current, ghostRef.current]
		if (isPresent || !room || !island || !ghost) return
		island.style.display = 'none'
		room.appendChild(ghost)
		// Called back before it had left
		return () => {
			ghost.remove()
			ghostRef.current = null
			island.style.display = ''
		}
	}, [isPresent])

	// The island's own width in layout, fractions of a pixel included, whatever
	// it is scaled to. Resize observers run before paint, so the room follows
	// a card's spring in the same frame.
	useLayoutEffect(() => {
		const [room, island] = [roomRef.current, islandRef.current]
		if (!isPresent || !room || !island) return
		const setWidth = (width: number) => room.style.setProperty('--island-width', `${width}px`)
		setWidth(island.offsetWidth)
		const observer = new ResizeObserver(([entry]) => setWidth(entry.borderBoxSize[0].inlineSize))
		observer.observe(island)
		return () => observer.disconnect()
	}, [isPresent])

	return (
		<motion.div
			ref={roomRef}
			className='flex shrink-0 items-end justify-center'
			style={{width: 'calc(var(--island-room) * var(--island-width))'}}
			initial={{'--island-room': 0}}
			animate={{'--island-room': 1}}
			exit={{'--island-room': 0}}
			transition={reducedMotion ? {duration: 0} : laneSpring}
		>
			<div
				ref={islandRef}
				className='pointer-events-auto shrink-0 origin-bottom'
				style={{
					paddingInline: LANE_GAP / 2,
					scale: `max(${SMALLEST_SCALE}, var(--island-room))`,
					opacity: `calc((var(--island-room) - ${FADE.from}) / ${FADE.to - FADE.from})`,
				}}
			>
				{children}
			</div>
		</motion.div>
	)
}

// A copy of an island for it to leave as: looks the same, does nothing
function stillCopy(island: HTMLElement) {
	const copy = island.cloneNode(true) as HTMLElement
	// A copied player would load its media again
	for (const media of copy.querySelectorAll('audio, video, iframe')) media.remove()
	copy.inert = true
	copy.setAttribute('aria-hidden', 'true')
	copy.style.pointerEvents = 'none'
	return copy
}
