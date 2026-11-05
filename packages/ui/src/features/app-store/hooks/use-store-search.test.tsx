// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {createMemoryRouter, RouterProvider} from 'react-router-dom'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'

import {useStoreSearch} from './use-store-search'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const probe = {query: '', setQuery: (_query: string) => {}}

function Probe() {
	const search = useStoreSearch()
	probe.query = search.query
	probe.setQuery = search.setQuery
	return null
}

describe('App Store search', () => {
	let container: HTMLDivElement
	let root: ReturnType<typeof createRoot>
	let router: ReturnType<typeof createMemoryRouter>

	beforeEach(async () => {
		container = document.createElement('div')
		document.body.appendChild(container)
		router = createMemoryRouter([{path: '/app-store', element: <Probe />}], {initialEntries: ['/app-store']})
		root = createRoot(container)
		await act(async () => root.render(<RouterProvider router={router} />))
	})

	afterEach(async () => {
		await act(async () => root.unmount())
		container.remove()
	})

	test('writes the typed query to the URL', async () => {
		await act(async () => probe.setQuery('ra'))
		expect(router.state.location.search).toBe('?q=ra')
	})

	test('keeps the typed query when an earlier write of its own echoes back late', async () => {
		await act(async () => probe.setQuery('ra'))
		// The hook writes with replace; a write for "r" that lands after "ra" looks like this
		await act(async () => router.navigate('/app-store?q=r', {replace: true}))
		expect(probe.query).toBe('ra')
	})

	test('adopts a query handed in by a push, like Cmd+K', async () => {
		await act(async () => probe.setQuery('ra'))
		await act(async () => router.navigate('/app-store?q=plex'))
		expect(probe.query).toBe('plex')
	})
})
