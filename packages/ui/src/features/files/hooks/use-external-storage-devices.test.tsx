// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import type {TRPCLink} from '@trpc/client'
import {observable} from '@trpc/server/observable'
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {trpcReact} from '@/trpc/trpc'

import type {AppRouter} from '../../../../../umbreld/source/modules/server/trpc/common'
import {useExternalStorageDevices} from './use-external-storage-devices'

vi.mock('@/trpc/trpc', async () => {
	const {createTRPCReact} = await import('@trpc/react-query')
	return {trpcReact: createTRPCReact()}
})
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
let queryClient: QueryClient
let inventory: {id: string}[]
let reads: number
let notifyChange: (() => void) | undefined
let result: ReturnType<typeof useExternalStorageDevices>

function Harness() {
	result = useExternalStorageDevices()
	return null
}

beforeEach(() => {
	vi.useFakeTimers()
	host = document.createElement('div')
	root = createRoot(host)
	queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
	inventory = []
	reads = 0
	notifyChange = undefined
})

afterEach(() => {
	act(() => root.unmount())
	queryClient.clear()
	vi.useRealTimers()
})

async function mount(role = 'owner') {
	// Preload identity just as the signed-in app does, to exercise member gating.
	queryClient.setQueryData([['user', 'get'], {type: 'query'}], {role})
	const link: TRPCLink<AppRouter> =
		() =>
		({op}) =>
			observable((observer) => {
				if (op.type === 'subscription') {
					notifyChange = () => observer.next({result: {data: {}}})
					return () => {
						notifyChange = undefined
					}
				}
				if (op.path === 'files.externalDevices') reads++
				observer.next({result: {data: op.path === 'user.get' ? {role} : structuredClone(inventory)}})
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
	await act(async () => {
		await vi.advanceTimersByTimeAsync(50)
	})
}

test('refreshes after USB mount events and cleans up its subscription', async () => {
	await mount()
	expect(result.data).toEqual([])
	inventory = [{id: 'usb-backup'}]
	await act(async () => {
		notifyChange!()
		await vi.advanceTimersByTimeAsync(50)
	})
	expect(result.data).toEqual(inventory)
	inventory = []
	await act(async () => {
		notifyChange!()
		await vi.advanceTimersByTimeAsync(50)
	})
	expect(result.data).toEqual([])
	act(() => root.render(null))
	expect(notifyChange).toBeUndefined()
})

test('polls for unplugging and missed connection events', async () => {
	inventory = [{id: 'usb-backup'}]
	await mount()
	expect(result.data).toEqual(inventory)
	inventory = []
	await act(async () => {
		await vi.advanceTimersByTimeAsync(5100)
	})
	expect(result.data).toEqual([])
	inventory = [{id: 'usb-media'}]
	await act(async () => {
		await vi.advanceTimersByTimeAsync(30_100)
	})
	expect(result.data).toEqual(inventory)
})

test('does not query or subscribe for a member account', async () => {
	await mount('member')
	expect(reads).toBe(0)
	expect(notifyChange).toBeUndefined()
})
