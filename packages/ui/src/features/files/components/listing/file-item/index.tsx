import {useCallback, useEffect, useRef, useState} from 'react'

import {useFileItemContext} from '@/features/files/components/listing/file-item/file-item-context'
import {IconsViewFileItem} from '@/features/files/components/listing/file-item/icons-view-file-item'
import {ListViewFileItem} from '@/features/files/components/listing/file-item/list-view-file-item'
import {Draggable, Droppable} from '@/features/files/components/shared/drag-and-drop'
import {MachineFolderMetadata} from '@/features/files/hooks/use-machine-folder'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {canPerformFileOperation} from '@/features/files/utils/file-capabilities'
import {isDirectoryAnUmbrelBackup} from '@/features/files/utils/is-directory-an-umbrel-backup'
import type {Machine} from '@/features/machines/types'
import {cn} from '@/lib/utils'

interface FileItemProps {
	item: FileSystemItem
	items: FileSystemItem[]
}

// Helper function to detect touch or pen events
function whenTouchOrPen<E>(handler: React.PointerEventHandler<E>): React.PointerEventHandler<E> {
	return (event) => (event.pointerType !== 'mouse' ? handler(event) : undefined)
}

export const FileItem = (props: FileItemProps) => (
	<MachineFolderMetadata path={props.item.path}>
		{({machine}) => <FileItemContent {...props} machine={machine} />}
	</MachineFolderMetadata>
)

