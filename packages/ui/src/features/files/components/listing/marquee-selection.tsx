import React, {CSSProperties, PointerEvent, useCallback, useEffect, useRef, useState} from 'react'

import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'

// DOMVector class inspired by https://www.joshuawootonn.com/react-drag-to-select
class DOMVector {
	constructor(
		readonly x: number,
		readonly y: number,
		readonly magnitudeX: number,
		readonly magnitudeY: number,
	) {}

	getDiagonalLength(): number {
		return Math.sqrt(Math.pow(this.magnitudeX, 2) + Math.pow(this.magnitudeY, 2))
	}

	toDOMRect(): DOMRect {
		return new DOMRect(
			Math.min(this.x, this.x + this.magnitudeX),
			Math.min(this.y, this.y + this.magnitudeY),
			Math.abs(this.magnitudeX),
			Math.abs(this.magnitudeY),
		)
	}

	toTerminalPoint(): DOMPoint {
		return new DOMPoint(this.x + this.magnitudeX, this.y + this.magnitudeY)
	}

	add(vector: DOMVector): DOMVector {
		return new DOMVector(
			this.x + vector.x,
			this.y + vector.y,
			this.magnitudeX + vector.magnitudeX,
			this.magnitudeY + vector.magnitudeY,
		)
	}

	clamp(rect: DOMRect): DOMVector {
		return new DOMVector(
			this.x,
			this.y,
			Math.min(rect.width - this.x, this.magnitudeX),
			Math.min(rect.height - this.y, this.magnitudeY),
		)
	}
}

function rectsIntersect(rect1: DOMRect, rect2: DOMRect): boolean {
	if (rect1.right < rect2.left || rect2.right < rect1.left) return false
	if (rect1.bottom < rect2.top || rect2.bottom < rect1.top) return false
	return true
}

interface MarqueeSelectionProps {
	items: FileSystemItem[]
	scrollAreaRef: React.RefObject<HTMLDivElement>
	children: React.ReactNode
	// Optional scale factor to compensate when the listing is rendered inside a CSS transform (e.g. Rewind embeds scale the Files UI).
	scale?: number
}

/**
 * Marquee selection component
 *
 *  - Displays a bounding box on click-drag.
 *  - Detects intersections of elements with data-marquee-selection-item-path.
 *  - Selects items when the marquee box intersects with them.
 *  - Scrolls `scrollAreaRef` (top/bottom) when dragging near edges.
 *  - Maintains selection for items that scroll out of view during a drag operation.
 */
