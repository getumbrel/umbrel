// @vitest-environment jsdom

import {QueryClient, QueryObserver} from '@tanstack/react-query'
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'

import {moveActivity} from '@/features/photos/hooks/move-activity'
import {MAP_POINTS_KEY} from '@/features/photos/hooks/use-map-points'
import {usePhotosEvents} from '@/features/photos/hooks/use-photos-events'

type SubscriptionOptions = {
	onStarted?: () => void
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
	invalidatePeople: vi.fn(),
	isMutating: vi.fn(() => 0),
	invalidateItem: vi.fn(),
	cancelItem: vi.fn(async () => {}),
	invalidateQueries: vi.fn(),
	findQueries: vi.fn<(...args: unknown[]) => unknown[]>(() => []),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
	const original = await importOriginal<typeof import('@tanstack/react-query')>()
	return {
		...original,
		useQueryClient: () => ({
			invalidateQueries: mocks.invalidateQueries,
			isMutating: mocks.isMutating,
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
				people: {invalidate: mocks.invalidatePeople},
				items: {get: {invalidate: mocks.invalidateItem, cancel: mocks.cancelItem}},
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
	// The map's points, the lists, and the ranked searches of the same library
	expect(mocks.invalidateQueries.mock.calls).toEqual([
		[{queryKey: MAP_POINTS_KEY}],
		[{queryKey: [['photos', 'items', 'list']], refetchType: 'none'}],
		[{queryKey: [['search', 'query']], refetchType: 'none'}],
	])
})

it('leaves people unread while a change to them is still on its way', async () => {
	mocks.isMutating.mockReturnValueOnce(1)
	await act(async () => {
		mocks.subscriptions.get('photos:change')!.onData({accountIds: ['Alice']})
		await vi.advanceTimersByTimeAsync(1000)
	})
	expect(mocks.isMutating).toHaveBeenCalledWith({mutationKey: [['photos', 'people']]})
	expect(mocks.invalidatePeople).not.toHaveBeenCalled()
	expect(mocks.invalidateSummary).toHaveBeenCalledOnce()

	await act(async () => {
		mocks.subscriptions.get('photos:change')!.onData({accountIds: ['Alice']})
		await vi.advanceTimersByTimeAsync(1000)
	})
	expect(mocks.invalidatePeople).toHaveBeenCalledOnce()
})

it('asks the ranked search on screen again when the library changes, and no other', async () => {
	const shown = {isActive: () => true, fetch: vi.fn(async () => {})}
	const cached = {isActive: () => false, fetch: vi.fn(async () => {})}
	mocks.findQueries.mockImplementation((filters) => {
		const [[path]] = (filters as {queryKey: string[][]}).queryKey
		return path === 'search' ? [shown, cached] : []
	})
	try {
		await act(async () => {
			mocks.subscriptions.get('photos:change')!.onData({accountIds: ['Alice']})
			await vi.advanceTimersByTimeAsync(1000)
		})
		expect(shown.fetch).toHaveBeenCalledOnce()
		expect(cached.fetch).not.toHaveBeenCalled()
	} finally {
		mocks.findQueries.mockReset().mockReturnValue([])
	}
})

it('asks the ranked search on screen again at once, then at most every ten seconds while changes keep coming', async () => {
	const shown = {isActive: () => true, fetch: vi.fn(async () => {})}
	mocks.findQueries.mockImplementation((filters) => {
		const [[path]] = (filters as {queryKey: string[][]}).queryKey
		return path === 'search' ? [shown] : []
	})
	try {
		// An import: a change a second, for 25 seconds
		await act(async () => {
			for (let second = 0; second < 25; second++) {
				mocks.subscriptions.get('photos:change')!.onData({accountIds: ['Alice']})
				await vi.advanceTimersByTimeAsync(1000)
			}
		})
		// At 1s, 11s and 21s
		expect(shown.fetch).toHaveBeenCalledTimes(3)
		// … and once more for the changes since, unless a delete of this session's is under way by then
		moveActivity.begin()
		await act(async () => vi.advanceTimersByTimeAsync(10_000))
		expect(shown.fetch).toHaveBeenCalledTimes(3)
	} finally {
		moveActivity.end()
		mocks.findQueries.mockReset().mockReturnValue([])
	}
})

it("refreshes the map's points at once, then at most every ten seconds while changes keep coming", async () => {
	const refreshes = () => mocks.invalidateQueries.mock.calls.filter(([{queryKey}]) => queryKey === MAP_POINTS_KEY)
	// An import: a change a second, for 25 seconds
	await act(async () => {
		for (let second = 0; second < 25; second++) {
			mocks.subscriptions.get('photos:change')!.onData({accountIds: ['Alice']})
			await vi.advanceTimersByTimeAsync(1000)
		}
	})
	expect(mocks.invalidateSummary).toHaveBeenCalledTimes(25)
	// At 1s, 11s and 21s
	expect(refreshes()).toHaveLength(3)
	// … and once more for the changes since, when its turn comes
	await act(async () => vi.advanceTimersByTimeAsync(10_000))
	expect(refreshes()).toHaveLength(4)
	await act(async () => vi.advanceTimersByTimeAsync(60_000))
	expect(refreshes()).toHaveLength(4)
})

it("leaves the map's points stale, not refetched, when Photos is closed with a refresh of them waiting", async () => {
	const refreshes = () => mocks.invalidateQueries.mock.calls.filter(([{queryKey}]) => queryKey === MAP_POINTS_KEY)
	await act(async () => {
		for (let second = 0; second < 2; second++) {
			mocks.subscriptions.get('photos:change')!.onData({accountIds: ['Alice']})
			await vi.advanceTimersByTimeAsync(1000)
		}
	})
	act(() => root.render(null))
	await act(async () => vi.advanceTimersByTimeAsync(60_000))
	expect(refreshes()).toHaveLength(2)
	expect(refreshes()[1]).toEqual([{queryKey: MAP_POINTS_KEY, refetchType: 'none'}])
})

it("owes nothing to the map's points when Photos is closed with no refresh of them waiting", async () => {
	await act(async () => {
		mocks.subscriptions.get('photos:change')!.onData({accountIds: ['Alice']})
		await vi.advanceTimersByTimeAsync(1000)
	})
	act(() => root.render(null))
	expect(mocks.invalidateQueries.mock.calls.filter(([{queryKey}]) => queryKey === MAP_POINTS_KEY)).toHaveLength(1)
})

it("refreshes the map's points once subscribed, for changes made while Photos was closed", async () => {
	await act(async () => {
		mocks.subscriptions.get('photos:change')!.onStarted?.()
		await Promise.resolve()
	})
	expect(mocks.invalidateItem).toHaveBeenCalledOnce()
	// Without cancelling a read the map has only just begun
	expect(mocks.invalidateQueries).toHaveBeenCalledWith({queryKey: MAP_POINTS_KEY}, {cancelRefetch: false})
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
	type Data = {pages: {items: string[]}[]}
	const pageOf = (item: string): Data => ({pages: [{items: [item]}]})
	let finishFilterRead!: (data: Data) => void
	const olderRead = new Promise<void>((resolve) => (finishOlderRead = resolve))
	const filterRead = new Promise<Data>((resolve) => (finishFilterRead = resolve))
	const queryFn = vi.fn().mockReturnValueOnce(filterRead).mockResolvedValue(pageOf('new data'))
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
		// Each refresh looks up the reads in flight, the lists, then the searches
		mocks.findQueries
			.mockReturnValueOnce([filterQuery])
			.mockReturnValueOnce([])
			.mockReturnValueOnce([])
			.mockReturnValueOnce([filterQuery])
		await act(async () => {
			mocks.subscriptions.get('photos:change')!.onData({accountIds: ['Alice']})
			finishOlderRead()
		})
		expect(queryFn).toHaveBeenCalledOnce()

		// cancelRefetch: false reuses B, whose response predates the second change.
		await act(async () => finishFilterRead(pageOf('old data')))
		expect(observer.getCurrentResult().data).toEqual(pageOf('old data'))
		await act(async () => vi.advanceTimersByTimeAsync(1000))
		expect(queryFn).toHaveBeenCalledTimes(2)
		expect(observer.getCurrentResult().data).toEqual(pageOf('new data'))
		await act(async () => vi.advanceTimersByTimeAsync(10_000))
		expect(queryFn).toHaveBeenCalledTimes(2)
	} finally {
		unsubscribe()
		client.clear()
		mocks.findQueries.mockReset().mockReturnValue([])
	}
})

it('refetches a short list in place, and leaves one holding larger pages only marked stale', async () => {
	const list = (sizes: number[]) => ({
		queryKey: [['photos', 'items', 'list'], {input: {filter: {}, limit: 200}, type: 'infinite'}],
		state: {fetchStatus: 'idle', data: {pages: sizes.map((size) => ({items: Array.from({length: size})}))}},
		isActive: () => true,
		fetch: vi.fn(async () => undefined),
	})
	const short = list([200, 200])
	const spliced = list([200, 1000])
	const deep = list([200, 200, 200, 200])
	// One nobody is showing: subscribed to, but switched off (the command palette's, while it is closed)
	const idle = {...list([6]), isActive: () => false}
	mocks.findQueries.mockImplementation((filters) =>
		(filters as {queryKey: unknown[]}).queryKey.length === 1 &&
		Array.isArray((filters as {queryKey: unknown[][]}).queryKey[0])
			? (filters as {queryKey: string[][]}).queryKey[0]!.length === 3
				? [short, spliced, deep, idle]
				: []
			: [],
	)
	try {
		await act(async () => {
			mocks.subscriptions.get('photos:change')!.onData({accountIds: ['Alice']})
			await vi.advanceTimersByTimeAsync(1000)
		})
		expect(short.fetch).toHaveBeenCalledOnce()
		// Refetched, either of these would come back shorter than it is, or a page at a time
		expect(spliced.fetch).not.toHaveBeenCalled()
		expect(deep.fetch).not.toHaveBeenCalled()
		expect(idle.fetch).not.toHaveBeenCalled()
		expect(mocks.invalidateQueries).toHaveBeenCalledWith({queryKey: [['photos', 'items', 'list']], refetchType: 'none'})
	} finally {
		mocks.findQueries.mockReset().mockReturnValue([])
	}
})

it('runs the bounded refresh when the change subscription starts again, for what a dropped socket missed', async () => {
	await act(async () => {
		mocks.subscriptions.get('photos:change')!.onStarted?.()
		await vi.advanceTimersByTimeAsync(1000)
	})
	// The first start is Photos opening: everything was fetched a moment ago
	expect(mocks.invalidateSummary).not.toHaveBeenCalled()

	await act(async () => {
		mocks.subscriptions.get('photos:change')!.onStarted?.()
		await vi.advanceTimersByTimeAsync(1000)
	})
	expect(mocks.invalidateSummary).toHaveBeenCalledOnce()
	expect(mocks.invalidateQueries).toHaveBeenCalledWith({queryKey: [['photos', 'items', 'list']], refetchType: 'none'})
})

it('holds its refresh while a delete of this session is still running, and reads once it has finished', async () => {
	moveActivity.begin()
	try {
		// The server reports the files leaving one by one, for as long as it takes
		for (let second = 0; second < 5; second++) {
			await act(async () => {
				mocks.subscriptions.get('photos:change')!.onData({accountIds: ['Alice']})
				await vi.advanceTimersByTimeAsync(1000)
			})
		}
		expect(mocks.invalidateSummary).not.toHaveBeenCalled()
		expect(mocks.invalidateAlbums).not.toHaveBeenCalled()
		expect(mocks.invalidateQueries).not.toHaveBeenCalled()
	} finally {
		moveActivity.end()
	}
	await act(async () => vi.advanceTimersByTimeAsync(1000))
	expect(mocks.invalidateSummary).toHaveBeenCalledOnce()
	expect(mocks.invalidateAlbums).toHaveBeenCalledOnce()
})

it('leaves a refresh already waiting its turn for the end of a delete that began meanwhile', async () => {
	await act(async () => {
		mocks.subscriptions.get('photos:change')!.onData({accountIds: ['Alice']})
		await vi.advanceTimersByTimeAsync(500)
	})
	moveActivity.begin()
	try {
		await act(async () => vi.advanceTimersByTimeAsync(2000))
		expect(mocks.invalidateSummary).not.toHaveBeenCalled()
	} finally {
		moveActivity.end()
	}
	await act(async () => vi.advanceTimersByTimeAsync(1000))
	expect(mocks.invalidateSummary).toHaveBeenCalledOnce()
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
