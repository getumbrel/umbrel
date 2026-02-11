import {useEffect, useRef} from 'react'

import {FILE_TYPE_MAP} from '@/features/files/constants'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {getGridColumnCount} from '@/features/files/utils/get-grid-column-count'
import {useIsMobile} from '@/hooks/use-is-mobile'

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
	const {currentPath} = useNavigate()
	const copyItemsToClipboard = useFilesStore((s: FilesStore) => s.copyItemsToClipboard)
	const cutItemsToClipboard = useFilesStore((s: FilesStore) => s.cutItemsToClipboard)
	const setSelectedItems = useFilesStore((s: FilesStore) => s.setSelectedItems)
	const selectedItems = useFilesStore((s: FilesStore) => s.selectedItems)
	const viewerItem = useFilesStore((s: FilesStore) => s.viewerItem)
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
	const viewRef = useRef(view)
	viewRef.current = view

	// Track the anchor index for Shift+Arrow range selection
	const selectionAnchorRef = useRef<number>(-1)

	useEffect(() => {
		// Guard to check if we're in a text input or contentEditable element
		const isInInput = (e: KeyboardEvent): boolean => {
			const target = e.target as HTMLElement
			return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable
		}

		const handleKeyDown = (e: KeyboardEvent) => {
			const mod = e.metaKey || e.ctrlKey

			// Modifier shortcuts (copy, cut, paste, trash, select all)
			if (mod && shortcutsEnabled) {
				if (isInInput(e)) return

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
					trashSelectedItems()
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
				const fileType = FILE_TYPE_MAP[item.type as keyof typeof FILE_TYPE_MAP]
				if (fileType && fileType.viewer) {
					setViewerItem(item)
				}
				return
			}

			// Arrow key navigation (allowed even in read-only)
			if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
				if (isInInput(e) || mod || e.altKey || viewerItemRef.current !== null || items.length === 0) return
				e.preventDefault()

				const currentView = viewRef.current
				const selected = selectedItemsRef.current

				// Find the current index — use the last selected item as the reference point
				let currentIndex = -1
				if (selected.length > 0) {
					const lastSelected = selected[selected.length - 1]
					currentIndex = items.findIndex((i) => i.path === lastSelected.path)
				}

				// If nothing is selected or the selected item was removed, select the first item
				if (currentIndex === -1) {
					setSelectedItems([items[0]])
					selectionAnchorRef.current = 0
					scrollItemIntoView(0)
					return
				}

				// Calculate the step based on view and direction
				let step = 0
				if (currentView === 'list') {
					// List view: all arrows move by 1
					if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') step = -1
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
				} else {
					// Regular arrow: select only the target item and reset anchor
					setSelectedItems([items[targetIndex]])
					selectionAnchorRef.current = targetIndex
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
		scrollAreaRef,
	])
}
