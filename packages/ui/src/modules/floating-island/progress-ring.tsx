import {motion} from 'motion/react'
import {useId, type ReactNode} from 'react'

import {cn} from '@/lib/utils'

const RADIUS = 40
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

// The hero of a single-item island: a 112px gradient ring around an icon, with
// the staggered spring entrance every island shares.
//
// - `percent` undefined is indeterminate: an empty, pulsing ring.
// - `transition` eases each discrete progress step over 700ms. Pass false when
//   the caller already tweens percent per frame (useAnimatedNumber): a CSS
//   transition restarted every frame makes the ring trail the number.
// - The glow is a blurred twin of the arc rather than an SVG filter, which
//   WebKit doesn't reliably repaint when a filtered element's offset changes.
// - The gradient id is per instance, so rings sharing a page never paint from
//   each other's defs.
export function ProgressRing({
	percent,
	transition = true,
	emphasized,
	children,
}: {
	percent?: number
	transition?: boolean
	// Brighter halo, e.g. once the work has finished
	emphasized?: boolean
	// Rendered centred inside the ring
	children?: ReactNode
}) {
	const gradientId = `progress-ring-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
	const clamped = percent === undefined ? 0 : Math.min(100, Math.max(0, percent))
	const strokeDashoffset = CIRCUMFERENCE - (clamped / 100) * CIRCUMFERENCE
	const arcClassName = transition ? 'transition-[stroke-dashoffset] duration-700 ease-out' : undefined

	return (
		<motion.div
			className='relative flex shrink-0 items-center justify-center'
			initial={{scale: 0.6, opacity: 0, rotate: -10}}
			animate={{scale: 1, opacity: 1, rotate: 0}}
			exit={{scale: 0.6, opacity: 0, rotate: 10}}
			transition={{type: 'spring', stiffness: 300, damping: 20, delay: 0.05}}
		>
			{/* Subtle background halo */}
			<motion.div
				className={cn(
					'absolute inset-0 rounded-full bg-linear-to-br to-transparent',
					emphasized ? 'from-brand/50' : 'from-brand/30',
				)}
				initial={{scale: 0.8, opacity: 0}}
				animate={{scale: 1, opacity: 1}}
				exit={{scale: 0.8, opacity: 0}}
				transition={{type: 'spring', stiffness: 400, damping: 25, delay: 0.1}}
			/>

			<svg
				className={cn('relative size-28 -rotate-90', percent === undefined && 'motion-safe:animate-pulse')}
				viewBox='0 0 112 112'
			>
				<defs>
					<linearGradient id={gradientId} x1='0%' y1='0%' x2='100%' y2='100%'>
						<stop offset='0%' stopColor='hsl(var(--color-brand))' />
						<stop offset='100%' stopColor='hsl(var(--color-brand-lightest))' />
					</linearGradient>
				</defs>
				{/* Track */}
				<circle
					cx='56'
					cy='56'
					r={RADIUS}
					strokeWidth='3'
					fill='none'
					className='stroke-white/10 contrast-more:stroke-white/25'
				/>
				{/* Glow: a wider, blurred, dimmer twin of the arc */}
				<circle
					cx='56'
					cy='56'
					r={RADIUS}
					stroke={`url(#${gradientId})`}
					strokeWidth='5'
					fill='none'
					strokeDasharray={CIRCUMFERENCE}
					strokeLinecap='round'
					className={cn('opacity-60 blur-[2px]', arcClassName)}
					style={{strokeDashoffset}}
				/>
				{/* Arc */}
				<circle
					cx='56'
					cy='56'
					r={RADIUS}
					stroke={`url(#${gradientId})`}
					strokeWidth='3'
					fill='none'
					strokeDasharray={CIRCUMFERENCE}
					strokeLinecap='round'
					className={arcClassName}
					style={{strokeDashoffset}}
				/>
			</svg>

			{/* Centre slot */}
			<motion.div
				className='absolute inset-0 flex items-center justify-center'
				initial={{scale: 0.7, opacity: 0}}
				animate={{scale: 1, opacity: 1}}
				exit={{scale: 0.7, opacity: 0}}
				transition={{type: 'spring', stiffness: 350, damping: 22, delay: 0.2}}
			>
				{children}
			</motion.div>
		</motion.div>
	)
}

// The bordered disc most islands put their icon in at the ring's centre
export function ProgressRingBadge({children}: {children: ReactNode}) {
	return (
		<motion.div
			className='relative rounded-full border border-white/10 bg-white/5 p-3'
			initial={{scale: 0.8, opacity: 0}}
			animate={{scale: 1, opacity: 1}}
			exit={{scale: 0.8, opacity: 0}}
			transition={{type: 'spring', stiffness: 400, damping: 20, delay: 0.25}}
		>
			{children}
		</motion.div>
	)
}
