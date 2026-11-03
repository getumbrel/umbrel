import {motion, useWillChange} from 'motion/react'
import {Children, isValidElement, useEffect, useRef, useState} from 'react'
import {RiCloseLine} from 'react-icons/ri'

import {cn} from '@/lib/utils'

import {useLaneStore} from './lane'

// Animation configurations
const spring = {
	type: 'spring' as const,
	stiffness: 400,
	damping: 30,
}

// Size presets
export const islandSizes = {
	minimized: {
		width: 150,
		height: 40,
		borderRadius: 22,
	},
	expanded: {
		width: 371,
		height: 180,
		borderRadius: 32,
	},
}

export type IslandSizes = typeof islandSizes

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
	// Extra classes for the expanded pill only (e.g. a glass surface)
	expandedClassName?: string
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

export const Island = ({
	children,
	onClose,
	nonDismissable,
	forceExpanded,
	defaultExpanded = true,
	sizes,
	expandKey,
	minimizeAfter,
	expandedClassName,
}: IslandProps) => {
	const [isExpanded, setIsExpanded] = useState(defaultExpanded)
	const islandRef = useRef<HTMLDivElement>(null)
	const willChange = useWillChange()
	const minimizeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
	const lastExpandKeyRef = useRef(expandKey)

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

	// Minimize when clicking anywhere outside the island. Uses a window-level listener
	// so clicks pass through naturally to the dock, dialogs, and other UI — no blocking backdrop needed.
	useEffect(() => {
		if (!isExpanded && !forceExpanded) return
		if (forceExpanded) return

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

	// Use forceExpanded to prevent minimizing, or use internal state
	const effectiveExpanded = forceExpanded || isExpanded

	// An open card on a phone takes the whole row: the lane hides Search
	const changeExpandedCount = useLaneStore((state) => state.changeExpandedCount)
	useEffect(() => {
		if (!effectiveExpanded) return
		changeExpandedCount(1)
		return () => changeExpandedCount(-1)
	}, [effectiveExpanded, changeExpandedCount])

	const size = (sizes ?? islandSizes)[effectiveExpanded ? 'expanded' : 'minimized']

	// Find and render the appropriate child component
	const childArray = Children.toArray(children)
	const minimizedChild = childArray.find((child) => isValidElement(child) && child.type === IslandMinimized)
	const expandedChild = childArray.find((child) => isValidElement(child) && child.type === IslandExpanded)

	return (
		<div className='flex justify-center md:block'>
			<motion.div
				ref={islandRef}
				// The viewport cap keeps wide presets (Photos uploads) on-screen on
				// phones; overflow-hidden keeps content inside the pill while the
				// expand/minimize spring is still in flight
				className={cn(
					'relative max-w-[calc(100vw-16px)] overflow-hidden bg-black text-white shadow-floating-island',
					effectiveExpanded && expandedClassName,
				)}
				style={{
					// TODO: debug using var in color-mix on macOS safari
					// backgroundColor: 'color-mix(in srgb, #000000 95%, rgb(var(--color-brand)) 5%)',
					willChange,
				}}
				animate={{
					width: size.width,
					height: size.height,
					borderRadius: size.borderRadius,
				}}
				transition={spring}
				// The phone row keeps an open card in view (container.tsx)
				data-island-open={effectiveExpanded || undefined}
				onClick={handleIslandClick}
				onPointerDown={handlePointerDown}
			>
				<div className='absolute inset-0'>
					{effectiveExpanded ? expandedChild : minimizedChild}
					{effectiveExpanded && onClose && !nonDismissable && (
						<motion.button
							className='absolute top-4 right-4 rounded-full bg-white/10 p-1 transition-colors hover:bg-white/20'
							initial={{scale: 0}}
							animate={{scale: 1}}
							onClick={(e) => {
								e.stopPropagation()
								onClose()
							}}
						>
							<RiCloseLine className='h-4 w-4 text-white' />
						</motion.button>
					)}
				</div>
			</motion.div>
		</div>
	)
}
