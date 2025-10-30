import {motion} from 'framer-motion'

import {t} from '@/utils/i18n'

export function MinimizedContent({count}: {count: number}) {
	return (
		<div className='flex size-full items-center gap-2 px-2'>
			<div className='relative inline-flex size-4 items-center justify-center'>
				{/* Small circular progress bar */}
				<motion.svg
					className='size-4'
					viewBox='0 0 16 16'
					animate={{rotate: 360}}
					transition={{
						repeat: Infinity,
						duration: 1.0,
						ease: 'linear',
					}}
				>
					<defs>
						<linearGradient id='minimizedFormattingGradient' x1='0%' y1='0%' x2='100%' y2='100%'>
							<stop offset='0%' stopColor='hsl(var(--color-brand))' />
							<stop offset='100%' stopColor='hsl(var(--color-brand-lightest))' />
						</linearGradient>
					</defs>
					{/* Background circle */}
					<circle cx='8' cy='8' r='6' stroke='currentColor' strokeWidth='1.5' fill='none' className='text-white/10' />
					{/* Progress arc */}
					<circle
						cx='8'
						cy='8'
						r='6'
						stroke='url(#minimizedFormattingGradient)'
						strokeWidth='1.5'
						fill='none'
						strokeDasharray='18.84 18.84'
						strokeLinecap='round'
					/>
				</motion.svg>
			</div>
			<div className='min-w-0 flex-1'>
				<span className='block truncate text-center text-xs text-white/90'>
					{t('files-formatting-island.formatting')}
				</span>
			</div>
			{/* Reserve right-side space to match other islands' layout */}
			<div className='flex shrink-0 items-center gap-2'>
				<span className='text-xs text-white/60'>{count}</span>
			</div>
		</div>
	)
}
