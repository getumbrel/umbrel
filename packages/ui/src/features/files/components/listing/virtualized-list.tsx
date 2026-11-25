import React, {memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbLoader} from 'react-icons/tb'
import {areEqual, FixedSizeGrid, FixedSizeList, GridChildComponentProps, ListChildComponentProps} from 'react-window'
import InfiniteLoader from 'react-window-infinite-loader'

import {FileItem} from '@/features/files/components/listing/file-item'
import {FileItemProvider} from '@/features/files/components/listing/file-item/file-item-context'
import {useIsFilesEmbedded} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {
	getGridColumnCount,
	getGridItemHeight,
	getGridItemWidth,
	getGridMinItemWidth,
	getGridScrollerPadding,
	getListRowHeight,
	GRID_GAP,
	LISTING_FADE_BOTTOM_PX,
	LISTING_FADE_TOP_PX,
} from '@/features/files/utils/get-grid-column-count'
import {getItemKey} from '@/features/files/utils/get-item-key'
import {indexAtPoint, indexesInRect, type ListingLayout} from '@/features/files/utils/listing-hit-test'
import {selectedPathsOf} from '@/features/files/utils/selected-paths'
import {useLargerText} from '@/hooks/use-accessibility'
import {useContainerSize} from '@/hooks/use-container-size'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {marqueeBoxClass, useMarquee} from '@/hooks/use-marquee'
import {useSwipeSelect} from '@/hooks/use-swipe-select'
import {cn} from '@/lib/utils'
import {useDockClearance} from '@/modules/desktop/dock'
import {useHomeFit} from '@/modules/desktop/home-fit'

// Hook to detect scroll in react-window components so we can apply custom fade styling
const useScrollFade = () => {
	const [isScrolled, setIsScrolled] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)

	// Memoize the scroll handler to avoid recreation on re-renders
	const handleScroll = useCallback((event: Event) => {
		const scrollElement = event.target as HTMLElement
		setIsScrolled(scrollElement.scrollTop > 0)
	}, [])

	useEffect(() => {
		const container = containerRef.current
		if (!container) return

		// Find the scrollable element created by react-window
		const findScrollElement = () => {
			return container.querySelector('[style*="overflow: auto"], [style*="overflow:auto"]') as HTMLElement | null
		}

		// Try to find the scroll element immediately
		let scrollElement = findScrollElement()

		// If not found immediately, use a mutation observer to detect when it's added
		let observer: MutationObserver | null = null

		if (!scrollElement) {
			observer = new MutationObserver(() => {
				scrollElement = findScrollElement()
				if (scrollElement) {
					scrollElement.addEventListener('scroll', handleScroll)
					// Check initial position
					setIsScrolled(scrollElement.scrollTop > 0)
					observer?.disconnect()
					observer = null
				}
			})

			observer.observe(container, {childList: true, subtree: true})
		} else {
			// Element found immediately
			scrollElement.addEventListener('scroll', handleScroll)
			// Check initial position
			setIsScrolled(scrollElement.scrollTop > 0)
		}

		// Cleanup function
		return () => {
			if (scrollElement) {
				scrollElement.removeEventListener('scroll', handleScroll)
			}
			if (observer) {
				observer.disconnect()
			}
		}
	}, [handleScroll])

	return {containerRef, isScrolled}
}

// What a press with the mouse lands on, as far as the marquee is concerned:
// the listing's empty space, the empty space of a list row, or something with
// a use of its own for the press (null). A row of the list runs the listing's
// whole width, so it gives the marquee all of itself but its icon and name,
// which are what pick the file up (see FileItem). A tile is picked up anywhere.
// [vaul-overlay] is the backdrop of the drawer a name is typed in.
function marqueePress(target: Element): 'space' | 'row' | null {
	const interactive = target.closest(
		'button, a, input, [role="button"], [role="link"], [role="menuitem"], [vaul-overlay]',
	)
	if (!interactive) return 'space'
	const item = target.closest('[data-files-item]')
	const isRowSpace =
		item !== null &&
		interactive === item &&
		item.closest('.files-list-view-file-item') !== null &&
		!target.closest('[data-item-content]')
	return isRowSpace ? 'row' : null
}

