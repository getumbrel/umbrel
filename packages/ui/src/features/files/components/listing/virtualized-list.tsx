import React, {useCallback, useEffect, useRef, useState} from 'react'
import {FixedSizeGrid, FixedSizeList, GridChildComponentProps, ListChildComponentProps} from 'react-window'
import InfiniteLoader from 'react-window-infinite-loader'

import {FileItem} from '@/features/files/components/listing/file-item'
import {FileItemProvider} from '@/features/files/components/listing/file-item/file-item-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {
	getGridColumnCount,
	getGridItemWidth,
	getGridScrollerPadding,
	GRID_ITEM_HEIGHT,
	GRID_ROW_GAP,
	LISTING_FADE_BOTTOM_PX,
	LISTING_FADE_TOP_PX,
} from '@/features/files/utils/get-grid-column-count'
import {getItemKey} from '@/features/files/utils/get-item-key'
import {useContainerSize} from '@/hooks/use-container-size'
import {useIsMobile} from '@/hooks/use-is-mobile'
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

// These overscan amounts control how many rows are rendered outside the visible react-window area (both above and below the area)
// so that items do not appear to render suddenly when scrolling
// We use a lower value for grid view to prevent performance issues during marquee selection. If there are 6 items (columns) in a row,
// then an overscan of 2 will render an extra 24 items (12 items above and 12 items below) which becomes expensive for marquee selection.
const LIST_OVERSCAN_AMOUNT = 20
const GRID_OVERSCAN_AMOUNT = 2

// Used to trigger fetching more items when only a certain number of items are left to render
const INFINITE_LOADER_THRESHOLD = 100

interface VirtualizedListProps {
	items: FileSystemItem[]
	hiddenRenamedPaths?: string[]
	hasMore: boolean
	isLoading: boolean
	onLoadMore: (startIndex: number) => Promise<boolean>
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
 * Data passed to grid cells for rendering items
 * Contains both the item array and layout dimensions
 */
interface GridItemData {
	items: FileSystemItem[]
	columnCount: number
	horizontalGap: number
	verticalGap: number
	itemHeight: number
	itemWidth: number
	borderAllowance: number
	totalWidth: number
}

// Trailing scroll room inside the virtualized content so the last row can be
// scrolled up past the bottom fade and read comfortably. Extends the scrollable
// height without shrinking the viewport (which must stay flush with the card edge).
const SCROLL_END_SPACER_PX = LISTING_FADE_BOTTOM_PX
const SCROLL_END_SPACER_UNDER_DOCK_PX = 96
const InnerElementWithEndSpacer = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
	function InnerElementWithEndSpacer({style, ...rest}, ref) {
		// On a phone on its side the card runs under the dock, so the end clears it
		const {low} = useHomeFit()
		const endSpacer = low ? SCROLL_END_SPACER_UNDER_DOCK_PX : SCROLL_END_SPACER_PX
		const height =
			typeof style?.height === 'number' ? style.height + endSpacer : `calc(${style?.height} + ${endSpacer}px)`
		return <div ref={ref} style={{...style, height}} {...rest} />
	},
)

