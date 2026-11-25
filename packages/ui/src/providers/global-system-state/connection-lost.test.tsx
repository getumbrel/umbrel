// @vitest-environment jsdom

import {QueryClient, QueryClientProvider, useQuery} from '@tanstack/react-query'
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {EnsureLoggedIn} from '@/modules/auth/ensure-logged-in'

import {GlobalSystemStateProvider} from '.'

// Whether a request from this browser gets through to the device
const device = vi.hoisted(() => ({reachable: true}))

vi.mock('react-i18next', async (importOriginal) => ({
	...(await importOriginal<typeof import('react-i18next')>()),
	useTranslation: () => ({t: (key: string) => key}),
}))

vi.mock('@/modules/auth/redirects', () => ({
	RedirectLogin: () => <div>redirect-login</div>,
	RedirectHome: () => <div>redirect-home</div>,
}))

// The real queries, asking a device that answers or doesn't
vi.mock('@/trpc/trpc', () => {
	const query = <T,>(key: string, answer: T) => ({
		useQuery: (_input: unknown, options: object = {}) =>
			useQuery({
				queryKey: [key],
				queryFn: async () => {
					if (!device.reachable) throw new TypeError('Failed to fetch')
					return answer
				},
				...options,
			}),
	})
	const mutation = {useMutation: () => ({mutate: () => {}})}

	return {
		trpcReact: {
			useUtils: () => ({system: {status: {cancel: () => {}}}}),
			system: {
				status: query('system.status', 'running'),
				restart: mutation,
				shutdown: mutation,
				factoryReset: mutation,
			},
			update: {install: mutation},
			migration: {migrate: mutation},
			backups: {restoreStatus: query('backups.restoreStatus', null)},
			user: {isLoggedIn: query('user.isLoggedIn', true)},
		},
	}
})
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const SECOND = 1000
const MINUTE = 60 * SECOND

describe('GlobalSystemStateProvider connection lost', () => {
	let container: HTMLDivElement
	let root: ReturnType<typeof createRoot>
	let queryClient: QueryClient

	// Covers are drawn in a portal on the body, so read the whole page
	function screen() {
		const text = document.body.textContent ?? ''
		if (text.includes('connection-lost')) return 'connection lost'
		if (text.includes('Live app')) return 'dashboard'
		return 'loading'
	}

	async function advance(ms: number) {
		await act(async () => {
			await vi.advanceTimersByTimeAsync(ms)
		})
	}

	// Lets time pass, and returns each change of screen with the second it happened in
	async function watch(ms: number) {
		const changes: [second: number, screen: string][] = []
		let last = screen()
		for (let elapsed = 100; elapsed <= ms; elapsed += 100) {
			await advance(100)
			if (screen() !== last) {
				last = screen()
				changes.push([Math.floor(elapsed / SECOND), last])
			}
		}
		return changes
	}

	async function setTabHidden(hidden: boolean) {
		Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => (hidden ? 'hidden' : 'visible')})
		await act(async () => {
			document.dispatchEvent(new Event('visibilitychange', {bubbles: true}))
		})
	}

	async function open() {
		await act(async () => {
			root.render(
				<QueryClientProvider client={queryClient}>
					<GlobalSystemStateProvider>
						<EnsureLoggedIn>Live app</EnsureLoggedIn>
					</GlobalSystemStateProvider>
				</QueryClientProvider>,
			)
		})
	}

	// A tab that has been open for a while, then left for another
	async function openAndLeave() {
		await open()
		await advance(10 * MINUTE)
		expect(screen()).toBe('dashboard')
		await setTabHidden(true)
		await advance(5 * MINUTE)
	}

	beforeEach(async () => {
		vi.useFakeTimers()
		localStorage.clear()
		device.reachable = true
		await setTabHidden(false)
		// Same defaults as the app's client (trpc/query-client.ts)
		queryClient = new QueryClient({defaultOptions: {queries: {staleTime: MINUTE}}})
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => root.unmount())
		container.remove()
		queryClient.clear()
		vi.useRealTimers()
	})

	// A laptop that wakes up needs a few seconds to rejoin its network, and requests fail until then
	test('keeps the dashboard while the network comes back on returning to the tab', async () => {
		await openAndLeave()

		device.reachable = false
		await setTabHidden(false)
		expect(await watch(8 * SECOND)).toEqual([])

		device.reachable = true
		expect(await watch(MINUTE)).toEqual([])
	})

	test('reports a device that has not answered for 15 seconds, and returns once it does', async () => {
		await openAndLeave()

		device.reachable = false
		await setTabHidden(false)
		expect(await watch(MINUTE)).toEqual([[15, 'connection lost']])

		device.reachable = true
		expect(await watch(MINUTE)).toEqual([[1, 'dashboard']])
	})

	test('counts only the time the tab is in view, from each return to it', async () => {
		await openAndLeave()

		device.reachable = false
		await setTabHidden(false)
		expect(await watch(10 * SECOND)).toEqual([])

		await setTabHidden(true)
		expect(await watch(MINUTE)).toEqual([])

		await setTabHidden(false)
		expect(await watch(MINUTE)).toEqual([[15, 'connection lost']])
	})

	test('stays lost when the tab is left and returned to', async () => {
		await openAndLeave()
		device.reachable = false
		await setTabHidden(false)
		await advance(MINUTE)
		expect(screen()).toBe('connection lost')

		await setTabHidden(true)
		expect(await watch(MINUTE)).toEqual([])
		await setTabHidden(false)
		expect(await watch(MINUTE)).toEqual([])
	})

	test('reports a device that has never answered', async () => {
		device.reachable = false
		await open()
		expect(screen()).toBe('loading')
		expect(await watch(MINUTE)).toEqual([[15, 'connection lost']])

		device.reachable = true
		expect(await watch(MINUTE)).toEqual([[1, 'dashboard']])
	})
})
