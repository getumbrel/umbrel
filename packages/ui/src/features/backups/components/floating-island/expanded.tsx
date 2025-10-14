import {motion} from 'framer-motion'

import {BackupDeviceIcon} from '@/features/backups/components/backup-device-icon'
import {ScrollArea} from '@/shadcn-components/ui/scroll-area'
import {t} from '@/utils/i18n'

type Progress = {name: string; percent: number; path?: string}

export function ExpandedContent({progresses}: {progresses: Progress[]}) {
	// Single backup - show circular progress
	if (progresses.length === 1) {
		const progress = progresses[0]
		const radius = 40
		const circumference = 2 * Math.PI * radius
		const strokeDashoffset = circumference - (progress.percent / 100) * circumference

		return (
			<div className='flex size-full items-center justify-between overflow-hidden px-8 py-6'>
				{/* Left side */}
				<div className='flex flex-col gap-1'>
					<div className='truncate text-sm tracking-tight text-white/90'>
						{t('backups-floating-island.backing-up-to')}
					</div>
					<div className='truncate text-xs font-normal text-white/50'>{progress.name}</div>
					<div className='mt-2 flex items-baseline gap-1'>
						<div className='text-5xl font-light tracking-tight text-white'>{progress.percent.toFixed(0)}</div>
						<div className='font-medium text-white/40'>%</div>
					</div>
				</div>

				{/* Right side */}
				<motion.div
					className='relative flex items-center justify-center'
					initial={{scale: 0.6, opacity: 0, rotate: -10}}
					animate={{scale: 1, opacity: 1, rotate: 0}}
					exit={{scale: 0.6, opacity: 0, rotate: 10}}
					transition={{
						type: 'spring',
						stiffness: 300,
						damping: 20,
						delay: 0.05,
					}}
				>
					{/* Subtle background glow */}
					<motion.div
						className='absolute inset-0 rounded-full bg-gradient-to-br from-brand/30 to-transparent'
						initial={{scale: 0.8, opacity: 0}}
						animate={{scale: 1, opacity: 1}}
						exit={{scale: 0.8, opacity: 0}}
						transition={{
							type: 'spring',
							stiffness: 400,
							damping: 25,
							delay: 0.1,
						}}
					/>

					{/* Main progress ring */}
					<svg className='relative size-28 -rotate-90' viewBox='0 0 112 112'>
						<defs>
							<linearGradient id='progressGradient' x1='0%' y1='0%' x2='100%' y2='100%'>
								<stop offset='0%' stopColor='hsl(var(--color-brand))' />
								<stop offset='100%' stopColor='hsl(var(--color-brand-lightest))' />
							</linearGradient>
							<filter id='glow'>
								<feGaussianBlur stdDeviation='2' result='coloredBlur' />
								<feMerge>
									<feMergeNode in='coloredBlur' />
									<feMergeNode in='SourceGraphic' />
								</feMerge>
							</filter>
						</defs>
						{/* Background circle */}
						<circle
							cx='56'
							cy='56'
							r={radius}
							stroke='currentColor'
							strokeWidth='3'
							fill='none'
							className='text-white/10'
						/>
						{/* Progress circle with gradient */}
						<circle
							cx='56'
							cy='56'
							r={radius}
							stroke='url(#progressGradient)'
							strokeWidth='3'
							fill='none'
							strokeDasharray={circumference}
							strokeDashoffset={strokeDashoffset}
							className='transition-all duration-700 ease-out'
							strokeLinecap='round'
							filter='url(#glow)'
						/>
					</svg>

					{/* Icon container */}
					<motion.div
						className='absolute inset-0 flex items-center justify-center'
						initial={{scale: 0.7, opacity: 0}}
						animate={{scale: 1, opacity: 1}}
						exit={{scale: 0.7, opacity: 0}}
						transition={{
							type: 'spring',
							stiffness: 350,
							damping: 22,
							delay: 0.2,
						}}
					>
						<motion.div
							className='relative rounded-full border border-white/10 bg-white/5 p-3'
							initial={{scale: 0.8, opacity: 0}}
							animate={{scale: 1, opacity: 1}}
							exit={{scale: 0.8, opacity: 0}}
							transition={{
								type: 'spring',
								stiffness: 400,
								damping: 20,
								delay: 0.25,
							}}
						>
							{progress.path ? (
								<BackupDeviceIcon path={progress.path} className='size-12 p-1' />
							) : (
								<div className='size-12' />
							)}
						</motion.div>
					</motion.div>
				</motion.div>
			</div>
		)
	}

	// Multiple backups - show list view
	return (
		<div className='flex h-full w-full flex-col overflow-hidden py-5'>
			<div className='mb-4 flex items-center justify-between px-5'>
				<span className='text-xs text-white/60'>{t('backups-floating-island.backing-up-to')}</span>
			</div>

			<ScrollArea className='flex-1 px-5 pb-1'>
				<div className='space-y-3'>
					{progresses.map((p) => (
						<div key={p.name} className='flex items-center gap-3'>
							{p.path ? (
								<BackupDeviceIcon path={p.path} className='size-7 shrink-0' />
							) : (
								<div className='size-6 shrink-0' />
							)}
							<div className='min-w-0 flex-1'>
								<div className='flex items-center justify-between text-xs text-white/70'>
									<span className='truncate'>{p.name}</span>
									<span className='shrink-0 text-white/60'>{p.percent.toFixed(0)}%</span>
								</div>
								<div className='relative mt-1 h-1 overflow-hidden rounded-full bg-white/20'>
									<div
										className='absolute left-0 top-0 h-full rounded-full bg-brand transition-all duration-300'
										style={{width: `${p.percent}%`}}
									/>
								</div>
							</div>
						</div>
					))}
				</div>
			</ScrollArea>
		</div>
	)
}
