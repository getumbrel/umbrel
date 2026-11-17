// @vitest-environment jsdom

import {act, useRef, type RefObject} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {useSwipeSelect} from './use-swipe-select'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

// Ten rows 60px tall in a scroller 300 by 400 at (0, 100): four of them
// show under a 20px fade, above a 100px dock, and the rest scroll
const ROW = 60
const COUNT = 10
const BOUNDS = {left: 0, top: 100, width: 300, height: 400}
const EDGES = {top: 20, bottom: 100}
const ids = Array.from({length: COUNT}, (_, index) => `row-${index}`)

type Options = {enabled?: boolean; selection?: string[]; handle?: boolean; version?: number}

let root: Root
let host: HTMLDivElement
let onSelect: ReturnType<typeof vi.fn<(ids: ReadonlySet<string>) => void>>
let onRowClick: ReturnType<typeof vi.fn<() => void>>
let selectionRef: RefObject<ReadonlySet<string>>
let captured: number | null
let frames: Array<() => void>

function Harness({enabled = true, handle = false, version = 0}: Options) {
	const scrollerRef = useRef<HTMLDivElement>(null)
	useSwipeSelect({
		scrollerRef,
		scrollerKey: version,
		itemAt: (_x, y) => ids[Math.floor(y / ROW)],
		between: (from, to) => {
			const start = ids.indexOf(from)
			const stop = ids.indexOf(to)
			if (start === -1 || stop === -1) return null
			return ids.slice(Math.min(start, stop), Math.max(start, stop) + 1)
		},
		selectionRef,
		enabled,
		edges: EDGES,
		onSelect,
		handle: handle ? '[data-handle]' : undefined,
	})
	return (
		// A new element per version, as a virtualised list swaps its own
		<div ref={scrollerRef} key={version} data-testid='scroller'>
			<button data-testid='row' onClick={onRowClick}>
				<span data-handle='' data-testid='handle' />
				row
			</button>
		</div>
	)
}

