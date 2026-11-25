// @vitest-environment jsdom

import {QueryClient, QueryClientProvider, useQuery} from '@tanstack/react-query'
import {act, ReactNode} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {LOADING_DASH} from '@/constants'

import {Widget} from '.'

const mocks = vi.hoisted(() => ({
	// Whether a refresh gets its answer
	answering: true,
	// The storage in use, as the device would report it
	used: '256 GB',
}))

vi.mock('react-i18next', async (importOriginal) => ({
	...(await importOriginal<typeof import('react-i18next')>()),
	useTranslation: () => ({t: (key: string) => key}),
}))

vi.mock('@/providers/apps', () => ({
	useApps: () => ({userAppsKeyed: {}, systemAppsKeyed: {}, isLoading: false}),
}))

vi.mock('@/hooks/use-launch-app', () => ({useLaunchApp: () => vi.fn()}))

// The glass a widget is drawn on needs WebGL and the wallpaper
vi.mock('@/components/ui/glass', () => ({Glass: ({children}: {children: ReactNode}) => <div>{children}</div>}))
vi.mock('@/components/ui/tilt', () => ({useTilt: () => ({})}))
vi.mock('@/providers/wallpaper', () => ({useWallpaper: () => ({staticWallpaperImgRef: {current: null}})}))

// The real query, asking a device that answers or doesn't
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		widget: {
			data: {
				useQuery: (input: {widgetId: string}, options: object) =>
					useQuery({
						queryKey: ['widget.data', input],
						queryFn: async () => {
							if (!mocks.answering) throw new Error('WebSocket closed')
							return {type: 'text-with-progress', title: 'Storage', text: mocks.used, progress: 0.25}
						},
						...options,
					}),
			},
		},
	},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const SECOND = 1000
const MINUTE = 60 * SECOND

describe('Widget', () => {
	let container: HTMLDivElement
	let root: ReturnType<typeof createRoot>
	let queryClient: QueryClient

	// The value the widget shows, or the dashes of a widget with no values to show
	function shown() {
		const text = container.textContent ?? ''
		return text.match(/\d+ GB/)?.[0] ?? (text.includes(LOADING_DASH) ? 'dashes' : 'nothing')
	}

	async function advance(ms: number) {
		await act(async () => {
			await vi.advanceTimersByTimeAsync(ms)
		})
	}

	// Lets time pass, and returns each change in what the widget shows with the second it happened in
	async function watch(ms: number) {
		const changes: [second: number, shown: string][] = []
		let last = shown()
		for (let elapsed = 100; elapsed <= ms; elapsed += 100) {
			await advance(100)
			if (shown() !== last) {
				last = shown()
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

	// The storage widget, which refreshes every 10 seconds
	async function open() {
		await act(async () => {
			root.render(
				<QueryClientProvider client={queryClient}>
					<MemoryRouter>
						<Widget
							appId='live-usage'
							config={{id: 'umbrel:storage', type: 'text-with-progress', refresh: 10 * SECOND}}
						/>
					</MemoryRouter>
				</QueryClientProvider>,
			)
		})
	}

	// A tab that has been open for a while, as tabs are
	async function openForAWhile() {
		await open()
		await advance(MINUTE)
		expect(shown()).toBe('256 GB')
	}

	beforeEach(async () => {
		vi.useFakeTimers()
		mocks.answering = true
		mocks.used = '256 GB'
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

	// The connection drops while the tab is away, so the refresh sent on returning to it fails
	test('keeps its values when a refresh fails, and tries again', async () => {
		await openForAWhile()
		await setTabHidden(true)
		await advance(5 * MINUTE)

		mocks.answering = false
		await setTabHidden(false)
		expect(await watch(SECOND / 2)).toEqual([])

		mocks.answering = true
		mocks.used = '257 GB'
		expect(await watch(MINUTE)).toEqual([[0, '257 GB']])
	})

	test('shows dashes once a refresh and its 3 retries have failed, until one works', async () => {
		await openForAWhile()

		// The next refresh is 10 seconds away, and is tried again after 1, 2 and 4 seconds
		mocks.answering = false
		expect(await watch(MINUTE)).toEqual([[17, 'dashes']])

		mocks.answering = true
		expect(await watch(MINUTE)).toEqual([[1, '256 GB']])
	})
})
