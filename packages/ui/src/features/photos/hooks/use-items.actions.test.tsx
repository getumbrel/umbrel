// @vitest-environment jsdom

import {QueryClient, QueryClientProvider, QueryObserver, type InfiniteData} from '@tanstack/react-query'
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'

import {moveActivity} from './move-activity'
import {useItemActions, type ItemsPage} from './use-items'

type Summary = {counts: {items: number; favorites: number; photos: number; videos: number; deleted: number}}

const mocks = vi.hoisted(() => ({
	remove: vi.fn<(input: {ids: string[]}) => Promise<number>>(),
	list: vi.fn(),
	summary: undefined as unknown,
	invalidateSummary: vi.fn(),
}))

vi.mock('@/features/photos/components/view-context', () => ({usePhotosView: () => ({})}))
vi.mock('@/modules/auth/http-auth', () => ({authorizedHttpUrl: async (url: string) => url}))
vi.mock('@/trpc/trpc', () => ({
	trpcClient: {photos: {items: {list: {query: mocks.list}}}},
	trpcReact: {
		useUtils: () => ({
			client: {photos: {items: {delete: {mutate: mocks.remove}}}},
			photos: {
				library: {
					summary: {
						invalidate: mocks.invalidateSummary,
						setData: (_input: undefined, update: (summary: unknown) => unknown) => {
							mocks.summary = update(mocks.summary)
						},
					},
				},
				albums: {list: {setData: vi.fn()}},
				items: {get: {invalidate: vi.fn()}},
			},
		}),
	},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const key = [['photos', 'items', 'list'], {input: {filter: {}, limit: 200}, type: 'infinite'}]
const library = Array.from({length: 6000}, (_, index) => `item-${index}`)
const page = (ids: string[]): ItemsPage => ({
	items: ids.map((id) => ({id, kind: 'photo', takenAt: Date.UTC(2024, 5, 1), width: 4, height: 3, isFavorite: false})),
	total: ids.length,
	nextCursor: undefined,
})

let actions!: ReturnType<typeof useItemActions>
function Probe() {
	actions = useItemActions()
	return null
}

let client!: QueryClient
let root!: Root
let container!: HTMLDivElement
const listed = () => client.getQueryData<InfiniteData<ItemsPage>>(key)!.pages.flatMap((entry) => entry.items).length

beforeEach(() => {
	client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}})
	client.setQueryData(key, {pages: [page(library)], pageParams: [null]})
	mocks.summary = {
		counts: {items: 6000, favorites: 0, photos: 6000, videos: 0, deleted: 0},
		bySubKind: {live: 0, panorama: 0, screenshot: 0, spherical: 0},
		months: [{year: 2024, month: 6, count: 6000}],
	}
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	act(() =>
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter initialEntries={['/photos']}>
					<Probe />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	)
})

afterEach(() => {
	act(() => root.unmount())
	container.remove()
	client.clear()
	vi.clearAllMocks()
})

it('deletes a selection of any size as one change on screen and a batch at a time on the server', async () => {
	const answers: (() => void)[] = []
	mocks.remove.mockImplementation(({ids}) => new Promise((resolve) => answers.push(() => resolve(ids.length))))
	let finished = false
	let deleting!: Promise<unknown>
	await act(async () => {
		deleting = actions.deleteItems({ids: library}).then(() => (finished = true))
	})
	// On screen at once: every tile gone, the count what it will come to
	expect(listed()).toBe(0)
	expect((mocks.summary as Summary).counts).toMatchObject({items: 0, deleted: 6000})
	expect(moveActivity.isRunning()).toBe(true)
	// To the server in batches no request refuses, one after another
	expect(mocks.remove.mock.calls.map(([input]) => input.ids.length)).toEqual([2500])
	await act(async () => answers[0]!())
	expect(mocks.remove.mock.calls.map(([input]) => input.ids.length)).toEqual([2500, 2500])
	await act(async () => answers[1]!())
	expect(mocks.remove.mock.calls.map(([input]) => input.ids.length)).toEqual([2500, 2500, 1000])
	expect(finished).toBe(false)
	await act(async () => {
		answers[2]!()
		await deleting
	})
	expect(mocks.remove.mock.calls.flatMap(([input]) => input.ids)).toEqual(library)
	expect(moveActivity.isRunning()).toBe(false)
	expect(mocks.invalidateSummary).toHaveBeenCalled()
})