// These overscan amounts control how many rows are rendered outside the visible react-window area (both above and below the area)
// so that items do not appear to render suddenly when scrolling. The grid mounts fewer rows beyond what shows: each holds a row of tiles.
const LIST_OVERSCAN_AMOUNT = 12
const GRID_OVERSCAN_AMOUNT = 2

// Used to trigger fetching more items when only a certain number of items are left to render
const INFINITE_LOADER_THRESHOLD = 100

interface VirtualizedListProps {
	items: FileSystemItem[]
	// The items a marquee may select (not ones still uploading). All of them, unless said.
	selectableItems?: FileSystemItem[]
	hiddenRenamedPaths?: string[]
	hasMore: boolean
	isLoading: boolean
	onLoadMore: (startIndex: number) => Promise<boolean>
	// Loads everything there is left to load
	onLoadAll?: () => Promise<boolean>
	scrollAreaRef: React.RefObject<HTMLDivElement | null>
	view: 'list' | 'icons'
}

/**
 * Common index range used for virtualized rendering
 * - visibleStartIndex/visibleStopIndex: The first/last item indexes currently visible
 * - overscanStartIndex/overscanStopIndex: The first/last item indexes in the render buffer
 */
interface IndexRange {
	visibleStartIndex: number
	visibleStopIndex: number
	overscanStartIndex: number
	overscanStopIndex: number
}

/**
 * Props provided by InfiniteLoader to its render function
 * - onItemsRendered: Callback to notify which items are currently rendered
 * - ref: Ref to be passed to the underlying List/Grid component
 */
interface InfiniteLoaderRenderProps {
	onItemsRendered: (indices: IndexRange) => void
	ref: React.Ref<FixedSizeList | FixedSizeGrid>
}

/**
 * Position information provided by Grid's onItemsRendered callback
 * Used to calculate which rows and columns are currently visible
 */
interface GridVisibleIndices {
	visibleRowStartIndex: number
	visibleRowStopIndex: number
	visibleColumnStartIndex: number
	visibleColumnStopIndex: number
}

/**
 * Data passed to list rows: the items, and the listing's width in pixels
 * (rows are as wide as the listing, not as the wider scroller they are in)
 */
interface ListRowData {
	items: FileSystemItem[]
	width: number
	// There is more of the folder to load, asked for from the slot after the last item
	hasMore: boolean
}

/**
 * Data passed to grid cells for rendering items
 * Contains both the item array and layout dimensions
 */
interface GridItemData {
	items: FileSystemItem[]
	columnCount: number
	itemHeight: number
	itemWidth: number
	hasMore: boolean
}

// What stands in the slot after the last loaded item while the next page is
// on its way: without it a long folder scrolled faster than it loads looks as
// if it ends there. Most pages land before it could be read, so it holds back
// a moment, as the listing's own spinner does.
function MoreLoading() {
	const {t} = useTranslation()
	return (
		<div className='flex size-full items-center justify-center motion-safe:animate-in motion-safe:duration-300 motion-safe:fill-mode-backwards motion-safe:[animation-delay:300ms] motion-safe:fade-in'>
			<TbLoader className='size-5 animate-spin text-white/40' aria-label={t('files-listing.loading')} />
		</div>
	)
}

