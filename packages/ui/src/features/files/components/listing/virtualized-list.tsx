import React, {useCallback, useEffect, useRef, useState} from 'react'
import AutoSizer from 'react-virtualized-auto-sizer'
import {FixedSizeGrid, FixedSizeList, GridChildComponentProps, ListChildComponentProps} from 'react-window'
import InfiniteLoader from 'react-window-infinite-loader'

import {FileItem} from '@/features/files/components/listing/file-item'
import type {FileSystemItem} from '@/features/files/types'
import {getItemKey} from '@/features/files/utils/get-item-key'
import {useIsMobile} from '@/hooks/use-is-mobile'

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
	hasMore: boolean
	isLoading: boolean
	onLoadMore: (startIndex: number) => Promise<boolean>
	scrollAreaRef: React.RefObject<HTMLDivElement>
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

export const VirtualizedList: React.FC<VirtualizedListProps> = ({
	items,
	hasMore,
	isLoading,
	onLoadMore,
	scrollAreaRef,
	view,
}) => {
	const infiniteLoaderRef = useRef<InfiniteLoader>(null)
	const isMobile = useIsMobile()
	const {containerRef, isScrolled} = useScrollFade()

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
	const getGridDimensions = useCallback((width: number) => {
		const itemWidth = 112 // Fixed item width of 112px
		const minGap = 8 // Prevents borders overlapping at certain screen sizes
		const borderAllowance = 2 // Extra space on each side for selection borders
		const fixedVerticalGap = 24 // Prevents multi-line file name items from overlapping

		// Adjust item width to include border allowance
		const containerWidth = itemWidth + borderAllowance * 2

		// Calculate how many columns can fit with minimum gap enforced
		// First calculate max possible columns
		const columnCount = Math.max(1, Math.floor((width + minGap) / (containerWidth + minGap)))

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

		// Set item height and row height separately - row height includes the gap
		const itemHeight = 120 // Height of each item itself
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
	}, [])

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

	return (
		<div
			ref={containerRef}
			className={`umbrel-files-fade-scroller h-full w-full overflow-auto p-6 pt-0 ${isScrolled ? 'scrolled' : ''}`}
		>
			<AutoSizer>
				{({height, width}: {height: number; width: number}) => {
					// ======== LIST VIEW ========
					if (view === 'list') {
						return (
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
										height={height}
										width={width + 24} // Add 24px to push scrollbar into parent padding
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
					}
					// ======== GRID VIEW ========
					else {
						const dimensions = getGridDimensions(width)
						const {columnCount, columnWidth, rowHeight} = dimensions

						// Calculate the exact number of rows needed
						const itemsRowCount = Math.ceil(items.length / columnCount)
						const rowCount = hasMore ? itemsRowCount + 1 : itemsRowCount

						return (
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
										height={height}
										width={width + 24}
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
				}}
			</AutoSizer>
		</div>
	)
}
