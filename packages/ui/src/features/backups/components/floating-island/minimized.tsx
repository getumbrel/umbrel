import {TbHistory} from 'react-icons/tb'

import {CircularProgress} from '@/features/files/components/shared/circular-progress'
import {t} from '@/utils/i18n'

export function MinimizedContent({count, progress}: {count: number; progress: number}) {
	return (
		<div className='flex size-full items-center gap-2 px-2'>
			<CircularProgress progress={progress}>
				{/* simple dot */}
				<TbHistory size={12} />
			</CircularProgress>
			<div className='min-w-0 flex-1'>
				<span className='block truncate text-center text-xs text-white/90'>
					{t('backups-floating-island.backing-up')}
				</span>
			</div>
			{/* Reserve right-side space to match other islands' layout (invisible) */}
			<div className='flex shrink-0 items-center gap-2'>
				<span className='text-xs text-white/60'>{progress}%</span>
			</div>
		</div>
	)
}