export const MarqueeSelection: React.FC<MarqueeSelectionProps> = ({
	items,
	scrollAreaRef,
	children,
	scale: scaleProp = 1,
}) => {
	// Treat zero/undefined as "no scale" while still supporting explicitly passing 1.
	const effectiveScale = scaleProp || 1
	const containerRef = useRef<HTMLDivElement | null>(null)

	const [isMarqueeSelecting, setIsMarqueeSelecting] = useState(false)
	const [startX, setStartX] = useState(0)
	const [startY, setStartY] = useState(0)
	const [, forceRender] = useState(0)

	// Track if we're auto-scrolling
	const isAutoScrolling = useRef(false)

	const setSelectedItems = useFilesStore((s) => s.setSelectedItems)
	const selectedItems = useFilesStore((s) => s.selectedItems)

	// Track initial scroll position
	const initialScrollOffset = useRef<{x: number; y: number}>({x: 0, y: 0})
	// Track current scroll offset for visual positioning
	const currentScrollOffset = useRef<{x: number; y: number}>({x: 0, y: 0})

	// Track modifier keys for selection merging
	const [isModifierPressed, setIsModifierPressed] = useState(false)
	const initialSelection = useRef<FileSystemItem[]>([])

	// For tracking items during marquee selection - this helps with virtualized lists
	// where items may scroll out of view but we want to keep them selected
	const selectedPaths = useRef<Set<string>>(new Set())
	const unselectedPaths = useRef<Set<string>>(new Set())

	// We will use a ref to store the requestAnimationFrame ID
	// for scrolling so that it can be cleaned up when dragging stops.
	const animationFrameIdRef = useRef<number | null>(null)

	// Add refs to track drag and scroll vectors
	const dragVectorRef = useRef<DOMVector | null>(null)
	const scrollVectorRef = useRef<DOMVector | null>(null)

	// Add refs to track scroll speeds
	const scrollSpeedsRef = useRef<{x: number; y: number}>({x: 0, y: 0})

	// ----------------------------------------
	// Helpers
	// ----------------------------------------

	/**
	 * Calculate the visual position of the marquee box when scrolling occurs
	 * This function handles the visual representation that's shown to the user
	 * and ensures it stays within the viewport.
	 * Using the DOMVector approach for more robust rectangle handling.
	 */
	const getVisualMarqueeBox = useCallback(() => {
		if (!dragVectorRef.current || !scrollVectorRef.current) {
			return {left: 0, top: 0, width: 0, height: 0}
		}

		// For the visual display, we need to show the selection rectangle in the viewport
		// So we need to apply vector addition and then subtract the current scroll position

		// Get the selection rectangle in content-relative coordinates.
		const selectionRect = dragVectorRef.current.add(scrollVectorRef.current).toDOMRect()

		// Now convert to viewport coordinates by subtracting current scroll position
		let visualLeft = selectionRect.x - currentScrollOffset.current.x
		let visualTop = selectionRect.y - currentScrollOffset.current.y
		let visualWidth = selectionRect.width
		let visualHeight = selectionRect.height

		// Get the scroll container bounds to constrain the visual marquee
		if (scrollAreaRef.current && containerRef.current) {
			const scrollRect = scrollAreaRef.current.getBoundingClientRect()
			const containerRect = containerRef.current.getBoundingClientRect()

			// Calculate bounds in container-relative coordinates. Because the content itself may be scaled by
			// a CSS transform, we divide by `effectiveScale` to translate from physical pixels back into the
			// logical coordinate space we operate in.
			const containerLeft = (scrollRect.left - containerRect.left) / effectiveScale
			const containerRight = (scrollRect.right - containerRect.left) / effectiveScale
			const containerTop = (scrollRect.top - containerRect.top) / effectiveScale
			const containerBottom = (scrollRect.bottom - containerRect.top) / effectiveScale

			// Constrain the visual marquee to the scroll container's visible area
			// Ensure left doesn't go outside the visible area
			if (visualLeft < containerLeft) {
				// Adjust width to account for clipping at the left
				visualWidth = visualWidth - (containerLeft - visualLeft)
				visualLeft = containerLeft
			}

			// Ensure right doesn't go outside the visible area
			const visualRight = visualLeft + visualWidth
			if (visualRight > containerRight) {
				visualWidth = containerRight - visualLeft
			}

			// Ensure top doesn't go above the viewport
			if (visualTop < containerTop) {
				// Adjust height to account for clipping at the top
				visualHeight = visualHeight - (containerTop - visualTop)
				visualTop = containerTop
			}

			// Ensure bottom doesn't go below the viewport
			const visualBottom = visualTop + visualHeight
			if (visualBottom > containerBottom) {
				visualHeight = containerBottom - visualTop
			}

			// Don't allow negative dimensions (can happen during fast scrolling)
			visualWidth = Math.max(0, visualWidth)
			visualHeight = Math.max(0, visualHeight)
		}

		return {
			left: visualLeft,
			top: visualTop,
			width: visualWidth,
			height: visualHeight,
		}
	}, [scrollAreaRef, containerRef, dragVectorRef, scrollVectorRef, currentScrollOffset, effectiveScale])

	/**
	 * Perform live selection detection by intersecting
	 * the marquee box with each item that has the `data-marquee-selection-item-path`.
	 * Maintains selection state for virtualized items that may scroll out of view.
	 * Uses the DOMVector approach for better rectangle handling.
	 */
	const detectIntersections = useCallback(() => {
		if (!containerRef.current || !isMarqueeSelecting || !scrollAreaRef.current) return
		if (!dragVectorRef.current || !scrollVectorRef.current) return

		// Get latest scroll position for accurate calculations
		if (scrollAreaRef.current) {
			currentScrollOffset.current = {
				x: scrollAreaRef.current.scrollLeft,
				y: scrollAreaRef.current.scrollTop,
			}

			// Update scroll vector with latest scroll position
			scrollVectorRef.current = new DOMVector(
				initialScrollOffset.current.x,
				initialScrollOffset.current.y,
				currentScrollOffset.current.x - initialScrollOffset.current.x,
				currentScrollOffset.current.y - initialScrollOffset.current.y,
			)
		}

		// Get the container's bounding rectangle for coordinate conversion
		const containerRect = containerRef.current.getBoundingClientRect()

		// Get the combined selection rectangle (drag + scroll)
		// This gives us content-relative coordinates
		const combinedRect = dragVectorRef.current.add(scrollVectorRef.current).toDOMRect()

		// Select items that intersect with the combined rectangle
		const selectableElements = containerRef.current.querySelectorAll<HTMLElement>('[data-marquee-selection-item-path]')

		// Get currently visible items
		const visiblePaths: Set<string> = new Set()
		const currentlyIntersectedPaths: Set<string> = new Set()

		// First determine which items are currently visible and which intersect with the marquee
		selectableElements.forEach((el) => {
			const path = el.getAttribute('data-marquee-selection-item-path')
			if (!path) return

			visiblePaths.add(path)

			const itemRect = el.getBoundingClientRect()

			// Convert to content-relative coordinates (like in the working example). Similar to the visual
			// calculations above we divide by `effectiveScale` so that hit-testing happens in the unscaled space.
			const translatedItemRect = new DOMRect(
				(itemRect.x - containerRect.x) / effectiveScale + scrollAreaRef.current!.scrollLeft,
				(itemRect.y - containerRect.y) / effectiveScale + scrollAreaRef.current!.scrollTop,
				itemRect.width / effectiveScale,
				itemRect.height / effectiveScale,
			)

			if (rectsIntersect(combinedRect, translatedItemRect)) {
				currentlyIntersectedPaths.add(path)
			}
		})

		// Update our tracking sets
		// For each currently intersected item:
		currentlyIntersectedPaths.forEach((path) => {
			// Add to selected set
			selectedPaths.current.add(path)
			// Remove from unselected set (in case it was previously unselected)
			unselectedPaths.current.delete(path)
		})

		// For each visible item that's NOT intersected:
		visiblePaths.forEach((path) => {
			if (!currentlyIntersectedPaths.has(path)) {
				// Add to unselected set
				unselectedPaths.current.add(path)
				// Remove from selected set
				selectedPaths.current.delete(path)
			}
		})

		// Now determine the final selection by filtering the items array
		const finalSelection = items.filter((item) => {
			// If the path is in our selected set and not in our unselected set, include it
			return selectedPaths.current.has(item.path) && !unselectedPaths.current.has(item.path)
		})

		// If modifier key is pressed, merge with initial selection
		if (isModifierPressed) {
			const mergedSelection = [...initialSelection.current]
			const mergedSelectionPaths = new Set(mergedSelection.map((item) => item.path))

			// Add newly selected items that aren't in initial selection
			finalSelection.forEach((item) => {
				if (!mergedSelectionPaths.has(item.path)) {
					mergedSelection.push(item)
				}
			})

			setSelectedItems(mergedSelection)
		} else {
			setSelectedItems(finalSelection.length > 0 ? finalSelection : [])
		}
	}, [items, isMarqueeSelecting, setSelectedItems, isModifierPressed, scrollAreaRef, effectiveScale])

	/**
	 * Scrolls the container if the pointer is near edges.
	 * Called on pointer move while dragging.
	 * Supports both vertical and horizontal scrolling using requestAnimationFrame for smooth animation.
	 */
	const handleScrollOnDrag = useCallback(
		(clientX: number, clientY: number) => {
			if (!scrollAreaRef.current || !dragVectorRef.current) return

			// Constants for scroll behavior
			const SCROLL_THRESHOLD = 20 // Distance from edge to trigger scrolling
			const MIN_SCROLL_SPEED = 5 // Minimum scroll speed
			const MAX_SCROLL_SPEED = 40 // Maximum scroll speed
			const ACCELERATION_FACTOR = 0.3 // Acceleration factor

			const scrollRect = scrollAreaRef.current.getBoundingClientRect()

			// Calculate how far outside the boundaries the cursor is
			const distanceOutsideTop = Math.max(0, scrollRect.top - clientY)
			const distanceOutsideBottom = Math.max(0, clientY - scrollRect.bottom)
			const distanceOutsideLeft = Math.max(0, scrollRect.left - clientX)
			const distanceOutsideRight = Math.max(0, clientX - scrollRect.right)

			// Calculate scroll speeds for all directions
			let scrollSpeedY = 0
			let scrollSpeedX = 0
			let shouldScroll = false

			// Vertical scrolling (top/bottom)
			// If cursor is near or above the top edge
			if (distanceOutsideTop > 0 || clientY - scrollRect.top < SCROLL_THRESHOLD) {
				shouldScroll = true
				isAutoScrolling.current = true

				// Calculate speed based on distance
				if (distanceOutsideTop > 0) {
					// If outside, use distance for acceleration
					scrollSpeedY = -Math.min(MAX_SCROLL_SPEED, MIN_SCROLL_SPEED + distanceOutsideTop * ACCELERATION_FACTOR)
				} else {
					// If inside but near edge, use fixed speed
					const proximity = SCROLL_THRESHOLD - (clientY - scrollRect.top)
					scrollSpeedY = -MIN_SCROLL_SPEED - (proximity / SCROLL_THRESHOLD) * (MAX_SCROLL_SPEED - MIN_SCROLL_SPEED)
				}
			}
			// If cursor is near or below the bottom edge
			else if (distanceOutsideBottom > 0 || scrollRect.bottom - clientY < SCROLL_THRESHOLD) {
				shouldScroll = true
				isAutoScrolling.current = true

				// Calculate speed based on distance
				if (distanceOutsideBottom > 0) {
					// If outside, use distance for acceleration
					scrollSpeedY = Math.min(MAX_SCROLL_SPEED, MIN_SCROLL_SPEED + distanceOutsideBottom * ACCELERATION_FACTOR)
				} else {
					// If inside but near edge, use fixed speed
					const proximity = SCROLL_THRESHOLD - (scrollRect.bottom - clientY)
					scrollSpeedY = MIN_SCROLL_SPEED + (proximity / SCROLL_THRESHOLD) * (MAX_SCROLL_SPEED - MIN_SCROLL_SPEED)
				}
			}

			// Horizontal scrolling (left/right)
			// If cursor is near or left of the left edge
			if (distanceOutsideLeft > 0 || clientX - scrollRect.left < SCROLL_THRESHOLD) {
				shouldScroll = true
				isAutoScrolling.current = true

				// Calculate speed based on distance
				if (distanceOutsideLeft > 0) {
					// If outside, use distance for acceleration
					scrollSpeedX = -Math.min(MAX_SCROLL_SPEED, MIN_SCROLL_SPEED + distanceOutsideLeft * ACCELERATION_FACTOR)
				} else {
					// If inside but near edge, use fixed speed
					const proximity = SCROLL_THRESHOLD - (clientX - scrollRect.left)
					scrollSpeedX = -MIN_SCROLL_SPEED - (proximity / SCROLL_THRESHOLD) * (MAX_SCROLL_SPEED - MIN_SCROLL_SPEED)
				}
			}
			// If cursor is near or right of the right edge
			else if (distanceOutsideRight > 0 || scrollRect.right - clientX < SCROLL_THRESHOLD) {
				shouldScroll = true
				isAutoScrolling.current = true

				// Calculate speed based on distance
				if (distanceOutsideRight > 0) {
					// If outside, use distance for acceleration
					scrollSpeedX = Math.min(MAX_SCROLL_SPEED, MIN_SCROLL_SPEED + distanceOutsideRight * ACCELERATION_FACTOR)
				} else {
					// If inside but near edge, use fixed speed
					const proximity = SCROLL_THRESHOLD - (scrollRect.right - clientX)
					scrollSpeedX = MIN_SCROLL_SPEED + (proximity / SCROLL_THRESHOLD) * (MAX_SCROLL_SPEED - MIN_SCROLL_SPEED)
				}
			}

			// Update the scroll speeds ref so the animation frame can use latest values
			scrollSpeedsRef.current = {x: scrollSpeedX, y: scrollSpeedY}

			// Start or stop the animation based on whether we should be scrolling
			if (shouldScroll) {
				// Only set up the animation if it's not already running
				if (animationFrameIdRef.current === null) {
					const scrollAndAnimate = () => {
						if (scrollAreaRef.current) {
							// Use the ref values for smooth scrolling
							scrollAreaRef.current.scrollBy({
								top: scrollSpeedsRef.current.y,
								left: scrollSpeedsRef.current.x,
							})

							// Update current scroll position
							currentScrollOffset.current = {
								x: scrollAreaRef.current.scrollLeft,
								y: scrollAreaRef.current.scrollTop,
							}

							// Update scroll vector with new scroll position
							if (scrollVectorRef.current) {
								scrollVectorRef.current = new DOMVector(
									initialScrollOffset.current.x,
									initialScrollOffset.current.y,
									currentScrollOffset.current.x - initialScrollOffset.current.x,
									currentScrollOffset.current.y - initialScrollOffset.current.y,
								)
							}

							// Force detection of intersections every time we auto-scroll
							// This is critical for upward scrolling to work properly
							detectIntersections()

							// Continue the animation loop only if still selecting and should scroll
							if (isMarqueeSelecting && shouldScroll) {
								animationFrameIdRef.current = requestAnimationFrame(scrollAndAnimate)
							} else {
								animationFrameIdRef.current = null
								isAutoScrolling.current = false
							}
						} else {
							animationFrameIdRef.current = null
						}
					}

					// Start the animation loop
					animationFrameIdRef.current = requestAnimationFrame(scrollAndAnimate)
				}
			} else {
				// Only cancel the animation if we're not scrolling anymore
				if (animationFrameIdRef.current !== null) {
					cancelAnimationFrame(animationFrameIdRef.current)
					animationFrameIdRef.current = null
					isAutoScrolling.current = false
				}
			}
		},
		[scrollAreaRef, detectIntersections, isMarqueeSelecting],
	)

	// ----------------------------------------
	// Animation and Selection Effects
	// ----------------------------------------

	// Set up animation frame for selection updates when dragging but not auto-scrolling
	useEffect(() => {
		if (!isMarqueeSelecting) return

		// If we're already auto-scrolling with animation frame, we don't need another one
		// because detectIntersections is called in the scroll animation loop
		if (isAutoScrolling.current) return

		// Recursive function to update selection using rAF
		const updateSelection = () => {
			// Run detection
			detectIntersections()

			// Schedule next frame only if still selecting and not auto-scrolling
			if (isMarqueeSelecting && !isAutoScrolling.current) {
				selectionAnimationRef.current = requestAnimationFrame(updateSelection)
			}
		}

		// Start the animation loop for selection updates
		const selectionAnimationRef = {current: requestAnimationFrame(updateSelection)}

		// Clean up on unmount or when isMarqueeSelecting changes
		return () => {
			cancelAnimationFrame(selectionAnimationRef.current)
		}
	}, [isMarqueeSelecting, detectIntersections, isAutoScrolling])

	// Update current scroll position when scrolling happens outside of pointer events
	useEffect(() => {
		if (!isMarqueeSelecting || !scrollAreaRef.current) return

		const scrollElement = scrollAreaRef.current
		const handleScroll = () => {
			if (scrollElement) {
				// Update current scroll offset when scroll events happen
				currentScrollOffset.current = {
					x: scrollElement.scrollLeft,
					y: scrollElement.scrollTop,
				}

				// Update scroll vector with latest scroll position
				if (scrollVectorRef.current) {
					scrollVectorRef.current = new DOMVector(
						initialScrollOffset.current.x,
						initialScrollOffset.current.y,
						currentScrollOffset.current.x - initialScrollOffset.current.x,
						currentScrollOffset.current.y - initialScrollOffset.current.y,
					)
				}
			}
		}

		// Add scroll event listener to capture all scrolling
		scrollElement.addEventListener('scroll', handleScroll)

		return () => {
			scrollElement.removeEventListener('scroll', handleScroll)
		}
	}, [isMarqueeSelecting, scrollAreaRef])

	// Cleanup any remaining animation frames on unmount
	useEffect(() => {
		return () => {
			if (animationFrameIdRef.current !== null) {
				cancelAnimationFrame(animationFrameIdRef.current)
			}
		}
	}, [])

	// ----------------------------------------
	// Event Handlers
	// ----------------------------------------

	const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
		// Only handle primary button (left-click)
		if (e.button !== 0) return

		// If the click is on an interactive element, don't start marquee selection
		// [vaul-overlay] is the modal overlay for the shadcn Drawer component that we use for the editable name modal (gets clicked when blurring the Drawer)
		const target = e.target as HTMLElement
		if (target.closest('button, a, input, [role="button"], [role="link"], [role="menuitem"], [vaul-overlay]')) {
			return
		}

		// If there's an active input (eg. new folder name input), blur it
		const activeElement = document.activeElement as HTMLElement | null
		if (activeElement && activeElement.tagName === 'INPUT') {
			activeElement.blur()
		}

		// We do not allow selection in scrollbar areas
		if (scrollAreaRef.current) {
			// check if the element has a vertical scrollbar
			const hasVerticalScrollbar = scrollAreaRef.current.scrollHeight > scrollAreaRef.current.clientHeight
			if (hasVerticalScrollbar) {
				const rect = scrollAreaRef.current.getBoundingClientRect()
				// 11px is the width of the scrollbar (see main index.css)
				if (e.clientX > rect.right - 11 && e.clientX <= rect.right) {
					return
				}
			}
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
			// Initialize current scroll position to initial
			currentScrollOffset.current = {
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

		// Reset our tracking sets
		selectedPaths.current = new Set()
		unselectedPaths.current = new Set()

		// Reset auto-scrolling flag
		isAutoScrolling.current = false

		// Convert to container-local coordinates. We divide by `effectiveScale` to undo any transforms
		// applied to the rendered content so pointer math stays aligned.
		const x = (e.clientX - containerRect.left) / effectiveScale
		const y = (e.clientY - containerRect.top) / effectiveScale

		// Initialize drag vector with position and zero magnitude
		dragVectorRef.current = new DOMVector(x, y, 0, 0)

		// Initialize scroll vector with scroll position and zero magnitude
		scrollVectorRef.current = new DOMVector(
			scrollAreaRef.current?.scrollLeft || 0,
			scrollAreaRef.current?.scrollTop || 0,
			0,
			0,
		)

		setIsMarqueeSelecting(true)
		setStartX(x)
		setStartY(y)
		forceRender((tick) => tick + 1)
	}

	const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
		if (!isMarqueeSelecting || !scrollAreaRef.current) return

		e.preventDefault()

		const containerRect = containerRef.current?.getBoundingClientRect()
		if (!containerRect) return

		// Update current scroll position
		currentScrollOffset.current = {
			x: scrollAreaRef.current.scrollLeft,
			y: scrollAreaRef.current.scrollTop,
		}

		// Calculate vectors using the approach from the working example
		// This is critical for upward scrolling to work properly

		// Create drag vector (from start point to current mouse position)
		const pointerX = (e.clientX - containerRect.left) / effectiveScale
		const pointerY = (e.clientY - containerRect.top) / effectiveScale

		dragVectorRef.current = new DOMVector(startX, startY, pointerX - startX, pointerY - startY)

		// Create scroll vector (from initial scroll position)
		scrollVectorRef.current = new DOMVector(
			initialScrollOffset.current.x,
			initialScrollOffset.current.y,
			currentScrollOffset.current.x - initialScrollOffset.current.x,
			currentScrollOffset.current.y - initialScrollOffset.current.y,
		)

		// Update current pointer position to trigger re-render
		forceRender((tick) => tick + 1)

		if (!isAutoScrolling.current) {
			detectIntersections()
		}

		// Auto-scroll if near container edges
		handleScrollOnDrag(e.clientX, e.clientY)
	}

	const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
		if (!isMarqueeSelecting) return

		e.preventDefault()
		// Release pointer capture
		;(e.target as HTMLElement).releasePointerCapture(e.pointerId)

		setIsMarqueeSelecting(false)

		// Clear our tracking sets when we're done
		selectedPaths.current = new Set()
		unselectedPaths.current = new Set()

		// Reset auto-scrolling flag
		isAutoScrolling.current = false

		// Reset vector references
		dragVectorRef.current = null
		scrollVectorRef.current = null

		// Reset scroll speeds
		scrollSpeedsRef.current = {x: 0, y: 0}

		// Clear any scroll intervals
		if (animationFrameIdRef.current !== null) {
			cancelAnimationFrame(animationFrameIdRef.current)
			animationFrameIdRef.current = null
		}
	}

	// ----------------------------------------
	// Render
	// ----------------------------------------
	const visualMarqueeBox = getVisualMarqueeBox()
	const marqueeStyle: CSSProperties = {
		display: isMarqueeSelecting ? 'block' : 'none',
		left: visualMarqueeBox.left,
		top: visualMarqueeBox.top,
		width: visualMarqueeBox.width,
		height: visualMarqueeBox.height,
	}

	return (
		<div
			ref={containerRef}
			className='relative size-full'
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
		>
			{/* The Marquee Selection Box */}
			<div
				className='pointer-events-none absolute z-50 overflow-hidden border border-slate-400 bg-slate-400/15'
				style={marqueeStyle}
			/>

			{/* The wrapped content */}
			{children}
		</div>
	)
}
