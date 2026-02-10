import {useEffect, useRef} from 'react'

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
 * Uses a single useEffect listener instead of react-use's useKey for React Compiler compatibility.
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
	const viewerItem = useFilesStore((s: FilesStore) => s.viewerItem)
	const setViewerItem = useFilesStore((s: FilesStore) => s.setViewerItem)
	const {pasteItemsFromClipboard, trashSelectedItems} = useFilesOperations()

	// Search functionality
	const searchBuffer = useRef('')
	const searchTimer = useRef<NodeJS.Timeout | undefined>(undefined)

	// Use refs for values that change frequently so the useEffect doesn't need to re-register
	const selectedItemsRef = useRef(selectedItems)
	selectedItemsRef.current = selectedItems
	const viewerItemRef = useRef(viewerItem)
	viewerItemRef.current = viewerItem

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

		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [
		shortcutsEnabled,
		currentPath,
		items,
		copyItemsToClipboard,
		cutItemsToClipboard,
		setSelectedItems,
		setViewerItem,
		pasteItemsFromClipboard,
		trashSelectedItems,
	])
}
