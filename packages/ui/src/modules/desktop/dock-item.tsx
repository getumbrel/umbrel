import {
	AnimatePresence,
	HTMLMotionProps,
	motion,
	MotionValue,
	SpringOptions,
	useSpring,
	useTransform,
} from 'motion/react'
import {useEffect, useRef, useState} from 'react'
import {Link, LinkProps} from 'react-router-dom'

import {darkTooltipClass} from '@/components/ui/dark-tooltip'
import {NotificationBadge} from '@/components/ui/notification-badge'
import {cn} from '@/lib/utils'

type HTMLDivProps = HTMLMotionProps<'div'>
type DockItemProps = {
	notificationCount?: number
	label?: string
	bg?: string
	open?: boolean
	mouseX: MotionValue<number>
	to?: LinkProps['to']
	iconSize: number
	iconSizeZoomed: number
	className?: string
	style?: React.CSSProperties
	onClick?: (e: React.MouseEvent) => void
} & HTMLDivProps

// Matches the umbrel-dock-bounce duration in index.css; the open pill waits
// out the bounce before fading in
const BOUNCE_DURATION = 0.4

export function DockItem({
	bg,
	label,
	mouseX,
	notificationCount,
	open,
	className,
	style,
	to,
	onClick,
	iconSize,
	iconSizeZoomed,
	...props
}: DockItemProps) {
	const [clickedOpen, setClickedOpen] = useState(false)
	const [hovered, setHovered] = useState(false)
	const ref = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!open) setClickedOpen(false)
	}, [open])

	const distance = useTransform(mouseX, (val) => {
		const bounds = ref.current?.getBoundingClientRect() ?? {x: 0, width: 0}

		return val - bounds.x - bounds.width / 2
	})

	const springOptions: SpringOptions = {
		mass: 0.1,
		stiffness: 150,
		damping: 10,
	}

	// The icon is laid out at its magnified size rather than scaled up with a
	// transform: Safari rasterizes a scaled icon at its resting size and stretches
	// that bitmap, so magnified icons came out soft. Only the badge still scales.
	const widthSync = useTransform(distance, [-150, 0, 150], [iconSize, iconSizeZoomed, iconSize])
	const width = useSpring(widthSync, springOptions)

	const scaleSync = useTransform(distance, [-150, 0, 150], [1, iconSizeZoomed / iconSize, 1])
	const badgeScale = useSpring(scaleSync, springOptions)

	return (
		<motion.div
			ref={ref}
			// Lift the hovered item so its label clears the neighbouring icon glows
			className={cn('relative aspect-square', hovered && 'z-10')}
			style={{width}}
			// Pointer type check so a tap on touch doesn't leave a label stuck open
			onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(true)}
			onPointerLeave={() => setHovered(false)}
		>
			<AnimatePresence>
				{label && hovered && (
					<motion.div
						initial={{opacity: 0, y: 4}}
						animate={{opacity: 1, y: 0}}
						exit={{opacity: 0, y: 4}}
						transition={{duration: 0.15, ease: 'easeOut'}}
						// Anchored off the dock baseline rather than the icon's top edge, so the
						// label holds still while the icon breathes under the magnification spring
						style={{x: '-50%', bottom: iconSizeZoomed + 7}}
						className={cn(darkTooltipClass, 'pointer-events-none absolute left-1/2')}
					>
						{label}
					</motion.div>
				)}
			</AnimatePresence>
			{/* icon glow */}
			<div
				className='absolute hidden h-full w-full bg-cover opacity-30 md:block'
				style={{
					backgroundImage: `url(${bg})`,
					filter: 'blur(16px)',
					transform: 'translateY(4px)',
				}}
			/>
			{/* icon */}
			<motion.div
				className={cn(
					'relative bg-cover transition-[filter] has-[:focus-visible]:brightness-125',
					// CSS bounce (see index.css) instead of a motion variant: a JS-driven
					// bounce stutters while the sheet's route mounts on the main thread
					open && clickedOpen && 'umbrel-dock-bounce',
					className,
				)}
				style={{
					width,
					height: width,
					backgroundImage: bg
						? `url(${bg})`
						: // TODO: use a better default
							`linear-gradient(to bottom right, white, black)`,
					...style,
				}}
				{...props}
			>
				<Link
					to={to || '/'}
					className='absolute inset-0 outline-hidden'
					onClick={(e) => {
						setClickedOpen(true)
						if (onClick) {
							onClick(e)
						}
					}}
				/>
				{!!notificationCount && (
					// Grows with the icon from its top-right corner, as it did when the
					// whole icon was scaled
					<motion.div className='absolute top-0 right-0 origin-top-right' style={{scale: badgeScale}}>
						<NotificationBadge count={notificationCount} />
					</motion.div>
				)}
			</motion.div>
			{open && <OpenPill />}
		</motion.div>
	)
}

function OpenPill() {
	return (
		<motion.div
			className='absolute -bottom-[7px] left-1/2 h-[2px] w-[10px] -translate-x-1/2 rounded-full bg-white'
			initial={{
				opacity: 0,
			}}
			animate={{
				opacity: 1,
				transition: {
					delay: BOUNCE_DURATION,
				},
			}}
		/>
	)
}
