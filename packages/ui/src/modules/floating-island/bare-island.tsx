import {AnimatePresence, motion, useIsPresent, useReducedMotion} from 'motion/react'
import {Children, isValidElement, useEffect, useRef, useState} from 'react'
import {RiCloseLine} from 'react-icons/ri'
import {useWindowSize} from 'react-use'

import {cn} from '@/lib/utils'

import {ISLAND_HEIGHT, LANE_EDGE, useLaneStore} from './lane'
import {laneSpring, useLaneBottom} from './row'

// Size presets
export const islandSizes = {
	minimized: {
		width: 150,
		height: ISLAND_HEIGHT,
		borderRadius: 22,
	},
	expanded: {
		width: 371,
		height: 180,
		borderRadius: 32,
	},
}

export type IslandSizes = typeof islandSizes
type IslandSize = IslandSizes['minimized']

interface IslandProps {
	id: string
	children: React.ReactNode
	onClose?: () => void
	nonDismissable?: boolean
	// When true, the island will expand and cannot be minimized. Useful for critical states like imminent reboots.
	forceExpanded?: boolean
	// Initial state only: pass false to appear minimized until the user taps it.
	defaultExpanded?: boolean
	// Per-island size presets; defaults to the standard sizes above
	sizes?: IslandSizes
	// Re-expands the island whenever this value changes (new work arriving)
	expandKey?: unknown
	// An automatic expansion (appearing, or expandKey changing) settles back
	// into the pill after this many ms. The user's own taps never settle, and
	// touching the island cancels a pending one.
	minimizeAfter?: number
	// Extra classes for the expanded card only (e.g. a glass surface). A card
	// that lets its content overflow still clips it while it opens and closes.
	expandedClassName?: string
	// The least space a card keeps from each side of the screen
	edgeInset?: number
}

interface IslandChildProps {
	children: React.ReactNode
}

export const IslandMinimized = ({children}: IslandChildProps) => {
	return <>{children}</>
}

export const IslandExpanded = ({children}: IslandChildProps) => {
	return <>{children}</>
}

