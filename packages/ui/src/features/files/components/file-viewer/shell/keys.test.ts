// @vitest-environment jsdom
import {expect, test, vi} from 'vitest'

import {pageShortcut, pageTurn} from '@/features/files/components/file-viewer/shell/keys'

const press = (key: string, init: KeyboardEventInit = {}, target?: EventTarget) => {
	const event = new KeyboardEvent('keydown', {key, cancelable: true, ...init})
	if (target) Object.defineProperty(event, 'target', {value: target})
	return event
}

test('⌘F, ⌘+, ⌘− and ⌘0 (or with Ctrl) find and zoom the pages; other keys are left alone', () => {
	const on = {find: vi.fn(), zoom: vi.fn(), actualSize: vi.fn()}
	const shortcuts = [
		press('f', {metaKey: true}),
		press('=', {ctrlKey: true}),
		press('_', {metaKey: true, shiftKey: true}),
		press('0', {metaKey: true}),
	]
	expect(shortcuts.map((event) => pageShortcut(event, on))).toEqual([true, true, true, true])
	expect(shortcuts.every((event) => event.defaultPrevented)).toBe(true)
	expect([on.find.mock.calls.length, on.zoom.mock.calls, on.actualSize.mock.calls.length]).toEqual([1, [[1], [-1]], 1])

	const others = [press('f'), press('f', {metaKey: true, altKey: true}), press('a', {metaKey: true})]
	expect(others.map((event) => pageShortcut(event, on))).toEqual([false, false, false])
	expect(others.some((event) => event.defaultPrevented)).toBe(false)
})

test('← and → turn the page only in an opened file whose pages have the keyboard, with no modifier', () => {
	const pages = document.createElement('div')
	expect(pageTurn(press('ArrowLeft', {}, pages), pages, 'open')).toBe(-1)
	expect(pageTurn(press('ArrowRight', {}, pages), pages, 'open')).toBe(1)
	expect([
		pageTurn(press('ArrowRight', {}, pages), pages, 'preview'),
		pageTurn(press('ArrowRight', {}, document.body), pages, 'open'),
		pageTurn(press('ArrowRight', {shiftKey: true}, pages), pages, 'open'),
		pageTurn(press('ArrowRight', {metaKey: true}, pages), pages, 'open'),
		pageTurn(press('ArrowDown', {}, pages), pages, 'open'),
	]).toEqual([0, 0, 0, 0, 0])
})
