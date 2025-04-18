import {useEffect, useState} from 'react'

import {FileItemContextMenu} from '@/features/files/components/listing/file-item/file-item-context-menu'
import {IconsViewFileItem} from '@/features/files/components/listing/file-item/icons-view-file-item'
import {ListViewFileItem} from '@/features/files/components/listing/file-item/list-view-file-item'
import {Draggable, Droppable} from '@/features/files/components/shared/drag-and-drop'
import {useItemClick} from '@/features/files/hooks/use-item-click'
import {usePreferences} from '@/features/files/hooks/use-preferences'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {cn} from '@/shadcn-lib/utils'

interface FileItemProps {
	item: FileSystemItem
	items: FileSystemItem[]
}

export const FileItem = ({item, items}: FileItemProps) => {
	const {handleClick, handleDoubleClick} = useItemClick()
	const isItemSelected = useFilesStore((state) => state.isItemSelected)
	const selectedItems = useFilesStore((state) => state.selectedItems)
	const clipboardItems = useFilesStore((state) => state.clipboardItems)
	const clipboardMode = useFilesStore((state) => state.clipboardMode)

	const [isEditingName, setIsEditingName] = useState(false)

	const [isContextMenuOpen, setIsContextMenuOpen] = useState(false)
	const isUploading = 'isUploading' in item && item.isUploading
	const isSelected = isItemSelected(item)
	const {preferences} = usePreferences()
	const view = preferences?.view

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

	const handleRenameClick = () => {
		setIsEditingName(true)
	}

	const handlNameEditingComplete = () => {
		setIsEditingName(false)
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
		if (!item.operations?.includes('rename')) return

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
	}, [isSelected, selectedItems.length])

	return (
		<div
			data-selected={isItemSelected(item) ? 'true' : 'false'}
			data-selection-position={selectionPosition}
			className={cn(
				`files-${view}-view-file-item`, // .files-list-view-file-item styles are applied via CSS using combinator classes
				'rounded-lg transition-colors duration-100',
				isSelected && 'bg-brand/10 shadow-[0_0_0_1px_theme(colors.brand)]', // selected item styles for list view are overwritten by CSS
				!isSelected && !isUploading && 'md:hover:!border-white/6 md:hover:!bg-white/5', // don't show hover state for selected items or uploading items
			)}
			data-marquee-selection-item-path={!isUploading ? item.path : ''} // don't enable marquee selection for uploading items
		>
			<FileItemContextMenu item={item} onRenameClick={handleRenameClick} onStateChange={setIsContextMenuOpen}>
				<Droppable
					id={`${view}-view-file-item-${item.path}`}
					path={item.path}
					disabled={!!isUploading || item.type !== 'directory'}
					className='rounded-lg'
				>
					<Draggable id={`${view}-view-file-item-${item.path}`} item={item} disabled={!!isUploading}>
						<div
							onClick={(e) => handleClick(e, item, items)}
							onDoubleClick={() => handleDoubleClick(item)}
							className={cn(isItemCut && 'opacity-50')}
							role='button'
						>
							{/* If the item is a dotfile, we decrease the brightness and opacity for the icon and text for a faded look */}
							<div className={cn(isDotfile(item.name) && 'opacity-50 brightness-75')}>
								{view === 'icons' ? (
									<IconsViewFileItem
										item={item}
										isEditingName={isEditingFileName}
										onEditingNameComplete={handlNameEditingComplete}
										isContextMenuOpen={isContextMenuOpen}
									/>
								) : null}
								{view === 'list' ? (
									<ListViewFileItem
										item={item}
										isEditingName={isEditingFileName}
										onEditingNameComplete={handlNameEditingComplete}
									/>
								) : null}
							</div>
						</div>
					</Draggable>
				</Droppable>
			</FileItemContextMenu>
		</div>
	)
}
