import {AnimatePresence, motion} from 'motion/react'

import UmbrelLogo from '@/components/umbrel-logo'
import {cn} from '@/lib/utils'

// Full-screen staged-progress layout: a breathing, glowing Umbrel logo above a
// crossfading stage label, a thin progress bar, and a quiet footnote.
//
// Preserved from the 2026-08 onboarding design exploration ("Breeze" concept's
// setup screen) — intended as a future replacement for the covers that show
// long-running system operations (umbrelOS updates, migration, backup restore,
// RAID setup). Not wired up anywhere yet.
//
// Purely presentational: the caller owns translation and progress state.

const EASE = [0.16, 1, 0.3, 1] as const

export function StagedProgressLayout({
	label,
	progress,
	footnote,
	className,
}: {
	/** Current stage description (e.g. "Creating your storage pool"). Crossfades when it changes. */
	label: string
	/** Overall progress from 0 to 1. Omit for an indeterminate bar. */
	progress?: number
	/** Quiet reassurance line under the bar (e.g. "Keep Umbrel Pro plugged in."). */
	footnote?: string
	className?: string
}) {
	return (
		<div className={cn('flex flex-col items-center px-6 text-center', className)}>
			<motion.div
				animate={{scale: [1, 1.06, 1], opacity: [0.8, 1, 0.8]}}
				transition={{duration: 2.6, repeat: Infinity, ease: 'easeInOut'}}
				style={{filter: 'drop-shadow(0 0 24px rgba(255,255,255,0.35))'}}
			>
				<UmbrelLogo className='w-[88px]' />
			</motion.div>

			{/* At least a line of the label tall, so swapping labels doesn't move the bar below */}
			<div className='mt-10 min-h-[1lh] text-16'>
				<AnimatePresence mode='wait'>
					<motion.p
						key={label}
						initial={{opacity: 0, y: 8}}
						animate={{opacity: 1, y: 0, transition: {duration: 0.4, ease: EASE}}}
						exit={{opacity: 0, y: -8, transition: {duration: 0.25}}}
						className='text-16 font-medium text-white/85'
					>
						{label}
					</motion.p>
				</AnimatePresence>
			</div>

			<div
				className={cn(
					'mt-5 h-1 w-[300px] overflow-hidden rounded-full bg-white/10',
					progress === undefined && 'umbrel-bouncing-gradient',
				)}
			>
				{progress !== undefined && (
					<div
						className='h-full rounded-full bg-white transition-[width] duration-150 ease-linear'
						style={{width: `${Math.min(Math.max(progress, 0), 1) * 100}%`}}
					/>
				)}
			</div>

			{footnote && <p className='mt-6 text-13 text-white/35'>{footnote}</p>}
		</div>
	)
}