export const VirtualizedList: React.FC<VirtualizedListProps> = ({
	items,
	hiddenRenamedPaths,
	hasMore,
	isLoading,
	onLoadMore,
	scrollAreaRef,
	view,
}) => {
	const infiniteLoaderRef = useRef<InfiniteLoader>(null)
	const isMobile = useIsMobile()
	const {containerRef, isScrolled} = useScrollFade()
	const {width, height} = useContainerSize(containerRef)
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
		const index = items.findIndex((item) => item.path === selectedPath)
		if (index === -1) {
			// The store can update before the listing supplies its rename result.
			if (isRenameSelection) return
			if (hasMore) onLoadMore(items.length)
			return
		}
		const scrollEl = scrollAreaRef.current
		if (!scrollEl) return
		// Row geometry mirrors the List/Grid props below. Scroll only when the
		// item sits outside the clearly-visible band, padded by the edge fades so
		// the selection never lands half-hidden under them.
		const rowHeight = view === 'list' ? (isMobile ? 50 : 40) : GRID_ITEM_HEIGHT + GRID_ROW_GAP
		const row = view === 'list' ? index : Math.floor(index / getGridColumnCount(width, getGridItemWidth(isMobile)))
		const itemTop = row * rowHeight
		const itemBottom = itemTop + rowHeight
		const {scrollTop, clientHeight} = scrollEl
		if (itemTop < scrollTop + LISTING_FADE_TOP_PX) {
			scrollEl.scrollTo({top: Math.max(0, itemTop - LISTING_FADE_TOP_PX)})
		} else if (itemBottom > scrollTop + clientHeight - LISTING_FADE_BOTTOM_PX) {
			scrollEl.scrollTo({top: itemBottom - clientHeight + LISTING_FADE_BOTTOM_PX})
		}
		handledSelectionRef.current = selectedPath
	}, [
		selectedPath,
		isRenameSelection,
		hiddenRenamedPaths,
		items,
		hasMore,
		onLoadMore,
		view,
		width,
		isMobile,
		scrollAreaRef,
	])

	const isItemsEmpty = items.length === 0

	// Reset the loader cache when items change significantly
	useEffect(() => {
		if (infiniteLoaderRef.current) {
			infiniteLoaderRef.current.resetloadMoreItemsCache(true)
		}
	}, [isItemsEmpty])

	// Add an extra slot when more items can be loaded - this acts as a trigger point
	// for InfiniteLoader but doesn't render anything visible (both rendering functions return null for this slot)
	const itemCount = hasMore ? items.length + 1 : items.length

	// Callback for loading more items - passed to InfiniteLoader
	const loadMoreItems = useCallback(
		async (startIndex: number) => {
			await onLoadMore(startIndex)
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

	// Render row for list view
	const renderListRow = useCallback(
		({index, style, data}: ListChildComponentProps<number>) => {
			// Skip rendering if we don't have the item yet (instead of showing a loader)
			if (!isItemLoaded(index) || index >= items.length) {
				return null
			}

			const item = items[index]
			// We apply background color directly based on item index instead of relying on CSS :nth-child because we are using infinite scrolling where the item count is dynamic
			const isEvenRow = index % 2 === 1

			return (
				<div
					style={{
						...style,
						// data contains the container width in pixels (passed via itemData prop)
						// Using fixed width prevents rows from shrinking when scrollbar appears
						width: data,
					}}
					key={getItemKey(item)}
					data-marquee-selection-item-path={item.path}
					className={`files-list-view-file-item relative rounded-lg ${isEvenRow ? 'bg-white/3' : ''}`}
				>
					<FileItem item={item} items={items} />
				</div>
			)
		},
		[items, isItemLoaded],
	)

	// Calculate grid dimensions based on container width
	// We cannot use simple flexbox css because we are using react-window for virtualization
	const getGridDimensions = useCallback(
		(width: number) => {
			const itemWidth = getGridItemWidth(isMobile) // Fixed item width (100px mobile / 112px desktop)
			const minGap = 8 // Prevents borders overlapping at certain screen sizes
			const borderAllowance = 2 // Extra space on each side for selection borders
			const fixedVerticalGap = GRID_ROW_GAP // Visual breathing room between rows (cells fully contain their item)

			// Adjust item width to include border allowance
			const containerWidth = itemWidth + borderAllowance * 2

			// Calculate how many columns can fit with minimum gap enforced
			const columnCount = getGridColumnCount(width, itemWidth)

			// Now calculate the actual horizontal gap that will be used
			// We'll ensure this is at least minGap
			let horizontalGap = minGap

			if (columnCount > 1) {
				// Calculate the total width available for gaps
				const totalItemsWidth = columnCount * containerWidth
				const availableSpaceForGaps = width - totalItemsWidth

				// Calculate gap size that would evenly distribute items
				const calculatedGap = availableSpaceForGaps / (columnCount - 1)

				// Use the calculated gap if it's larger than our minimum
				horizontalGap = Math.max(minGap, calculatedGap)
			}

			// Use a larger fixed vertical gap to prevent wrapped text from overlapping
			const verticalGap = fixedVerticalGap

			// Set item height and row height separately - row height includes the gap.
			// The item boxes fill the cell (h-full) so every box in a row is equal-height;
			// the cell must therefore fully contain a 2-line-filename item: 12px cell top
			// padding + 134px content (icon + two name lines + type/size label + paddings)
			const itemHeight = GRID_ITEM_HEIGHT
			const rowHeight = itemHeight + verticalGap // Row height includes vertical gap

			return {
				columnCount,
				columnWidth: containerWidth, // Column width includes border allowance
				itemWidth, // The actual item width without border allowance
				rowHeight,
				itemHeight,
				horizontalGap,
				verticalGap,
				totalWidth: width,
				borderAllowance,
			}
		},
		[isMobile],
	)

	// Render cell for grid view
	const renderGridCell = useCallback(
		({columnIndex, rowIndex, style, data}: GridChildComponentProps) => {
			const {items, columnCount, horizontalGap, verticalGap, itemHeight, itemWidth, borderAllowance, totalWidth} =
				data as GridItemData

			const index = rowIndex * columnCount + columnIndex

			// Skip rendering if index is out of bounds or item not loaded
			if (index >= itemCount || !isItemLoaded(index) || index >= items.length) return null

			const item = items[index]
			if (!item) return null

			// Calculate the container width (item width + border allowance)
			const containerWidth = itemWidth + borderAllowance * 2

			// Handle special case for single column to center it
			const leftPosition =
				columnCount === 1 ? (totalWidth - containerWidth) / 2 : columnIndex * (containerWidth + horizontalGap)

			// Calculate top position based on row index
			const topPosition = rowIndex * (itemHeight + verticalGap)

			// Apply proper margin and spacing for grid items
			const adjustedStyle = {
				...style,
				left: leftPosition,
				top: topPosition,
				width: containerWidth,
				height: itemHeight, // Use the full item height
			}

			return (
				<div
					style={adjustedStyle}
					key={getItemKey(item)}
					className='relative flex items-start justify-center overflow-visible pt-3'
					data-marquee-selection-item-path={item.path}
				>
					<div
						className='flex h-full w-full flex-col items-center justify-start'
						style={{padding: `${rowIndex === 0 ? borderAllowance : 0}px ${borderAllowance}px 0`}}
					>
						<FileItem item={item} items={items} />
					</div>
				</div>
			)
		},
		[itemCount, isItemLoaded],
	)

	/**
	 * Converts grid-based indices to flat list indices for InfiniteLoader
	 * InfiniteLoader works with a flat list of items, but Grid uses row/column indices
	 */
	const gridToListIndices = useCallback(
		(gridIndices: GridVisibleIndices): IndexRange => {
			const {visibleRowStartIndex, visibleRowStopIndex, visibleColumnStartIndex, visibleColumnStopIndex} = gridIndices
			const columnCount = getGridDimensions(window.innerWidth).columnCount

			return {
				visibleStartIndex: visibleRowStartIndex * columnCount + visibleColumnStartIndex,
				visibleStopIndex: visibleRowStopIndex * columnCount + visibleColumnStopIndex,
				overscanStartIndex: Math.max(0, (visibleRowStartIndex - GRID_OVERSCAN_AMOUNT) * columnCount),
				overscanStopIndex: Math.min(itemCount - 1, (visibleRowStopIndex + GRID_OVERSCAN_AMOUNT + 1) * columnCount - 1),
			}
		},
		[getGridDimensions, itemCount],
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
					className='umbrel-files-virtual-scroller'
					height={height}
					width={width + getGridScrollerPadding(isMobile)} // Push scrollbar into parent padding (px-3 mobile / px-6 desktop)
					innerElementType={InnerElementWithEndSpacer}
					itemCount={itemCount}
					itemSize={isMobile ? 50 : 40}
					itemData={width} // Pass the actual width for fixed row width
					onItemsRendered={onItemsRendered}
					outerRef={scrollAreaRef} // For marquee selection
					overscanCount={LIST_OVERSCAN_AMOUNT}
				>
					{renderListRow}
				</FixedSizeList>
			)}
		</InfiniteLoader>
	)

	// ======== GRID VIEW ========
	let gridContent: React.ReactNode = null
	if (view !== 'list' && hasDimensions) {
		const dimensions = getGridDimensions(width)
		const {columnCount, columnWidth, rowHeight} = dimensions
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
						className='umbrel-files-virtual-scroller'
						height={height}
						width={width + getGridScrollerPadding(isMobile)}
						innerElementType={InnerElementWithEndSpacer}
						rowCount={rowCount}
						columnCount={columnCount}
						rowHeight={rowHeight}
						columnWidth={columnWidth}
						overscanRowCount={GRID_OVERSCAN_AMOUNT}
						itemData={{...dimensions, items}} // Grid cells need both dimensions and items
						outerRef={scrollAreaRef} // For marquee selection
						onItemsRendered={(gridIndices: GridVisibleIndices) => {
							// Convert grid coordinates to flat list indices for InfiniteLoader
							onItemsRendered(gridToListIndices(gridIndices))
						}}
					>
						{renderGridCell}
					</FixedSizeGrid>
				)}
			</InfiniteLoader>
		)
	}

	// overflow-hidden, never overflow-auto: react-window's own outer element is the real
	// scroller (it carries scrollAreaRef), so this container never needs to scroll — and it
	// must not be able to. It measures itself with clientWidth/clientHeight, which shrink
	// when it shows scrollbars of its own, which resizes the list, which changes whether it
	// overflows: a feedback loop. Where scrollbars take layout space (Firefox on macOS with
	// "Show scroll bars: Always"; ours are 11px only because ::-webkit-scrollbar is styled,
	// which Firefox ignores) there is zero slack to absorb that — the list is sized flush to
	// the padding box on both axes — so the two scrollbars trigger each other and the
	// listing visibly shakes.
	return (
		<div
			ref={containerRef}
			className={`umbrel-files-fade-scroller h-full w-full overflow-hidden px-3 lg:px-6 ${isScrolled ? 'scrolled' : ''}`}
		>
			{/* Containment wrapper: the FixedSizeList is rendered wider than the content area
			    (width + 24) to push its scrollbar into parent padding. Without this wrapper,
			    the oversized list would be in normal flow and expand the container, creating
			    a measurement feedback loop. The absolute positioning takes it out of flow,
			    matching what AutoSizer's internal wrapper did. */}
			<div className='relative h-full w-full'>
				<div className='absolute inset-0 overflow-visible'>
					<FileItemProvider>
						{listContent}
						{gridContent}
					</FileItemProvider>
				</div>
			</div>
		</div>
	)
}