const $ = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`)!

function render(options: Options = {}) {
	if (options.selection) selectionRef.current = new Set(options.selection)
	act(() => root.render(<Harness {...options} />))
	const scroller = $('scroller')
	scroller.getBoundingClientRect = () => new DOMRect(BOUNDS.left, BOUNDS.top, BOUNDS.width, BOUNDS.height) as DOMRect
	Object.defineProperties(scroller, {
		clientWidth: {value: BOUNDS.width, configurable: true},
		clientHeight: {value: BOUNDS.height, configurable: true},
	})
	return scroller
}

function pointer(type: string, target: Element, x: number, y: number, pointerType = 'touch') {
	const event = new MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y})
	Object.defineProperties(event, {pointerId: {value: 7}, pointerType: {value: pointerType}})
	target.dispatchEvent(event)
	return event
}
// The y of the middle of a row, on screen, with nothing scrolled
const rowY = (index: number) => BOUNDS.top + index * ROW + ROW / 2
const down = (target: Element, x: number, y: number, pointerType?: string) =>
	pointer('pointerdown', target, x, y, pointerType)
const move = (target: Element, x: number, y: number) => pointer('pointermove', target, x, y)
const up = (target: Element, x: number, y: number) => pointer('pointerup', target, x, y)
const touchMove = (target: Element) => {
	const event = new Event('touchmove', {bubbles: true, cancelable: true})
	target.dispatchEvent(event)
	return event
}
const click = (target: Element) => act(() => target.dispatchEvent(new MouseEvent('click', {bubbles: true})))
const lastSelection = () => [...(onSelect.mock.calls.at(-1)?.[0] ?? [])].sort()
const runFrame = () => frames.splice(0).forEach((frame) => frame())

beforeEach(() => {
	host = document.createElement('div')
	document.body.append(host)
	root = createRoot(host)
	onSelect = vi.fn()
	onRowClick = vi.fn()
	selectionRef = {current: new Set()}
	captured = null
	frames = []
	HTMLElement.prototype.setPointerCapture = function (id: number) {
		captured = id
	}
	HTMLElement.prototype.releasePointerCapture = function () {
		captured = null
	}
	HTMLElement.prototype.hasPointerCapture = (id: number) => captured === id
	vi.stubGlobal('requestAnimationFrame', (frame: () => void) => frames.push(frame))
	vi.stubGlobal('cancelAnimationFrame', () => {
		frames = []
	})
})
afterEach(() => {
	act(() => root.unmount())
	host.remove()
	vi.unstubAllGlobals()
})

describe('useSwipeSelect', () => {
	test('a finger that sets off sideways selects from its item to the one it reaches', () => {
		const scroller = render()
		down($('row'), 40, rowY(1))
		move(scroller, 60, rowY(1) + 2)
		expect(lastSelection()).toEqual(['row-1'])
		expect(captured).toBe(7)
		// On down the rows, in the listing's order
		move(scroller, 80, rowY(3))
		expect(lastSelection()).toEqual(['row-1', 'row-2', 'row-3'])
		// Sliding back gives up what it leaves
		move(scroller, 80, rowY(2))
		expect(lastSelection()).toEqual(['row-1', 'row-2'])
		// And past where it began, the run goes the other way
		move(scroller, 80, rowY(0))
		expect(lastSelection()).toEqual(['row-0', 'row-1'])
	})

	test('a finger that sets off up or down is a scroll, and selects nothing', () => {
		const scroller = render()
		down($('row'), 40, rowY(1))
		move(scroller, 44, rowY(1) + 30)
		move(scroller, 120, rowY(3))
		expect(onSelect).not.toHaveBeenCalled()
		expect(captured).toBeNull()
		expect(touchMove(scroller).defaultPrevented).toBe(false)
	})

	test('from a handle, straight down selects', () => {
		const scroller = render({handle: true})
		down($('handle'), 20, rowY(0))
		move(scroller, 20, rowY(0) + 3)
		expect(onSelect).not.toHaveBeenCalled()
		move(scroller, 21, rowY(2))
		expect(lastSelection()).toEqual(['row-0', 'row-1', 'row-2'])
	})

	test('a handle is only a handle where the caller has them', () => {
		const scroller = render({handle: false})
		down($('handle'), 20, rowY(0))
		move(scroller, 21, rowY(2))
		expect(onSelect).not.toHaveBeenCalled()
	})

	test('starting on a selected item deselects the run, and leaves the rest as it was', () => {
		const scroller = render({selection: ['row-1', 'row-2', 'row-3', 'row-7']})
		down($('row'), 40, rowY(2))
		move(scroller, 70, rowY(2))
		expect(lastSelection()).toEqual(['row-1', 'row-3', 'row-7'])
		move(scroller, 70, rowY(3))
		expect(lastSelection()).toEqual(['row-1', 'row-7'])
		// Back off the third: it is selected again, as it was
		move(scroller, 70, rowY(2))
		expect(lastSelection()).toEqual(['row-1', 'row-3', 'row-7'])
	})

	test('past the last item it keeps reaching where it last did', () => {
		const scroller = render()
		scroller.scrollTop = 300
		// Row 8 is now 180px down the scroller, and row 9 240px
		down($('row'), 40, BOUNDS.top + 200)
		move(scroller, 80, BOUNDS.top + 205)
		move(scroller, 80, BOUNDS.top + 250)
		expect(lastSelection()).toEqual(['row-8', 'row-9'])
		move(scroller, 80, BOUNDS.top + 390)
		expect(lastSelection()).toEqual(['row-8', 'row-9'])
		expect(onSelect).toHaveBeenCalledTimes(2)
	})

	test('it does nothing out of selection mode, for a mouse, or from where there is no item', () => {
		let scroller = render({enabled: false})
		down($('row'), 40, rowY(1))
		move(scroller, 90, rowY(1))
		up(scroller, 90, rowY(1))
		scroller = render({enabled: true})
		down($('row'), 40, rowY(1), 'mouse')
		move(scroller, 90, rowY(1))
		up(scroller, 90, rowY(1))
		// Below the tenth row
		scroller.scrollTop = 600
		down(scroller, 40, BOUNDS.top + 50)
		move(scroller, 90, BOUNDS.top + 50)
		up(scroller, 90, BOUNDS.top + 50)
		expect(onSelect).not.toHaveBeenCalled()
	})

	test('the page is kept from scrolling only while a swipe has the finger', () => {
		const scroller = render()
		down($('row'), 40, rowY(1))
		expect(touchMove(scroller).defaultPrevented).toBe(false)
		move(scroller, 70, rowY(1))
		expect(touchMove(scroller).defaultPrevented).toBe(true)
		up(scroller, 70, rowY(1))
		expect(touchMove(scroller).defaultPrevented).toBe(false)
	})

	test('the click that ends a swipe is swallowed, and a tap is not', () => {
		const scroller = render()
		down($('row'), 40, rowY(1))
		move(scroller, 70, rowY(1))
		up(scroller, 70, rowY(1))
		expect(captured).toBeNull()
		click($('row'))
		expect(onRowClick).not.toHaveBeenCalled()
		// A tap: down and up with no travel
		down($('row'), 40, rowY(1))
		up($('row'), 40, rowY(1))
		click($('row'))
		expect(onRowClick).toHaveBeenCalledTimes(1)
	})

	test('holding the finger near an edge scrolls, and the run follows', () => {
		const scroller = render()
		down($('row'), 40, rowY(0))
		move(scroller, 80, rowY(0) + 2)
		// The dock covers the last 100px, and the band is the 72px above it:
		// 36px into the band, halfway up the ramp
		move(scroller, 80, BOUNDS.top + BOUNDS.height - EDGES.bottom - 36)
		expect(lastSelection()).toEqual(['row-0', 'row-1', 'row-2', 'row-3', 'row-4'])
		expect(frames).toHaveLength(1)
		for (let frame = 0; frame < 6; frame++) runFrame()
		// 13px a frame
		expect(scroller.scrollTop).toBe(78)
		expect(lastSelection()).toEqual(['row-0', 'row-1', 'row-2', 'row-3', 'row-4', 'row-5'])
		// Back in the middle, the scrolling stops
		move(scroller, 80, BOUNDS.top + 200)
		expect(frames).toHaveLength(0)
	})

	test('a swipe that loses the finger ends, but not for an item losing its own hold of it', () => {
		const scroller = render()
		down($('row'), 40, rowY(1))
		move(scroller, 70, rowY(1))
		// The item's implicit capture passes to the scroller as the swipe sets off
		pointer('lostpointercapture', $('row'), 70, rowY(1))
		move(scroller, 70, rowY(2))
		expect(lastSelection()).toEqual(['row-1', 'row-2'])
		pointer('lostpointercapture', scroller, 70, rowY(2))
		move(scroller, 70, rowY(4))
		expect(lastSelection()).toEqual(['row-1', 'row-2'])
	})

	test('it follows the scroller to a new element when the caller says it has changed', () => {
		const first = render({version: 0})
		const second = render({version: 1})
		expect(second).not.toBe(first)
		down($('row'), 40, rowY(1))
		move(second, 70, rowY(1))
		expect(lastSelection()).toEqual(['row-1'])
	})
})
