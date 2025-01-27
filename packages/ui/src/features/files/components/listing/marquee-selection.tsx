import React, {CSSProperties, PointerEvent, useCallback, useEffect, useRef, useState} from 'react'
import {useDebounce} from 'react-use'

import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'

interface MarqueeSelectionProps {
	items: FileSystemItem[]
	scrollAreaRef: React.RefObject<HTMLDivElement>
	children: React.ReactNode
}

/**
 * Marquee selection component
 *
 *  - Displays a bounding box on click-drag.
 *  - Detects intersections of elements with data-marquee-selection-item-path.
 *  - Selects items when the marquee box intersects with them.
 *  - Scrolls `scrollAreaRef` (top/bottom) when dragging near edges.
 */
export const MarqueeSelection: React.FC<MarqueeSelectionProps> = ({items, scrollAreaRef, children}) => {
	const containerRef = useRef<HTMLDivElement | null>(null)

	// Track marquee start and current positions (in container-relative coords)
	const [isMarqueeSelecting, setIsMarqueeSelecting] = useState(false)
	const [startX, setStartX] = useState(0)
	const [startY, setStartY] = useState(0)
	const [currentX, setCurrentX] = useState(0)
	const [currentY, setCurrentY] = useState(0)
	const setSelectedItems = useFilesStore((s) => s.setSelectedItems)
	const selectedItems = useFilesStore((s) => s.selectedItems)

	// Track initial scroll position
	const initialScrollOffset = useRef<{x: number; y: number}>({x: 0, y: 0})

	// Track modifier keys for selection merging
	const [isModifierPressed, setIsModifierPressed] = useState(false)
	const initialSelection = useRef<FileSystemItem[]>([])

	// We will use a ref to store the requestAnimationFrame or interval ID
	// for scrolling so that it can be cleaned up when dragging stops.
	const scrollIntervalRef = useRef<number | null>(null)

	// ----------------------------------------
	// Helpers
	// ----------------------------------------

	/**
	 * Calculate the bounding box (left, top, width, height) of the marquee
	 * from start (startX, startY) and current pointer (currentX, currentY).
	 */
	const getMarqueeBox = useCallback(() => {
		const left = Math.min(startX, currentX)
		const top = Math.min(startY, currentY)
		const width = Math.abs(currentX - startX)
		const height = Math.abs(currentY - startY)

		return {left, top, width, height}
	}, [startX, startY, currentX, currentY])

	/**
	 * Checks if two DOMRects intersect.
	 */
	const rectsIntersect = (r1: DOMRect, r2: DOMRect) => {
		return !(r2.left > r1.right || r2.right < r1.left || r2.top > r1.bottom || r2.bottom < r1.top)
	}

	/**
	 * Perform live selection detection by intersecting
	 * the marquee box with each item that has the `data-marquee-selection-item-path`.
	 */
	const detectIntersections = useCallback(() => {
		if (!containerRef.current || !isMarqueeSelecting || !scrollAreaRef.current) return

		const {left, top, width, height} = getMarqueeBox()

		// Get absolute coords for the marquee in the viewport
		// by adding container's bounding rect and adjusting for scroll
		const containerRect = containerRef.current.getBoundingClientRect()
		const scrollDeltaX = scrollAreaRef.current.scrollLeft - initialScrollOffset.current.x
		const scrollDeltaY = scrollAreaRef.current.scrollTop - initialScrollOffset.current.y

		const marqueeRect: DOMRect = {
			x: containerRect.x + left - scrollDeltaX,
			y: containerRect.y + top - scrollDeltaY,
			width,
			height,
			top: containerRect.top + top - scrollDeltaY,
			left: containerRect.left + left - scrollDeltaX,
			right: containerRect.left + left - scrollDeltaX + width,
			bottom: containerRect.top + top - scrollDeltaY + height,
			toJSON: () => {}, // not used
		}

		const selectableElements = containerRef.current.querySelectorAll<HTMLElement>('[data-marquee-selection-item-path]')

		const matchedPaths: string[] = []
		selectableElements.forEach((el) => {
			const rect = el.getBoundingClientRect()
			if (rectsIntersect(rect, marqueeRect)) {
				const path = el.getAttribute('data-marquee-selection-item-path')
				if (path) {
					matchedPaths.push(path)
				}
			}
		})

		// Find matching item objects from `items`
		const matchedItems = items.filter((item) => matchedPaths.includes(item.path))

		// If modifier key is pressed, merge with initial selection
		if (isModifierPressed) {
			const finalSelection = [...initialSelection.current]
			const finalSelectionPaths = new Set(finalSelection.map((item) => item.path))

			// Add newly selected items that aren't in initial selection
			matchedItems.forEach((item) => {
				if (!finalSelectionPaths.has(item.path)) {
					finalSelection.push(item)
				}
			})

			setSelectedItems(finalSelection)
		} else {
			setSelectedItems(matchedItems.length > 0 ? matchedItems : [])
		}
	}, [getMarqueeBox, items, isMarqueeSelecting, setSelectedItems, isModifierPressed, scrollAreaRef])

	/**
	 * Scrolls the container up or down if the pointer is near top/bottom edges.
	 * Called on pointer move while dragging.
	 */
	const handleScrollOnDrag = useCallback(
		(clientY: number) => {
			if (!scrollAreaRef.current) return

			// Constants for how close to top/bottom we begin scrolling
			const EDGE_THRESHOLD = 40
			// The amount to scroll per "tick"
			const SCROLL_SPEED = 10

			const scrollRect = scrollAreaRef.current.getBoundingClientRect()

			// Clear any existing interval
			if (scrollIntervalRef.current !== null) {
				window.clearInterval(scrollIntervalRef.current)
				scrollIntervalRef.current = null
			}

			// If near the top edge
			if (clientY - scrollRect.top < EDGE_THRESHOLD) {
				scrollIntervalRef.current = window.setInterval(() => {
					scrollAreaRef.current?.scrollBy({top: -SCROLL_SPEED})
				}, 16) // ~60fps
				return
			}

			// If near the bottom edge
			if (scrollRect.bottom - clientY < EDGE_THRESHOLD) {
				scrollIntervalRef.current = window.setInterval(() => {
					scrollAreaRef.current?.scrollBy({top: SCROLL_SPEED})
				}, 16)
				return
			}
		},
		[scrollAreaRef],
	)

	// ----------------------------------------
	// Event Handlers
	// ----------------------------------------

	const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
		// Only handle primary button (left-click)
		if (e.button !== 0) return

		// If the click is on an interactive element, don't start marquee selection
		const target = e.target as HTMLElement
		if (target.closest('button, a, input, [role="button"], [role="link"], [role="menuitem"]')) {
			return
		}

		// Make this element capture pointer events
		target.setPointerCapture(e.pointerId)

		const containerRect = containerRef.current?.getBoundingClientRect()
		if (!containerRect) return

		// Store initial scroll position
		if (scrollAreaRef.current) {
			initialScrollOffset.current = {
				x: scrollAreaRef.current.scrollLeft,
				y: scrollAreaRef.current.scrollTop,
			}
		}

		// Check if modifier key is pressed
		const hasModifier = e.shiftKey || e.metaKey || e.ctrlKey
		setIsModifierPressed(hasModifier)

		// Store initial selection if using modifier
		if (hasModifier && selectedItems) {
			initialSelection.current = selectedItems
		} else {
			initialSelection.current = []
			setSelectedItems([])
		}

		// Convert to container-local coordinates
		const x = e.clientX - containerRect.left
		const y = e.clientY - containerRect.top

		setIsMarqueeSelecting(true)
		setStartX(x)
		setStartY(y)
		setCurrentX(x)
		setCurrentY(y)
	}

	const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
		if (!isMarqueeSelecting || !scrollAreaRef.current) return

		e.preventDefault()

		const containerRect = containerRef.current?.getBoundingClientRect()
		if (!containerRect) return

		// Calculate scroll delta since drag start
		const scrollDeltaX = scrollAreaRef.current.scrollLeft - initialScrollOffset.current.x
		const scrollDeltaY = scrollAreaRef.current.scrollTop - initialScrollOffset.current.y

		// Convert pointer coords to container coords and adjust for scroll
		const x = e.clientX - containerRect.left + scrollDeltaX
		const y = e.clientY - containerRect.top + scrollDeltaY

		setCurrentX(x)
		setCurrentY(y)

		// Auto-scroll if near container edges
		handleScrollOnDrag(e.clientY)
	}

	const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
		if (!isMarqueeSelecting) return

		e.preventDefault()
		// Release pointer capture
		;(e.target as HTMLElement).releasePointerCapture(e.pointerId)

		setIsMarqueeSelecting(false)

		// Clear any scroll intervals
		if (scrollIntervalRef.current !== null) {
			window.clearInterval(scrollIntervalRef.current)
			scrollIntervalRef.current = null
		}
	}

	// Setup the debounced detection of selected items
	useDebounce(
		() => {
			if (isMarqueeSelecting) {
				detectIntersections()
			}
		},
		5, // 5ms debounce
		[currentX, currentY, isMarqueeSelecting],
	)

	// ----------------------------------------
	// Cleanup any remaining intervals on unmount
	// ----------------------------------------
	useEffect(() => {
		return () => {
			if (scrollIntervalRef.current !== null) {
				window.clearInterval(scrollIntervalRef.current)
			}
		}
	}, [])

	// ----------------------------------------
	// Render
	// ----------------------------------------
	const {left, top, width, height} = getMarqueeBox()
	const marqueeStyle: CSSProperties = {
		display: isMarqueeSelecting ? 'block' : 'none',
		left,
		top,
		width,
		height,
	}

	return (
		<div
			ref={containerRef}
			className='relative h-full w-full'
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
		>
			{/* The Marquee Selection Box */}
			<div className='pointer-events-none absolute z-50 border border-slate-400 bg-slate-400/15' style={marqueeStyle} />

			{/* The wrapped content */}
			{children}
		</div>
	)
}
