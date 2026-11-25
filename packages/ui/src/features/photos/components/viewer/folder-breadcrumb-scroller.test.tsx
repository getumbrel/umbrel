// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'

import {FolderBreadcrumbScroller} from './folder-breadcrumb-scroller'

vi.mock('@/features/files/components/dialogs/cloud-add-dialog/destination-step', () => ({
	DestinationBreadcrumbs: ({path}: {path: string}) => <span data-path={path}>{path}</span>,
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

class ResizeObserverMock {
	observe = vi.fn()
	unobserve = vi.fn()
	disconnect = vi.fn()
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
	vi.stubGlobal('ResizeObserver', ResizeObserverMock)
	vi.stubGlobal(
		'requestAnimationFrame',
		vi.fn(() => 1),
	)
	vi.stubGlobal('cancelAnimationFrame', vi.fn())
	vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(640)
	vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(240)
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})

afterEach(() => {
	act(() => root.unmount())
	container.remove()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

it('keeps the full path scrollable and initially shows its end', () => {
	act(() => root.render(<FolderBreadcrumbScroller path='/Home/Photos/Trips' homePath='/Home' />))

	const scroller = container.querySelector<HTMLDivElement>('.umbrel-fade-scroller-x')!
	expect(scroller.className).toContain('overflow-x-auto')
	expect(scroller.className).toContain('whitespace-nowrap')
	expect(scroller.firstElementChild?.className).toContain('w-max')
	expect(scroller.firstElementChild?.className).toContain('p-1')
	expect(scroller.textContent).toBe('/Home/Photos/Trips')
	expect(scroller.scrollLeft).toBe(640)

	scroller.scrollLeft = 0
	act(() => root.render(<FolderBreadcrumbScroller path='/Home/Archive/2026' homePath='/Home' />))
	expect(scroller.textContent).toBe('/Home/Archive/2026')
	expect(scroller.scrollLeft).toBe(640)
})

it('leaves a path that fits at its start', () => {
	// A fraction of a pixel over, as text widths are: reported as one
	vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(241)
	act(() => root.render(<FolderBreadcrumbScroller path='/Home/Photos' homePath='/Home' />))

	const scroller = container.querySelector<HTMLDivElement>('.umbrel-fade-scroller-x')!
	scroller.scrollLeft = 0.5
	act(() => root.render(<FolderBreadcrumbScroller path='/Home/Videos' homePath='/Home' />))
	expect(scroller.scrollLeft).toBe(0)
})
