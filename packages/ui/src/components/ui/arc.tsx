import React from 'react'

interface ProgressArcProps {
	/** Progress from 0 to 1 */
	progress: number
	size: number // Size of the SVG (width and height)
	strokeWidth: number
}

// Used ChatGPT to generate the basics of the arc, then added `circleFraction` and other things myself
export const Arc: React.FC<ProgressArcProps> = ({progress, size, strokeWidth}) => {
	const radius = (size - strokeWidth) / 2
	const circumference = 2 * Math.PI * radius

	// 1 means it's a circle. 0.5 means it's a half circle
	const circleFraction = 0.7

	const outline = circumference - circumference * circleFraction
	const offset = circumference - progress * circumference * circleFraction

	// SVG Path for a circle, but with the stroke offset to create the gap
	const arcPath = `
        M ${size / 2}, ${size / 2}
        m 0, -${radius}
        a ${radius},${radius} 0 1,1 0,${2 * radius}
        a ${radius},${radius} 0 1,1 0,-${2 * radius}
    `

	// Rotate the arc so the opening/gap is at the bottom
	const arcAngle = (360 * circleFraction) / 2

	const arcStyle = {
		'--full-length': circumference,
		'--final-offset': offset,
		animation: `animate-arc 400ms ease-out forwards`,
	}

	return (
		<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
			<path
				className='stroke-white/10'
				d={arcPath}
				fill='none'
				strokeWidth={strokeWidth}
				strokeDasharray={circumference}
				strokeDashoffset={outline}
				strokeLinecap='round'
				transform={`rotate(-${arcAngle} ${size / 2} ${size / 2})`}
			/>
			<path
				className='stroke-white'
				d={arcPath}
				fill='none'
				strokeWidth={strokeWidth}
				strokeDasharray={circumference}
				// strokeDashoffset={offset}
				strokeLinecap='round'
				transform={`rotate(-${arcAngle} ${size / 2} ${size / 2})`}
				style={arcStyle}
			/>
		</svg>
	)
}
