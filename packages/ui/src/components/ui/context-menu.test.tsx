// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from './context-menu'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

// Radix opens a trigger's menu 700 ms into a touch press
const LONG_PRESS_MS = 700

// The desktop's menu around an app icon's menu
describe('ContextMenuTrigger inside another trigger', () => {
	let container: HTMLDivElement
	let root: ReturnType<typeof createRoot>

	beforeEach(() => {
		vi.useFakeTimers()
		vi.stubGlobal(
			'ResizeObserver',
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		)
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
		act(() =>
			root.render(
				<ContextMenu modal={false}>
					<ContextMenuTrigger>
						<div id='desktop'>Desktop</div>
						<ContextMenu>
							<ContextMenuTrigger>
								<button id='app'>App</button>
							</ContextMenuTrigger>
							<ContextMenuContent>
								<ContextMenuItem id='uninstall'>Uninstall</ContextMenuItem>
							</ContextMenuContent>
						</ContextMenu>
					</ContextMenuTrigger>
					<ContextMenuContent>
						<ContextMenuItem>Change wallpaper</ContextMenuItem>
					</ContextMenuContent>
				</ContextMenu>,
			),
		)
	})

	afterEach(() => {
		act(() => root.unmount())
		container.remove()
		vi.unstubAllGlobals()
		vi.useRealTimers()
	})

	function touchDown(selector: string) {
		const event = new MouseEvent('pointerdown', {bubbles: true, cancelable: true})
		Object.defineProperty(event, 'pointerType', {value: 'touch'})
		act(() => void document.querySelector(selector)!.dispatchEvent(event))
	}

	function contextMenu(selector: string) {
		const event = new MouseEvent('contextmenu', {bubbles: true, cancelable: true})
		act(() => void document.querySelector(selector)!.dispatchEvent(event))
	}

	function wait(ms: number) {
		act(() => void vi.advanceTimersByTime(ms))
	}

	function openMenus() {
		return Array.from(document.querySelectorAll('[role=menu]'), (menu) => menu.textContent)
	}

	it('opens only the inner menu on a touch long-press', () => {
		touchDown('#app')
		wait(LONG_PRESS_MS)
		expect(openMenus()).toEqual(['Uninstall'])
	})

	// Chrome on Android sends its own `contextmenu` partway through the press, with the finger still down
	it('opens only the inner menu when the browser reports the long-press first', () => {
		touchDown('#app')
		wait(500)
		contextMenu('#app')
		wait(LONG_PRESS_MS)
		expect(openMenus()).toEqual(['Uninstall'])
	})

	it('opens only the inner menu on a right-click', () => {
		contextMenu('#app')
		expect(openMenus()).toEqual(['Uninstall'])
	})

	// The open menu is portalled out of the outer trigger, but is still inside it as far as React's events go
	it('stays closed for presses inside the inner menu', () => {
		contextMenu('#app')
		touchDown('#uninstall')
		wait(LONG_PRESS_MS)
		contextMenu('#uninstall')
		expect(openMenus()).toEqual(['Uninstall'])
	})

	it('opens the outer menu from the rest of its surface', () => {
		touchDown('#desktop')
		wait(LONG_PRESS_MS)
		expect(openMenus()).toEqual(['Change wallpaper'])
	})
})
