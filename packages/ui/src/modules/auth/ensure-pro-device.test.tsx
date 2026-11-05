// @vitest-environment jsdom
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {TRPCClientError, type TRPCLink} from '@trpc/client'
import {observable} from '@trpc/server/observable'
import {act, useState} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {trpcReact} from '@/trpc/trpc'

import type {AppRouter} from '../../../../umbreld/source/modules/server/trpc/common'
import {EnsureProDevice} from './ensure-pro-device'

vi.mock('@/trpc/trpc', async () => {
	const {createTRPCReact} = await import('@trpc/react-query')
	return {trpcReact: createTRPCReact()}
})
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
vi.mock('@/layouts/bare/shared', () => ({primaryButtonProps: {}}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
let queryClient: QueryClient
let productName: string
let unavailable: boolean
let userExists: boolean
let queriedPaths: string[]

function Setup() {
	const [started, setStarted] = useState(false)
	return <button onClick={() => setStarted(true)}>{started ? 'setup-started' : 'start-setup'}</button>
}

beforeEach(() => {
	vi.useFakeTimers()
	host = document.createElement('div')
	root = createRoot(host)
	queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
	productName = 'Umbrel Pro'
	unavailable = false
	userExists = false
	queriedPaths = []
})

afterEach(() => {
	act(() => root.unmount())
	queryClient.clear()
	vi.useRealTimers()
})

async function settle() {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(100)
	})
}

async function mount() {
	const link: TRPCLink<AppRouter> =
		() =>
		({op}) =>
			observable((observer) => {
				queriedPaths.push(op.path)
				// Device identity is available before registration; owner-only queries are not.
				if (userExists || op.path !== 'systemNg.device.getIdentity') {
					observer.error(
						TRPCClientError.from({
							error: {message: 'Invalid token', code: -32001, data: {code: 'UNAUTHORIZED', httpStatus: 401}},
						}),
					)
					return
				}
				if (unavailable) {
					observer.error(TRPCClientError.from(new TypeError('Failed to fetch')))
					return
				}
				observer.next({result: {data: {productName}}})
				observer.complete()
			})
	const client = trpcReact.createClient({links: [link]})
	await act(async () =>
		root.render(
			<trpcReact.Provider client={client} queryClient={queryClient}>
				<QueryClientProvider client={queryClient}>
					<MemoryRouter initialEntries={['/onboarding/raid/setup']}>
						<Routes>
							<Route path='/' element={<div>home</div>} />
							<Route
								path='/onboarding/raid/setup'
								element={
									<EnsureProDevice>
										<Setup />
									</EnsureProDevice>
								}
							/>
						</Routes>
					</MemoryRouter>
				</QueryClientProvider>
			</trpcReact.Provider>,
		),
	)
	await settle()
}

test('allows Pro setup before an owner token exists', async () => {
	await mount()
	expect(host.textContent).toBe('start-setup')
	expect(queriedPaths).toEqual(['systemNg.device.getIdentity'])
})

test('redirects other hardware away from Pro setup', async () => {
	productName = 'Umbrel Home'
	await mount()
	expect(host.textContent).toBe('home')
})

test('redirects a fresh setup page to the login route after registration', async () => {
	userExists = true
	await mount()
	expect(host.textContent).toBe('home')
})

test('offers a working retry when the initial identity read fails', async () => {
	unavailable = true
	await mount()
	expect(host.textContent).toContain('storage-status.check-failed')
	expect(host.textContent).not.toContain('start-setup')
	unavailable = false
	await act(async () => host.querySelector('button')!.click())
	await settle()
	expect(host.textContent).toBe('start-setup')
})

test.each(['offline', 'registered'])('preserves active setup when the backend is %s', async (state) => {
	await mount()
	await act(async () => host.querySelector('button')!.click())
	expect(host.textContent).toBe('setup-started')
	unavailable = state === 'offline'
	userExists = state === 'registered'
	await act(async () => {
		await queryClient.invalidateQueries()
	})
	await settle()
	expect(queryClient.getQueryCache().getAll()[0].state.status).toBe('error')
	expect(host.textContent).toBe('setup-started')
})
