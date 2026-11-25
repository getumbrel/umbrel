// @vitest-environment jsdom

import {QueryClient, QueryClientProvider, useInfiniteQuery} from '@tanstack/react-query'
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {holdsRankedAnswer, useListing, type Listing} from './use-listing'

type Answer = {
	understood: {chips: {type: string; label: string}[]; text: string}
	results: {photo: {id: string}}[]
	total: number
	nextCursor?: number
}

const fixtures = vi.hoisted(() => ({
	text: '',
	answers: new Map<string, (answer: unknown) => void>(),
	failures: new Map<string, (error: Error) => void>(),
}))

vi.mock('react-router-dom', () => ({useParams: () => ({}), useLocation: () => ({pathname: '/photos'})}))

vi.mock('@/features/photos/components/view-context', () => ({
	tokensFilter: () => ({}),
	usePhotosView: () => ({search: {appliedText: fixtures.text, tokens: [], active: fixtures.text !== ''}}),
}))

vi.mock('@/features/photos/hooks/use-search', () => ({useSmartSearch: () => true}))

// The timeline: the whole library, whatever it is asked
vi.mock('@/features/photos/hooks/use-items', () => ({
	useItems: () => ({
		items: [{id: 'library-1'}, {id: 'library-2'}],
		total: 844,
		isLoading: false,
		hasMore: false,
		loadMore: () => {},
	}),
}))

// search.query as React Query runs it, a page at a time, each page answered
// by hand: the first under the words asked, the ones after it under the words
// and where the page starts
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		search: {
			query: {
				useInfiniteQuery: (input: {query: string}, {initialCursor, ...options}: {initialCursor: number}) =>
					useInfiniteQuery({
						queryKey: [['search', 'query'], {input, type: 'infinite'}],
						queryFn: ({pageParam}) =>
							new Promise((resolve, reject) => {
								const asked = pageParam ? `${input.query} from ${pageParam}` : input.query
								fixtures.answers.set(asked, resolve)
								fixtures.failures.set(asked, reject)
							}),
						initialPageParam: initialCursor,
						getNextPageParam: () => undefined,
						...options,
					}),
			},
		},
	},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const answer = (label: string, ...ids: string[]): Answer => ({
	understood: {chips: [{type: 'place', label}], text: ''},
	results: ids.map((id) => ({photo: {id}})),
	total: ids.length,
})

