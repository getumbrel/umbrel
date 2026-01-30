import {motion} from 'framer-motion'

import {type RaidProgress} from '@/features/storage/hooks/use-raid-progress'
import {t} from '@/utils/i18n'

import {DataStreamIcon} from './data-stream-icon'
import {raidOperationLabels} from './index'

export function ExpandedContent({operation}: {operation: RaidProgress}) {
	const label = t(raidOperationLabels[operation.type])
	const isRebooting = operation.state === 'rebooting'

	const getStateDescription = () => {
		// restart warning for failsafe-transition syncing phase
		if (isRebooting) {
			// TODO: Add countdown timer when we use realtime events for system status instead of polling
			return t('storage-manager.operation.restarting')
		}
		if (operation.type === 'failsafe-transition' && operation.state === 'syncing') {
			return t('storage-manager.operation.syncing-restarts')
		}
		if (operation.state === 'adding') {
			return t('storage-manager.operation.adding-ssd')
		}
		if (operation.state === 'starting') {
			return t('storage-manager.operation.starting')
		}
		return operation.state
	}
	const stateDescription = getStateDescription()

	// Progress ring calculations
	const radius = 40
	const circumference = 2 * Math.PI * radius
	const strokeDashoffset = circumference - (operation.progress / 100) * circumference

	// Check if operation is complete
	const isComplete = operation.state === 'finished' || operation.state === 'complete'
	const isCanceled = operation.state === 'canceled'

	return (
		<div className='flex size-full items-center justify-between overflow-hidden px-8 py-6'>
			{/* Left side */}
			<div className='flex flex-col gap-1'>
				<div className='truncate text-sm tracking-tight text-white/90'>{label}</div>
				<div className='truncate text-xs font-normal text-white/50'>{stateDescription}</div>
				<div className='mt-2 flex items-baseline gap-1'>
					<div className='text-5xl font-light tracking-tight text-white'>{Math.round(operation.progress)}</div>
					<div className='font-medium text-white/40'>%</div>
				</div>
			</div>

			{/* Right side - Progress ring */}
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
					className={`absolute inset-0 rounded-full bg-gradient-to-br ${
						isComplete ? 'from-brand/50' : 'from-brand/30'
					} to-transparent`}
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
						<linearGradient id='raidProgressGradient' x1='0%' y1='0%' x2='100%' y2='100%'>
							<stop offset='0%' stopColor='hsl(var(--color-brand))' />
							<stop offset='100%' stopColor='hsl(var(--color-brand-lightest))' />
						</linearGradient>
						<filter id='raidGlow'>
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
						stroke='url(#raidProgressGradient)'
						strokeWidth='3'
						fill='none'
						strokeDasharray={circumference}
						strokeDashoffset={isCanceled ? circumference : strokeDashoffset}
						className='transition-all duration-700 ease-out'
						strokeLinecap='round'
						filter='url(#raidGlow)'
					/>
				</svg>

				{/* Data stream visualization */}
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
					<DataStreamIcon size={22} isActive={!isComplete && !isCanceled} />
				</motion.div>
			</motion.div>
		</div>
	)
}
