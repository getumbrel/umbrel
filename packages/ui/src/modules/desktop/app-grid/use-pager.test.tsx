// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect, test, vi} from 'vitest'

import {usePager} from './app-pagination-utils'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

// The first page's inner box, as a 1440×900 browser lays it out
const PAGE = {width: 900, height: 600}

vi.mock('react-use', async (importOriginal) => ({
	...(await importOriginal<typeof import('react-use')>()),
	useMeasure: () => [() => {}, {...PAGE, x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0}],
}))

test('pages after the widgets fit as many rows of apps as they can', async () => {
	Object.defineProperty(window, 'innerWidth', {configurable: true, value: 1440})
	Object.defineProperty(window, 'innerHeight', {configurable: true, value: 900})

	let pages: ReturnType<typeof usePager>['pages'] = []
	function Probe() {
		pages = usePager({
			apps: Array.from({length: 50}, (_, i) => `app-${i}`),
			widgets: ['storage', 'system', 'files'],
		}).pages
		return null
	}
	const root = createRoot(document.createElement('div'))
	await act(async () => root.render(<Probe />))

	// Six columns. Under the widgets three rows fit, and five on a page of apps
	// alone (5 × 110px + 4 × 8px ≤ 600px), not the four the widget page's
	// wider gaps leave room for.
	expect(pages.map((page) => [page.widgets.length, page.apps.length])).toEqual([
		[3, 18],
		[0, 30],
		[0, 2],
	])
	// Spread over the page: (600 - 5 × 110) / 4
	expect(document.documentElement.style.getPropertyValue('--app-y-gap-apps')).toBe('12.5px')
	await act(async () => root.unmount())
})