describe('useListing', () => {
	let container: HTMLDivElement
	let root: ReturnType<typeof createRoot>
	let client: QueryClient
	let listing!: Listing

	function Probe() {
		listing = useListing()
		return null
	}

	const type = (text: string) => {
		fixtures.text = text
		act(() =>
			root.render(
				<QueryClientProvider client={client}>
					<Probe />
				</QueryClientProvider>,
			),
		)
	}
	const land = (text: string, response: Answer) =>
		act(async () => {
			fixtures.answers.get(text)!(response)
			// React Query tells its observers a task after the answer lands
			await new Promise((resolve) => setTimeout(resolve, 20))
		})
	const fail = (text: string) =>
		act(async () => {
			fixtures.failures.get(text)!(new Error('Search fell over'))
			await new Promise((resolve) => setTimeout(resolve, 20))
		})
	const ids = () => listing.items.map((item) => item.id)

	beforeEach(() => {
		fixtures.text = ''
		fixtures.answers.clear()
		fixtures.failures.clear()
		client = new QueryClient({defaultOptions: {queries: {retry: false}}})
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => root.unmount())
		container.remove()
		client.clear()
	})

	test('lists a search a page at a time, and counts all that was found from the first', async () => {
		type('sunset')
		await land('sunset', {...answer('Sunset', 'a', 'b'), total: 3, nextCursor: 2})
		expect(listing).toMatchObject({mode: 'ranked', pending: false, total: 3, hasMore: true})
		expect(ids()).toEqual(['a', 'b'])

		// Asked for more, it fetches the page after, once
		act(() => listing.loadMore())
		act(() => listing.loadMore())
		await land('sunset from 2', {...answer('Sunset', 'c'), total: 3})
		expect(listing).toMatchObject({mode: 'ranked', pending: false, total: 3, hasMore: false})
		expect(ids()).toEqual(['a', 'b', 'c'])
	})

	test('pages a search to its end for Select all, and hands back everything it found', async () => {
		type('sunset')
		await land('sunset', {...answer('Sunset', 'a', 'b'), total: 4, nextCursor: 2})
		let all: string[] | null | undefined
		act(() => void listing.loadAll!().then((ids) => (all = ids)))
		await land('sunset from 2', {...answer('Sunset', 'c'), total: 4, nextCursor: 3})
		expect(all).toBeUndefined()
		await land('sunset from 3', {...answer('Sunset', 'd'), total: 4})
		expect(all).toEqual(['a', 'b', 'c', 'd'])
	})

	test('does not hand Select all part of a search when a page of it fails', async () => {
		type('sunset')
		await land('sunset', {...answer('Sunset', 'a', 'b'), total: 4, nextCursor: 2})
		let all: string[] | null | undefined
		act(() => void listing.loadAll!().then((ids) => (all = ids)))
		await fail('sunset from 2')
		expect(all).toBeNull()
	})

	test('keeps the results on screen when a later page fails, and falls back to names only for want of an answer', async () => {
		type('sunset')
		await land('sunset', {...answer('Sunset', 'a', 'b'), total: 3, nextCursor: 2})
		act(() => listing.loadMore())
		await fail('sunset from 2')
		expect(listing).toMatchObject({mode: 'ranked', pending: false, total: 3, hasMore: false})
		expect(ids()).toEqual(['a', 'b'])

		type('ikea receipt')
		await fail('ikea receipt')
		expect(listing).toMatchObject({mode: 'timeline', pending: false, total: 844})
	})

	test('awaits a first search over the list before it, without lending the search its count', async () => {
		type('')
		expect(listing).toMatchObject({mode: 'timeline', pending: false, total: 844})

		type('sunset')
		expect(listing).toMatchObject({mode: 'timeline', pending: true, total: undefined})
		expect(ids()).toEqual(['library-1', 'library-2'])

		await land('sunset', answer('Sunset', 'a', 'b', 'c'))
		expect(listing).toMatchObject({mode: 'ranked', pending: false, total: 3})
		expect(listing.understood?.chips).toEqual([{type: 'place', label: 'Sunset'}])
		expect(ids()).toEqual(['a', 'b', 'c'])
	})

	test('holds the last answer while a search is refined, as pending and with nothing understood', async () => {
		type('sunset')
		await land('sunset', answer('Sunset', 'a', 'b', 'c'))
		const settled = listing.answer

		type('sunset beach')
		expect(listing).toMatchObject({mode: 'ranked', pending: true, total: undefined})
		expect(ids()).toEqual(['a', 'b', 'c'])
		// Still the answer that was on screen: nothing has taken its place yet
		expect(listing.answer).toBe(settled)

		await land('sunset beach', answer('Beach', 'b'))
		expect(listing).toMatchObject({mode: 'ranked', pending: false, total: 1})
		expect(listing.understood?.chips).toEqual([{type: 'place', label: 'Beach'}])
		expect(listing.answer).not.toBe(settled)
	})

	test('holds the answer when a word is put in quotes, as taking off a chip read from it does', async () => {
		type('sunset dad')
		await land('sunset dad', answer('Dad', 'a', 'b', 'c'))

		type('sunset "dad"')
		expect(listing).toMatchObject({mode: 'ranked', pending: true, total: undefined})
		expect(ids()).toEqual(['a', 'b', 'c'])

		await land('sunset "dad"', answer('Sunset', 'c'))
		expect(listing).toMatchObject({mode: 'ranked', pending: false, total: 1})
		expect(ids()).toEqual(['c'])
	})

	test('never shows one search’s results under another typed after the field was emptied', async () => {
		type('sunset')
		await land('sunset', answer('Sunset', 'a', 'b', 'c'))

		type('')
		expect(listing).toMatchObject({mode: 'timeline', pending: false, total: 844})

		type('ikea receipt')
		expect(listing).toMatchObject({mode: 'timeline', pending: true, total: undefined})
		expect(ids()).toEqual(['library-1', 'library-2'])

		// … not even the same words again: the field was emptied in between
		type('')
		type('sunset b')
		expect(listing.mode).toBe('timeline')
	})

	test('does not hold an answer under a different question typed over it', async () => {
		type('sunset')
		await land('sunset', answer('Sunset', 'a', 'b', 'c'))

		type('ikea receipt')
		expect(listing).toMatchObject({mode: 'timeline', pending: true, isLoading: true})
		// … nor the library the results had replaced
		expect(ids()).toEqual([])
	})
})

describe('holdsRankedAnswer', () => {
	test('holds for the same words in a changed view, and for words being refined', () => {
		expect(holdsRankedAnswer('beach', 'beach')).toBe(true)
		expect(holdsRankedAnswer('', '')).toBe(true)
		expect(holdsRankedAnswer('beach', 'beach 2019')).toBe(true)
		expect(holdsRankedAnswer('beach', 'ikea')).toBe(false)
	})
})
