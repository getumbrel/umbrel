import {motion} from 'framer-motion'

import {cn} from '@/shadcn-lib/utils'

interface CircularProgressProps {
	progress?: number // Accept 1 to 100 (e.g. 50 = 50%)
	className?: string
	progressColor?: string
	trackColor?: string
}

export const CircularProgress = ({
	progress = 50,
	className = 'bg-gray-200',
	progressColor = '#FFFFFF',
	trackColor = 'transparent',
}: CircularProgressProps) => {
	// Clamp the progress between 0 and 1
	const clampedProgress = Math.max(0, Math.min(progress / 100, 1))

	// Convert progress to degrees for the conic-gradient
	const degrees = clampedProgress * 360

	// Using a conic-gradient for the progress circle
	const gradient = `conic-gradient(${progressColor} ${degrees}deg, ${trackColor} ${degrees}deg)`

	return (
		<div className='absolute left-0 top-0 flex h-full w-full justify-center '>
			<motion.div
				className={cn(
					'mt-6 rounded-full',
					'h-[30px] w-[30px]',
					'shadow-[inset_0_0_0_2px_rgba(255,255,255,0.4)]',
					className,
				)}
				style={{
					background: gradient,
				}}
				animate={{
					background: gradient,
				}}
				transition={{
					background: {
						duration: 0.3,
						ease: 'easeOut',
					},
				}}
			/>
		</div>
	)
}
