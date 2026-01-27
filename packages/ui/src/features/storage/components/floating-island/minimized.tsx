import {type RaidProgress} from '@/features/storage/hooks/use-raid-progress'
import {t} from '@/utils/i18n'

import {DataStreamIconMini} from './data-stream-icon'
import {raidOperationLabels} from './index'

// No restart countdown here - island is force-expanded when rebooting (see index.tsx)
export function MinimizedContent({operation}: {operation: RaidProgress}) {
	const label = t(raidOperationLabels[operation.type])
	const isActive = operation.state !== 'finished' && operation.state !== 'complete' && operation.state !== 'canceled'

	return (
		<div className='flex size-full select-none items-center gap-2 px-2'>
			<div className='relative flex size-5 items-center justify-center'>
				<DataStreamIconMini size={20} isActive={isActive} />
			</div>
			<div className='min-w-0 flex-1'>
				<span className='block truncate text-center text-xs text-white/90'>{label}</span>
			</div>
			<div className='flex shrink-0 items-center gap-2'>
				<span className='text-xs text-white/60'>{Math.round(operation.progress)}%</span>
			</div>
		</div>
	)
}
