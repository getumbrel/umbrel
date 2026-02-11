import {motion} from 'motion/react'
import {memo, useCallback, useState} from 'react'

import {cn} from '@/lib/utils'

import {LaserEngraving} from './laser-engraving'

const AnimatedUmbrelHomeIcon = memo(
	({modelNumber = '', serialNumber = ''}: {modelNumber?: string; serialNumber?: string}) => {
		// Update transforms to return 0 when flipped
		const [isFlipped, setIsFlipped] = useState(false)

		// Track number of clicks
		const [clicks, setClicks] = useState(0)

		const handleClick = useCallback(() => {
			const totalClicks = clicks + 1
			setClicks(totalClicks)
			if (totalClicks === 3) {
				setIsFlipped(true)
			}
		}, [clicks])

		const footVariants = {
			hidden: {rotate: 180, opacity: 0},
			visible: {rotate: 0, opacity: 1, transition: {duration: 0.5}},
		}

		return (
			<motion.div
				style={{
					display: 'flex',
					justifyContent: 'center',
					alignItems: 'center',
					outline: 'none',
					height: '128px',
					width: '128px',
				}}
				animate={{
					height: isFlipped ? '335px' : '128px',
					width: isFlipped ? '335px' : '128px',
				}}
				tabIndex={-1}
				whileTap={{
					scale: isFlipped ? 1 : 0.97,
				}}
				whileHover={{
					scale: isFlipped ? 1 : 1.03,
				}}
				onClick={handleClick}
			>
				<div className='flex h-full w-full items-center justify-center'>
					<div
						className={cn(
							'relative h-full w-full overflow-hidden bg-linear-to-tr from-neutral-800 via-neutral-900 to-neutral-800',
							{
								'rounded-[3.5rem]': isFlipped,
								'rounded-[1.3rem]': !isFlipped,
							},
						)}
					>
						<div className='absolute top-[-25%] left-[-25%] h-[150%] w-[150%] animate-spin bg-[conic-gradient(from_0deg,transparent_0deg,rgba(255,255,255,0.3)_40deg,rgba(255,255,255,0.25)_80deg,transparent_120deg)] [animation-duration:_20s]'></div>
						<div className='absolute top-[-25%] left-[-25%] h-[150%] w-[150%] animate-spin bg-[conic-gradient(from_180deg,transparent_0deg,rgba(255,255,255,0.3)_40deg,rgba(255,255,255,0.25)_80deg,transparent_120deg)] [animation-duration:_20s]'></div>
						<div
							className={cn(
								'absolute top-[1.5px] left-[1.5px] flex h-[calc(100%-3px)] w-[calc(100%-3px)] items-center justify-center bg-linear-to-tr from-neutral-900 via-neutral-950 to-neutral-800 text-xs',
								{
									'rounded-[3.5rem]': isFlipped,
									'rounded-[1.3rem]': !isFlipped,
								},
							)}
						>
							{isFlipped ? (
								<>
									<div
										className='absolute top-0 left-0 h-full w-full opacity-10'
										style={{
											backgroundImage: isFlipped ? 'url(/assets/umbrel-home-device-info-grain.png)' : 'none',
											backgroundBlendMode: 'overlay',
											backgroundSize: 'cover',
										}}
									></div>
									<div className='pointer-events-none absolute flex h-full w-full'>
										<motion.div
											initial='hidden'
											animate='visible'
											variants={{
												hidden: {},
												visible: {
													transition: {
														staggerChildren: 0,
														delayChildren: 0.2,
													},
												},
											}}
										>
											<motion.div
												variants={footVariants}
												className='absolute top-[8%] left-[8%] h-[44px] w-[44px] rounded-full border border-black/50 bg-black/40 shadow-[0_2px_4px_rgba(0,0,0,0.4),inset_0_1px_2px_rgba(255,255,255,0.15)]'
											/>
											<motion.div
												variants={footVariants}
												className='absolute top-[8%] right-[8%] h-[44px] w-[44px] rounded-full border border-black/50 bg-black/40 shadow-[0_2px_4px_rgba(0,0,0,0.4),inset_0_1px_2px_rgba(255,255,255,0.15)]'
											/>
											<motion.div
												variants={footVariants}
												className='absolute right-[8%] bottom-[8%] h-[44px] w-[44px] rounded-full border border-black/50 bg-black/40 shadow-[0_2px_4px_rgba(0,0,0,0.4),inset_0_1px_2px_rgba(255,255,255,0.15)]'
											/>
											<motion.div
												variants={footVariants}
												className='absolute bottom-[8%] left-[8%] h-[44px] w-[44px] rounded-full border border-black/50 bg-black/40 shadow-[0_2px_4px_rgba(0,0,0,0.4),inset_0_1px_2px_rgba(255,255,255,0.15)]'
											/>
										</motion.div>
									</div>
									<div className='pointer-events-none relative h-full w-full'>
										<div className='absolute top-1/2 left-1/2 w-full -translate-x-1/2 -translate-y-1/2 text-center text-[11px] text-white/60'>
											<motion.div
												initial={{opacity: 0}}
												animate={{opacity: 0.6}}
												transition={{delay: 0.2, duration: 0.5, ease: [0.22, 1, 0.36, 1]}}
												className='flex flex-wrap justify-center'
											>
												<span className='inline whitespace-pre'>Designed by Umbrel. Assembled in China.</span>
											</motion.div>
										</div>
										<div className='absolute bottom-[20%] left-1/2 flex -translate-x-1/2 flex-col items-center gap-2'>
											<motion.div
												initial={{opacity: 0}}
												animate={{opacity: 1}}
												transition={{duration: 0.5, delay: 0.2, ease: [0.22, 1, 0.36, 1]}}
												className='text-[9px] text-white/40'
											>
												Model {modelNumber}&nbsp;&nbsp;&nbsp;Rated 12V ⎓ 2.5A
											</motion.div>
											<motion.img
												initial={{opacity: 0}}
												animate={{opacity: 0.35}}
												transition={{delay: 0.2, duration: 0.5, ease: [0.22, 1, 0.36, 1]}}
												src='/assets/umbrel-home-certifications.svg'
												className='w-[80px]'
												draggable='false'
											/>
											<LaserEngraving
												text={`Serial ${serialNumber}`}
												className='absolute top-[-6px] left-0'
												backgroundColor='transparent'
												engravingColor='#3F3F3F'
												speed={10}
												delay={0.5}
											/>
										</div>
									</div>
								</>
							) : (
								<svg width='51' height='25' viewBox='0 0 569 280' fill='none' xmlns='http://www.w3.org/2000/svg'>
									<mask
										id='mask0_26_11'
										style={{maskType: 'alpha'}}
										maskUnits='userSpaceOnUse'
										x='0'
										y='0'
										width='569'
										height='280'
									>
										<path
											fillRule='evenodd'
											clipRule='evenodd'
											d='M281.001 52.1822C343.327 50.9851 392.381 67.7244 430.42 100.664C458.068 124.59 481.196 158.188 499.077 202.567C485.449 199.214 471.046 197.569 455.967 197.569C424.084 197.569 395.459 204.931 371.612 220.952C344.886 204.692 316.162 196.133 285.718 196.133C254.595 196.133 224.711 205.091 196.347 221.85C168.961 204.672 138.118 196.153 104.456 196.153C92.303 196.153 80.676 197.276 69.708 199.627C85.7836 158.809 107.05 127.343 132.881 104.276C169.781 71.3356 218.394 53.3793 281.001 52.1822ZM4.88818 268.469C8.57466 273.602 14.0193 277.241 20.2214 278.672C26.9648 280.227 34.0513 279.046 39.9217 275.386C42.4384 273.818 44.6431 271.849 46.4638 269.581C57.8781 256.512 75.6752 248.226 104.456 248.226C131.761 248.226 155.169 255.788 175.658 270.751L176.457 271.35C181.883 275.38 188.429 277.627 195.19 277.781C201.951 277.934 208.593 275.987 214.197 272.208C238.664 255.688 262.371 248.226 285.718 248.226C308.666 248.226 330.914 255.408 352.962 271.05L353.422 271.37C365.675 280.108 382.326 279.35 393.72 269.534C408.292 256.985 428.242 249.662 455.967 249.662C485.331 249.662 508.078 257.882 525.989 273.125C528.597 275.343 531.617 277.027 534.877 278.08C538.136 279.133 541.572 279.534 544.987 279.262C548.403 278.99 551.731 278.049 554.782 276.492C557.833 274.936 560.547 272.796 562.769 270.193C564.991 267.59 566.678 264.575 567.732 261.322C568.787 258.068 569.19 254.639 568.917 251.23C568.784 249.569 568.492 247.929 568.047 246.332C547.348 166.285 513.502 103.616 464.622 61.2801C415.208 18.504 352.922 -1.32776 279.981 0.0688505C207.38 1.46546 145.973 22.6739 98.0793 65.45C50.533 107.904 18.7264 169.413 0.726395 247.192C0.0814305 249.862 -0.142033 252.642 0.0880995 255.431C0.450913 259.828 1.92223 264.018 4.3136 267.635C4.50003 267.917 4.6916 268.195 4.88818 268.469Z'
											fill='white'
										/>
									</mask>
									<g mask='url(#mask0_26_11)'>
										<rect
											className='origin-center animate-spin [animation-duration:20s]'
											x='-61'
											y='-186'
											width='700'
											height='700'
											fill='url(#paint0_linear_26_11)'
											style={{willChange: 'transform', transform: 'translateZ(0)', overflow: 'hidden'}} // Fix for flickering in Chrome around edges
										/>
									</g>
									<defs>
										<linearGradient
											id='paint0_linear_26_11'
											x1='142'
											y1='-171'
											x2='436'
											y2='501'
											gradientUnits='userSpaceOnUse'
										>
											<stop stopColor='#202020' />
											<stop offset='0.365' stopColor='#3E3E3E' />
											<stop offset='0.494166' stopColor='#858585' />
											<stop offset='0.650946' stopColor='#333333' />
											<stop offset='0.998941' stopColor='#3F3F3F' />
										</linearGradient>
									</defs>
								</svg>
							)}
						</div>
					</div>
				</div>
			</motion.div>
		)
	},
)

export default AnimatedUmbrelHomeIcon
