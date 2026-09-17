// @vitest-environment jsdom

import {
	QueryClient,
	QueryClientProvider,
	QueryObserver,
	type InvalidateOptions,
	type InvalidateQueryFilters,
} from '@tanstack/react-query'
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'

import {ITEMS_LIST_KEY} from '@/features/photos/hooks/use-items'
import {usePhotosEvents} from '@/features/photos/hooks/use-photos-events'

type SubscriptionOptions = {
	onStarted?: () => void
	onData: (data: unknown) => void
}

const mocks = vi.hoisted(() => ({
	subscriptions: new Map<string, SubscriptionOptions>(),
	invalidateSummary: vi.fn(),
	invalidateSources: vi.fn(),
	invalidateAlbums: vi.fn(),
}))

// Keep the real query cache so these tests exercise refetching, staleness,
// and cancellation rather than only checking calls to the tRPC utilities.
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		useUtils: () => ({
			photos: {
				library: {summary: {invalidate: mocks.invalidateSummary}},
				sources: {invalidate: mocks.invalidateSources},
				albums: {invalidate: mocks.invalidateAlbums},
				items: {
					get: {
						cancel: () => queryClient.cancelQueries({queryKey: ITEM_DETAIL_KEY}),
						invalidate: (_input?: unknown, filters?: InvalidateQueryFilters, options?: InvalidateOptions) =>
							queryClient.invalidateQueries({...filters, queryKey: ITEM_DETAIL_KEY}, options),
					},
				},
			},
		}),
		eventBus: {
			listen: {
				useSubscription: ({event}: {event: string}, options: SubscriptionOptions) => {
					mocks.subscriptions.set(event, options)
				},
			},
		},
	},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let queryClient: QueryClient
const unsubscribeQueries: Array<() => void> = []
const ITEM_DETAIL_KEY = [['photos', 'items', 'get']] as const
const itemKey = (id: string) => [...ITEM_DETAIL_KEY, {input: {id, deleted: false}, type: 'query'}] as const

function observeItem(id: string, queryFn: () => Promise<{fileName: string}>) {
	const observer = new QueryObserver(queryClient, {queryKey: itemKey(id), queryFn})
	unsubscribeQueries.push(observer.subscribe(() => {}))
	return observer
}

async function startSubscription() {
	await act(async () => {
		mocks.subscriptions.get('photos:change')!.onStarted?.()
	})
}

function Harness() {
	usePhotosEvents()
	return null
}

beforeEach(() => {
	vi.useFakeTimers()
	queryClient = new QueryClient({defaultOptions: {queries: {staleTime: 60_000, retry: false, gcTime: Infinity}}})
	const container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	act(() =>
		root.render(
			<QueryClientProvider client={queryClient}>
				<Harness />
			</QueryClientProvider>,
		),
	)
})

afterEach(() => {
	act(() => root.unmount())
	for (const unsubscribe of unsubscribeQueries.splice(0)) unsubscribe()
	queryClient.clear()
	document.body.replaceChildren()
	mocks.subscriptions.clear()
	vi.useRealTimers()
	vi.clearAllMocks()
})

it('refreshes an open cached photo on return and on subscription reconnect', async () => {
	queryClient.setQueryData(itemKey('photo'), {fileName: 'before.jpg'})
	const readItem = vi.fn(async () => ({fileName: 'renamed.jpg'}))
	const observer = observeItem('photo', readItem)
	expect(readItem).not.toHaveBeenCalled()

	await startSubscription()
	expect(observer.getCurrentResult().data).toEqual({fileName: 'renamed.jpg'})
	expect(readItem).toHaveBeenCalledOnce()

	readItem.mockResolvedValue({fileName: 'renamed-again.jpg'})
	await startSubscription()
	expect(observer.getCurrentResult().data).toEqual({fileName: 'renamed-again.jpg'})
	expect(readItem).toHaveBeenCalledTimes(2)
})

