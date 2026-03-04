import {motion} from 'motion/react'
import {memo, useEffect, useState} from 'react'

import {LaserEngraving} from './laser-engraving'

// Render canvas at 2x for retina sharpness, CSS scales it down to display size
const CANVAS_SCALE = 2
// Canvas is tall so smoke particles have room to rise and fade naturally
const ENGRAVE_DISPLAY_HEIGHT = 150
const ENGRAVE_CANVAS_WIDTH = 400 * CANVAS_SCALE
const ENGRAVE_CANVAS_HEIGHT = ENGRAVE_DISPLAY_HEIGHT * CANVAS_SCALE
const COVER_SLIDE_DELAY = 1.0 // seconds to wait after scale-up before cover slides

const AnimatedUmbrelProIcon = memo(({serialNumber = ''}: {serialNumber?: string}) => {
	const [scaleComplete, setScaleComplete] = useState(false)
	const [coverLifted, setCoverLifted] = useState(false)
	const [engraveReady, setEngraveReady] = useState(false)

	// Add a delay between scale-up completing and cover sliding
	useEffect(() => {
		if (!scaleComplete) return
		const timer = setTimeout(() => setCoverLifted(true), COVER_SLIDE_DELAY * 1000)
		return () => clearTimeout(timer)
	}, [scaleComplete])

	return (
		<motion.div
			className='relative mb-3 w-full'
			style={{aspectRatio: '1 / 1', maxWidth: 400}}
			initial={{scale: 1, opacity: 1}}
			animate={{scale: 1, opacity: 1}}
			transition={{duration: 0.6, ease: [0.22, 1, 0.36, 1]}}
			onAnimationComplete={() => setScaleComplete(true)}
		>
			{/* Clipped container for the device images and cover slide */}
			<div className='absolute inset-0 mt-8'>
				{/* Layer 1: Bottom plate (revealed surface where serial gets engraved) */}
				<img
					src='/assets/umbrel-pro-bottom.webp'
					className='pointer-events-none absolute inset-0 h-full w-full object-contain'
					style={{filter: 'drop-shadow(-8px 12px 20px rgba(0, 0, 0, 0.55)) brightness(0.85)'}}
					draggable={false}
				/>

				{/* Layer 3: Cover plate that slides up to reveal bottom */}
				<motion.img
					src='/assets/umbrel-pro-bottom-cover.webp'
					className='pointer-events-none absolute inset-0 m-auto h-[97%] w-[97%] object-contain'
					style={{filter: 'drop-shadow(-8px 12px 20px rgba(0, 0, 0, 0.55))'}}
					draggable={false}
					initial={{y: 0}}
					animate={{y: coverLifted ? '-25%' : 0}}
					transition={{duration: 0.8, ease: [0.22, 1, 0.36, 1]}}
					onAnimationComplete={() => {
						if (coverLifted) setEngraveReady(true)
					}}
				/>
			</div>

			{/* Layer 2: Laser engraving — outside the clipped container so smoke can overflow */}
			{serialNumber && engraveReady && (
				<div
					className='pointer-events-none absolute left-0 flex w-full items-end justify-center'
					style={{bottom: '-12%', height: ENGRAVE_DISPLAY_HEIGHT}}
				>
					<LaserEngraving
						text={`Serial ${serialNumber}`}
						width={ENGRAVE_CANVAS_WIDTH}
						height={ENGRAVE_CANVAS_HEIGHT}
						fontSize={22}
						backgroundColor='transparent'
						engravingColor='#555555'
						speed={16}
						delay={0.3}
						className='w-full'
					/>
				</div>
			)}
		</motion.div>
	)
})

export default AnimatedUmbrelProIcon
