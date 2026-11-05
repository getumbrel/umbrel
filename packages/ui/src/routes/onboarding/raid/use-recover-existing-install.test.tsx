// @vitest-environment jsdom
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {TRPCClientError, type TRPCLink} from '@trpc/client'
import {observable} from '@trpc/server/observable'
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {trpcReact} from '@/trpc/trpc'

import type {AppRouter} from '../../../../../umbreld/source/modules/server/trpc/common'
import {useRecoverExistingInstall} from './use-recover-existing-install'
import {STORAGE_WAIT_NOTICE_DELAY_MS} from './use-storage-wait'

vi.mock('@/trpc/trpc', async () => {
	const {createTRPCReact} = await import('@trpc/react-query')
	return {trpcReact: createTRPCReact()}
})
vi.mock('@/providers/global-system-state/index', () => ({useGlobalSystemState: () => ({suppressErrors: () => {}})}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let queryClient: QueryClient
let result: ReturnType<typeof useRecoverExistingInstall>
let outcome: 'accepted' | 'lost' | 'failed' | 'pending'
let serverState: 'running' | 'restarting' | 'offline'
let userExists: boolean
let mountFailed: boolean
let destination: {href: string}
let writes: number
let reads: number
let resolveRecovery: (accepted: boolean) => void
function Harness() {
	result = useRecoverExistingInstall()
	return null
}

beforeEach(() => {
	vi.useFakeTimers()
	root = createRoot(document.createElement('div'))
	queryClient = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}})
	outcome = 'accepted'
	serverState = 'restarting'
	userExists = false
	mountFailed = false
	destination = {href: '/onboarding/raid/setup'}
	const testWindow = Object.create(window)
	Object.defineProperty(testWindow, 'location', {value: destination})
	vi.stubGlobal('window', testWindow)
	writes = 0
	reads = 0
})
afterEach(() => {
	act(() => root.unmount())
	queryClient.clear()
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

async function mount() {
	const link: TRPCLink<AppRouter> =
		() =>
		({op}) =>
			observable((observer) => {
				if (op.type === 'mutation') {
					writes++
					if (outcome === 'pending') {
						resolveRecovery = (accepted) => {
							observer.next({result: {data: accepted}})
							observer.complete()
						}
						return
					}
					if (outcome === 'lost') {
						observer.error(TRPCClientError.from(new TypeError('Failed to fetch')))
						return
					}
					observer.next({result: {data: outcome === 'accepted'}})
				} else {
					reads++
					if (serverState === 'offline') {
						observer.error(TRPCClientError.from(new TypeError('Failed to fetch')))
						return
					}
					const responses: Record<string, unknown> = {
						'system.status': serverState,
						'user.exists': userExists,
						'hardware.raid.checkRaidMountFailure': mountFailed,
					}
					if (!(op.path in responses)) throw new Error(`Unsupported query: ${op.path}`)
					observer.next({result: {data: responses[op.path]}})
				}
				observer.complete()
			})
	const client = trpcReact.createClient({links: [link]})
	await act(async () =>
		root.render(
			<trpcReact.Provider client={client} queryClient={queryClient}>
				<QueryClientProvider client={queryClient}>
					<Harness />
				</QueryClientProvider>
			</trpcReact.Provider>,
		),
	)
}

test('reconciles an accepted restore using the provider client and offers prolonged-wait help', async () => {
	await mount()
	await act(async () => {
		await result.handleRestore()
	})
	expect(result.restoreFailed).toBe(false)
	expect(reads).toBeGreaterThan(0)
	await act(async () => {
		await vi.advanceTimersByTimeAsync(STORAGE_WAIT_NOTICE_DELAY_MS)
	})
	expect(result.showWaitNotice).toBe(true)
	await act(async () => {
		await result.handleRestore()
		await result.checkStatus()
	})
	expect(writes).toBe(1)
})

test('recovery counts from the click and a definite failure gives the next attempt its own timer', async () => {
	outcome = 'pending'
	await mount()
	await act(async () => {
		void result.handleRestore()
	})
	await act(async () => {
		await vi.advanceTimersByTimeAsync(STORAGE_WAIT_NOTICE_DELAY_MS - 1)
	})
	expect(result.showWaitNotice).toBe(false)
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1)
	})
	expect(result.showWaitNotice).toBe(true)
	await act(async () => resolveRecovery(false))
	expect(result.restoreFailed).toBe(true)
	expect(result.showWaitNotice).toBe(false)
	await act(async () => {
		void result.handleRestore()
	})
	expect(result.showWaitNotice).toBe(false)
	await act(async () => {
		await vi.advanceTimersByTimeAsync(120_000)
		resolveRecovery(true)
	})
	await act(async () => {
		await vi.advanceTimersByTimeAsync(STORAGE_WAIT_NOTICE_DELAY_MS - 120_000 - 1)
	})
	expect(result.showWaitNotice).toBe(false)
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1)
	})
	expect(result.showWaitNotice).toBe(true)
	expect(writes).toBe(2)
})

