import {motion, useReducedMotion} from 'motion/react'

import {POINTER_SHAPE} from '../agent-pointer'

// A lightweight, local replay. It never contacts or controls a machine.
export function MachineAgentPreview() {
	const reduced = useReducedMotion()
	return (
		<div
			aria-hidden
			className='relative h-40 overflow-hidden rounded-20 border border-white/10 bg-[linear-gradient(135deg,#23374b,#352755)]'
		>
			<div className='absolute inset-x-9 top-6 bottom-5 overflow-hidden rounded-xl border border-white/15 bg-[#1a1d2b]/90 shadow-xl'>
				<div className='flex h-7 items-center gap-1.5 border-b border-white/5 px-3'>
					<i className='size-1.5 rounded-full bg-[#ff6059]' />
					<i className='size-1.5 rounded-full bg-[#ffbd2e]' />
					<i className='size-1.5 rounded-full bg-[#28c840]' />
				</div>
				<div className='space-y-2.5 px-4 py-3'>
					<div className='h-1.5 w-3/4 rounded bg-white/20' />
					<div className='h-1.5 w-1/2 rounded bg-white/10' />
					<motion.div
						className='h-5 w-24 rounded-md bg-[#7168ff]/70'
						animate={reduced ? undefined : {opacity: [0.7, 0.7, 1, 0.7]}}
						transition={{duration: 5, repeat: Infinity}}
					/>
				</div>
			</div>
			<motion.svg
				viewBox='-3 -3 38 38'
				className='absolute top-14 left-12 size-7 drop-shadow-lg'
				animate={
					reduced ? {x: 85, y: 40} : {x: [15, 95, 95, 150, 15], y: [0, 48, 48, 14, 0], scale: [1, 1, 0.94, 1, 1]}
				}
				transition={{
					duration: 5,
					times: [0, 0.3, 0.4, 0.72, 1],
					repeat: Infinity,
					repeatDelay: 0.8,
					ease: [0.45, 0, 0.2, 1],
				}}
			>
				<path d={POINTER_SHAPE} fill='#7168ff' stroke='#cdcaff' strokeWidth={2.4} />
			</motion.svg>
		</div>
	)
}
