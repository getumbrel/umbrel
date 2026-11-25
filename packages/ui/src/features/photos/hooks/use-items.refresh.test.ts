import {InfiniteQueryObserver, QueryClient, type InfiniteData, type Query} from '@tanstack/react-query'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {refreshHead, rereadList, trimList, type ItemsPage} from './use-items'

const mocks = vi.hoisted(() => ({list: vi.fn()}))

vi.mock('@/features/photos/components/view-context', () => ({usePhotosView: () => ({})}))
vi.mock('@/modules/auth/http-auth', () => ({authorizedHttpUrl: async (url: string) => url}))
vi.mock('@/trpc/trpc', () => ({trpcReact: {}, trpcClient: {photos: {items: {list: {query: mocks.list}}}}}))

type List = InfiniteData<ItemsPage, string | null | undefined>

// A library of numbered items, newest first, paged by position
let library: string[] = []
const serve = ({cursor, limit}: {cursor?: string; limit: number}): ItemsPage => {
	const from = cursor === undefined ? 0 : Number(cursor)
	const ids = library.slice(from, from + limit)
	return {
		items: ids.map((id) => ({id, kind: 'photo', takenAt: 0, width: 4, height: 3, isFavorite: false})),
		total: library.length,
		nextCursor: from + limit < library.length ? String(from + limit) : undefined,
	}
}
const PAGE = 200
const key = [['photos', 'items', 'list'], {input: {filter: {}, limit: PAGE}, type: 'infinite'}]
const ids = (data: List | undefined) => data?.pages.flatMap((page) => page.items.map((item) => item.id)) ?? []

let client: QueryClient
let served: ReturnType<typeof vi.fn<(input: {cursor?: string; limit: number}) => ItemsPage>>
let unsubscribe = () => {}

// A list on screen, asked the way useItems asks (through tRPC, whose first
// page param is null and is no cursor): its first page here
async function show({staleTime = 'static' as 'static' | number} = {}) {
	const observer = new InfiniteQueryObserver<ItemsPage, Error, List, typeof key, string | null | undefined>(client, {
		queryKey: key,
		queryFn: ({pageParam}) => served({cursor: pageParam ?? undefined, limit: PAGE}),
		initialPageParam: null,
		getNextPageParam: (last) => last.nextCursor,
		staleTime,
	})
	unsubscribe = observer.subscribe(() => {})
	await vi.waitFor(() => expect(observer.getCurrentResult().data).toBeDefined())
	const query = client.getQueryCache().find<List>({queryKey: key, exact: true})!
	return {observer, query}
}
// … and the larger page a jump along the rail splices on after it
const splice = () =>
	client.setQueryData<List>(key, (data) => {
		const cursor = data!.pages.at(-1)!.nextCursor
		return {pages: [...data!.pages, serve({cursor, limit: 1000})], pageParams: [...data!.pageParams, cursor]}
	})

beforeEach(() => {
	library = Array.from({length: 5000}, (_, index) => `item-${index}`)
	client = new QueryClient({defaultOptions: {queries: {retry: false}}})
	served = vi.fn(serve)
	mocks.list.mockImplementation(async (input: {cursor?: string; limit: number}) => serve(input))
})

afterEach(() => {
	unsubscribe()
	unsubscribe = () => {}
	client.clear()
	vi.clearAllMocks()
})

describe('a list on screen', () => {
	it('comes back a fraction of its length when the library refetches it with a larger page in it', async () => {
		// Why lists are static: this is what a focus, a reconnect or an invalidation did to them
		const {observer} = await show({staleTime: 0})
		splice()
		expect(ids(observer.getCurrentResult().data)).toHaveLength(1200)
		await client.invalidateQueries()
		expect(ids(observer.getCurrentResult().data)).toHaveLength(400)
	})

	it('is left as it is by an invalidation of everything, and only marked stale', async () => {
		const {observer, query} = await show()
		splice()
		served.mockClear()
		await client.invalidateQueries()
		expect(served).not.toHaveBeenCalled()
		expect(ids(observer.getCurrentResult().data)).toHaveLength(1200)
		expect(query.state.isInvalidated).toBe(true)
	})

	it('still pages on from its last page', async () => {
		const {observer} = await show()
		splice()
		await observer.fetchNextPage()
		expect(served).toHaveBeenLastCalledWith({cursor: '1200', limit: PAGE})
		expect(ids(observer.getCurrentResult().data)).toHaveLength(1400)
	})
})

describe('refreshHead', () => {
	it('asks again for a single page that has gone stale, and for no other list', async () => {
		const {query} = await show()
		served.mockClear()
		// Fresh: taken as it is
		refreshHead(client, key)
		expect(served).not.toHaveBeenCalled()

		query.invalidate()
		library = ['new', ...library]
		refreshHead(client, key)
		await vi.waitFor(() => expect(ids(query.state.data)[0]).toBe('new'))
		expect(served).toHaveBeenCalledOnce()
		expect(query.state.isInvalidated).toBe(false)

		// Paged beyond its first page it is the grid's, wherever that has scrolled to
		splice()
		query.invalidate()
		served.mockClear()
		refreshHead(client, key)
		expect(served).not.toHaveBeenCalled()
	})
})

describe('trimList', () => {
	it('cuts a list that has been left back to its first page, as old and as stale as it was', async () => {
		const {query} = await show()
		splice()
		query.invalidate()
		const {dataUpdatedAt} = query.state
		const first = query.state.data!.pages[0]
		unsubscribe()
		trimList(client, key)
		expect(query.state.data!.pages).toHaveLength(1)
		expect(query.state.data!.pages[0]).toBe(first)
		expect(query.state.data!.pageParams).toEqual([null])
		expect(query.state.dataUpdatedAt).toBe(dataUpdatedAt)
		expect(query.state.isInvalidated).toBe(true)
	})
})

describe('rereadList', () => {
	it('reads a list again as far as it was loaded, a thousand at a time', async () => {
		const {query} = await show()
		splice()
		// A deletion that didn't happen took these out of the list
		client.setQueryData<List>(key, (data) => ({
			...data!,
			pages: data!.pages.map((page) => ({...page, items: page.items.filter((item) => item.id !== 'item-7')})),
		}))
		expect(ids(query.state.data)).toHaveLength(1199)
		await rereadList(client, query as Query<List>)
		expect(mocks.list.mock.calls.map(([input]) => [input.cursor, input.limit])).toEqual([
			[undefined, 1000],
			['1000', 1000],
		])
		expect(ids(query.state.data).slice(0, 9)).toEqual(library.slice(0, 9))
		expect(ids(query.state.data)).toHaveLength(2000)
		// Still a list the library can page on from: the first page's param as it was
		expect(query.state.data!.pageParams).toEqual([null, '1000'])
	})

	it('leaves the list alone if it was changed again while being read', async () => {
		const {query} = await show()
		let answer!: (page: ItemsPage) => void
		mocks.list.mockImplementationOnce(() => new Promise<ItemsPage>((resolve) => (answer = resolve)))
		const reading = rereadList(client, query as Query<List>)
		splice()
		const changed = query.state.data
		answer(serve({limit: 1000}))
		await reading
		expect(query.state.data).toBe(changed)
	})
})
