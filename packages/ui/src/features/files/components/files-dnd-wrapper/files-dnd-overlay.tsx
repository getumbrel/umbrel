import {DragOverlay} from '@dnd-kit/core'
import {snapCenterToCursor} from '@dnd-kit/modifiers'

import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {cn} from '@/shadcn-lib/utils'

export function FilesDndOverlay() {
	const draggedItems = useFilesStore((s) => s.draggedItems)

	const firstItem = draggedItems[0]
	const totalItemsBeingDragged = draggedItems.length
	const previewItems = draggedItems.slice(1, 4)

	return (
		<DragOverlay dropAnimation={null} modifiers={[snapCenterToCursor]}>
			{
				<div className='relative z-[20390930293920] flex w-[160px] flex-col items-center gap-0'>
					{totalItemsBeingDragged > 1 && (
						<div className='absolute right-[-10px] top-[-10px] flex h-6 w-6 items-center justify-center rounded-full border border-white/25 bg-brand shadow-sm'>
							<span className='text-xs font-medium text-white'>{totalItemsBeingDragged}</span>
						</div>
					)}
					<div className='flex w-full items-center gap-1.5 rounded-lg border border-brand/90 bg-brand/20 p-1.5'>
						<FileItemIcon item={firstItem} className='h-6 w-6 flex-shrink-0' />
						<span className='overflow-hidden text-ellipsis whitespace-nowrap text-12 text-white'>
							{firstItem?.name}
						</span>
					</div>
					{previewItems.map((item, index) => (
						<div
							key={`${item.path}-drag-preview`}
							className={cn(
								'rounded-b-lg border-b border-l border-r border-brand bg-brand/20',
								index === 0 && 'h-[0.5rem] w-[90%] opacity-75',
								index === 1 && 'h-[0.4rem] w-[80%] opacity-50',
								index === 2 && 'h-[0.3rem] w-[70%] opacity-25',
							)}
						></div>
					))}
				</div>
			}
		</DragOverlay>
	)
}
