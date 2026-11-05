// @vitest-environment jsdom
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {TRPCClientError, type TRPCLink} from '@trpc/client'
import {observable} from '@trpc/server/observable'
import {act, useState} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {trpcReact} from '@/trpc/trpc'

import type {AppRouter} from '../../../../umbreld/source/modules/server/trpc/common'
import StorageManagerDialog from './index'

vi.mock('@/trpc/trpc', async () => {
	const {createTRPCReact} = await import('@trpc/react-query')
	return {trpcReact: createTRPCReact()}
})
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/features/storage/components/list-manager', () => ({ListStorageManager: RepairFlow}))
vi.mock('@/features/storage/components/storage-unavailable', () => ({StorageUnavailable: () => <div>unavailable</div>}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key, maybeT: (key: string) => key}))
vi.mock('@/components/ui/toast', () => ({toast: {error: vi.fn()}}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function RepairFlow() {
	const [open, setOpen] = useState(false)
	return <button onClick={() => setOpen(true)}>{open ? 'repair open' : 'open repair'}</button>
}
let host: HTMLDivElement
let root: Root
let cache: QueryClient
let failedQuery: string | undefined
let unavailable: boolean
let reads: string[]
const queryNames = ['hardware.umbrelPro.isUmbrelPro', 'hardware.raid.getStatus', 'hardware.internalStorage.getDevices']

beforeEach(() => {
	vi.useFakeTimers()
	host = document.createElement('div')
	root = createRoot(host)
	cache = new QueryClient({defaultOptions: {queries: {retry: false}}})
	failedQuery = undefined
	unavailable = false
	reads = []
})
afterEach(() => {
	act(() => root.unmount())
	cache.clear()
	vi.useRealTimers()
})
async function flush() {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(100)
	})
}
async function mount() {
	const link: TRPCLink<AppRouter> =
		() =>
		({op}) =>
			observable((observer) => {
				reads.push(op.path)
				if (failedQuery === op.path) {
					observer.error(TRPCClientError.from(new TypeError('Failed to fetch')))
					return
				}
				const responses: Record<string, unknown> = {
					'hardware.umbrelPro.isUmbrelPro': false,
					'hardware.raid.getStatus': {
						exists: true,
						status: unavailable ? 'UNAVAIL' : 'ONLINE',
						topology: 'mirror',
						devices: [{id: 'disk-A'}],
					},
					'hardware.internalStorage.getDevices': [{id: 'disk-A', type: 'hdd'}],
				}
				observer.next({result: {data: responses[op.path]}})
				observer.complete()
			})
	const client = trpcReact.createClient({links: [link]})
	await act(async () =>
		root.render(
			<trpcReact.Provider client={client} queryClient={cache}>
				<QueryClientProvider client={cache}>
					<StorageManagerDialog />
				</QueryClientProvider>
			</trpcReact.Provider>,
		),
	)
	await flush()
}

test.each(queryNames)('preserves an open repair flow when %s fails on refresh', async (path) => {
	await mount()
	await act(async () => host.querySelector('button')!.click())
	failedQuery = path
	await act(async () => {
		await cache.refetchQueries()
	})
	await flush()
	expect(reads.filter((name) => name === path)).toHaveLength(2)
	expect(host.textContent).toBe('repair open')
})

test.each(queryNames)('still blocks initial %s errors without cached data', async (path) => {
	failedQuery = path
	await mount()
	expect(host.textContent).toBe('unavailable')
})

test('a freshly confirmed unavailable pool replaces the manager', async () => {
	await mount()
	await act(async () => host.querySelector('button')!.click())
	unavailable = true
	await act(async () => {
		await cache.refetchQueries()
	})
	await flush()
	expect(host.textContent).toBe('unavailable')
})
