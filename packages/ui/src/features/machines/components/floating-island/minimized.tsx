import {CircularProgress} from '@/features/files/components/shared/circular-progress'
import {OsIcon} from '@/features/machines/components/os-icon'
import type {Machine} from '@/features/machines/types'
import {t} from '@/utils/i18n'

export function MinimizedContent({machines}: {machines: Machine[]}) {
	const progress = Math.min(
		99,
		machines.reduce((total, machine) => total + (machine.installProgress ?? 0), 0) / machines.length,
	)
	const label = machines.length === 1 ? machines[0].name : t('machines.machines-count', {count: machines.length})

	return (
		<div className='flex h-full w-full items-center gap-2 px-2'>
			<CircularProgress progress={progress}>
				<OsIcon osId={machines[0].osId} state='installing' className='size-3' />
			</CircularProgress>
			<div className='min-w-0 flex-1'>
				<span className='block truncate text-center text-xs text-white/90'>{label}</span>
			</div>
			<div className='flex shrink-0 items-center gap-2'>
				<span className='text-xs text-white/60 tabular-nums'>{Math.round(progress)}%</span>
			</div>
		</div>
	)
}
