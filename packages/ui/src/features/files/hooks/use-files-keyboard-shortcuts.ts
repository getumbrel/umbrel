import {useEffect, useRef} from 'react'
import {useNavigate as useRouterNavigate} from 'react-router-dom'

import {FILE_TYPE_MAP} from '@/features/files/constants'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {getGridColumnCount} from '@/features/files/utils/get-grid-column-count'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useLinkToDialog} from '@/utils/dialog'

/**
 * Hook to handle keyboard shortcuts for file operations: copy, cut, paste, trash,
 * and arrow key navigation through file items.
 * We use both command and ctrl for every shortcut to mimic the behaviour of both macOS and windows.
 * Uses a single useEffect listener instead of react-use's useKey for React Compiler compatibility.
 */
export function useFilesKeyboardShortcuts({
	items,
	scrollAreaRef,
	view,
}: {
	items: FileSystemItem[]
	scrollAreaRef: React.RefObject<HTMLDivElement | null>
	view: 'list' | 'icons'
}) {
	const isReadOnly = useIsFilesReadOnly()
	// In read-only mode, disable write/selection shortcuts but allow viewer and navigation shortcuts.
	const shortcutsEnabled = !isReadOnly
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

		const handleKeyDown = (e: KeyboardEvent) => {
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

				// Write shortcuts below require shortcutsEnabled (not read-only)
				// Note: No Cmd+Shift+N for new folder — the browser intercepts it to open a new window.
				if (!shortcutsEnabled) return

				if (e.key === 'c') {
					e.preventDefault()
					copyItemsToClipboard()
					return
				}
				if (e.key === 'x') {
					e.preventDefault()
					cutItemsToClipboard()
					return
				}
				if (e.key === 'v') {
					// If Rewind is open, ignore paste to prevent collision dialogs
					if (document.querySelector('[data-rewind="open"]')) return
					e.preventDefault()
					pasteItemsFromClipboard({toDirectory: currentPath})
					return
				}
				if (e.key === 'Backspace') {
					e.preventDefault()
					const selected = selectedItemsRef.current
					if (selected.length === 0) return
					const canTrash = selected[0].operations.includes('trash')
					const canDelete = selected[0].operations.includes('delete')
					if (canDelete) {
						routerNavigate(linkToDialog('files-permanently-delete-confirmation'))
					} else if (canTrash) {
						trashSelectedItems()
					}
					return
				}
				if (e.key === 'a') {
					e.preventDefault()
					setSelectedItems(items)
					return
				}
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
				// Allow preview for all items including directories (info card fallback for filetypes without viewers)
				if (item.type) {
					setViewerItem(item, 'preview')
				}
				return
			}

			// Arrow key navigation (allowed even in read-only)
			if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
				if (isInInput(e) || mod || e.altKey || items.length === 0) return

				const currentView = viewRef.current
				const viewer = viewerItemRef.current
				const mode = viewerModeRef.current

				// --- Preview navigation (viewer is open) ---
				if (viewer) {
					// In list view, left/right are meaningless
					const isHorizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight'
					if (isHorizontal && currentView === 'list') return
					// Don't intercept arrow keys when viewing video via double-click/navigate —
					// let the video player handle seek/volume. In preview mode (spacebar),
					// arrow keys navigate between files instead.
					if (viewer.type?.startsWith('video/') && mode !== 'preview') return

					// Build the list of items navigable in preview
					const previewable = items.filter((file) => {
						if (typeof file.type !== 'string') return false
						if (mode === 'preview') return true
						const entry = FILE_TYPE_MAP[file.type as keyof typeof FILE_TYPE_MAP]
						return Boolean(entry?.viewer)
					})
					if (previewable.length === 0) return
					const currentIndex = previewable.findIndex((f) => f.path === viewer.path)
					if (currentIndex === -1) return

					// In icons view, up/down jump by the column count (same as listing navigation)
					let step = 1
					if (currentView === 'icons' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
						const scrollEl = scrollAreaRef.current
						const columnCount = scrollEl ? getGridColumnCount(scrollEl.clientWidth - 24) : 1
						step = columnCount
					}

					const isPrev = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
					const nextIndex = isPrev
						? Math.max(0, currentIndex - step)
						: Math.min(previewable.length - 1, currentIndex + step)

					e.preventDefault()
					if (nextIndex !== currentIndex) {
						const nextItem = previewable[nextIndex]
						setViewerItem(nextItem, mode)
						setSelectedItems([nextItem])
					}
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

				// If nothing is selected or the selected item was removed, select the first item
				if (currentIndex === -1) {
					setSelectedItems([items[0]])
					selectionAnchorRef.current = 0
					selectionCursorRef.current = 0
					scrollItemIntoView(0)
					return
				}

				// Calculate the step based on view and direction
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
						const columnCount = scrollEl ? getGridColumnCount(scrollEl.clientWidth - 24) : 1
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

			// Search functionality
			if (!shortcutsEnabled) return
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
				const columnCount = getGridColumnCount(scrollEl.clientWidth - 24)
				const row = Math.floor(index / columnCount)
				const rowHeight = 144 // 120px item + 24px gap
				itemTop = row * rowHeight
				itemBottom = itemTop + rowHeight
			}

			const {scrollTop, clientHeight} = scrollEl

			if (itemTop < scrollTop) {
				scrollEl.scrollTop = itemTop
			} else if (itemBottom > scrollTop + clientHeight) {
				scrollEl.scrollTop = itemBottom - clientHeight
			}
		}

		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [
		shortcutsEnabled,
		currentPath,
		items,
		isMobile,
		copyItemsToClipboard,
		cutItemsToClipboard,
		setSelectedItems,
		setViewerItem,
		pasteItemsFromClipboard,
		trashSelectedItems,
		navigateToItem,
		navigateToDirectory,
		scrollAreaRef,
		routerNavigate,
		linkToDialog,
	])
}
