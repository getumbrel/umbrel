import {useEffect, useRef} from 'react'
import {useKey} from 'react-use'

import {FILE_TYPE_MAP} from '@/features/files/constants'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'

/**
 * Hook to handle keyboard shortcuts for file operations: copy, cut, paste, and trash.
 * We use both command and ctrl for every shortcut to mimic the behaviour of both macOS and windows.
 */
export function useFilesKeyboardShortcuts({items}: {items: FileSystemItem[]}) {
	const isReadOnly = useIsFilesReadOnly()
	// In read-only mode, disable write/selection shortcuts but allow viewer shortcut.
	const shortcutsEnabled = !isReadOnly
	const {currentPath} = useNavigate()
	const copyItemsToClipboard = useFilesStore((s: FilesStore) => s.copyItemsToClipboard)
	const cutItemsToClipboard = useFilesStore((s: FilesStore) => s.cutItemsToClipboard)
	const setSelectedItems = useFilesStore((s: FilesStore) => s.setSelectedItems)
	const selectedItems = useFilesStore((s: FilesStore) => s.selectedItems)
	const setViewerItem = useFilesStore((s: FilesStore) => s.setViewerItem)
	const {pasteItemsFromClipboard, trashSelectedItems} = useFilesOperations()

	// Search functionality
	const searchBuffer = useRef('')
	const searchTimer = useRef<NodeJS.Timeout>()

	// Guard to check if we're in a text input or contentEditable element
	// We don't want to override the default shortcut behaviour for text inputs.
	// For example, we want cmd+backspace to delete a word when editing a file name, not move to trash.
	const isInInput = (e: KeyboardEvent): boolean => {
		const target = e.target as HTMLElement
		return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable
	}

	// Register copy shortcut (⌘C / Ctrl+C)
	useKey(
		(e) => shortcutsEnabled && (e.metaKey || e.ctrlKey) && e.key === 'c',
		(e) => {
			if (!shortcutsEnabled) return
			if (isInInput(e)) return
			e.preventDefault()
			copyItemsToClipboard()
		},
	)

	// Register cut shortcut (⌘X / Ctrl+X)
	useKey(
		(e) => shortcutsEnabled && (e.metaKey || e.ctrlKey) && e.key === 'x',
		(e) => {
			if (!shortcutsEnabled) return
			if (isInInput(e)) return
			e.preventDefault()
			cutItemsToClipboard()
		},
	)

	// Register paste shortcut (⌘V / Ctrl+V)
	useKey(
		(e) => shortcutsEnabled && (e.metaKey || e.ctrlKey) && e.key === 'v',
		(e) => {
			// Simple but hacky:
			// If Rewind is open (marked via data-rewind on its dialog),
			// ignore paste to prevent background Files from showing collision dialogs.
			// This avoids global state or focus plumbing; revisit with scoped shortcuts later.
			if (document.querySelector('[data-rewind="open"]')) return
			if (!shortcutsEnabled) return
			if (isInInput(e)) return
			e.preventDefault()
			pasteItemsFromClipboard({toDirectory: currentPath})
		},
	)

	// Register trash shortcut (⌘⌫ / Ctrl+Backspace)
	useKey(
		(e) => shortcutsEnabled && (e.metaKey || e.ctrlKey) && e.key === 'Backspace',
		(e) => {
			if (!shortcutsEnabled) return
			if (isInInput(e)) return
			e.preventDefault()
			trashSelectedItems()
		},
	)

	// Register select all shortcut (⌘A / Ctrl+A)
	useKey(
		(e) => shortcutsEnabled && (e.metaKey || e.ctrlKey) && e.key === 'a',
		(e) => {
			if (!shortcutsEnabled) return
			if (isInInput(e)) return
			e.preventDefault()
			// Select all items in the current directory
			setSelectedItems(items)
		},
	)

	// Register space bar to view selected item (allowed even in read-only)
	useKey(
		(e) => e.key === ' ',
		(e) => {
			if (
				isInInput(e) ||
				e.metaKey ||
				e.ctrlKey ||
				e.altKey ||
				searchBuffer.current.length > 0 ||
				selectedItems.length !== 1
			)
				return
			e.preventDefault()
			const item = selectedItems[0]
			const fileType = FILE_TYPE_MAP[item.type as keyof typeof FILE_TYPE_MAP]
			if (fileType && fileType.viewer) {
				setViewerItem(item)
			}
		},
	)

	// Handle search functionality
	useEffect(() => {
		if (!shortcutsEnabled) return
		const handleKeyDown = (e: KeyboardEvent) => {
			// Ignore if we're in an input or if using modifier keys
			if (isInInput(e) || e.metaKey || e.ctrlKey || e.altKey) return

			// Skip handling the spacebar as a search input if it's the first key pressed.
			// This ensures the spacebar can be used to open the viewer immediately without waiting for the search buffer to clear.
			// If the spacebar is pressed during an ongoing search (i.e., not the first key), it will be included in the search input.
			if (e.key === ' ' && searchBuffer.current.length === 0) return

			// Only handle printable characters
			if (e.key.length === 1) {
				e.preventDefault()

				// Append to search buffer
				searchBuffer.current += e.key.toLowerCase()

				// Clear previous timer
				if (searchTimer.current) {
					clearTimeout(searchTimer.current)
				}

				// Set new timer to clear search buffer after 700ms
				sessionStorage
				searchTimer.current = setTimeout(() => {
					searchBuffer.current = ''
				}, 700)

				// Find first matching item
				const matchingItem = items.find((item) => item.name.toLowerCase().startsWith(searchBuffer.current))

				if (matchingItem) {
					setSelectedItems([matchingItem])
				}
			}
		}

		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [items, setSelectedItems, shortcutsEnabled])
}
