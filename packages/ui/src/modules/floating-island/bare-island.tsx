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
const sizes = {
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

export const Island = ({children, onClose, nonDismissable}: IslandProps) => {
	const [isExpanded, setIsExpanded] = useState(true)
	const islandRef = useRef<HTMLDivElement>(null)
	const willChange = useWillChange()

	// Expand the island on click
	const handleIslandClick = () => {
		if (!isExpanded) {
			setIsExpanded(true)
		}
	}

	const size = isExpanded ? sizes.expanded : sizes.minimized

	// Find and render the appropriate child component
	const childArray = Children.toArray(children)
	const minimizedChild = childArray.find((child) => isValidElement(child) && child.type === IslandMinimized)
	const expandedChild = childArray.find((child) => isValidElement(child) && child.type === IslandExpanded)

	// Add touch/click outside handler
	// to minimize the island when clicking outside of it
	useEffect(() => {
		// If the island isn't expanded we don't need to listen for outside clicks
		if (!isExpanded) return

		const handleInteractionOutside = (event: MouseEvent | TouchEvent) => {
			if (islandRef.current && !islandRef.current.contains(event.target as Node)) {
				setIsExpanded(false)
			}
		}

		document.addEventListener('touchstart', handleInteractionOutside)
		document.addEventListener('mousedown', handleInteractionOutside)

		return () => {
			document.removeEventListener('touchstart', handleInteractionOutside)
			document.removeEventListener('mousedown', handleInteractionOutside)
		}
	}, [isExpanded])

	return (
		<div className='flex justify-center md:block'>
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
			>
				<div className='absolute inset-0'>
					{isExpanded ? expandedChild : minimizedChild}
					{isExpanded && onClose && !nonDismissable && (
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
