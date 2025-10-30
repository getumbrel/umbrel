import {motion} from 'framer-motion'

import externalStorageIcon from '@/features/files/assets/external-storage-icon.png'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {ScrollArea} from '@/shadcn-components/ui/scroll-area'
import {t} from '@/utils/i18n'

type FormattingDevice = {
	id: string
	name: string
	size: number
}

export function ExpandedContent({devices}: {devices: FormattingDevice[]}) {
	// Single device - show circular spinning progress
	if (devices.length === 1) {
		const device = devices[0]

		return (
			<div className='flex size-full items-center justify-between overflow-hidden px-8 py-6'>
				{/* Left side */}
				<div className='flex min-w-0 flex-1 flex-col gap-2 pr-2'>
					<div className='truncate text-sm tracking-tight text-white/60'>{t('files-formatting-island.formatting')}</div>
					<div className='truncate text-3xl font-light tracking-tight text-white'>{`${device.name.slice(0, 9)}${device.name.length > 9 ? '...' : ''}`}</div>
					<div className='truncate text-sm tracking-tight text-white/60'>{formatFilesystemSize(device.size)}</div>
				</div>

				{/* Right side - Spinning progress indicator */}
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

					{/* Spinning progress ring */}
					<motion.svg
						className='relative size-28'
						viewBox='0 0 112 112'
						animate={{rotate: 360}}
						transition={{
							repeat: Infinity,
							duration: 1.0,
							ease: 'linear',
						}}
					>
						<defs>
							<linearGradient id='formattingGradient' x1='0%' y1='0%' x2='100%' y2='100%'>
								<stop offset='0%' stopColor='hsl(var(--color-brand))' />
								<stop offset='100%' stopColor='hsl(var(--color-brand-lightest))' />
							</linearGradient>
						</defs>
						{/* Background circle */}
						<circle
							cx='56'
							cy='56'
							r='40'
							stroke='currentColor'
							strokeWidth='3'
							fill='none'
							className='text-white/10'
						/>
						{/* Partial progress arc - clean spinner */}
						<circle
							cx='56'
							cy='56'
							r='40'
							stroke='url(#formattingGradient)'
							strokeWidth='3'
							fill='none'
							strokeDasharray='125.6 125.6'
							strokeLinecap='round'
						/>
					</motion.svg>

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
							<img src={externalStorageIcon} alt='External Storage' className='size-11' draggable={false} />
						</motion.div>
					</motion.div>
				</motion.div>
			</div>
		)
	}

	// Multiple devices - show list view with sliding progress bars
	return (
		<div className='flex h-full w-full flex-col overflow-hidden py-5'>
			<div className='mb-4 flex items-center justify-between px-5'>
				<span className='text-xs text-white/60'>
					{devices.length > 1
						? t('files-formatting-island.formatting-drives', {count: devices.length})
						: t('files-formatting-island.formatting')}
				</span>
			</div>

			<ScrollArea className='flex-1 px-5 pb-1'>
				<div className='space-y-3'>
					{devices.map((device) => (
						<div key={device.id} className='flex items-center gap-3'>
							<img src={externalStorageIcon} alt='External Storage' className='size-7 shrink-0' draggable={false} />
							<div className='min-w-0 flex-1'>
								<div className='flex items-center justify-between text-xs text-white/70'>
									<span className='truncate'>{device.name}</span>
								</div>
								{/* Indeterminate progress bar with sliding animation */}
								<div className='relative mt-1 h-1 overflow-hidden rounded-full bg-white/20'>
									<motion.div
										className='absolute left-0 top-0 h-full w-1/3 rounded-full bg-brand'
										animate={{
											x: ['-100%', '300%'],
										}}
										transition={{
											repeat: Infinity,
											duration: 1.5,
											ease: 'easeInOut',
										}}
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
