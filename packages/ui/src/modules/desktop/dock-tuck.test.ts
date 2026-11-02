// @vitest-environment jsdom

import {act, createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {useDockTuck, useTuckDockOnScroll} from './dock-tuck'

const originalHeight = window.innerHeight

function mount(page: HTMLElement) {
	function Page() {
		useTuckDockOnScroll(page)
		return null
	}
	const root = createRoot(document.createElement('div'))
	act(() => root.render(createElement(Page)))
	return () => act(() => root.unmount())
}

function scrollTo(element: HTMLElement, top: number) {
	act(() => {
		element.scrollTop = top
		element.dispatchEvent(new Event('scroll'))
	})
}

const tucked = () => useDockTuck.getState().tucked

describe('useTuckDockOnScroll', () => {
	let page: HTMLDivElement

	beforeEach(() => {
		;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
		page = document.createElement('div')
		useDockTuck.setState({tucked: false})
	})

	afterEach(() => {
		window.innerHeight = originalHeight
	})

	describe('on a phone on its side', () => {
		beforeEach(() => {
			window.innerHeight = 296
		})

		it('tucks the dock scrolling down and brings it back scrolling up', () => {
			mount(page)
			scrollTo(page, 200)
			expect(tucked()).toBe(true)
			scrollTo(page, 150)
			expect(tucked()).toBe(false)
		})

		it('ignores tiny scrolls', () => {
			mount(page)
			scrollTo(page, 200)
			scrollTo(page, 196)
			expect(tucked()).toBe(true)
		})

		it('always shows the dock at the top of a page', () => {
			mount(page)
			scrollTo(page, 200)
			scrollTo(page, 10)
			expect(tucked()).toBe(false)
		})

		it('follows a pane inside the page', () => {
			const pane = page.appendChild(document.createElement('div'))
			mount(page)
			scrollTo(pane, 200)
			expect(tucked()).toBe(true)
			scrollTo(pane, 150)
			expect(tucked()).toBe(false)
		})

		it('ignores sideways scrolling', () => {
			const rail = page.appendChild(document.createElement('div'))
			mount(page)
			scrollTo(page, 200)
			act(() => {
				rail.scrollLeft = 300
				rail.dispatchEvent(new Event('scroll'))
			})
			expect(tucked()).toBe(true)
		})

		it('brings the dock back when the page goes away', () => {
			const unmount = mount(page)
			scrollTo(page, 200)
			unmount()
			expect(tucked()).toBe(false)
		})
	})

	it('leaves the dock alone on taller screens', () => {
		window.innerHeight = 714
		mount(page)
		scrollTo(page, 200)
		expect(tucked()).toBe(false)
	})
})
