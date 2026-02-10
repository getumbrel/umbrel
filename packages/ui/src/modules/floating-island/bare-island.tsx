import {motion, useWillChange} from 'framer-motion'
import {Children, isValidElement, useEffect, useRef, useState} from 'react'
import {RiCloseLine} from 'react-icons/ri'

// Animation configurations
const spring = {
	type: 'spring' as const,
	stiffness: 400,
	damping: 30,
}

// Size presets
const islandSizes = {
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

interface IslandProps {
	id: string
	children: React.ReactNode
	onClose?: () => void
	nonDismissable?: boolean
	// When true, the island will expand and cannot be minimized. Useful for critical states like imminent reboots.
	forceExpanded?: boolean
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

export const Island = ({children, onClose, nonDismissable, forceExpanded}: IslandProps) => {
	const [isExpanded, setIsExpanded] = useState(true)
	const islandRef = useRef<HTMLDivElement>(null)
	const willChange = useWillChange()

	// Force expansion when forceExpanded prop is true
	useEffect(() => {
		if (forceExpanded) {
			setIsExpanded(true)
		}
	}, [forceExpanded])

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
	}

	// Use forceExpanded to prevent minimizing, or use internal state
	const effectiveExpanded = forceExpanded || isExpanded
	const size = effectiveExpanded ? islandSizes.expanded : islandSizes.minimized

	// Find and render the appropriate child component
	const childArray = Children.toArray(children)
	const minimizedChild = childArray.find((child) => isValidElement(child) && child.type === IslandMinimized)
	const expandedChild = childArray.find((child) => isValidElement(child) && child.type === IslandExpanded)

	// Minimize island and stop propagation so dialogs below don't also close
	const handleBackdropClick = (e: React.MouseEvent | React.TouchEvent | React.PointerEvent) => {
		e.stopPropagation()
		if (!forceExpanded) {
			setIsExpanded(false)
		}
	}

	return (
		<div className='flex justify-center md:block'>
			{/* Full-screen backdrop when expanded: captures outside clicks to minimize island first,
			    stopping propagation so dialogs below stay open. Provides layered dismissal UX. */}
			{effectiveExpanded && !forceExpanded && (
				<div
					className='fixed inset-0'
					onClick={handleBackdropClick}
					onPointerDown={handleBackdropClick}
					onTouchStart={handleBackdropClick}
				/>
			)}
			<motion.div
				ref={islandRef}
				className='relative select-none bg-black text-white shadow-floating-island'
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
				onClick={handleIslandClick}
				onPointerDown={handlePointerDown}
			>
				<div className='absolute inset-0'>
					{effectiveExpanded ? expandedChild : minimizedChild}
					{effectiveExpanded && onClose && !nonDismissable && (
						<motion.button
							className='absolute right-4 top-4 rounded-full bg-white/10 p-1 transition-colors hover:bg-white/20'
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
