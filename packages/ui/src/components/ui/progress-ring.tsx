import {cn} from '@/lib/utils'

const RADIUS = 6.25
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

// A small ring that fills clockwise from the top as `fraction` goes from 0
// to 1, in white over a faint track. Sized by its `className`.
export function ProgressRing({fraction, className}: {fraction: number; className?: string}) {
	// A sliver of arc even at 0% so the ring never looks inert
	const arc = Math.min(Math.max(fraction, 0.03), 1)
	return (
		<svg
			viewBox='0 0 16 16'
			className={cn('-rotate-90', className)}
			fill='none'
			strokeWidth={2}
			strokeLinecap='round'
			aria-hidden='true'
		>
			<circle cx='8' cy='8' r={RADIUS} className='stroke-white/15' />
			<circle
				cx='8'
				cy='8'
				r={RADIUS}
				strokeDasharray={CIRCUMFERENCE}
				strokeDashoffset={CIRCUMFERENCE * (1 - arc)}
				className='stroke-white/70 transition-[stroke-dashoffset] duration-500 ease-out'
			/>
		</svg>
	)
}
