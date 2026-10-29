import {useEffect, useRef} from 'react'
import {useNavigate as useRouterNavigate} from 'react-router-dom'

import {SYSTEM_MANAGED_ROOT_PATHS} from '@/features/files/constants'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {ARROW_STEPS, type ViewerStep, type ViewerStepper} from '@/features/files/store/slices/file-viewer-slice'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {canPerformFileOperation} from '@/features/files/utils/file-capabilities'
import {getFileViewer} from '@/features/files/utils/get-file-viewer'
import {
	getGridColumnCount,
	getGridItemWidth,
	getGridScrollerPadding,
	GRID_ITEM_HEIGHT,
	GRID_ROW_GAP,
	LISTING_FADE_BOTTOM_PX,
	LISTING_FADE_TOP_PX,
} from '@/features/files/utils/get-grid-column-count'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useLinkToDialog} from '@/utils/dialog'
import {isBeneathModal} from '@/utils/is-beneath-modal'

/**
 * Hook to handle keyboard shortcuts for file operations: copy, cut, paste, trash,
 * and arrow key navigation through file items.
 * We use both command and ctrl for every shortcut to mimic the behaviour of both macOS and windows.
 * Uses a single useEffect listener instead of react-use's useKey for React Compiler compatibility.
 */
export function useFilesKeyboardShortcuts({
	items,
	hiddenRenamedPaths,
	listingRef,
	scrollAreaRef,
	view,
}: {
	items: FileSystemItem[]
	hiddenRenamedPaths?: string[]
	listingRef: React.RefObject<HTMLDivElement | null>
	scrollAreaRef: React.RefObject<HTMLDivElement | null>
	view: 'list' | 'icons'
}) {
	const isReadOnly = useIsFilesReadOnly()
	const writeShortcutsEnabled = !isReadOnly
	const {currentPath, navigateToItem, navigateToDirectory} = useNavigate()
	const routerNavigate = useRouterNavigate()
	const linkToDialog = useLinkToDialog()
	const copyItemsToClipboard = useFilesStore((s: FilesStore) => s.copyItemsToClipboard)
	const cutItemsToClipboard = useFilesStore((s: FilesStore) => s.cutItemsToClipboard)
	const setSelectedItems = useFilesStore((s: FilesStore) => s.setSelectedItems)
	const selectedItems = useFilesStore((s: FilesStore) => s.selectedItems)
	const viewerItem = useFilesStore((s: FilesStore) => s.viewerItem)
	const viewerMode = useFilesStore((s: FilesStore) => s.viewerMode)
	const setViewerItem = useFilesStore((s: FilesStore) => s.setViewerItem)
	const setViewerStepper = useFilesStore((s: FilesStore) => s.setViewerStepper)
	const {pasteItemsFromClipboard, trashSelectedItems} = useFilesOperations()
	const isMobile = useIsMobile()

	// Search functionality
	const searchBuffer = useRef('')
	const searchTimer = useRef<NodeJS.Timeout | undefined>(undefined)

	// Use refs for values that change frequently so the useEffect doesn't need to re-register
	const selectedItemsRef = useRef(selectedItems)
	selectedItemsRef.current = selectedItems
	const viewerItemRef = useRef(viewerItem)
	viewerItemRef.current = viewerItem
	const viewerModeRef = useRef(viewerMode)
	viewerModeRef.current = viewerMode
	const viewRef = useRef(view)
	viewRef.current = view
	const hiddenRenamedPathsRef = useRef(hiddenRenamedPaths)
	hiddenRenamedPathsRef.current = hiddenRenamedPaths

	// Track the anchor index for Shift+Arrow range selection and the cursor (moving end)
	const selectionAnchorRef = useRef<number>(-1)
	const selectionCursorRef = useRef<number>(-1)

	// Reset cursor/anchor when the item list changes (e.g. navigating to a new directory)
	// so arrow keys start from the first item instead of a stale index.
	useEffect(() => {
		selectionAnchorRef.current = -1
		selectionCursorRef.current = -1
	}, [items])

	useEffect(() => {
		// Guard to check if we're in a text input or contentEditable element
		const isInInput = (e: KeyboardEvent): boolean => {
			const target = e.target as HTMLElement
			return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable
		}

		// Moves the viewer to a neighbour in this listing: ←/→ one file along, ↑/↓
		// a row of the icon grid (one file in the list). Quick look visits every
		// file; an opened viewer only those it can show that leave ←/→ to
		// stepping, as one that keeps them (pages, slides, cells) would hold
		// them there with no way on. Registered with the store as well: a
		// viewer open over Files hears the keys itself.
		const stepTarget = (step: ViewerStep) => {
			const viewer = viewerItemRef.current
			const mode = viewerModeRef.current
			if (!viewer || !mode) return
			const navigable = items.filter((file) => {
				if (file.isDisconnected) return false
				if (typeof file.type !== 'string') return false
				if (mode === 'preview') return true
				const fileViewer = getFileViewer(file)
				return Boolean(fileViewer && !fileViewer.ownsArrows)
			})
			const currentIndex = navigable.findIndex((file) => file.path === viewer.path)
			if (currentIndex === -1) return
			let distance = 1
			if ((step === 'up' || step === 'down') && viewRef.current === 'icons') {
				const scrollEl = scrollAreaRef.current
				distance = scrollEl
					? getGridColumnCount(scrollEl.clientWidth - getGridScrollerPadding(isMobile), getGridItemWidth(isMobile))
					: 1
			}
			const nextIndex =
				step === 'previous' || step === 'up'
					? Math.max(0, currentIndex - distance)
					: Math.min(navigable.length - 1, currentIndex + distance)
			return nextIndex === currentIndex ? undefined : navigable[nextIndex]
		}
		const stepper: ViewerStepper = {
			step: (step) => {
				const target = stepTarget(step)
				if (target && setViewerItem(target, viewerModeRef.current ?? 'open')) setSelectedItems([target])
			},
			canStep: (step) => Boolean(stepTarget(step)),
		}
		setViewerStepper(stepper)

		const handleKeyDown = (e: KeyboardEvent) => {
			// The listener is on the window so it hears keys pressed in a dialog
			// opened over the listing too, where Cmd+C is for the text selected
			// in it and Cmd+Backspace must not trash the files underneath
			if (isBeneathModal(listingRef.current, e)) return

			const mod = e.metaKey || e.ctrlKey

			// Modifier shortcuts
			if (mod) {
				if (isInInput(e)) return

				// Cmd+Down: open selected item (drill into directory or open file viewer)
				if (e.key === 'ArrowDown') {
					if (selectedItemsRef.current.length !== 1) return
					e.preventDefault()
					navigateToItem(selectedItemsRef.current[0])
					return
				}

				// Cmd+Up: navigate to parent directory
				if (e.key === 'ArrowUp') {
					e.preventDefault()
					const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/'
					if (parentPath !== currentPath) {
						navigateToDirectory(parentPath)
					}
					return
				}

				if (e.key === 'c') {
					e.preventDefault()
					copyItemsToClipboard()
					return
				}

				if (e.key === 'a') {
					e.preventDefault()
					setSelectedItems(items)
					return
				}

				// Write shortcuts below are unavailable in embedded read-only
				// mode. Their command handlers also enforce per-path operations.
				// Note: No Cmd+Shift+N for new folder — the browser intercepts it to open a new window.
				if (!writeShortcutsEnabled) return

				if (e.key === 'x') {
					e.preventDefault()
					cutItemsToClipboard()
					return
				}
				if (e.key === 'v') {
					// /Apps and /Machines offer no paste target; their listings hide
					// every other write affordance too
					if (SYSTEM_MANAGED_ROOT_PATHS.has(currentPath)) return
					e.preventDefault()
					pasteItemsFromClipboard({toDirectory: currentPath})
					return
				}
				if (e.key === 'Backspace') {
					e.preventDefault()
					const selected = selectedItemsRef.current
					if (selected.length === 0) return
					const canTrash = canPerformFileOperation(selected[0], 'trash')
					const canDelete = canPerformFileOperation(selected[0], 'delete')
					if (canDelete) {
						routerNavigate(linkToDialog('files-permanently-delete-confirmation'))
					} else if (canTrash) {
						trashSelectedItems()
					}
					return
				}
			}

			// A quick look playing in an island (audio) leaves the keys here, where
			// Space and Escape close it as they would any quick look
			if ((e.key === ' ' || e.key === 'Escape') && viewerItemRef.current && viewerModeRef.current === 'preview') {
				if (isInInput(e) || mod || e.altKey) return
				e.preventDefault()
				setViewerItem(null)
				return
			}

			// Space bar to view selected item (allowed even in read-only)
			if (e.key === ' ') {
				if (
					isInInput(e) ||
					mod ||
					e.altKey ||
					searchBuffer.current.length > 0 ||
					selectedItemsRef.current.length !== 1 ||
					viewerItemRef.current !== null
				)
					return
				e.preventDefault()
				const item = selectedItemsRef.current[0]
				if (item.isDisconnected) return
				// Allow preview for all items including directories (info card fallback for filetypes without viewers)
				if (item.type) {
					setViewerItem(item, 'preview')
				}
				return
			}

			// Arrow key navigation (allowed even in read-only)
			if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
				if (isInInput(e) || mod || e.altKey || items.length === 0) return

				// --- Viewer navigation (an island viewer, like audio, leaves the keys here) ---
				if (viewerItemRef.current) {
					const viewer = getFileViewer(viewerItemRef.current)
					if (viewer?.ownsArrows && viewerModeRef.current !== 'preview') return
					e.preventDefault()
					stepper.step(ARROW_STEPS[e.key]!)
					return
				}

				// --- Listing navigation (no viewer open) ---
				e.preventDefault()

				// Remove focus from any focused element (e.g. sidebar buttons) to prevent
				// stale focus outlines while navigating the listing with arrow keys.
				// This runs after the isInInput guard so text inputs aren't affected.
				if (document.activeElement instanceof HTMLElement) {
					document.activeElement.blur()
				}

				const selected = selectedItemsRef.current

				// Sync refs when selection was changed externally (e.g. mouse click).
				// Without this, the anchor/cursor stay stale and Shift+Arrow produces wrong ranges.
				if (selected.length === 1) {
					const clickedIndex = items.findIndex((i) => i.path === selected[0].path)
					if (clickedIndex !== -1 && clickedIndex !== selectionCursorRef.current) {
						selectionAnchorRef.current = clickedIndex
						selectionCursorRef.current = clickedIndex
					}
				}

				// Find the current index — use the cursor ref if set (tracks the moving end during
				// Shift+Arrow selection), otherwise fall back to the last selected item
				let currentIndex = selectionCursorRef.current
				if (currentIndex === -1 && selected.length > 0) {
					const lastSelected = selected[selected.length - 1]
					currentIndex = items.findIndex((i) => i.path === lastSelected.path)
				}

				// If nothing is selected or the selected item was removed, select the first item.
				// A rename the listing is deliberately holding back is neither: it is still
				// the user's place in the folder, so arrow keys must not jump to the top.
				if (currentIndex === -1) {
					if (selected.length === 1 && hiddenRenamedPathsRef.current?.includes(selected[0].path)) return
					setSelectedItems([items[0]])
					selectionAnchorRef.current = 0
					selectionCursorRef.current = 0
					scrollItemIntoView(0)
					return
				}

				// Calculate the step based on view and direction
				const currentView = viewRef.current
				let step = 0
				if (currentView === 'list') {
					// List view: only up/down navigate, left/right are ignored
					if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return
					if (e.key === 'ArrowUp') step = -1
					else step = 1
				} else {
					// Icons view: Left/Right move by 1, Up/Down move by column count
					if (e.key === 'ArrowLeft') step = -1
					else if (e.key === 'ArrowRight') step = 1
					else {
						const scrollEl = scrollAreaRef.current
						const columnCount = scrollEl
							? getGridColumnCount(scrollEl.clientWidth - getGridScrollerPadding(isMobile), getGridItemWidth(isMobile))
							: 1
						if (e.key === 'ArrowUp') step = -columnCount
						else step = columnCount
					}
				}

				// Clamp target to valid range
				const targetIndex = Math.max(0, Math.min(items.length - 1, currentIndex + step))

				// If we're already at the boundary and can't move, do nothing
				if (targetIndex === currentIndex) return

				if (e.shiftKey) {
					// Shift+Arrow: extend selection as a contiguous range from anchor to target
					// Set anchor on first shift-select if not already set
					if (selectionAnchorRef.current === -1) {
						selectionAnchorRef.current = currentIndex
					}
					const anchor = selectionAnchorRef.current
					const start = Math.min(anchor, targetIndex)
					const end = Math.max(anchor, targetIndex)
					setSelectedItems(items.slice(start, end + 1))
					selectionCursorRef.current = targetIndex
				} else {
					// Regular arrow: select only the target item and reset anchor
					setSelectedItems([items[targetIndex]])
					selectionAnchorRef.current = targetIndex
					selectionCursorRef.current = targetIndex
				}

				scrollItemIntoView(targetIndex)
				return
			}

			// Search/selection stays available in read-only views.
			if (isInInput(e) || mod || e.altKey) return
			if (e.key === ' ' && searchBuffer.current.length === 0) return

			// "/" is handled by SearchInput for focus
			if (e.key === '/') return

			if (e.key.length === 1) {
				e.preventDefault()
				searchBuffer.current += e.key.toLowerCase()

				if (searchTimer.current) {
					clearTimeout(searchTimer.current)
				}
				searchTimer.current = setTimeout(() => {
					searchBuffer.current = ''
				}, 700)

				const matchingItem = items.find((item) => item.name.toLowerCase().startsWith(searchBuffer.current))
				if (matchingItem) {
					setSelectedItems([matchingItem])
				}
			}
		}

		/** Scroll the item at `index` into view if it's outside the visible area */
		function scrollItemIntoView(index: number) {
			const scrollEl = scrollAreaRef.current
			if (!scrollEl) return

			const currentView = viewRef.current
			let itemTop: number
			let itemBottom: number

			if (currentView === 'list') {
				const itemHeight = isMobile ? 50 : 40
				itemTop = index * itemHeight
				itemBottom = itemTop + itemHeight
			} else {
				const columnCount = getGridColumnCount(
					scrollEl.clientWidth - getGridScrollerPadding(isMobile),
					getGridItemWidth(isMobile),
				)
				const row = Math.floor(index / columnCount)
				const rowHeight = GRID_ITEM_HEIGHT + GRID_ROW_GAP
				itemTop = row * rowHeight
				itemBottom = itemTop + rowHeight
			}

			const {scrollTop, clientHeight} = scrollEl

			// Pad by the edge fades so the item lands clearly visible, not under them
			if (itemTop < scrollTop + LISTING_FADE_TOP_PX) {
				scrollEl.scrollTop = Math.max(0, itemTop - LISTING_FADE_TOP_PX)
			} else if (itemBottom > scrollTop + clientHeight - LISTING_FADE_BOTTOM_PX) {
				scrollEl.scrollTop = itemBottom - clientHeight + LISTING_FADE_BOTTOM_PX
			}
		}

		window.addEventListener('keydown', handleKeyDown)
		return () => {
			window.removeEventListener('keydown', handleKeyDown)
			if (useFilesStore.getState().viewerStepper === stepper) setViewerStepper(null)
		}
	}, [
		writeShortcutsEnabled,
		currentPath,
		items,
		isMobile,
		copyItemsToClipboard,
		cutItemsToClipboard,
		setSelectedItems,
		setViewerItem,
		setViewerStepper,
		pasteItemsFromClipboard,
		trashSelectedItems,
		navigateToItem,
		navigateToDirectory,
		listingRef,
		scrollAreaRef,
		routerNavigate,
		linkToDialog,
	])
}
