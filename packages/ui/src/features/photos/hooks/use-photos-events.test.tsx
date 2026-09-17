// @vitest-environment jsdom

import {QueryClient, QueryObserver} from '@tanstack/react-query'
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'

import {usePhotosEvents} from '@/features/photos/hooks/use-photos-events'

type SubscriptionOptions = {
	onData: (data: unknown) => void
	onError: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
	subscriptions: new Map<string, SubscriptionOptions>(),
	statusData: undefined as unknown,
	setStatus: vi.fn(),
	cancelStatus: vi.fn(async () => {}),
	invalidateSummary: vi.fn(),
	invalidateSources: vi.fn(),
	invalidateAlbums: vi.fn(),
	invalidateItem: vi.fn(),
	invalidateQueries: vi.fn(),
	findQueries: vi.fn<(...args: unknown[]) => unknown[]>(() => []),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
	const original = await importOriginal<typeof import('@tanstack/react-query')>()
	return {
		...original,
		useQueryClient: () => ({
			invalidateQueries: mocks.invalidateQueries,
			getQueryCache: () => ({findAll: mocks.findQueries}),
		}),
	}
})

vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		useUtils: () => ({
			photos: {
				library: {
					summary: {invalidate: mocks.invalidateSummary},
					status: {cancel: mocks.cancelStatus, getData: () => mocks.statusData, setData: mocks.setStatus},
				},
				sources: {invalidate: mocks.invalidateSources},
				albums: {invalidate: mocks.invalidateAlbums},
				items: {get: {invalidate: mocks.invalidateItem}},
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

let container!: HTMLDivElement
let root!: Root

function Harness() {
	usePhotosEvents()
	return null
}

beforeEach(() => {
	vi.useFakeTimers()
	mocks.statusData = undefined
	mocks.setStatus.mockImplementation((_input, state) => {
		mocks.statusData = state
	})
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	act(() => root.render(<Harness />))
})

afterEach(() => {
	act(() => root.unmount())
	document.body.replaceChildren()
	mocks.subscriptions.clear()
	vi.useRealTimers()
	vi.clearAllMocks()
})

it('cancels an older query before writing an indexing snapshot into the status cache', async () => {
	const state = {phase: 'enriching', completed: 2, total: 4, percentage: 50}
	await act(async () => {
		mocks.subscriptions.get('photos:indexing-progress')?.onData(state)
		await Promise.resolve()
	})
	expect(mocks.cancelStatus).toHaveBeenCalledOnce()
	expect(mocks.setStatus).toHaveBeenCalledWith(undefined, state)
})

it('does not let an older cancellation publish over a newer progress event', async () => {
	let releaseFirst!: () => void
	let releaseSecond!: () => void
	mocks.cancelStatus
		.mockImplementationOnce(() => new Promise<void>((resolve) => (releaseFirst = resolve)))
		.mockImplementationOnce(() => new Promise<void>((resolve) => (releaseSecond = resolve)))
	const enriching = {phase: 'enriching', completed: 2, total: 4, percentage: 50}
	const ready = {phase: 'ready', completed: 4, total: 4, percentage: 100}

	act(() => {
		mocks.subscriptions.get('photos:indexing-progress')?.onData(enriching)
		mocks.subscriptions.get('photos:indexing-progress')?.onData(ready)
	})
	await act(async () => releaseSecond())
	await act(async () => releaseFirst())

	expect(mocks.setStatus).toHaveBeenCalledOnce()
	expect(mocks.setStatus).toHaveBeenCalledWith(undefined, ready)
})

it('keeps generic Photos changes from refetching indexing status', () => {
	act(() => {
		mocks.subscriptions.get('photos:change')?.onData({accountIds: ['Alice']})
		vi.advanceTimersByTime(1000)
	})

	expect(mocks.invalidateSummary).toHaveBeenCalledOnce()
	expect(mocks.setStatus).not.toHaveBeenCalled()
})

it('uses the bounded library refresh when indexing becomes ready', async () => {
	mocks.statusData = {phase: 'enriching', completed: 2, total: 4, percentage: 50}
	const ready = {phase: 'ready', completed: 4, total: 4, percentage: 100}
	await act(async () => {
		mocks.subscriptions.get('photos:indexing-progress')?.onData(ready)
		await Promise.resolve()
		vi.advanceTimersByTime(1000)
	})

	expect(mocks.invalidateSummary).toHaveBeenCalledOnce()
	expect(mocks.invalidateSources).toHaveBeenCalledOnce()
	expect(mocks.invalidateAlbums).toHaveBeenCalledOnce()
	expect(mocks.invalidateItem).toHaveBeenCalledOnce()
	expect(mocks.invalidateQueries).toHaveBeenCalledOnce()
})

it('does not refresh cold data when the initial indexing seed is already ready', async () => {
	const ready = {phase: 'ready', completed: 4, total: 4, percentage: 100}
	await act(async () => {
		mocks.subscriptions.get('photos:indexing-progress')?.onData(ready)
		await Promise.resolve()
		vi.advanceTimersByTime(1000)
	})

	expect(mocks.setStatus).toHaveBeenCalledWith(undefined, ready)
	expect(mocks.invalidateSummary).not.toHaveBeenCalled()
	expect(mocks.invalidateQueries).not.toHaveBeenCalled()
})

it('ignores ongoing app file activity while Photos is open', async () => {
	await act(async () => {
		for (let second = 0; second < 30; second++) {
			mocks.subscriptions.get('files:watcher:change')?.onData({path: '/Apps/bitcoin/data/chainstate', type: 'change'})
			await vi.advanceTimersByTimeAsync(1000)
		}
	})

	expect(mocks.invalidateSummary).not.toHaveBeenCalled()
	expect(mocks.invalidateSources).not.toHaveBeenCalled()
	expect(mocks.invalidateAlbums).not.toHaveBeenCalled()
	expect(mocks.invalidateItem).not.toHaveBeenCalled()
	expect(mocks.invalidateQueries).not.toHaveBeenCalled()
})

it('finishes a slow refresh before refreshing changes that arrived during it', async () => {
	let finishSummary!: () => void
	mocks.invalidateSummary.mockImplementationOnce(() => new Promise<void>((resolve) => (finishSummary = resolve)))
	await act(async () => {
		mocks.subscriptions.get('photos:change')!.onData({accountIds: ['Alice']})
		await vi.advanceTimersByTimeAsync(1000)
		for (let second = 0; second < 10; second++) {
			mocks.subscriptions.get('photos:change')!.onData({accountIds: ['Alice']})
			await vi.advanceTimersByTimeAsync(1000)
		}
	})
	expect(mocks.invalidateSummary).toHaveBeenCalledOnce()
	expect(mocks.invalidateSources).toHaveBeenCalledOnce()
	expect(mocks.invalidateItem).toHaveBeenCalledOnce()

	await act(async () => {
		finishSummary()
		await vi.advanceTimersByTimeAsync(1000)
	})
	expect(mocks.invalidateSummary).toHaveBeenCalledTimes(2)
	await act(async () => vi.advanceTimersByTimeAsync(10_000))
	expect(mocks.invalidateSummary).toHaveBeenCalledTimes(2)
})

it('continues refreshing after a failed refresh', async () => {
	mocks.invalidateSummary.mockRejectedValueOnce(new Error('Connection interrupted'))
	await act(async () => {
		mocks.subscriptions.get('photos:change')!.onData({accountIds: ['Alice']})
		await vi.advanceTimersByTimeAsync(1000)
		mocks.subscriptions.get('photos:change')!.onData({accountIds: ['Alice']})
		await vi.advanceTimersByTimeAsync(1000)
	})
	expect(mocks.invalidateSummary).toHaveBeenCalledTimes(2)
})

it('waits for an older read before requesting data for a new change', async () => {
	let finishOlderRead!: () => void
	const promise = new Promise<void>((resolve) => (finishOlderRead = resolve))
	mocks.findQueries.mockReturnValueOnce([{state: {fetchStatus: 'fetching'}, promise}])
	await act(async () => {
		mocks.subscriptions.get('photos:change')!.onData({accountIds: ['Alice']})
		await vi.advanceTimersByTimeAsync(1000)
	})
	expect(mocks.invalidateSummary).not.toHaveBeenCalled()
	await act(async () => finishOlderRead())
	expect(mocks.invalidateSummary).toHaveBeenCalledOnce()
	expect(mocks.invalidateSummary).toHaveBeenCalledWith(undefined, undefined, {cancelRefetch: false})
})

it('refreshes a newly selected filter when a change arrives while waiting for an older read', async () => {
	const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity}}})
	let finishOlderRead!: () => void
	let finishFilterRead!: (data: {pages: string[]}) => void
	const olderRead = new Promise<void>((resolve) => (finishOlderRead = resolve))
	const filterRead = new Promise<{pages: string[]}>((resolve) => (finishFilterRead = resolve))
	const queryFn = vi
		.fn()
		.mockReturnValueOnce(filterRead)
		.mockResolvedValue({pages: ['new data']})
	const observer = new QueryObserver(client, {queryKey: [['photos', 'items', 'list'], {filter: 'new'}], queryFn})
	let unsubscribe = () => {}
	try {
		mocks.findQueries.mockReturnValueOnce([{state: {fetchStatus: 'fetching'}, promise: olderRead}])
		await act(async () => {
			mocks.subscriptions.get('photos:change')!.onData({accountIds: ['Alice']})
			await vi.advanceTimersByTimeAsync(1000)
		})
		expect(mocks.invalidateSummary).not.toHaveBeenCalled()

		// Switching filters starts B after the refresh took its snapshot of A.
		unsubscribe = observer.subscribe(() => {})
		const filterQuery = client.getQueryCache().getAll()[0]!
		mocks.findQueries.mockReturnValueOnce([filterQuery]).mockReturnValueOnce([]).mockReturnValueOnce([filterQuery])
		await act(async () => {
			mocks.subscriptions.get('photos:change')!.onData({accountIds: ['Alice']})
			finishOlderRead()
		})
		expect(queryFn).toHaveBeenCalledOnce()

		// cancelRefetch: false reuses B, whose response predates the second change.
		await act(async () => finishFilterRead({pages: ['old data']}))
		expect(observer.getCurrentResult().data).toEqual({pages: ['old data']})
		await act(async () => vi.advanceTimersByTimeAsync(1000))
		expect(queryFn).toHaveBeenCalledTimes(2)
		expect(observer.getCurrentResult().data).toEqual({pages: ['new data']})
		await act(async () => vi.advanceTimersByTimeAsync(10_000))
		expect(queryFn).toHaveBeenCalledTimes(2)
	} finally {
		unsubscribe()
		client.clear()
		mocks.findQueries.mockReset().mockReturnValue([])
	}
})

it('discards queued changes when Photos is closed during a refresh', async () => {
	let finishSummary!: () => void
	mocks.invalidateSummary.mockImplementationOnce(() => new Promise<void>((resolve) => (finishSummary = resolve)))
	await act(async () => {
		mocks.subscriptions.get('photos:change')!.onData({accountIds: ['Alice']})
		await vi.advanceTimersByTimeAsync(1000)
		mocks.subscriptions.get('photos:change')!.onData({accountIds: ['Alice']})
		root.render(null)
	})
	await act(async () => {
		finishSummary()
		await vi.advanceTimersByTimeAsync(10_000)
	})
	expect(mocks.invalidateSummary).toHaveBeenCalledOnce()
})
