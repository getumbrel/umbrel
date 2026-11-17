// @vitest-environment jsdom

import {act, useRef, type RefObject} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {useMarquee, type MarqueeRect} from './use-marquee'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

// The scroller as drawn: 400 by 300 at (100, 50), its last 10px a scrollbar,
// over content 2000 tall
const BOUNDS = {left: 100, top: 50, width: 400, height: 300}

type Options = {
	// Where the box lives: in the scroller's content, or over the scroller
	box?: 'inside' | 'over'
	selection?: ReadonlySet<string>
	held?: ReadonlySet<string>
	canStart?: () => boolean
	edges?: {top: number; bottom: number}
	// What the layout says a box touches: by default, a set of its own making per test
	itemsInRect?: (rect: MarqueeRect) => Iterable<string> | null
}

let root: Root
let host: HTMLDivElement
let onSelect: ReturnType<typeof vi.fn<(ids: ReadonlySet<string>) => void>>
let itemsInRect: ReturnType<typeof vi.fn<(rect: MarqueeRect) => Iterable<string> | null>>
let onItemClick: ReturnType<typeof vi.fn<() => void>>
let selectionRef: RefObject<ReadonlySet<string>>
let captured: number | null
let frames: Array<() => void>

function Harness({box = 'inside', held, canStart, edges}: Options) {
	const scrollerRef = useRef<HTMLDivElement>(null)
	const heldRef = useRef(held ?? new Set<string>())
	const marquee = useMarquee({
		scrollerRef,
		itemsInRect,
		selectionRef,
		heldRef,
		onSelect,
		canStart,
		edges,
	})
	const boxElement = <div ref={marquee.boxRef} data-testid='box' style={{display: 'none'}} />
	return (
		<div data-testid='wrap' {...(box === 'over' ? marquee.handlers : {})}>
			<div ref={scrollerRef} data-testid='scroller' {...(box === 'inside' ? marquee.handlers : {})}>
				<div data-testid='content'>
					<button data-testid='item' onClick={onItemClick}>
						item
					</button>
					{box === 'inside' && boxElement}
				</div>
			</div>
			{box === 'over' && boxElement}
		</div>
	)
}

