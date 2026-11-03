// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {createMemoryRouter, RouterProvider} from 'react-router-dom'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'

import {CmdkProvider, useCmdkOpen} from './cmdk'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const probe = {} as ReturnType<typeof useCmdkOpen>

function Probe() {
	const cmdk = useCmdkOpen()
	probe.open = cmdk.open
	probe.setOpen = cmdk.setOpen
	return null
}

describe('Cmd+K palette', () => {
	let container: HTMLDivElement
	let root: ReturnType<typeof createRoot>
	let router: ReturnType<typeof createMemoryRouter>

	beforeEach(async () => {
		container = document.createElement('div')
		document.body.appendChild(container)
		// Like the app, the provider sits on the parent route and stays mounted as children change
		router = createMemoryRouter(
			[
				{
					path: '/',
					element: (
						<CmdkProvider>
							<Probe />
						</CmdkProvider>
					),
					children: [{path: 'app-store'}],
				},
			],
			{initialEntries: ['/']},
		)
		root = createRoot(container)
		await act(async () => root.render(<RouterProvider router={router} />))
	})

	afterEach(async () => {
		await act(async () => root.unmount())
		container.remove()
	})

	test('closes when back or forward moves the page under it', async () => {
		await act(async () => router.navigate('/app-store'))
		await act(async () => probe.setOpen(true))
		await act(async () => router.navigate(-1))
		expect(router.state.location.pathname).toBe('/')
		expect(probe.open).toBe(false)
	})

	test('stays open through a push of its own', async () => {
		await act(async () => probe.setOpen(true))
		await act(async () => router.navigate('/app-store'))
		expect(probe.open).toBe(true)
	})
})
