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
import {isKeyForFocusedControl} from '@/features/files/utils/is-key-for-focused-control'
import {selectedPathsOf, selectionPositionOf} from '@/features/files/utils/selected-paths'
import type {Machine} from '@/features/machines/types'
import {cn} from '@/lib/utils'
import {isBeneathModal} from '@/utils/is-beneath-modal'

interface FileItemProps {
	item: FileSystemItem
	items: FileSystemItem[]
	// Where the item stands in `items`
	index: number
}

// How long a finger rests on an item before its actions come up, and how far
// it may drift meanwhile. Shorter than a browser's own long press, so ours
// answers first.
const HOLD_MS = 420
const HOLD_SLOP_PX = 8

export const FileItem = (props: FileItemProps) => (
	<MachineFolderMetadata path={props.item.path}>
		{({machine}) => <FileItemContent {...props} machine={machine} />}
	</MachineFolderMetadata>
)

const FileItemContent = ({item, items, index, machine}: FileItemProps & {machine: Machine | undefined}) => {
	const {handleClick, handleDoubleClick, view} = useFileItemContext()
	const setSelectedItems = useFilesStore((state) => state.setSelectedItems)
	const clipboardItems = useFilesStore((state) => state.clipboardItems)
	const clipboardMode = useFilesStore((state) => state.clipboardMode)
	const pendingType = useFilesStore((state) => state.pendingPaths.get(item.path) ?? null)
	const isPendingProcessing = pendingType === 'processing'
	const isSelecting = useFilesStore((state) => state.isSelectingOnMobile)
	const openItemActionSheet = useFilesStore((state) => state.openItemActionSheet)

	const [isEditingName, setIsEditingName] = useState(false)

	// The "New Folder" placeholder is only a name being typed — it has no file behind it
	// until Enter commits it, so it can never take part in drag and drop.
	const isUnsavedPlaceholder = 'isNew' in item && !!item.isNew

	const allowsOperation = (operation: FileSystemItem['operations'][number]) =>
		!isUnsavedPlaceholder && canPerformFileOperation(item, operation)

	const renamingItemPath = useFilesStore((state) => state.renamingItemPath)
	const setRenamingItemPath = useFilesStore((state) => state.setRenamingItemPath)
	const isUploading = 'isUploading' in item && item.isUploading
	// What the selection means for this item, asked of the store as questions
	// with one-word answers, so a change of selection renders only the items it
	// changes something for. (A listing keeps dozens of them mounted, and a
	// marquee changes the selection on every frame.) Whether it is selected:
	const isSelected = useFilesStore((state) => selectedPathsOf(state.selectedItems).has(item.path))
	// where a row of the list stands in its run of selected rows, which rounds its corners:
	const selectionPosition = useFilesStore((state) =>
		view === 'list'
			? selectionPositionOf(
					selectedPathsOf(state.selectedItems),
					item.path,
					items[index - 1]?.path,
					items[index + 1]?.path,
				)
			: '',
	)
	// and whether it is the whole selection, which Enter renames:
	const isOnlySelected = useFilesStore(
		(state) => state.selectedItems.length === 1 && state.selectedItems[0].path === item.path,
	)
	const isReadOnly = useIsFilesReadOnly()

	// Disconnected entries stay selectable for removal, but cannot transfer files.
	const isItemInteractive = !item.isDisconnected

	const itemRef = useRef<HTMLDivElement>(null)

	// A right-click is about the item under it: it becomes the selection, unless
	// it is already part of one, and the menu acts on that
	const selectForMenu = useCallback(() => {
		const {selectedItems} = useFilesStore.getState()
		if (!selectedPathsOf(selectedItems).has(item.path)) {
			setSelectedItems([item])
		} else {
			// Update the selected items with fresh item data from the listing.
			// This ensures operations are up to date (e.g., after folder creation where
			// the item was initially selected with empty operations).
			setSelectedItems(selectedItems.map((selected) => (selected.path === item.path ? item : selected)))
		}
	}, [setSelectedItems, item])

	// A finger held on an item brings up what can be done to it. It selects
	// nothing and enters no mode: the sheet is about this one item, and when it
	// is put away the listing is as it was. While selecting, a hold is left
	// alone (a tap toggles, a drag selects a run).
	const hold = useRef<{timer: number; x: number; y: number} | null>(null)
	// The tap that would follow the hold, when the finger lifts, is not a tap
	const heldRef = useRef(false)
	const cancelHold = useCallback(() => {
		if (hold.current) window.clearTimeout(hold.current.timer)
		hold.current = null
	}, [])
	useEffect(() => cancelHold, [cancelHold])
	const canHold = !isReadOnly && !isUploading && !isUnsavedPlaceholder && !isPendingProcessing && !isSelecting

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

		// ensure that the item is selected, and is the only one that is
		if (!isOnlySelected) return

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

			// don't trigger the rename if the user Entered in the input, or on a focused button
			if (isInInput(event) || isKeyForFocusedControl(event)) return

			// nor if the Enter was for a dialog or menu open over the listing
			if (isBeneathModal(itemRef.current, event)) return

			event.preventDefault()

			setIsEditingName(true)
		}

		// attach the listener
		window.addEventListener('keydown', handleKeyDown)

		// remove the listener on cleanup
		return () => {
			window.removeEventListener('keydown', handleKeyDown)
		}
	}, [isReadOnly, isOnlySelected, isUnsavedPlaceholder, item])

	const viewProps = {
		item,
		machine,
		isEditingName: isEditingFileName,
		onEditingNameComplete: handlNameEditingComplete,
		fadedContent: !isItemInteractive,
		isSelected,
		// The circles show, and a tap selects, while a touch screen is selecting
		isSelecting: isSelecting && !isUploading && !isUnsavedPlaceholder,
	}

	return (
		<div
			ref={itemRef}
			data-selected={isSelected ? 'true' : 'false'}
			data-selection-position={selectionPosition}
			className={cn(
				`files-${view}-view-file-item`, // .files-list-view-file-item styles are applied via CSS using combinator classes
				// Fills its row or its grid cell, so every item in a row is the same box
				'h-full select-none',
				view === 'icons' ? 'rounded-12' : 'rounded-10',
				'transition-colors duration-100',
				isPendingProcessing && 'pointer-events-none animate-pulse',
				// The outline is drawn inside the item's own box: one drawn round the
				// outside is cut off wherever the item meets the listing's edge.
				// (The list view's selected rows are styled in its CSS.)
				isSelected && !isPendingProcessing && 'bg-brand/10 shadow-[inset_0_0_0_1px_hsl(var(--color-brand))]',
				// Under a pointer it lights up; under a finger, while it is down.
				// Not for a selected item, or one uploading or being worked on.
				!isSelected && !isUploading && !isPendingProcessing && 'hover:bg-white/5 pointer-coarse:active:bg-white/8',
			)}
		>
			<Droppable
				id={`${view}-view-file-item-${item.path}`}
				path={item.path}
				disabled={
					isReadOnly || !!isUploading || item.type !== 'directory' || !allowsOperation('writable') || !isItemInteractive
				}
				className={cn('h-full', view === 'icons' ? 'rounded-12' : 'rounded-10')}
			>
				<Draggable
					id={`${view}-view-file-item-${item.path}`}
					item={item}
					className='h-full'
					// A row of the list runs the listing's whole width, so it is picked
					// up by its icon and its name, and a drag from the rest of it draws
					// the marquee (see VirtualizedList). A tile is picked up anywhere.
					handle={view === 'list' ? '[data-item-content]' : undefined}
					disabled={isReadOnly || !!isUploading || !allowsOperation('move') || !isItemInteractive}
				>
					<div
						onClick={(e) => {
							// The finger that held the item is lifting: its actions are already up
							if (heldRef.current) {
								heldRef.current = false
								return
							}
							handleClick(e, item, items)
						}}
						onDoubleClick={() => handleDoubleClick(item)}
						// The listing's context menu reads this to tell a right-click on an item from one on empty space
						data-files-item
						onContextMenu={(event) => {
							// A touch screen's own long press (text selection, the image
							// menu) has no place here: the hold below is ours
							if (hold.current || heldRef.current) return event.preventDefault()
							selectForMenu()
						}}
						onPointerDown={(event) => {
							heldRef.current = false
							if (event.pointerType === 'mouse' || !canHold) return
							cancelHold()
							hold.current = {
								x: event.clientX,
								y: event.clientY,
								timer: window.setTimeout(() => {
									hold.current = null
									heldRef.current = true
									// A tick under the finger, where the device can give one
									navigator.vibrate?.(8)
									openItemActionSheet(item)
								}, HOLD_MS),
							}
						}}
						onPointerMove={(event) => {
							if (!hold.current) return
							const moved = Math.hypot(event.clientX - hold.current.x, event.clientY - hold.current.y)
							if (moved > HOLD_SLOP_PX) cancelHold()
						}}
						onPointerCancel={cancelHold}
						onPointerUp={cancelHold}
						onPointerLeave={cancelHold}
						// Prevent native iOS context menu/callout
						style={{WebkitTouchCallout: 'none'}}
						className={cn('h-full', isItemCut && 'opacity-50')}
						role='button'
					>
						{/* If the item is a dotfile, we decrease the brightness and opacity for the icon and text for a faded look */}
						<div
							className={cn(
								'h-full',
								isDotfile(item.name) &&
									'opacity-50 brightness-75 contrast-more:opacity-80 contrast-more:brightness-100',
							)}
						>
							{view === 'icons' ? <IconsViewFileItem {...viewProps} /> : null}
							{view === 'list' ? <ListViewFileItem {...viewProps} /> : null}
						</div>
					</div>
				</Draggable>
			</Droppable>
		</div>
	)
}
