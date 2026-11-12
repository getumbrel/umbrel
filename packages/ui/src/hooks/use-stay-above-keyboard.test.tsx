// @vitest-environment jsdom

import {act, useState} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {revealOffset, useStayAboveKeyboard} from './use-stay-above-keyboard'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

describe('revealOffset', () => {
	// A list showing from 100 to 300, and a 36px field
	const room = {top: 100, bottom: 300}

	it('leaves a field alone that already shows with room to spare', () => {
		expect(revealOffset({top: 150, bottom: 186}, room)).toBe(0)
	})

	it('scrolls down just far enough for a field under the foot, plus breathing room', () => {
		expect(revealOffset({top: 290, bottom: 326}, room)).toBe(42)
		// Showing, but hard against the edge
		expect(revealOffset({top: 264, bottom: 300}, room)).toBe(16)
	})

	it('scrolls up for a field above the top', () => {
		expect(revealOffset({top: 60, bottom: 96}, room)).toBe(-56)
	})

	it('gives up breathing room as the room runs out', () => {
		// 40px of room for a 36px field: 2px either side
		expect(revealOffset({top: 300, bottom: 336}, {top: 100, bottom: 140})).toBe(198)
	})

	it('keeps the top of a field that is taller than the room', () => {
		expect(revealOffset({top: 250, bottom: 500}, room)).toBe(150)
		// And leaves it there, rather than going back and forth
		expect(revealOffset({top: 100, bottom: 350}, room)).toBe(0)
	})
})

describe('useStayAboveKeyboard', () => {
	// An iPhone: 664px of page, and a keyboard that covers the foot of it
	const PAGE_HEIGHT = 664
	let viewport: EventTarget & {height: number; offsetTop: number; scale: number}
	let container: HTMLDivElement
	let root: Root
	let drawer: HTMLDivElement

	function Drawer() {
		const [el, setEl] = useState<HTMLDivElement | null>(null)
		useStayAboveKeyboard(el)
		return (
			<div ref={setEl} data-testid='drawer'>
				<div data-testid='scroller' style={{overflowY: 'auto'}}>
					<input />
				</div>
			</div>
		)
	}

	async function setViewport(change: Partial<typeof viewport>, event = 'resize') {
		await act(async () => {
			Object.assign(viewport, change)
			viewport.dispatchEvent(new Event(event))
		})
	}

	beforeEach(async () => {
		viewport = Object.assign(new EventTarget(), {height: PAGE_HEIGHT, offsetTop: 0, scale: 1})
		vi.stubGlobal('visualViewport', viewport)
		vi.stubGlobal(
			'ResizeObserver',
			class {
				observe() {}
				disconnect() {}
			},
		)
		vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(PAGE_HEIGHT)
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
		await act(async () => root.render(<Drawer />))
		drawer = container.querySelector('[data-testid=drawer]')!
	})

	afterEach(async () => {
		await act(async () => root.unmount())
		container.remove()
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	const state = () => ({
		keyboard: drawer.hasAttribute('data-keyboard'),
		low: drawer.hasAttribute('data-low'),
		top: drawer.style.getPropertyValue('--visible-top'),
		bottom: drawer.style.getPropertyValue('--visible-bottom'),
	})

	it('leaves the drawer alone with nothing covered', () => {
		expect(state()).toEqual({keyboard: false, low: false, top: '0px', bottom: '0px'})
	})

	it('tells the drawer what the keyboard covers, and takes it back when the keyboard goes', async () => {
		await setViewport({height: 325})
		expect(state()).toEqual({keyboard: true, low: true, top: '0px', bottom: '339px'})

		await setViewport({height: PAGE_HEIGHT})
		expect(state()).toEqual({keyboard: false, low: false, top: '0px', bottom: '0px'})
	})

	it('follows the page as the browser pans it to bring a field up', async () => {
		await setViewport({height: 325})
		await setViewport({offsetTop: 120}, 'scroll')
		expect(state()).toEqual({keyboard: true, low: true, top: '120px', bottom: '219px'})
	})

	it('is not low under a bar that only takes a little', async () => {
		// The bar iOS shows for a hardware keyboard
		await setViewport({height: PAGE_HEIGHT - 55})
		expect(state()).toEqual({keyboard: true, low: false, top: '0px', bottom: '55px'})
	})

	it('does not take a scrollbar for a keyboard', async () => {
		await setViewport({height: PAGE_HEIGHT - 15})
		expect(state()).toEqual({keyboard: false, low: false, top: '0px', bottom: '0px'})
	})

	it('still counts a keyboard the page has panned most of the way past', async () => {
		// iOS centres the field: only 15px of the page's foot is left under the keyboard
		await setViewport({height: 325, offsetTop: 324}, 'scroll')
		expect(state()).toEqual({keyboard: true, low: true, top: '324px', bottom: '15px'})
	})

	it('leaves a drawer alone when the keyboard leaves next to nothing', async () => {
		// A small iPhone on its side: 44px of page above the keyboard
		vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(265)
		await setViewport({height: 44, offsetTop: 221})
		expect(state()).toEqual({keyboard: false, low: false, top: '0px', bottom: '0px'})
	})

	it('takes a window the keyboard resized as it is', async () => {
		// The Android app: the page itself got shorter, so nothing is covered
		vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(325)
		await setViewport({height: 325})
		expect(state()).toEqual({keyboard: false, low: false, top: '0px', bottom: '0px'})
	})

	it('does not take zooming in for a keyboard', async () => {
		await setViewport({height: 332, offsetTop: 100, scale: 2})
		expect(state()).toEqual({keyboard: false, low: false, top: '0px', bottom: '0px'})
	})

	it('scrolls the field being typed in back into view', async () => {
		const scroller = drawer.querySelector<HTMLElement>('[data-testid=scroller]')!
		const input = drawer.querySelector('input')!
		const rect = (top: number, bottom: number) => ({top, bottom}) as DOMRect
		// The drawer ends at the keyboard, the list was laid out past it, and the field is down there
		vi.spyOn(drawer, 'getBoundingClientRect').mockReturnValue(rect(12, 325))
		vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(rect(153, 533))
		vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(rect(418, 454))
		input.focus()

		await setViewport({height: 325})
		// Up to the drawer's foot at 325, less the breathing room
		expect(scroller.scrollTop).toBe(454 - (325 - 16))
	})

	it('keeps the error a field is described by in view with it', async () => {
		const scroller = drawer.querySelector<HTMLElement>('[data-testid=scroller]')!
		const input = drawer.querySelector('input')!
		const error = document.createElement('p')
		error.id = 'wrong-password'
		scroller.append(error)
		input.setAttribute('aria-describedby', 'wrong-password')
		const rect = (top: number, bottom: number) => ({top, bottom}) as DOMRect
		vi.spyOn(drawer, 'getBoundingClientRect').mockReturnValue(rect(12, 325))
		vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(rect(153, 295))
		// The field shows, with room to spare, but the error under it runs past the foot of the list
		vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(rect(230, 266))
		vi.spyOn(error, 'getBoundingClientRect').mockReturnValue(rect(270, 294))
		input.focus()

		await setViewport({height: 325})
		expect(scroller.scrollTop).toBe(294 - (295 - 16))
	})
})