it('marks closed photo details stale on return without refreshing timeline pages', async () => {
	queryClient.setQueryData(itemKey('photo'), {fileName: 'before.jpg'})
	queryClient.setQueryData(itemKey('neighbor'), {fileName: 'neighbor.jpg'})
	const lists = [1, 4].map((pageCount) => {
		const queryKey = [...ITEMS_LIST_KEY, {input: {limit: pageCount}, type: 'infinite'}]
		const data = {pages: Array.from({length: pageCount}, () => ({items: []})), pageParams: []}
		queryClient.setQueryData(queryKey, data)
		const queryFn = vi.fn(async () => data)
		const observer = new QueryObserver(queryClient, {queryKey, queryFn})
		unsubscribeQueries.push(observer.subscribe(() => {}))
		return {queryKey, read: queryFn}
	})

	await startSubscription()
	await act(async () => {
		vi.advanceTimersByTime(1000)
	})
	expect(queryClient.isFetching()).toBe(0)
	expect(queryClient.getQueryState(itemKey('photo'))?.isInvalidated).toBe(true)
	expect(queryClient.getQueryState(itemKey('neighbor'))?.isInvalidated).toBe(true)
	expect(mocks.invalidateSummary).not.toHaveBeenCalled()
	expect(mocks.invalidateSources).not.toHaveBeenCalled()
	expect(mocks.invalidateAlbums).not.toHaveBeenCalled()
	for (const {queryKey, read} of lists) {
		expect(read).not.toHaveBeenCalled()
		expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false)
	}

	const readItem = vi.fn(async () => ({fileName: 'renamed.jpg'}))
	const observer = observeItem('photo', readItem)
	await act(async () => {})
	expect(observer.getCurrentResult().data).toEqual({fileName: 'renamed.jpg'})
	expect(readItem).toHaveBeenCalledOnce()

	// Reopening the same photo within this Photos visit still uses fresh cached details.
	observer.setOptions({queryKey: itemKey(''), enabled: false})
	observer.setOptions({queryKey: itemKey('photo'), queryFn: readItem})
	expect(readItem).toHaveBeenCalledOnce()
})

it('picks up an index update that finishes after returning to Photos', async () => {
	queryClient.setQueryData(itemKey('photo'), {fileName: 'before.jpg'})
	const readItem = vi.fn(async () => ({fileName: 'before.jpg'}))
	const observer = observeItem('photo', readItem)
	await startSubscription()
	expect(readItem).toHaveBeenCalledOnce()

	readItem.mockResolvedValue({fileName: 'renamed.jpg'})
	await act(async () => {
		mocks.subscriptions.get('photos:change')!.onData({accountIds: ['Alice']})
		vi.advanceTimersByTime(1000)
	})
	expect(observer.getCurrentResult().data).toEqual({fileName: 'renamed.jpg'})
	expect(readItem).toHaveBeenCalledTimes(2)
})

it('restarts a cold detail request begun before subscription start and ignores its late response', async () => {
	let resolveOld!: (data: {fileName: string}) => void
	const readItem = vi
		.fn(async () => ({fileName: 'renamed.jpg'}))
		.mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)))
	const observer = observeItem('photo', readItem)
	expect(readItem).toHaveBeenCalledOnce()

	await startSubscription()
	expect(readItem).toHaveBeenCalledTimes(2)
	expect(observer.getCurrentResult().data).toEqual({fileName: 'renamed.jpg'})

	await act(async () => resolveOld({fileName: 'before.jpg'}))
	expect(observer.getCurrentResult().data).toEqual({fileName: 'renamed.jpg'})
})

it('prevents an inactive detail request from making old cached data fresh after return', async () => {
	queryClient.setQueryData(itemKey('photo'), {fileName: 'before.jpg'})
	let resolveOld!: (data: {fileName: string}) => void
	const oldRequest = queryClient.fetchQuery({
		queryKey: itemKey('photo'),
		staleTime: 0,
		queryFn: () => new Promise<{fileName: string}>((resolve) => (resolveOld = resolve)),
	})
	// The request's caller may have left Photos before its response arrived.
	const settledOldRequest = oldRequest.catch(() => {})

	await startSubscription()
	await act(async () => {
		resolveOld({fileName: 'before.jpg'})
		await settledOldRequest
	})
	expect(queryClient.getQueryState(itemKey('photo'))?.isInvalidated).toBe(true)

	const readItem = vi.fn(async () => ({fileName: 'renamed.jpg'}))
	const observer = observeItem('photo', readItem)
	await act(async () => {})
	expect(observer.getCurrentResult().data).toEqual({fileName: 'renamed.jpg'})
})
