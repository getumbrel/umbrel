import {DragOverlay, type Modifier} from '@dnd-kit/core'
import {getEventCoordinates} from '@dnd-kit/utilities'

import {materialSurfaceClasses} from '@/components/ui/shared/material'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {cn} from '@/lib/utils'

// The ghost trails just below and to the right of the pointer, like a badge on
// the cursor, so the row under the pointer (the drop target) stays readable
const GHOST_OFFSET_PX = 12
const trailCursor: Modifier = ({activatorEvent, draggingNodeRect, transform}) => {
	const pointer = activatorEvent && getEventCoordinates(activatorEvent)
	if (!draggingNodeRect || !pointer) return transform
	return {
		...transform,
		x: transform.x + pointer.x - draggingNodeRect.left + GHOST_OFFSET_PX,
		y: transform.y + pointer.y - draggingNodeRect.top + GHOST_OFFSET_PX,
	}
}

export function FilesDndOverlay() {
	const draggedItems = useFilesStore((s) => s.draggedItems)

	const firstItem = draggedItems[0]
	const totalItemsBeingDragged = draggedItems.length
	const previewItems = draggedItems.slice(1, 4)

	// A drag can start on an item that handleDragStart then declines to track, which would
	// otherwise render FileItemIcon with an undefined item and crash the whole Files route.
	if (!firstItem) return null

	return (
		<DragOverlay dropAnimation={null} modifiers={[trailCursor]}>
			<div className='relative flex w-[160px] flex-col items-center gap-0'>
				{totalItemsBeingDragged > 1 && (
					<div className='absolute top-[-10px] right-[-10px] z-10 flex h-6 w-6 items-center justify-center rounded-full border border-white/25 bg-brand shadow-xs'>
						<span className='text-xs font-medium text-white'>{totalItemsBeingDragged}</span>
					</div>
				)}
				{/* Frosted like a menu, so the text beneath blurs away instead of mixing with the name */}
				<div className={cn(materialSurfaceClasses.popover, 'flex w-full items-center gap-1.5 rounded-lg p-1.5')}>
					<FileItemIcon item={firstItem} className='h-6 w-6 flex-shrink-0' />
					<span className='overflow-hidden text-12 text-ellipsis whitespace-nowrap text-white'>{firstItem.name}</span>
				</div>
				{previewItems.map((item, index) => (
					<div
						key={`${item.path}-drag-preview`}
						className={cn(
							'rounded-b-lg border-r border-b border-l border-white/10 bg-neutral-800',
							index === 0 && 'h-[0.5rem] w-[90%] opacity-75',
							index === 1 && 'h-[0.4rem] w-[80%] opacity-50',
							index === 2 && 'h-[0.3rem] w-[70%] opacity-25',
						)}
					></div>
				))}
			</div>
		</DragOverlay>
	)
}
