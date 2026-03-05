import React from 'react'

interface CircularProgressProps {
	progress: number
	size?: number
	strokeWidth?: number
	children?: React.ReactNode
}

export const CircularProgress: React.FC<CircularProgressProps> = ({progress, size = 20, strokeWidth = 2, children}) => {
	const radius = (size - strokeWidth) / 2
	const circumference = radius * 2 * Math.PI
	const offset = circumference - (progress / 100) * circumference

	return (
		<div className='relative inline-flex items-center justify-center transition-transform'>
			<svg width={size} height={size} className='-rotate-90 transform'>
				{/* Background circle */}
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					strokeWidth={strokeWidth}
					stroke='rgba(255, 255, 255, 0.2)'
					fill='none'
				/>
				{/* Progress circle */}
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					strokeWidth={strokeWidth}
					fill='none'
					strokeLinecap='round'
					className='stroke-brand'
					style={{
						strokeDasharray: circumference,
						strokeDashoffset: offset,
						transition: 'stroke-dashoffset 0.3s ease',
					}}
				/>
			</svg>
			<div className='absolute inset-0 flex items-center justify-center text-white'>{children}</div>
		</div>
	)
}