const $ = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`)!

function render(options: Options = {}, {scale = 1}: {scale?: number} = {}) {
	selectionRef = {current: options.selection ?? new Set()}
	if (options.itemsInRect) itemsInRect.mockImplementation(options.itemsInRect)
	act(() => root.render(<Harness {...options} />))
	const scroller = $('scroller')
	scroller.getBoundingClientRect = () =>
		new DOMRect(BOUNDS.left, BOUNDS.top, BOUNDS.width * scale, BOUNDS.height * scale) as DOMRect
	Object.defineProperties(scroller, {
		offsetWidth: {value: BOUNDS.width},
		clientWidth: {value: BOUNDS.width - 10},
		clientHeight: {value: BOUNDS.height},
		scrollHeight: {value: 2000},
	})
	return scroller
}

// A mouse event of the pointer kind, as React hears it
function pointer(
	type: string,
	target: Element,
	{x, y, ...init}: {x: number; y: number} & MouseEventInit & {pointerType?: string},
) {
	const {pointerType = 'mouse', ...mouse} = init
	const event = new MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, ...mouse})
	Object.defineProperties(event, {pointerId: {value: 1}, pointerType: {value: pointerType}})
	act(() => {
		target.dispatchEvent(event)
	})
	return event
}
const press = (target: Element, x: number, y: number, init: MouseEventInit & {pointerType?: string} = {}) =>
	pointer('pointerdown', target, {x, y, button: 0, buttons: 1, ...init})
const move = (target: Element, x: number, y: number) => pointer('pointermove', target, {x, y, buttons: 1})
const release = (target: Element, x: number, y: number) => pointer('pointerup', target, {x, y, buttons: 0})
const click = (target: Element) => {
	const event = new MouseEvent('click', {bubbles: true, cancelable: true})
	act(() => {
		target.dispatchEvent(event)
	})
}
const lastSelection = () => [...(onSelect.mock.calls.at(-1)?.[0] ?? [])].sort()
const runFrame = () => act(() => frames.splice(0).forEach((frame) => frame()))

beforeEach(() => {
	host = document.createElement('div')
	document.body.append(host)
	root = createRoot(host)
	onSelect = vi.fn()
	onItemClick = vi.fn()
	itemsInRect = vi.fn((): Iterable<string> | null => [])
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

describe('useMarquee', () => {
	test('a press that goes nowhere is a click, and stays one', () => {
		const scroller = render()
		press($('item'), 150, 100)
		move($('item'), 152, 101)
		release($('item'), 152, 101)
		click($('item'))
		expect(onSelect).not.toHaveBeenCalled()
		expect(onItemClick).toHaveBeenCalledTimes(1)
		expect($('box').style.display).toBe('none')
		expect(scroller.scrollTop).toBe(0)
	})

	test('a drag selects what the box covers, asked for in the content’s own coordinates', () => {
		const scroller = render({itemsInRect: () => ['a', 'b']})
		scroller.scrollTop = 500
		press(scroller, 150, 100)
		move(scroller, 250, 200)
		// 50px in from the scroller's left, and 50px down it plus the 500 scrolled
		expect(itemsInRect).toHaveBeenLastCalledWith({left: 50, top: 550, right: 150, bottom: 650})
		expect(lastSelection()).toEqual(['a', 'b'])
		expect(captured).toBe(1)
		// A box drawn up and to the left of where it began is the same box
		move(scroller, 120, 70)
		expect(itemsInRect).toHaveBeenLastCalledWith({left: 20, top: 520, right: 50, bottom: 550})
	})

	test('a plain drag replaces the selection, keeping only what is held', () => {
		const scroller = render({selection: new Set(['old', 'kept']), held: new Set(['kept']), itemsInRect: () => ['a']})
		press(scroller, 150, 100)
		move(scroller, 250, 200)
		expect(lastSelection()).toEqual(['a', 'kept'])
	})

	test('with shift or ⌘ held it adds to the selection', () => {
		const scroller = render({selection: new Set(['old']), held: new Set(['kept']), itemsInRect: () => ['a']})
		press(scroller, 150, 100, {metaKey: true})
		move(scroller, 250, 200)
		expect(lastSelection()).toEqual(['a', 'old'])
	})

	test('the selection is only set when what the box covers changes', () => {
		const scroller = render({itemsInRect: (rect) => (rect.bottom > 160 ? ['a', 'b'] : ['a'])})
		press(scroller, 150, 100)
		move(scroller, 200, 120)
		move(scroller, 210, 130)
		move(scroller, 220, 140)
		expect(onSelect).toHaveBeenCalledTimes(1)
		move(scroller, 220, 220)
		expect(onSelect).toHaveBeenCalledTimes(2)
		expect(lastSelection()).toEqual(['a', 'b'])
	})

	test('what the press itself did to the selection is what the drag starts from', () => {
		// Files lets go of the selection on a press on empty space: a box that
		// then covers the same item must select it again
		const scroller = render({selection: new Set(['a']), itemsInRect: () => ['a']})
		press(scroller, 150, 100)
		selectionRef.current = new Set()
		move(scroller, 250, 200)
		expect(lastSelection()).toEqual(['a'])
	})

	test('the click that ends a drag is swallowed, and the next one is not', () => {
		render({itemsInRect: () => ['a']})
		press($('item'), 150, 100)
		move($('item'), 250, 200)
		release($('item'), 250, 200)
		expect(captured).toBeNull()
		expect($('box').style.display).toBe('none')
		click($('item'))
		expect(onItemClick).not.toHaveBeenCalled()
		click($('item'))
		expect(onItemClick).toHaveBeenCalledTimes(1)
	})

	test('a press the caller keeps for itself never becomes a drag', () => {
		const scroller = render({canStart: () => false, itemsInRect: () => ['a']})
		press(scroller, 150, 100)
		move(scroller, 250, 200)
		release(scroller, 250, 200)
		expect(onSelect).not.toHaveBeenCalled()
		click($('item'))
		expect(onItemClick).toHaveBeenCalledTimes(1)
	})

	test('only the mouse’s main button draws it, and not from the scrollbar or outside the scroller', () => {
		const scroller = render({box: 'over', itemsInRect: () => ['a']})
		const attempts: Array<() => void> = [
			() => press(scroller, 150, 100, {pointerType: 'touch'}),
			() => press(scroller, 150, 100, {pointerType: 'pen'}),
			() => press(scroller, 150, 100, {button: 2}),
			// The last 10px of the scroller's width are its scrollbar
			() => press(scroller, 495, 100),
			// On the wrapper, above the scroller
			() => press($('wrap'), 150, 20),
		]
		for (const attempt of attempts) {
			attempt()
			move(scroller, 250, 200)
			release(scroller, 250, 200)
		}
		expect(onSelect).not.toHaveBeenCalled()
	})

	test('a button let go of out of earshot ends the press', () => {
		const scroller = render({itemsInRect: () => ['a']})
		press(scroller, 150, 100)
		// The pointer comes back with nothing held
		pointer('pointermove', scroller, {x: 250, y: 200, buttons: 0})
		move(scroller, 300, 250)
		expect(onSelect).not.toHaveBeenCalled()
	})

	test('a scroller drawn at another scale is read in its own px', () => {
		// Drawn at 80%: 320 wide on screen for the 400 it is laid out at
		const scroller = render({itemsInRect: () => []}, {scale: 0.8})
		press(scroller, 100 + 80, 50 + 40)
		move(scroller, 100 + 160, 50 + 120)
		expect(itemsInRect).toHaveBeenLastCalledWith({left: 100, top: 50, right: 200, bottom: 150})
	})

	test('a box in the scroller’s content is drawn in the content’s coordinates', () => {
		const scroller = render({box: 'inside'})
		scroller.scrollTop = 500
		press(scroller, 150, 100)
		move(scroller, 250, 200)
		const box = $('box')
		expect(box.style.display).toBe('block')
		expect(box.style.transform).toBe('translate(50px, 550px)')
		expect(box.style.width).toBe('100px')
		expect(box.style.height).toBe('100px')
	})

	test('a box over the scroller is drawn where it shows, cut to the scroller’s edges', () => {
		const scroller = render({box: 'over'})
		// Whatever positions the box is 20px left of the scroller and 30px above it
		Object.defineProperty($('box'), 'offsetParent', {value: $('wrap')})
		$('wrap').getBoundingClientRect = () => new DOMRect(80, 20, 500, 400) as DOMRect
		scroller.scrollTop = 500
		press(scroller, 150, 100)
		move(scroller, 250, 200)
		const box = $('box')
		expect(box.style.transform).toBe('translate(70px, 80px)')
		expect(box.style.width).toBe('100px')
		expect(box.style.height).toBe('100px')
		// Scrolled on under a held pointer, the box's top is above what shows
		scroller.scrollTop = 600
		act(() => {
			scroller.dispatchEvent(new Event('scroll'))
		})
		expect(itemsInRect).toHaveBeenLastCalledWith({left: 50, top: 550, right: 150, bottom: 750})
		expect(box.style.transform).toBe('translate(70px, 30px)')
		expect(box.style.height).toBe('150px')
	})

	test('holding the pointer past an edge scrolls, and the selection follows', () => {
		const scroller = render({itemsInRect: (rect) => (rect.bottom > 420 ? ['a', 'b'] : ['a'])})
		press(scroller, 150, 100)
		// 80px below the scroller's bottom edge: halfway up the ramp
		move(scroller, 250, 430)
		expect(lastSelection()).toEqual(['a'])
		expect(frames).toHaveLength(1)
		runFrame()
		expect(scroller.scrollTop).toBe(18)
		runFrame()
		runFrame()
		runFrame()
		runFrame()
		runFrame()
		runFrame()
		expect(scroller.scrollTop).toBe(126)
		// The pointer hasn't moved, and the box has grown by what scrolled
		expect(lastSelection()).toEqual(['a', 'b'])
		// Back inside, the scrolling stops
		move(scroller, 250, 200)
		expect(frames).toHaveLength(0)
	})

	test('the scrolling starts where the scroller is covered, when it says it is', () => {
		const scroller = render({edges: {top: 20, bottom: 100}})
		press(scroller, 150, 150)
		// 40px into the 100px the dock covers at the bottom
		move(scroller, 250, 290)
		expect(frames).toHaveLength(1)
		runFrame()
		expect(scroller.scrollTop).toBe(11)
	})

	test('a drag that loses the pointer ends', () => {
		const scroller = render({itemsInRect: () => ['a']})
		press(scroller, 150, 100)
		move(scroller, 250, 200)
		pointer('lostpointercapture', scroller, {x: 250, y: 200})
		expect($('box').style.display).toBe('none')
		move(scroller, 300, 250)
		expect(onSelect).toHaveBeenCalledTimes(1)
	})

	test('nothing is selected while the layout can’t say what a box touches', () => {
		const scroller = render({itemsInRect: () => null})
		press(scroller, 150, 100)
		move(scroller, 250, 200)
		expect(onSelect).not.toHaveBeenCalled()
	})
})
