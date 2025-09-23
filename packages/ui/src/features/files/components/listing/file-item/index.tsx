import {useCallback, useEffect, useRef, useState} from 'react'

import {IconsViewFileItem} from '@/features/files/components/listing/file-item/icons-view-file-item'
import {ListViewFileItem} from '@/features/files/components/listing/file-item/list-view-file-item'
import {Draggable, Droppable} from '@/features/files/components/shared/drag-and-drop'
import {useItemClick} from '@/features/files/hooks/use-item-click'
import {useNetworkStorage} from '@/features/files/hooks/use-network-storage'
import {usePreferences} from '@/features/files/hooks/use-preferences'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {isDirectoryANetworkDevice} from '@/features/files/utils/is-directory-a-network-device-or-share'
import {isDirectoryAnUmbrelBackup} from '@/features/files/utils/is-directory-an-umbrel-backup'
import {cn} from '@/shadcn-lib/utils'

interface FileItemProps {
	item: FileSystemItem
	items: FileSystemItem[]
}

// Helper function to detect touch or pen events
function whenTouchOrPen<E>(handler: React.PointerEventHandler<E>): React.PointerEventHandler<E> {
	return (event) => (event.pointerType !== 'mouse' ? handler(event) : undefined)
}

export const FileItem = ({item, items}: FileItemProps) => {
	const {handleClick, handleDoubleClick} = useItemClick()
	const isItemSelected = useFilesStore((state) => state.isItemSelected)
	const selectedItems = useFilesStore((state) => state.selectedItems)
	const setSelectedItems = useFilesStore((state) => state.setSelectedItems)
	const clipboardItems = useFilesStore((state) => state.clipboardItems)
	const clipboardMode = useFilesStore((state) => state.clipboardMode)

	const [isEditingName, setIsEditingName] = useState(false)

	const renamingItemPath = useFilesStore((state) => state.renamingItemPath)
	const setRenamingItemPath = useFilesStore((state) => state.setRenamingItemPath)
	const isUploading = 'isUploading' in item && item.isUploading
	const isSelected = isItemSelected(item)
	const {preferences} = usePreferences()
	const view = preferences?.view
	const setIsSelectingOnMobile = useFilesStore((state) => state.setIsSelectingOnMobile)

	const {doesHostHaveMountedShares} = useNetworkStorage()

	// If the item is a network device that isn't actually mounted then we disable and fade the text content but not the icon.
	const isNetworkHost = isDirectoryANetworkDevice(item.path)
	const isItemInteractive = isNetworkHost ? doesHostHaveMountedShares(item.path) : true

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
		}
	}, [setIsSelectingOnMobile, setSelectedItems, isItemSelected, item])

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
			<Droppable
				id={`${view}-view-file-item-${item.path}`}
				path={item.path}
				disabled={!!isUploading || item.type !== 'directory' || !isItemInteractive}
				className='rounded-lg'
			>
				<Draggable
					id={`${view}-view-file-item-${item.path}`}
					item={item}
					disabled={!!isUploading || !isItemInteractive}
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
									fadedContent={!isItemInteractive}
								/>
							) : null}
							{view === 'list' ? (
								<ListViewFileItem
									item={item}
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
