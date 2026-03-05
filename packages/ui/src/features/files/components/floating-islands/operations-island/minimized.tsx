import {RiFileCopyFill, RiFileTransferFill, RiTimeLine} from 'react-icons/ri'

import {CircularProgress} from '@/features/files/components/shared/circular-progress'
import {t} from '@/utils/i18n'
import {formatNumberI18n} from '@/utils/number'

export function MinimizedContent({
	progress,
	count,
	eta,
	type,
}: {
	progress: number
	count: number
	eta: string
	type: 'copy' | 'move' | 'mixed'
}) {
	return (
		<div className='flex h-full w-full items-center gap-2 px-2'>
			<CircularProgress progress={progress}>
				{type === 'copy' && <RiFileCopyFill className='h-3 w-3 text-white/60' />}
				{type === 'move' && <RiFileTransferFill className='h-3 w-3 text-white/60' />}
				{type === 'mixed' && <RiTimeLine className='h-3 w-3 text-white/60' />}
			</CircularProgress>
			<div className='min-w-0 flex-1'>
				<span className='block truncate text-center text-xs text-white/90'>
					{t('files-listing.item-count', {formattedCount: formatNumberI18n({n: count, showDecimals: false}), count})}
				</span>
			</div>
			<div className='flex flex-shrink-0 items-center gap-2'>
				<span className='text-xs text-white/60'>{eta}</span>
			</div>
		</div>
	)
}
