// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {GlobalDialogs, prefetchGlobalDialog} from './global-dialogs'

const fixtures = vi.hoisted(() => ({role: 'owner', loaded: [] as string[]}))

vi.mock('@/trpc/trpc', () => ({
	trpcReact: {user: {get: {useQuery: () => ({data: {role: fixtures.role}})}}},
}))
vi.mock('@/routes/settings/troubleshoot', () => {
	fixtures.loaded.push('troubleshoot')
	return {default: () => <div data-dialog='troubleshoot' />}
})
vi.mock('@/routes/live-usage', () => ({default: () => <div data-dialog='live-usage' />}))
vi.mock('@/routes/settings/terminal', () => {
	fixtures.loaded.push('terminal')
	return {default: () => <div data-dialog='terminal' />}
})
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
	fixtures.role = 'owner'
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
})

afterEach(() => {
	act(() => root.unmount())
	container.remove()
})

async function renderAt(url: string) {
	await act(async () =>
		root.render(
			<MemoryRouter key={url} initialEntries={[url]} future={{v7_startTransition: true, v7_relativeSplatPath: true}}>
				<GlobalDialogs />
			</MemoryRouter>,
		),
	)
	return [...container.querySelectorAll('[data-dialog]')].map((dialog) => dialog.getAttribute('data-dialog'))
}

// In order: a module loads once, so what has loaded by each step is the assertion
describe('GlobalDialogs', () => {
	it('loads a dialog when it first holds the slot, and mounts it only while it does', async () => {
		expect(await renderAt('/files/Home?sort=name')).toEqual([])
		expect(await renderAt('/files/Home?dialog=files-share-info')).toEqual([])
		expect(fixtures.loaded).toEqual([])

		expect(await renderAt('/files/Home?dialog=terminal&app=bitcoin')).toEqual(['terminal'])
		expect(fixtures.loaded).toEqual(['terminal'])
	})

	it('prefetches a dialog without mounting it', async () => {
		await act(async () => prefetchGlobalDialog('troubleshoot'))
		expect(fixtures.loaded).toEqual(['terminal', 'troubleshoot'])
		expect(await renderAt('/')).toEqual([])

		expect(await renderAt('/?dialog=troubleshoot')).toEqual(['troubleshoot'])
	})

	it('keeps the owner-only dialogs, and only those, from members', async () => {
		fixtures.role = 'member'

		expect(await renderAt('/?dialog=terminal')).toEqual([])
		expect(await renderAt('/?dialog=troubleshoot&app=bitcoin')).toEqual([])
		expect(await renderAt('/?dialog=live-usage')).toEqual(['live-usage'])
	})
})
