import {RiCloseLine} from 'react-icons/ri'

import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {useGlobalFiles} from '@/providers/global-files'
import {ScrollArea} from '@/shadcn-components/ui/scroll-area'
import {t} from '@/utils/i18n'

export function ExpandedContent() {
	const {uploadingItems, uploadStats, cancelUpload} = useGlobalFiles()

	return (
		<div className='flex h-full w-full flex-col overflow-hidden py-5'>
			<div className='mb-4 flex items-center justify-between px-5'>
				<span className='text-sm text-white/60'>
					{t('files-upload-island.uploading-count', {count: uploadingItems.length})}
				</span>
				<span className='text-xs text-white/60'>
					{formatFilesystemSize(uploadStats.totalUploaded)} / {formatFilesystemSize(uploadStats.totalSize)}
				</span>
			</div>

			<ScrollArea className='flex-1 px-5 pb-2'>
				<div className='space-y-3'>
					{uploadingItems.map((item) => (
						<div key={item.tempId} className='flex items-center gap-2'>
							<div className='flex-shrink-0'>
								<FileItemIcon item={item} className='h-7 w-7' />
							</div>
							<div className='min-w-0 flex-1'>
								<div className='mb-1 flex items-center justify-between gap-2'>
									<span className='block max-w-36 truncate text-xs text-white/90'>{item.name}</span>
									<span className='flex-shrink-0 text-right text-xs text-white/60'>
										{formatFilesystemSize(item.speed || 0)}/s - {formatFilesystemSize(item.size ?? 0)}
									</span>
								</div>
								<div className='relative h-1 overflow-hidden rounded-full bg-white/20'>
									<div
										className='absolute left-0 top-0 h-full rounded-full bg-brand transition-all duration-300'
										style={{width: `${item.progress}%`}}
									/>
								</div>
							</div>
							<button
								className='flex-shrink-0 rounded-full bg-white/10 p-1 transition-colors hover:bg-white/20'
								onClick={() => cancelUpload(item.tempId ?? '')}
								aria-label={t('files-action.cancel-upload')}
							>
								<RiCloseLine className='h-3 w-3 text-white' />
							</button>
						</div>
					))}
				</div>
			</ScrollArea>
		</div>
	)
}