const FileItemContent = ({item, items, machine}: FileItemProps & {machine: Machine | undefined}) => {
	const {handleClick, handleDoubleClick, view} = useFileItemContext()
	const isItemSelected = useFilesStore((state) => state.isItemSelected)
	const selectedItems = useFilesStore((state) => state.selectedItems)
	const setSelectedItems = useFilesStore((state) => state.setSelectedItems)
	const clipboardItems = useFilesStore((state) => state.clipboardItems)
	const clipboardMode = useFilesStore((state) => state.clipboardMode)
	const pendingType = useFilesStore((state) => state.pendingPaths.get(item.path) ?? null)
	const isPendingProcessing = pendingType === 'processing'

	const [isEditingName, setIsEditingName] = useState(false)

	// The "New Folder" placeholder is only a name being typed — it has no file behind it
	// until Enter commits it, so it can never take part in drag and drop.
	const isUnsavedPlaceholder = 'isNew' in item && !!item.isNew

	const allowsOperation = (operation: FileSystemItem['operations'][number]) =>
		!isUnsavedPlaceholder && canPerformFileOperation(item, operation)

	const renamingItemPath = useFilesStore((state) => state.renamingItemPath)
	const setRenamingItemPath = useFilesStore((state) => state.setRenamingItemPath)
	const isUploading = 'isUploading' in item && item.isUploading
	const isSelected = isItemSelected(item)
	const isReadOnly = useIsFilesReadOnly()
	const setIsSelectingOnMobile = useFilesStore((state) => state.setIsSelectingOnMobile)

	// Disconnected entries stay selectable for removal, but cannot transfer files.
	const isItemInteractive = !item.isDisconnected

	// Long press detection to select the item on mobile
	// since onContextMenu isn't triggered on mobile
	const longPressTimerRef = useRef(0)
	const clearLongPress = useCallback(() => {
		window.clearTimeout(longPressTimerRef.current)
	}, [])

	const handleOpenContextMenu = useCallback(() => {
		setIsSelectingOnMobile(true)
		// Select the item if it's not already selected
		if (!isItemSelected(item)) {
			setSelectedItems([item])
		} else {
			// Update the selected items with fresh item data from the listing.
			// This ensures operations are up to date (e.g., after folder creation where
			// the item was initially selected with empty operations).
			setSelectedItems(selectedItems.map((selected) => (selected.path === item.path ? item : selected)))
		}
	}, [setIsSelectingOnMobile, setSelectedItems, isItemSelected, item, selectedItems])

	// Cleanup timer on unmount
	useEffect(() => {
		return () => clearLongPress()
	}, [clearLongPress])

	// Calculate the selection position (first, middle, last, or standalone)
	let selectionPosition = ''
	if (isSelected && view === 'list') {
		// Get the indices of all selected items
		const selectedPaths = selectedItems.map((i) => i.path)
		const sortedItemIndices = items
			.map((i, index) => (selectedPaths.includes(i.path) ? index : -1))
			.filter((index) => index !== -1)
			.sort((a, b) => a - b)

		// Find the current item's index
		const currentIndex = items.findIndex((i) => i.path === item.path)

		// Split the sorted indices into groups of contiguous indices
		const groups: number[][] = []
		let currentGroup: number[] = []

		sortedItemIndices.forEach((index, i) => {
			if (i === 0 || index !== sortedItemIndices[i - 1] + 1) {
				// Start a new group if this is the first item or there's a gap
				if (currentGroup.length > 0) {
					groups.push(currentGroup)
				}
				currentGroup = [index]
			} else {
				// Continue the current group for contiguous indices
				currentGroup.push(index)
			}
		})

		// Add the last group
		if (currentGroup.length > 0) {
			groups.push(currentGroup)
		}

		// Find which group contains the current item
		const groupIndex = groups.findIndex((group) => group.includes(currentIndex))

		if (groupIndex !== -1) {
			const group = groups[groupIndex]

			// Determine position within the group
			if (group.length === 1) {
				// Only item in the group
				selectionPosition = 'standalone'
			} else if (group[0] === currentIndex) {
				// First item in the group
				selectionPosition = 'first'
			} else if (group[group.length - 1] === currentIndex) {
				// Last item in the group
				selectionPosition = 'last'
			} else {
				// Middle item in the group
				selectionPosition = 'middle'
			}
		}
	}

	// Trigger inline rename when the global state is set for this item.
	useEffect(() => {
		if (renamingItemPath === item.path) {
			setIsEditingName(true)
		}
	}, [renamingItemPath, item.path])

	const handlNameEditingComplete = () => {
		setIsEditingName(false)
		setRenamingItemPath(null)
	}

	const isDotfile = (filename: string) => filename.startsWith('.')

	const isItemCut = clipboardMode === 'cut' && clipboardItems.find((i) => i.path === item.path)

	const isEditingFileName = isEditingName || !!('isNew' in item && item.isNew)

	// Handle rename on Enter
	useEffect(() => {
		// do some checks to avoid attaching multiple listeners

		// ensure that the item is selected
		if (!isSelected) return

		// ensure that this is the only selected item
		if (selectedItems.length !== 1) return

		// check if the rename operation is allowed for this item
		if (isReadOnly || isUnsavedPlaceholder || !canPerformFileOperation(item, 'rename')) return

		// helper function to check if the event target is an input
		function isInInput(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null
			if (!target) return false
			return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable
		}

		function handleKeyDown(event: KeyboardEvent) {
			if (event.key !== 'Enter') {
				return
			}

			// don't allow renaming Umbrel Backup directory
			if (isDirectoryAnUmbrelBackup(item.name)) return

			// don't trigger the rename if the user Entered in the input
			if (isInInput(event)) return

			event.preventDefault()

			setIsEditingName(true)
		}

		// attach the listener
		window.addEventListener('keydown', handleKeyDown)

		// remove the listener on cleanup
		return () => {
			window.removeEventListener('keydown', handleKeyDown)
		}
	}, [isReadOnly, isSelected, isUnsavedPlaceholder, item, selectedItems.length])

	return (
		<div
			data-selected={isItemSelected(item) ? 'true' : 'false'}
			data-selection-position={selectionPosition}
			className={cn(
				`files-${view}-view-file-item`, // .files-list-view-file-item styles are applied via CSS using combinator classes
				// Icons view fills the fixed grid cell so all boxes in a row share the same height
				view === 'icons' ? 'h-full rounded-12' : 'rounded-lg',
				'transition-colors duration-100',
				isPendingProcessing && 'pointer-events-none animate-pulse',
				isSelected && !isPendingProcessing && 'bg-brand/10 shadow-[0_0_0_1px_hsl(var(--color-brand))]', // selected item styles for list view are overwritten by CSS
				!isSelected && !isUploading && !isPendingProcessing && 'md:hover:!border-white/6 md:hover:!bg-white/5', // don't show hover state for selected items, uploading items, or processing items
			)}
			data-marquee-selection-item-path={!isUploading && !isPendingProcessing ? item.path : ''} // don't enable marquee selection for uploading or processing items
		>
			<Droppable
				id={`${view}-view-file-item-${item.path}`}
				path={item.path}
				disabled={
					isReadOnly || !!isUploading || item.type !== 'directory' || !allowsOperation('writable') || !isItemInteractive
				}
				className={view === 'icons' ? 'h-full rounded-12' : 'rounded-lg'}
			>
				<Draggable
					id={`${view}-view-file-item-${item.path}`}
					item={item}
					className={view === 'icons' ? 'h-full' : undefined}
					disabled={isReadOnly || !!isUploading || !allowsOperation('move') || !isItemInteractive}
				>
					<div
						onClick={(e) => handleClick(e, item, items)}
						onDoubleClick={() => handleDoubleClick(item)}
						onContextMenu={() => {
							handleOpenContextMenu()
						}}
						// Add pointer events for long press detection on mobile
						onPointerDown={whenTouchOrPen(() => {
							// Clear any previous timer
							clearLongPress()
							// Start a new timer
							longPressTimerRef.current = window.setTimeout(() => handleOpenContextMenu(), 700)
						})}
						onPointerMove={whenTouchOrPen(clearLongPress)}
						onPointerCancel={whenTouchOrPen(clearLongPress)}
						onPointerUp={whenTouchOrPen(clearLongPress)}
						// Prevent native iOS context menu/callout
						style={{WebkitTouchCallout: 'none'}}
						className={cn(view === 'icons' && 'h-full', isItemCut && 'opacity-50')}
						role='button'
					>
						{/* If the item is a dotfile, we decrease the brightness and opacity for the icon and text for a faded look */}
						<div className={cn(isDotfile(item.name) && 'opacity-50 brightness-75')}>
							{view === 'icons' ? (
								<IconsViewFileItem
									item={item}
									machine={machine}
									isEditingName={isEditingFileName}
									onEditingNameComplete={handlNameEditingComplete}
									fadedContent={!isItemInteractive}
								/>
							) : null}
							{view === 'list' ? (
								<ListViewFileItem
									item={item}
									machine={machine}
									isEditingName={isEditingFileName}
									onEditingNameComplete={handlNameEditingComplete}
									fadedContent={!isItemInteractive}
								/>
							) : null}
						</div>
					</div>
				</Draggable>
			</Droppable>
		</div>
	)
}
