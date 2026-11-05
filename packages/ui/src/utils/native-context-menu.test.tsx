// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/components/ui/context-menu'

import {allowsNativeContextMenu} from './native-context-menu'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function element(html: string) {
	document.body.innerHTML = html
	return document.body.querySelector('[data-target]')
}

describe('allowsNativeContextMenu', () => {
	it('keeps the browser menu on text controls', () => {
		expect(allowsNativeContextMenu(element('<input data-target />'))).toBe(true)
		expect(allowsNativeContextMenu(element('<input data-target type="search" />'))).toBe(true)
		expect(allowsNativeContextMenu(element('<input data-target type="password" />'))).toBe(true)
		expect(allowsNativeContextMenu(element('<textarea data-target></textarea>'))).toBe(true)
		expect(allowsNativeContextMenu(element('<div contenteditable="true"><span data-target>x</span></div>'))).toBe(true)
	})

	it('keeps the browser menu inside opted-in surfaces like the terminal', () => {
		expect(allowsNativeContextMenu(element('<div data-native-context-menu><canvas data-target></canvas></div>'))).toBe(
			true,
		)
	})

	it('suppresses it everywhere else', () => {
		expect(allowsNativeContextMenu(element('<input data-target type="checkbox" />'))).toBe(false)
		expect(allowsNativeContextMenu(element('<input data-target type="file" />'))).toBe(false)
		expect(allowsNativeContextMenu(element('<input data-target type="range" />'))).toBe(false)
		expect(allowsNativeContextMenu(element('<div contenteditable="false"><span data-target>x</span></div>'))).toBe(
			false,
		)
		expect(allowsNativeContextMenu(element('<button data-target>x</button>'))).toBe(false)
		expect(allowsNativeContextMenu(element('<div data-target>x</div>'))).toBe(false)
		expect(allowsNativeContextMenu(null)).toBe(false)
		expect(allowsNativeContextMenu(document)).toBe(false)
	})
})

describe('ContextMenuTrigger', () => {
	let container: HTMLDivElement
	let root: ReturnType<typeof createRoot>

	beforeEach(() => {
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
				<ContextMenu>
					<ContextMenuTrigger>
						<div id='item'>Item</div>
						<input id='rename' defaultValue='Item' />
					</ContextMenuTrigger>
					<ContextMenuContent>
						<ContextMenuItem>Open</ContextMenuItem>
					</ContextMenuContent>
				</ContextMenu>,
			),
		)
	})

	afterEach(() => {
		act(() => root.unmount())
		container.remove()
		vi.unstubAllGlobals()
	})

	// Right-clicks with init.tsx's document-level blocker in place, which runs last of all
	function rightClick(selector: string) {
		const blocker = (event: Event) => {
			if (!allowsNativeContextMenu(event.target)) event.preventDefault()
		}
		document.addEventListener('contextmenu', blocker)
		const event = new MouseEvent('contextmenu', {bubbles: true, cancelable: true})
		act(() => void document.querySelector(selector)!.dispatchEvent(event))
		document.removeEventListener('contextmenu', blocker)
		return {browserMenu: !event.defaultPrevented, menuOpen: document.body.textContent!.includes('Open')}
	}

	it('opens its own menu on the rest of the trigger', () => {
		expect(rightClick('#item')).toEqual({browserMenu: false, menuOpen: true})
	})

	it('leaves a text field inside it to the browser', () => {
		expect(rightClick('#rename')).toEqual({browserMenu: true, menuOpen: false})
	})
})
