// @vitest-environment jsdom
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeAll, expect, test, vi} from 'vitest'

import {SheetTabs} from './sheet-tabs'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

// The strip's size and place, which jsdom doesn't lay out: 300px showing 1000px of tabs
const strip = {clientWidth: 300, scrollWidth: 1000, scrollLeft: 0}
beforeAll(() => {
	globalThis.ResizeObserver = class {
		observe() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver
	Element.prototype.scrollIntoView = () => {}
	const ours = (element: Element) => element.getAttribute('role') === 'tablist'
	for (const name of ['clientWidth', 'scrollWidth'] as const) {
		Object.defineProperty(HTMLDivElement.prototype, name, {
			configurable: true,
			get(this: HTMLDivElement) {
				return ours(this) ? strip[name] : 0
			},
		})
	}
	Object.defineProperty(HTMLDivElement.prototype, 'scrollLeft', {
		configurable: true,
		get(this: HTMLDivElement) {
			return ours(this) ? strip.scrollLeft : 0
		},
		set(this: HTMLDivElement, value: number) {
			if (ours(this)) strip.scrollLeft = Math.max(0, Math.min(strip.scrollWidth - strip.clientWidth, value))
		},
	})
})

let root: Root | undefined
afterEach(() => {
	act(() => root?.unmount())
	root = undefined
	document.body.replaceChildren()
	strip.scrollLeft = 0
})

const SHEETS = ['Summary', 'Q4 2020 Revenue Forecast Draft (final, really)', 'Expenses', 'Notes'].map(
	(name, index) => ({index, name}),
)

function mount(active = 1) {
	const selected: number[] = []
	const container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
	act(() => root!.render(<SheetTabs sheets={SHEETS} active={active} onSelect={(index) => selected.push(index)} />))
	const tablist = container.querySelector<HTMLElement>('[role="tablist"]')!
	return {selected, tablist, tabs: [...tablist.querySelectorAll<HTMLElement>('[role="tab"]')]}
}

test('every tab shows its whole name, and only the open one is in the tab order', () => {
	const {tabs} = mount()
	expect(tabs.map((tab) => tab.title)).toEqual(SHEETS.map(({name}) => name))
	expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1, -1])
})

test('the arrows, Home and End go along the tabs, and keep the keys from the viewer', () => {
	const {tabs, selected} = mount()
	const seen = vi.fn()
	window.addEventListener('keydown', seen)
	const press = (key: string) => {
		const event = new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true})
		act(() => void document.activeElement!.dispatchEvent(event))
		return event
	}
	tabs[1].focus()
	expect(press('ArrowRight').defaultPrevented).toBe(true)
	expect(document.activeElement).toBe(tabs[2])
	press('ArrowRight')
	press('ArrowRight')
	// Past the last, round to the first
	expect(document.activeElement).toBe(tabs[0])
	press('ArrowLeft')
	expect(document.activeElement).toBe(tabs[3])
	press('Home')
	expect(document.activeElement).toBe(tabs[0])
	press('End')
	expect(document.activeElement).toBe(tabs[3])
	expect(seen).not.toHaveBeenCalled()
	// Moving along chooses nothing: Enter or Space does, as the tab is a button
	expect(selected).toEqual([])
	window.removeEventListener('keydown', seen)
})

test('a wheel turns the strip, and an end fades while there are more tabs past it', () => {
	const {tablist} = mount()
	const wheel = (init: WheelEventInit) =>
		act(() => {
			tablist.dispatchEvent(new WheelEvent('wheel', {bubbles: true, ...init}))
			tablist.dispatchEvent(new Event('scroll'))
		})
	expect(tablist.dataset.more).toBe('end')
	wheel({deltaY: 100})
	expect(strip.scrollLeft).toBe(100)
	expect(tablist.dataset.more).toBe('both')
	// A wheel that counts lines, as Firefox's does
	wheel({deltaY: 3, deltaMode: 1})
	expect(strip.scrollLeft).toBe(220)
	// Sideways is the browser's own
	wheel({deltaX: 50, deltaY: 100})
	expect(strip.scrollLeft).toBe(220)
	wheel({deltaY: 1000})
	expect(strip.scrollLeft).toBe(700)
	expect(tablist.dataset.more).toBe('start')
})
