import {HTMLMotionProps, motion, MotionValue, SpringOptions, useSpring, useTransform, Variants} from 'framer-motion'
import {useEffect, useRef, useState} from 'react'
import {Link, LinkProps} from 'react-router-dom'

import {cn} from '@/shadcn-lib/utils'

import {NotificationBadge} from '../ui/notification-badge'
import {ICON_SIDE, ICON_SIDE_ZOOMED} from './dock'

type HTMLDivProps = HTMLMotionProps<'div'>
type DockItemProps = {
	notificationCount?: number
	bg?: string
	open?: boolean
	mouseX: MotionValue<number>
	to?: LinkProps['to']
} & HTMLDivProps

const BOUNCE_DURATION = 0.4

export function DockItem({
	bg,
	mouseX,
	notificationCount,
	open,
	className,
	style,
	to,
	onClick,
	...props
}: DockItemProps) {
	const [clickedOpen, setClickedOpen] = useState(false)
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

	const widthSync = useTransform(distance, [-150, 0, 150], [ICON_SIDE, ICON_SIDE_ZOOMED, ICON_SIDE])
	const width = useSpring(widthSync, springOptions)

	const scaleSync = useTransform(distance, [-150, 0, 150], [1, ICON_SIDE_ZOOMED / ICON_SIDE, 1])
	const transform = useSpring(scaleSync, springOptions)

	// Config from:
	// https://github.com/ysj151215/big-sur-dock/blob/04a7244beb0d35d22d1bb18ad91b4c0021bf5ec4/components/dock/DockItem.tsx
	const variants: Variants = {
		open: {
			transition: {
				default: {
					duration: 0.2,
				},
				translateY: {
					duration: BOUNCE_DURATION,
					ease: 'easeInOut',
					times: [0, 0.5, 1],
				},
			},
			translateY: [0, -20, 0],
		},
		closed: {},
	}
	const variant = open && clickedOpen ? 'open' : 'closed'

	return (
		<motion.div ref={ref} className='relative aspect-square' style={{width}}>
			{/* icon glow */}
			<div
				className='absolute h-full w-full bg-cover opacity-30'
				style={{
					backgroundImage: `url(${bg})`,
					filter: 'blur(16px)',
					transform: 'translateY(4px)',
				}}
			/>
			{/* icon */}
			<motion.div
				className={cn('relative origin-top-left bg-cover', className)}
				style={{
					width: ICON_SIDE,
					height: ICON_SIDE,
					backgroundImage: bg
						? `url(${bg})`
						: // TODO: use a better default
						  `linear-gradient(to bottom right, white, black)`,
					scale: transform,
					...style,
				}}
				onClick={(e) => {
					setClickedOpen(true)
					onClick?.(e)
				}}
				{...props}
				variants={variants}
				animate={variant}
			>
				<Link to={to || '/'} className='absolute inset-0' unstable_viewTransition />
				{!!notificationCount && <NotificationBadge count={notificationCount} />}
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
