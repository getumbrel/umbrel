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
	getGridItemHeight,
	getListRowHeight,
	GRID_ROW_GAP,
	LISTING_FADE_TOP_PX,
	readScrollerLayout,
} from '@/features/files/utils/get-grid-column-count'
import {isKeyForFocusedControl} from '@/features/files/utils/is-key-for-focused-control'
import {useLargerText} from '@/hooks/use-accessibility'
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
	hasMore = false,
	onLoadAll,
	listingRef,
	scrollAreaRef,
	view,
}: {
	items: FileSystemItem[]
	hiddenRenamedPaths?: string[]
	// The listing holds more than `items`, which `onLoadAll` loads the rest of
	hasMore?: boolean
	onLoadAll?: () => Promise<boolean>
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
	const largerText = useLargerText()

	// Search functionality
	const searchBuffer = useRef('')
	const searchTimer = useRef<NodeJS.Timeout | undefined>(undefined)
	// A typed name that nothing loaded starts with, in a folder with more to
	// load: the rest is on its way, and the name is looked for again when it
	// lands, as long as nothing else has been selected meanwhile
	const awaitedName = useRef<{name: string; selection: FileSystemItem[]} | null>(null)
	const latestLoading = useRef({hasMore, onLoadAll})
	latestLoading.current = {hasMore, onLoadAll}
	useEffect(() => {
		const awaited = awaitedName.current
		if (!awaited) return
		if (useFilesStore.getState().selectedItems !== awaited.selection) {
			awaitedName.current = null
			return
		}
		const match = items.find((item) => item.name.toLowerCase().startsWith(awaited.name))
		if (match) setSelectedItems([match])
		if (match || !hasMore) awaitedName.current = null
	}, [items, hasMore, setSelectedItems])

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

	// Where a Shift+Arrow range began (the anchor) and where its moving end is
	// now (the cursor), as paths. Not indexes, and not reset when the items
	// change: the listing hands over a new array whenever it renders, and rows
	// come and go as pages load, while the range has to stay where it was put.
	const selectionAnchorRef = useRef<string | null>(null)
	const selectionCursorRef = useRef<string | null>(null)
	// The selection the arrows last made, to tell it from one made some other way
	const arrowSelectionRef = useRef<FileSystemItem[] | null>(null)

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
				distance = readScrollerLayout(scrollAreaRef.current).columnCount
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

			// Escape lets go of the selection, as a click on empty space does.
			// Ahead of the check below: the sheet Files lives in turns every
			// Escape down so that it doesn't close, which marks them all as
			// handled. Not while a viewer is open over the listing (Escape is the
			// viewer's), from a field (a name being typed gives up its edit) or
			// from inside a popover (it closes that), nor in the middle of a drag
			// (which Escape calls off). On a touch screen that is selecting, a
			// second Escape leaves selecting, as Done does.
			if (e.key === 'Escape' && viewerItemRef.current === null) {
				if (isInInput(e) || e.metaKey || e.ctrlKey || e.altKey) return
				if (e.target instanceof Element && e.target.closest('[data-radix-popper-content-wrapper]')) return
				const {draggedItems, isSelectingOnMobile, setIsSelectingOnMobile} = useFilesStore.getState()
				if (draggedItems.length > 0) return
				if (selectedItemsRef.current.length > 0) setSelectedItems([])
				else if (isSelectingOnMobile) setIsSelectingOnMobile(false)
				return
			}

			// A key the focused control already handled (the Cloud tree's arrows) isn't the listing's
			if (e.defaultPrevented) return

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

				// While Select all is still loading the rest of a folder, the
				// selection is short of what was asked for: copying, cutting or
				// trashing it would act on a part as if it were the whole
				const isSelectingAll = useFilesStore.getState().isSelectingAll

				if (e.key === 'c') {
					e.preventDefault()
					if (!isSelectingAll) copyItemsToClipboard()
					return
				}

				if (e.key === 'a') {
					e.preventDefault()
					// The listing selects everything it holds, loaded or not (see Listing)
					const selectAll = useFilesStore.getState().selectAllHandler
					if (selectAll) selectAll()
					else setSelectedItems(items)
					return
				}

				// Write shortcuts below are unavailable in embedded read-only
				// mode. Their command handlers also enforce per-path operations.
				// Note: No Cmd+Shift+N for new folder — the browser intercepts it to open a new window.
				if (!writeShortcutsEnabled) return

				if (e.key === 'x') {
					e.preventDefault()
					if (!isSelectingAll) cutItemsToClipboard()
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
					if (selected.length === 0 || isSelectingAll) return
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

			// Space bar to view selected item (allowed even in read-only). In the
			// middle of a name being typed, it is part of the name (see below).
			if (e.key === ' ' && searchBuffer.current.length === 0) {
				if (
					isInInput(e) ||
					isKeyForFocusedControl(e) ||
					mod ||
					e.altKey ||
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

				const indexOf = (path: string | null) => (path === null ? -1 : items.findIndex((i) => i.path === path))

				// A selection the arrows made keeps its anchor, however the listing
				// has re-rendered since. One made some other way (a click, a
				// marquee, a Shift+click, Select all) is where the arrows go on
				// from: the item selected first anchors the range, and its moving
				// end is the selected item furthest from that in the listing.
				const byArrows = arrowSelectionRef.current
				const madeByArrows =
					byArrows !== null &&
					(selected === byArrows ||
						(selected.length === byArrows.length && selected.every((item, i) => item.path === byArrows[i].path)))
				if (!madeByArrows) {
					arrowSelectionRef.current = null
					selectionAnchorRef.current = selected[0]?.path ?? null
					selectionCursorRef.current = selected[0]?.path ?? null
					if (selected.length > 1) {
						const selectedPaths = new Set(selected.map((i) => i.path))
						let first = -1
						let last = -1
						items.forEach((item, index) => {
							if (!selectedPaths.has(item.path)) return
							if (first === -1) first = index
							last = index
						})
						const anchor = indexOf(selectionAnchorRef.current)
						if (first !== -1 && anchor !== -1) {
							selectionCursorRef.current = items[anchor - first > last - anchor ? first : last].path
						}
					}
				}

				// The moving end is where the next step is taken from
				const currentIndex = indexOf(selectionCursorRef.current)

				// If nothing is selected or the selected item was removed, select the first item.
				// A rename the listing is deliberately holding back is neither: it is still
				// the user's place in the folder, so arrow keys must not jump to the top.
				const selectByArrow = (next: FileSystemItem[]) => {
					arrowSelectionRef.current = next
					setSelectedItems(next)
				}
				if (currentIndex === -1) {
					if (selected.length === 1 && hiddenRenamedPathsRef.current?.includes(selected[0].path)) return
					selectByArrow([items[0]])
					selectionAnchorRef.current = items[0].path
					selectionCursorRef.current = items[0].path
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
						const {columnCount} = readScrollerLayout(scrollAreaRef.current)
						if (e.key === 'ArrowUp') step = -columnCount
						else step = columnCount
					}
				}

				// Clamp target to valid range
				const targetIndex = Math.max(0, Math.min(items.length - 1, currentIndex + step))

				// If we're already at the boundary and can't move, do nothing
				if (targetIndex === currentIndex) return

				if (e.shiftKey) {
					// Shift+Arrow: the selection is the contiguous range from the anchor
					// to the target. An anchor that has left the listing gives way to
					// where the step was taken from.
					let anchor = indexOf(selectionAnchorRef.current)
					if (anchor === -1) {
						anchor = currentIndex
						selectionAnchorRef.current = items[currentIndex].path
					}
					const start = Math.min(anchor, targetIndex)
					const end = Math.max(anchor, targetIndex)
					selectByArrow(items.slice(start, end + 1))
				} else {
					// Regular arrow: select only the target item, which anchors the next range
					selectByArrow([items[targetIndex]])
					selectionAnchorRef.current = items[targetIndex].path
				}
				selectionCursorRef.current = items[targetIndex].path

				scrollItemIntoView(targetIndex)
				return
			}

			// Typing a name selects the first item that starts with it. It stays
			// available in read-only views. A space only ever continues a name
			// (one that opens a name is the quick look's, above), and not when it
			// is pressing a focused button.
			if (isInInput(e) || mod || e.altKey) return
			if (e.key === ' ' && isKeyForFocusedControl(e)) return

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
				awaitedName.current = null
				if (matchingItem) {
					setSelectedItems([matchingItem])
				} else if (latestLoading.current.hasMore && latestLoading.current.onLoadAll) {
					// It may be further down than what is loaded: load the rest and look again (see above)
					awaitedName.current = {name: searchBuffer.current, selection: selectedItemsRef.current}
					void latestLoading.current.onLoadAll()
				}
			}
		}

		/** Scroll the item at `index` into view if it's outside the visible area */
		function scrollItemIntoView(index: number) {
			const scrollEl = scrollAreaRef.current
			if (!scrollEl) return

			const currentView = viewRef.current
			const {columnCount, bottomInset} = readScrollerLayout(scrollEl)
			let itemTop: number
			let itemBottom: number

			if (currentView === 'list') {
				const itemHeight = getListRowHeight(isMobile, largerText)
				itemTop = index * itemHeight
				itemBottom = itemTop + itemHeight
			} else {
				const row = Math.floor(index / columnCount)
				const rowHeight = getGridItemHeight(largerText) + GRID_ROW_GAP
				itemTop = row * rowHeight
				itemBottom = itemTop + rowHeight
			}

			const {scrollTop, clientHeight} = scrollEl

			// Pad by the edge fades (and the dock over the bottom) so the item lands clearly visible, not under them
			if (itemTop < scrollTop + LISTING_FADE_TOP_PX) {
				scrollEl.scrollTop = Math.max(0, itemTop - LISTING_FADE_TOP_PX)
			} else if (itemBottom > scrollTop + clientHeight - bottomInset) {
				scrollEl.scrollTop = itemBottom - clientHeight + bottomInset
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
		largerText,
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
