import {RiArrowUpLine} from 'react-icons/ri'

import {CircularProgress} from '@/features/files/components/shared/circular-progress'
import {useGlobalFiles} from '@/providers/global-files'

export function MinimizedContent() {
	const {uploadingItems, uploadStats} = useGlobalFiles()

	return (
		<div className='flex h-full w-full items-center gap-2 px-2'>
			<CircularProgress progress={uploadStats.totalProgress}>
				<RiArrowUpLine className='h-3 w-3 text-white/60' />
			</CircularProgress>
			<div className='min-w-0 flex-1'>
				<span className='block truncate text-center text-xs text-white/90'>
					{uploadingItems.length} item{uploadingItems.length > 1 ? 's' : ''}
				</span>
			</div>
			<div className='flex flex-shrink-0 items-center gap-2'>
				<span className='text-xs text-white/60'>{uploadStats.eta}</span>
			</div>
		</div>
	)
}