// One row of the list, and one tile of the grid. Each is a component of its
// own that stays the same from render to render and is handed the items as
// data. They used to be functions made anew whenever the items changed, which
// to React is a different component each time: every page that arrived, and
// every refresh, unmounted all the rows on screen and mounted them again,
// taking a name being typed in one of them along. Now a row whose item hasn't
// changed is left alone, and one whose item has is updated in place.
const ListRow = memo(function ListRow({index, style, data}: ListChildComponentProps<ListRowData>) {
	const {items, width, hasMore} = data
	const item = items[index]
	if (!item) {
		if (!hasMore || index !== items.length) return null
		return (
			<div style={{...style, width}}>
				<MoreLoading />
			</div>
		)
	}
	return (
		<div
			style={{...style, width}}
			data-item-path={item.path}
			// Every other row lies on a faint band (see list-view-file-item.css)
			data-striped={index % 2 === 1 ? '' : undefined}
			className='files-list-view-file-item relative'
		>
			<FileItem item={item} items={items} index={index} />
		</div>
	)
}, areEqual)

// We cannot use simple flexbox css because we are using react-window for
// virtualization: each tile is placed by hand, the row's width shared out
// evenly between the columns
const GridCell = memo(function GridCell({columnIndex, rowIndex, style, data}: GridChildComponentProps<GridItemData>) {
	const {items, columnCount, itemHeight, itemWidth, hasMore} = data
	const index = rowIndex * columnCount + columnIndex
	const item = items[index]
	const placed = {
		...style,
		left: columnIndex * (itemWidth + GRID_GAP),
		top: rowIndex * (itemHeight + GRID_GAP),
		width: itemWidth,
		height: itemHeight,
	}
	if (!item) {
		if (!hasMore || index !== items.length) return null
		return (
			<div style={placed}>
				<MoreLoading />
			</div>
		)
	}
	return (
		<div style={placed} className='relative' data-item-path={item.path}>
			<FileItem item={item} items={items} index={index} />
		</div>
	)
}, areEqual)

// Rows and tiles are known to React by their item, not by where they stand:
// one that moves as the listing changes above it moves, state and all
const listRowKey = (index: number, {items}: ListRowData) => (items[index] ? getItemKey(items[index]) : `slot-${index}`)
const gridCellKey = ({columnIndex, rowIndex, data}: {columnIndex: number; rowIndex: number; data: GridItemData}) => {
	const item = data.items[rowIndex * data.columnCount + columnIndex]
	return item ? getItemKey(item) : `slot-${rowIndex}-${columnIndex}`
}

// How much of the scroller's bottom the listing's last rows must be able to
// scroll clear of. Files itself runs down to the sheet's bottom edge, beneath
// the dock, so that is the dock and a breath above it. A phone on its side
// tucks its dock away as the listing scrolls, and keeps only room to clear it
// at the very end. Embedded in Rewind there is no dock: only the card's fade.
const DOCK_BREATHING_ROOM_PX = 12
const SCROLL_END_SPACER_UNDER_DOCK_PX = 96
function useBottomInset() {
	const isEmbedded = useIsFilesEmbedded()
	const dockClearance = useDockClearance()
	const {low} = useHomeFit()
	if (isEmbedded) return LISTING_FADE_BOTTOM_PX
	return low ? SCROLL_END_SPACER_UNDER_DOCK_PX : Math.round(dockClearance) + DOCK_BREATHING_ROOM_PX
}

// Trailing scroll room inside the virtualized content so the last row can be
// scrolled up past the dock (or the bottom fade) and read comfortably. Extends
// the scrollable height without shrinking the viewport (which must stay flush
// with the sheet's edge).
const InnerElementWithEndSpacer = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
	function InnerElementWithEndSpacer({style, ...rest}, ref) {
		const endSpacer = useBottomInset()
		const height =
			typeof style?.height === 'number' ? style.height + endSpacer : `calc(${style?.height} + ${endSpacer}px)`
		return <div ref={ref} style={{...style, height}} {...rest} />
	},
)