// A pill resting in the lane above the dock that opens into a card.
//
// The surface is one box whose size springs between the two presets. It sits
// in the row's normal layout (row.tsx), so the row gives way around it as it
// grows. Its two faces are laid out once each, at the size they will end up,
// and cross-fade while the box moves around them: nothing inside reflows or
// slides on the way.
export const Island = ({
	id,
	children,
	onClose,
	nonDismissable,
	forceExpanded,
	defaultExpanded = true,
	sizes,
	expandKey,
	minimizeAfter,
	expandedClassName,
	edgeInset = LANE_EDGE,
}: IslandProps) => {
	const [isExpanded, setIsExpanded] = useState(defaultExpanded)
	const islandRef = useRef<HTMLDivElement>(null)
	const minimizeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
	const lastExpandKeyRef = useRef(expandKey)
	const reducedMotion = useReducedMotion()

	// Force expansion when forceExpanded prop is true
	useEffect(() => {
		if (forceExpanded) {
			setIsExpanded(true)
		}
	}, [forceExpanded])

	// Automatic expansions — appearing, and every expandKey change — settle
	// back into the pill after minimizeAfter, unless the user engages first
	// (see handlePointerDown). The user's own taps never settle. New work is
	// detected by comparing expandKey against the last one seen, not by "has
	// this effect run before": StrictMode double-invokes the mount effect, which
	// used to expand islands that asked to appear minimized.
	useEffect(() => {
		if (forceExpanded) return
		const newWork = !Object.is(lastExpandKeyRef.current, expandKey)
		lastExpandKeyRef.current = expandKey
		if (newWork) setIsExpanded(true)
		else if (!defaultExpanded) return
		if (minimizeAfter === undefined) return
		const timer = setTimeout(() => setIsExpanded(false), minimizeAfter)
		minimizeTimerRef.current = timer
		return () => clearTimeout(timer)
	}, [defaultExpanded, expandKey, forceExpanded, minimizeAfter])

	// Use forceExpanded to prevent minimizing, or use internal state
	const expanded = forceExpanded || isExpanded

	// Minimize when clicking anywhere outside the island. Uses a window-level listener
	// so clicks pass through naturally to the dock, dialogs, and other UI — no blocking backdrop needed.
	useEffect(() => {
		if (!isExpanded || forceExpanded) return

		const handleClickOutside = (e: PointerEvent) => {
			if (islandRef.current?.contains(e.target as Node)) return
			setIsExpanded(false)
		}

		window.addEventListener('pointerdown', handleClickOutside)
		return () => window.removeEventListener('pointerdown', handleClickOutside)
	}, [isExpanded, forceExpanded])

	// Stop propagation on both click and pointerdown to prevent Radix dialogs from
	// detecting this as an "outside" interaction and closing (Radix uses pointer events)
	const handleIslandClick = (e: React.MouseEvent) => {
		e.stopPropagation()
		if (!isExpanded) {
			setIsExpanded(true)
		}
	}

	const handlePointerDown = (e: React.PointerEvent) => {
		e.stopPropagation()
		// The user is engaging: a pending auto-settle would yank the island away
		clearTimeout(minimizeTimerRef.current)
	}

	// From the keyboard: Enter or Space opens the pill, Escape closes the card
	// and hands focus back to the island
	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (!expanded && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
			e.preventDefault()
			setIsExpanded(true)
		} else if (isExpanded && !forceExpanded && e.key === 'Escape') {
			e.stopPropagation()
			islandRef.current?.focus()
			setIsExpanded(false)
		}
	}

	// An open card on a phone takes the whole row: the lane hides Search
	const changeExpandedCount = useLaneStore((state) => state.changeExpandedCount)
	useEffect(() => {
		if (!expanded) return
		changeExpandedCount(1)
		return () => changeExpandedCount(-1)
	}, [expanded, changeExpandedCount])

	// Both faces fit the screen: no wider than it, no taller than the room
	// above the lane. Capped here rather than with max-width, so the spring
	// always runs between sizes that are really shown.
	const {width: windowWidth, height: windowHeight} = useWindowSize()
	const laneBottom = useLaneBottom()
	const preset = sizes ?? islandSizes
	const fit = (size: IslandSize): IslandSize => ({
		...size,
		width: Math.max(0, Math.min(size.width, windowWidth - edgeInset * 2)),
		height: Math.max(ISLAND_HEIGHT, Math.min(size.height, windowHeight - laneBottom - LANE_EDGE)),
	})
	const minimizedSize = fit(preset.minimized)
	const expandedSize = fit(preset.expanded)
	const size = expanded ? expandedSize : minimizedSize

	// From a tap until the surface has settled on its new size. Meanwhile each
	// face holds the size it is headed for (or had), and nothing spills out.
	const [morphing, setMorphing] = useState(false)
	const [settledExpanded, setSettledExpanded] = useState(expanded)
	if (settledExpanded !== expanded) {
		setSettledExpanded(expanded)
		setMorphing(true)
	}

	// Find and render the appropriate child component
	const childArray = Children.toArray(children)
	const minimizedChild = childArray.find((child) => isValidElement(child) && child.type === IslandMinimized)
	const expandedChild = childArray.find((child) => isValidElement(child) && child.type === IslandExpanded)

	return (
		<motion.div
			ref={islandRef}
			className={cn(
				// An island's sizes are fixed, so its text keeps its size whatever the text size setting
				'relative overflow-hidden bg-black text-white shadow-floating-island outline-offset-2 outline-white/60 [--text-boost:0px] focus-visible:outline-2',
				expanded && expandedClassName,
			)}
			style={morphing ? {overflow: 'hidden'} : undefined}
			initial={false}
			animate={{
				width: size.width,
				height: size.height,
				borderRadius: size.borderRadius,
			}}
			transition={reducedMotion ? {duration: 0} : laneSpring}
			onAnimationComplete={() => setMorphing(false)}
			data-island={id}
			// The row keeps an open card in view (lane.ts)
			data-island-open={expanded || undefined}
			// Focusable either way, so focus stays put as the pill becomes a card
			role={expanded ? 'group' : 'button'}
			tabIndex={0}
			aria-expanded={expanded ? undefined : false}
			onClick={handleIslandClick}
			onPointerDown={handlePointerDown}
			onKeyDown={handleKeyDown}
		>
			<AnimatePresence initial={false}>
				{expanded ? (
					<IslandFace key='expanded' size={expandedSize} held={morphing} reducedMotion={reducedMotion}>
						{expandedChild}
						{onClose && !nonDismissable && (
							<button
								className='absolute top-4 right-4 rounded-full bg-white/10 p-1 transition-colors hover:bg-white/20'
								onClick={(e) => {
									e.stopPropagation()
									onClose()
								}}
							>
								<RiCloseLine className='h-4 w-4 text-white' />
							</button>
						)}
					</IslandFace>
				) : (
					<IslandFace key='minimized' size={minimizedSize} held={morphing} reducedMotion={reducedMotion}>
						{minimizedChild}
					</IslandFace>
				)}
			</AnimatePresence>
		</motion.div>
	)
}

// One face of an island: the pill's or the card's. At rest it fills the
// surface. While the surface is on its way to or from the other face, it holds
// its own full size, pinned to the bottom centre (the edge the island rests
// on), and the surface simply uncovers or covers it. The face arriving fades
// in a beat behind the one leaving, so the two are never read at once.
function IslandFace({
	size,
	held,
	reducedMotion,
	children,
}: {
	size: IslandSize
	held: boolean
	reducedMotion: boolean | null
	children: React.ReactNode
}) {
	// A face on its way out keeps the props it last had, so it holds from here
	const isPresent = useIsPresent()
	const hold = held || !isPresent

	return (
		<motion.div
			className={hold ? 'absolute bottom-0 left-1/2 origin-bottom -translate-x-1/2' : 'absolute inset-0 origin-bottom'}
			style={hold ? {width: size.width, height: size.height} : undefined}
			initial={{opacity: 0, scale: 0.96}}
			animate={{
				opacity: 1,
				scale: 1,
				transition: reducedMotion ? {duration: 0} : {duration: 0.2, delay: 0.08, ease: 'easeOut'},
			}}
			exit={{opacity: 0, transition: {duration: reducedMotion ? 0 : 0.1, ease: 'easeOut'}}}
		>
			{children}
		</motion.div>
	)
}