test('running without a restored account cannot resolve a lost response or enable retry', async () => {
	outcome = 'lost'
	serverState = 'running'
	await mount()
	await act(async () => {
		await result.handleRestore()
	})
	expect(result.outcomeUnknown).toBe(true)
	expect(destination.href).toBe('/onboarding/raid/setup')
	expect(result.restoreFailed).toBe(false)
	await act(async () => {
		await vi.advanceTimersByTimeAsync(6_000)
		await result.handleRestore()
	})
	expect(writes).toBe(1)
	expect(result.restoreFailed).toBe(false)
})

test('a definite rejection permits one explicit retry', async () => {
	outcome = 'failed'
	await mount()
	await act(async () => {
		await result.handleRestore()
	})
	expect(result.restoreFailed).toBe(true)
	outcome = 'accepted'
	await act(async () => {
		await result.handleRestore()
	})
	expect(result.restoreFailed).toBe(false)
	expect(writes).toBe(2)
})

test('rapid clicks and a status check do not duplicate or fail a pending request', async () => {
	outcome = 'pending'
	serverState = 'running'
	await mount()
	await act(async () => {
		void result.handleRestore()
		void result.handleRestore()
	})
	await act(async () => {
		await result.checkStatus()
	})
	expect(writes).toBe(1)
	expect(result.restoreFailed).toBe(false)
	expect(result.restoreRequested).toBe(true)
})

test('an accepted restore waits through restarting and offline before returning to the router', async () => {
	await mount()
	await act(async () => {
		await result.handleRestore()
	})
	expect(destination.href).toBe('/onboarding/raid/setup')
	serverState = 'offline'
	await act(async () => {
		await result.checkStatus()
	})
	expect(result.restoreFailed).toBe(false)
	expect(destination.href).toBe('/onboarding/raid/setup')
	serverState = 'running'
	await act(async () => {
		await result.checkStatus()
	})
	expect(destination.href).toBe('/')
	expect(writes).toBe(1)
})

test.each(['account', 'mount failure'] as const)('a lost response can resolve after observing %s', async (evidence) => {
	outcome = 'lost'
	serverState = 'running'
	await mount()
	await act(async () => {
		await result.handleRestore()
	})
	expect(destination.href).toBe('/onboarding/raid/setup')
	userExists = evidence === 'account'
	mountFailed = evidence === 'mount failure'
	await act(async () => {
		await result.checkStatus()
	})
	expect(destination.href).toBe('/')
	expect(writes).toBe(1)
})

test('a lost response can observe the existing restart lifecycle without repeating recovery', async () => {
	outcome = 'lost'
	serverState = 'running'
	await mount()
	await act(async () => {
		await result.handleRestore()
	})
	serverState = 'restarting'
	await act(async () => {
		await result.checkStatus()
	})
	expect(result.outcomeUnknown).toBe(false)
	expect(destination.href).toBe('/onboarding/raid/setup')
	serverState = 'running'
	await act(async () => {
		await result.checkStatus()
	})
	expect(destination.href).toBe('/')
	expect(writes).toBe(1)
})
