import {useTranslation} from 'react-i18next'

import {ProgressRing} from '@/modules/floating-island/progress-ring'

import {DataStreamIcon, type DriveVariant} from './data-stream-icon'
import {raidOperationLabels, type IslandRaidProgress} from './index'

export function ExpandedContent({
	operation,
	deviceType = 'ssd',
}: {
	operation: IslandRaidProgress
	deviceType?: DriveVariant
}) {
	const {t} = useTranslation()
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
			return t('storage-manager.operation.adding')
		}
		if (operation.state === 'starting') {
			return t('storage-manager.operation.starting')
		}
		if (operation.state === 'finished' || operation.state === 'complete') {
			return t('storage-manager.operation.completed')
		}
		if (operation.state === 'canceled') {
			return t('storage-manager.operation.canceled')
		}
		// In-progress states (expanding/rebuilding/syncing) already read from the label
		// above - never leak the raw internal state string
		return ''
	}
	const stateDescription = getStateDescription()

	// Check if operation is complete
	const isComplete = operation.state === 'finished' || operation.state === 'complete'
	const isCanceled = operation.state === 'canceled'

	return (
		<div className='flex size-full items-center justify-between gap-4 overflow-hidden px-8 py-6'>
			{/* Left side */}
			<div className='flex min-w-0 flex-col gap-1'>
				<div className='truncate text-sm tracking-tight text-white/90'>{label}</div>
				<div className='truncate text-xs font-normal text-white/50'>{stateDescription}</div>
				<div className='mt-2 flex items-baseline gap-1'>
					<div className='text-5xl font-light tracking-tight text-white'>{Math.round(operation.progress)}</div>
					<div className='font-medium text-white/40'>%</div>
				</div>
			</div>

			{/* Right side - progress ring around the data stream visualization */}
			<ProgressRing percent={isCanceled ? 0 : operation.progress} emphasized={isComplete}>
				<DataStreamIcon size={22} isActive={!isComplete && !isCanceled} variant={deviceType} />
			</ProgressRing>
		</div>
	)
}