export const VirtualizedList: React.FC<VirtualizedListProps> = ({
	items,
	selectableItems,
	hiddenRenamedPaths,
	hasMore,
	isLoading,
	onLoadMore,
	onLoadAll,
	scrollAreaRef,
	view,
}) => {
	const infiniteLoaderRef = useRef<InfiniteLoader>(null)
	const isMobile = useIsMobile()
	const isEmbedded = useIsFilesEmbedded()
	const largerText = useLargerText()
	const bottomInset = useBottomInset()
	const {containerRef, isScrolled} = useScrollFade()
	const {width, height} = useContainerSize(containerRef)

	// The layout, in one place: rows and tiles are sized from these, and so is
	// everything that has to find an item without asking the DOM
	const rowHeight = getListRowHeight(isMobile, largerText)
	const columnCount = getGridColumnCount(width, getGridMinItemWidth(isMobile))
	const itemWidth = getGridItemWidth(width, isMobile)
	const itemHeight = getGridItemHeight(largerText)
	const scrollerPadding = getGridScrollerPadding(isMobile, isEmbedded)

	// Keyboard navigation scrolls to items by the numbers the rows were laid out with
	useLayoutEffect(() => {
		const scroller = scrollAreaRef.current
		if (!scroller) return
		scroller.dataset.columns = String(view === 'list' ? 1 : columnCount)
		scroller.dataset.bottomInset = String(bottomInset)
	})

	// Bring a programmatically-selected item into view: type-ahead search, a
	// freshly created folder, and deep links (e.g. the Recents widget or cmdk)
	// all select without scrolling. Reveal once using current metadata so later
	// server updates do not interrupt manual scrolling. Missing deep links keep
	// paging; renames only follow within the loaded range.
	const selectedItems = useFilesStore((s) => s.selectedItems)
	const selectedPath = selectedItems.length === 1 ? selectedItems[0].path : undefined
	// Match the selected object so a later deep link to the same path is not
	// mistaken for the rename that left this optimistic entry behind.
	const isRenameSelection = useFilesStore((s) =>
		s.incomingItems.some((item) => item === selectedItems[0] && !!item.renamedFrom),
	)
	// A folder just made here is listed at once, ahead of the server. In a
	// folder that isn't all loaded that puts it at the end of what is, wherever
	// it belongs, so the rest is loaded first and it is revealed where it
	// really stands.
	const isNewArrival = useFilesStore((s) =>
		s.incomingItems.some((item) => item === selectedItems[0] && !item.renamedFrom),
	)
	const handledSelectionRef = useRef<string | null>(null)
	useEffect(() => {
		handledSelectionRef.current = null
	}, [selectedPath])
	useEffect(() => {
		if (!selectedPath || handledSelectionRef.current === selectedPath) return
		if (isRenameSelection && hiddenRenamedPaths?.includes(selectedPath)) {
			// Do not fetch pages for this rename or jump when it arrives later.
			handledSelectionRef.current = selectedPath
			return
		}
		if (isNewArrival && hasMore && onLoadAll) {
			void onLoadAll()
			return
		}
		const index = items.findIndex((item) => item.path === selectedPath)
		if (index === -1) {
			// The store can update before the listing supplies its rename result.
			if (isRenameSelection) return
			if (hasMore) onLoadMore(items.length)
			return
		}
		const scrollEl = scrollAreaRef.current
		if (!scrollEl) return
		// Scroll only when the item sits outside the clearly-visible band, padded
		// by the top fade and by the dock (or fade) over the bottom, so the
		// selection never lands half-hidden under them.
		const rowPitch = view === 'list' ? rowHeight : itemHeight + GRID_GAP
		const row = view === 'list' ? index : Math.floor(index / columnCount)
		const itemTop = row * rowPitch
		const itemBottom = itemTop + rowPitch
		const {scrollTop, clientHeight} = scrollEl
		if (itemTop < scrollTop + LISTING_FADE_TOP_PX) {
			scrollEl.scrollTo({top: Math.max(0, itemTop - LISTING_FADE_TOP_PX)})
		} else if (itemBottom > scrollTop + clientHeight - bottomInset) {
			scrollEl.scrollTo({top: itemBottom - clientHeight + bottomInset})
		}
		handledSelectionRef.current = selectedPath
	}, [
		selectedPath,
		isRenameSelection,
		isNewArrival,
		hiddenRenamedPaths,
		items,
		hasMore,
		onLoadMore,
		onLoadAll,
		view,
		rowHeight,
		itemHeight,
		columnCount,
		bottomInset,
		scrollAreaRef,
	])

	// Selecting by dragging, with a finger or a mouse. Either way, which item
	// is where is arithmetic over the layout, so a drag reaches rows that
	// aren't mounted and measures nothing as it goes.
	const layout: ListingLayout =
		view === 'list'
			? {view: 'list', count: items.length, width, rowHeight}
			: {view: 'icons', count: items.length, columnCount, itemWidth, itemHeight}
	const setSelectedItems = useFilesStore((s) => s.setSelectedItems)
	const selectedPathsRef = useRef<ReadonlySet<string>>(new Set())
	useLayoutEffect(() => {
		selectedPathsRef.current = selectedPathsOf(selectedItems)
	}, [selectedItems])

	// On a touch screen in selection mode, a finger drawn across the items
	// selects them as it goes (see useSwipeSelect): sideways from any item, as
	// in Photos, or in any direction from a row's selection circle or from
	// anywhere on an item it was held on for a moment
	const isSelecting = useFilesStore((state) => state.isSelectingOnMobile)
	useSwipeSelect({
		scrollerRef: scrollAreaRef,
		// The scroller mounts once the listing is measured, and the list and the grid each have their own
		scrollerKey: `${view}-${width > 0 && height > 0}-${isLoading}-${items.length > 0}`,
		itemAt: (x, y) => {
			const index = indexAtPoint(layout, x, y)
			return index === undefined ? undefined : items[index]?.path
		},
		between: (from, to) => {
			const start = items.findIndex((item) => item.path === from)
			const stop = items.findIndex((item) => item.path === to)
			if (start === -1 || stop === -1) return null
			return items
				.slice(Math.min(start, stop), Math.max(start, stop) + 1)
				.filter((item) => !item.isUploading)
				.map((item) => item.path)
		},
		selectionRef: selectedPathsRef,
		enabled: isSelecting,
		edges: {top: LISTING_FADE_TOP_PX, bottom: bottomInset},
		// What was selected keeps its order, and what the swipe adds follows in the listing's
		onSelect: (paths) => {
			const kept = useFilesStore.getState().selectedItems.filter((item) => paths.has(item.path))
			const keptPaths = new Set(kept.map((item) => item.path))
			setSelectedItems([...kept, ...items.filter((item) => paths.has(item.path) && !keptPaths.has(item.path))])
		},
		handle: '[data-select-handle]',
	})

	// With a mouse, a box dragged across the items selects what it covers (see useMarquee)
	const selectable = selectableItems ?? items
	const selectablePaths = useMemo(() => new Set(selectable.map((item) => item.path)), [selectable])
	// What a drag with shift or ⌘ held adds to, in the order it was selected:
	// the item selected last is where a shift-click's range starts from
	const marqueeBase = useRef<FileSystemItem[]>([])
	const marquee = useMarquee({
		scrollerRef: scrollAreaRef,
		itemsInRect: (rect) => {
			const paths: string[] = []
			for (const index of indexesInRect(layout, rect)) {
				const path = items[index]?.path
				if (path !== undefined && selectablePaths.has(path)) paths.push(path)
			}
			return paths
		},
		selectionRef: selectedPathsRef,
		onSelect: (paths) => {
			const base = marqueeBase.current
			const basePaths = new Set(base.map((item) => item.path))
			setSelectedItems([...base, ...selectable.filter((item) => paths.has(item.path) && !basePaths.has(item.path))])
		},
		canStart: (event) => marqueePress(event.target as Element) !== null,
		// The scrolling starts where the fade and the dock do: under the dock is
		// as far down as the pointer can go
		edges: {top: LISTING_FADE_TOP_PX, bottom: bottomInset},
	})
	const onMarqueePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!marquee.handlers.onPointerDown(event)) return
		const additive = event.shiftKey || event.metaKey || event.ctrlKey
		marqueeBase.current = additive ? useFilesStore.getState().selectedItems : []
		if (marqueePress(event.target as Element) !== 'space') return
		// A press on empty space leaves a name being typed, and lets go of the selection
		if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
		if (!additive) setSelectedItems([])
	}

	const isItemsEmpty = items.length === 0

	// Reset the loader cache when items change significantly
	useEffect(() => {
		if (infiniteLoaderRef.current) {
			infiniteLoaderRef.current.resetloadMoreItemsCache(true)
		}
	}, [isItemsEmpty])

	// Add an extra slot when more items can be loaded - this acts as a trigger point
	// for InfiniteLoader, and shows that the next page is on its way (see MoreLoading)
	const itemCount = hasMore ? items.length + 1 : items.length

	// Callback for loading more items - passed to InfiniteLoader
	const loadMoreItems = useCallback(
		async (startIndex: number) => {
			// A request that brought nothing (it failed, or its answer was dropped)
			// is forgotten, or the loader would go on waiting for rows that aren't
			// coming and never ask again
			if (!(await onLoadMore(startIndex))) infiniteLoaderRef.current?.resetloadMoreItemsCache()
		},
		[onLoadMore],
	)

	// Check if an item at a given index is loaded - passed to InfiniteLoader
	const isItemLoaded = useCallback(
		(index: number) => {
			return !hasMore || index < items.length
		},
		[hasMore, items.length],
	)

	// What the rows and tiles are drawn from (see ListRow and GridCell). The
	// same object until something in it changes, so they are left alone until then.
	const listRowData = useMemo<ListRowData>(() => ({items, width, hasMore}), [items, width, hasMore])
	const gridCellData = useMemo<GridItemData>(
		() => ({items, columnCount, itemHeight, itemWidth, hasMore}),
		[items, columnCount, itemHeight, itemWidth, hasMore],
	)

	/**
	 * Converts grid-based indices to flat list indices for InfiniteLoader
	 * InfiniteLoader works with a flat list of items, but Grid uses row/column indices
	 */
	const gridToListIndices = useCallback(
		(gridIndices: GridVisibleIndices): IndexRange => {
			const {visibleRowStartIndex, visibleRowStopIndex, visibleColumnStartIndex, visibleColumnStopIndex} = gridIndices

			return {
				visibleStartIndex: visibleRowStartIndex * columnCount + visibleColumnStartIndex,
				visibleStopIndex: visibleRowStopIndex * columnCount + visibleColumnStopIndex,
				overscanStartIndex: Math.max(0, (visibleRowStartIndex - GRID_OVERSCAN_AMOUNT) * columnCount),
				overscanStopIndex: Math.min(itemCount - 1, (visibleRowStopIndex + GRID_OVERSCAN_AMOUNT + 1) * columnCount - 1),
			}
		},
		[columnCount, itemCount],
	)

	if (isLoading) return null

	// Don't render until the container has been measured
	const hasDimensions = width > 0 && height > 0

	// ======== LIST VIEW ========
	const listContent = view === 'list' && hasDimensions && (
		<InfiniteLoader
			ref={infiniteLoaderRef}
			isItemLoaded={isItemLoaded}
			itemCount={itemCount}
			loadMoreItems={loadMoreItems}
			threshold={INFINITE_LOADER_THRESHOLD}
		>
			{/* InfiniteLoader's render prop provides methods to attach to the List */}
			{({onItemsRendered, ref}: InfiniteLoaderRenderProps) => (
				<FixedSizeList
					ref={ref as React.Ref<FixedSizeList>}
					// A finger scrolls it up and down and the browser leaves a sideways
					// swipe alone, which in selection mode selects (see useSwipeSelect)
					className='umbrel-files-virtual-scroller touch-pan-y touch-pinch-zoom'
					height={height}
					width={width + scrollerPadding} // Push scrollbar into the margin beside the rows
					innerElementType={InnerElementWithEndSpacer}
					itemCount={itemCount}
					itemSize={rowHeight}
					itemData={listRowData}
					itemKey={listRowKey}
					onItemsRendered={onItemsRendered}
					outerRef={scrollAreaRef} // The scroller: the marquee, the keyboard and the touch selection all work on it
					overscanCount={LIST_OVERSCAN_AMOUNT}
				>
					{ListRow}
				</FixedSizeList>
			)}
		</InfiniteLoader>
	)

	// ======== GRID VIEW ========
	let gridContent: React.ReactNode = null
	if (view !== 'list' && hasDimensions) {
		// Calculate the exact number of rows needed
		const itemsRowCount = Math.ceil(items.length / columnCount)
		const rowCount = hasMore ? itemsRowCount + 1 : itemsRowCount

		gridContent = (
			<InfiniteLoader
				ref={infiniteLoaderRef}
				isItemLoaded={isItemLoaded}
				itemCount={itemCount}
				loadMoreItems={loadMoreItems}
				threshold={INFINITE_LOADER_THRESHOLD}
			>
				{/* InfiniteLoader's render prop provides methods to attach to the Grid */}
				{({onItemsRendered, ref}: InfiniteLoaderRenderProps) => (
					<FixedSizeGrid
						ref={ref as React.Ref<FixedSizeGrid>}
						className='umbrel-files-virtual-scroller touch-pan-y touch-pinch-zoom'
						height={height}
						width={width + scrollerPadding}
						innerElementType={InnerElementWithEndSpacer}
						rowCount={rowCount}
						columnCount={columnCount}
						rowHeight={itemHeight + GRID_GAP}
						// Narrower than the tiles are apart (they are placed by hand), so
						// the columns never add up to more than the grid and scroll sideways
						columnWidth={itemWidth}
						overscanRowCount={GRID_OVERSCAN_AMOUNT}
						itemData={gridCellData}
						itemKey={gridCellKey}
						outerRef={scrollAreaRef}
						onItemsRendered={(gridIndices: GridVisibleIndices) => {
							// Convert grid coordinates to flat list indices for InfiniteLoader
							onItemsRendered(gridToListIndices(gridIndices))
						}}
					>
						{GridCell}
					</FixedSizeGrid>
				)}
			</InfiniteLoader>
		)
	}

	// overflow-hidden, never overflow-auto: react-window's own outer element is the real
	// scroller (it carries scrollAreaRef), so this container never needs to scroll — and it
	// must not be able to. It measures itself with clientWidth/clientHeight, which shrink
	// wherever a browser's scrollbars take room, which resizes the list, which changes
	// whether it overflows: a feedback loop.
	return (
		<div
			ref={containerRef}
			className={cn(
				'umbrel-files-fade-scroller relative h-full w-full overflow-hidden',
				// The padding is the margin the scrollbar sits in. In Files it is taken
				// out of the sheet's own padding, so the rows keep the bar's width.
				isEmbedded ? 'embedded px-3 lg:px-6' : 'lg:-mr-4 lg:w-[calc(100%+1rem)] lg:pr-4',
				isScrolled && 'scrolled',
			)}
			{...marquee.handlers}
			onPointerDown={onMarqueePointerDown}
		>
			{/* The marquee's box, laid over the listing (useMarquee shows and sizes it).
			    Out here it is clear of the fade the rows wear. */}
			<div ref={marquee.boxRef} aria-hidden className={marqueeBoxClass} />
			{/* Containment wrapper: the FixedSizeList is rendered wider than the content area
			    to push its scrollbar into the margin. Without this wrapper, the oversized
			    list would be in normal flow and expand the container, creating a
			    measurement feedback loop. The absolute positioning takes it out of flow,
			    matching what AutoSizer's internal wrapper did. */}
			<div className='relative h-full w-full'>
				<div className='absolute inset-0 overflow-visible'>
					<FileItemProvider gridItemWidth={itemWidth}>
						{listContent}
						{gridContent}
					</FileItemProvider>
				</div>
			</div>
		</div>
	)
}
