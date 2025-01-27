import {DragEndEvent, DragStartEvent} from '@dnd-kit/core'

import {TRASH_PATH} from '@/features/files/constants'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FilesStore} from '@/features/files/store/use-files-store'
import {FileSystemItem} from '@/features/files/types'

export function useDragAndDrop() {
	const selectedItems = useFilesStore((s: FilesStore) => s.selectedItems)
	const setSelectedItems = useFilesStore((s: FilesStore) => s.setSelectedItems)
	const setDraggedItems = useFilesStore((s: FilesStore) => s.setDraggedItems)
	const clearDraggedItems = useFilesStore((s: FilesStore) => s.clearDraggedItems)
	const {moveDraggedItems, trashDraggedItems} = useFilesOperations()

	const handleDragStart = (event: DragStartEvent) => {
		const draggedItem = event.active.data.current as FileSystemItem
		if (!draggedItem) return

		// if the item is not already selected, reset the selection with the new item
		if (!selectedItems.find((item) => item.path === draggedItem.path)) {
			setSelectedItems([draggedItem])
			setDraggedItems([draggedItem])
		} else {
			// if the item is already selected, use all selected items for dragging
			setDraggedItems([...selectedItems])
		}
	}

	const handleDragEnd = (event: DragEndEvent) => {
		const {over} = event
		const targetPath = over?.data.current?.path as string
		clearDraggedItems()
		if (!targetPath) {
			return // dropped outside a valid drop target
		}

		// if the target is the trash, move the selected items to the trash
		if (targetPath === TRASH_PATH) {
			trashDraggedItems()
		} else {
			// otherwise move the selected items to the target directory
			moveDraggedItems({toDirectory: targetPath})
		}

		// no need to clear dragged items after drop
		// as the above mutations will auto-clear it
	}

	return {
		handleDragStart,
		handleDragEnd,
	}
}