it('carries on past what the server cannot delete, shows it again and hands it back', async () => {
	// One photo in a read-only folder: the request that names it is refused from that photo on
	const stuck = 'item-3141'
	const deleted = new Set<string>()
	mocks.remove.mockImplementation(async ({ids}) => {
		for (const id of ids) {
			if (id === stuck) throw new Error('[cloud-read-only]')
			deleted.add(id)
		}
		return ids.length
	})
	mocks.list.mockImplementation(async () => page(library.filter((id) => !deleted.has(id))))
	const stop = new QueryObserver(client, {
		queryKey: key,
		queryFn: () => client.getQueryData(key),
		staleTime: Infinity,
	}).subscribe(() => {})
	try {
		let result!: {failed: string[]}
		await act(async () => {
			result = await actions.deleteItems({ids: library})
		})
		expect(result).toEqual({failed: [stuck]})
		expect(deleted.size).toBe(5999)
		await vi.waitFor(() => expect(listed()).toBe(1))
		expect(moveActivity.isRunning()).toBe(false)
	} finally {
		stop()
	}
})

it('fails as a whole, and reads the list back, when the server takes none of it', async () => {
	mocks.remove.mockRejectedValue(new Error('too many SQL variables'))
	mocks.list.mockResolvedValue(page(library))
	// Only a list something is showing is read again
	const stop = new QueryObserver(client, {
		queryKey: key,
		queryFn: () => client.getQueryData(key),
		staleTime: Infinity,
	}).subscribe(() => {})
	try {
		let failure: unknown
		await act(async () => {
			await actions.deleteItems({ids: library}).catch((error) => (failure = error))
		})
		expect(String(failure)).toContain('too many SQL variables')
		await vi.waitFor(() => expect(listed()).toBe(6000))
		// From the top: the first page's param is not a cursor
		expect(mocks.list).toHaveBeenCalledWith({filter: {}, cursor: undefined, limit: 1000})
		expect(moveActivity.isRunning()).toBe(false)
	} finally {
		stop()
	}
})

it('takes a deleted item out of a search that found it, whichever shape its answer is cached in', async () => {
	mocks.remove.mockImplementation(async ({ids}) => ids.length)
	const found = (...ids: string[]) => ({
		understood: {chips: [], text: 'beach'},
		results: ids.map((id) => ({photo: page([id]).items[0]})),
		total: 3,
	})
	// A ranked search in Photos is pages of answers; the command palette's is one
	const ranked = [['search', 'query'], {input: {query: 'beach', scope: 'photos', filter: {}}, type: 'infinite'}]
	const whole = [['search', 'query'], {input: {query: 'beach', scope: 'all'}, type: 'query'}]
	client.setQueryData(ranked, {pages: [found('item-1', 'item-2'), found('item-3')], pageParams: [0, 2]})
	client.setQueryData(whole, found('item-1', 'item-2', 'item-3'))
	await act(async () => {
		await actions.deleteItems({ids: ['item-2']})
	})
	type Answer = ReturnType<typeof found>
	const idsOf = (answer: Answer) => answer.results.map((result) => result.photo!.id)
	const pages = client.getQueryData<InfiniteData<Answer>>(ranked)!.pages
	expect(pages.map(idsOf)).toEqual([['item-1'], ['item-3']])
	// … and off the count of what it found, on every page
	expect(pages.map((answer) => answer.total)).toEqual([2, 2])
	expect(idsOf(client.getQueryData<Answer>(whole)!)).toEqual(['item-1', 'item-3'])
	expect(listed()).toBe(5999)
})
