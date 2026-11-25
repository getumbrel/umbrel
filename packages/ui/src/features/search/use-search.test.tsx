// @vitest-environment jsdom

import {QueryClient, QueryClientProvider, useQuery} from '@tanstack/react-query'
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import type {SearchScope} from './types'
import {useSearch} from './use-search'

const fixtures = vi.hoisted(() => ({answers: new Map<string, (answer: unknown) => void>()}))

// search.query as React Query runs it, each query answered by hand
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		search: {
			query: {
				useQuery: (input: {query: string; scope: string}, options: object) =>
					useQuery({
						queryKey: [['search', 'query'], {input, type: 'query'}],
						queryFn: () => new Promise((resolve) => fixtures.answers.set(`${input.scope}:${input.query}`, resolve)),
						...options,
					}),
			},
		},
	},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

describe('useSearch', () => {
	let container: HTMLDivElement
	let root: ReturnType<typeof createRoot>
	let client: QueryClient
	let search!: ReturnType<typeof useSearch>

	function Probe({query, scope}: {query: string; scope: SearchScope}) {
		search = useSearch({query, scope, limit: 10, debounceMs: 0})
		return null
	}

	// Long enough for the debounce to fire and for React Query, which tells its
	// observers a task after an answer lands, to have told them
	const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 20)))
	const type = async (query: string, scope: SearchScope = 'files') => {
		act(() =>
			root.render(
				<QueryClientProvider client={client}>
					<Probe query={query} scope={scope} />
				</QueryClientProvider>,
			),
		)
		await settle()
	}
	const land = async (key: string, ...ids: string[]) => {
		fixtures.answers.get(key)!({understood: {chips: [], text: ''}, results: ids.map((id) => ({id}))})
		await settle()
	}
	const ids = () => search.results.map((result) => result.id)

	beforeEach(() => {
		fixtures.answers.clear()
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

	test('keeps the last answer up while the query is refined, and says which query it answers', async () => {
		await type('sunset')
		await land('files:sunset', 'a', 'b')

		await type('sunset beach')
		expect(ids()).toEqual(['a', 'b'])
		expect(search).toMatchObject({answeredQuery: 'sunset', isSearching: true})

		await land('files:sunset beach', 'b')
		expect(ids()).toEqual(['b'])
		expect(search).toMatchObject({answeredQuery: 'sunset beach', isSearching: false})
	})

	test('asks a refinement once the answer before it is in', async () => {
		await type('sun')
		await type('sunset')
		await type('sunset beach')
		expect([...fixtures.answers.keys()]).toEqual(['files:sun'])
		expect(search).toMatchObject({answeredQuery: '', isSearching: true})

		await land('files:sun', 'a', 'b', 'c')
		expect(ids()).toEqual(['a', 'b', 'c'])
		expect(search).toMatchObject({answeredQuery: 'sun', isSearching: true})
		// Only what the field holds now: what was typed on the way is never asked
		expect([...fixtures.answers.keys()]).toEqual(['files:sun', 'files:sunset beach'])

		await land('files:sunset beach', 'b')
		expect(ids()).toEqual(['b'])
		expect(search).toMatchObject({answeredQuery: 'sunset beach', isSearching: false})
	})

	test('asks a different question at once, and a refinement whose wait has been long enough', async () => {
		await type('sun')
		await type('ikea receipt')
		expect([...fixtures.answers.keys()]).toEqual(['files:sun', 'files:ikea receipt'])

		await type('ikea receipt 2024')
		expect(fixtures.answers.has('files:ikea receipt 2024')).toBe(false)
		await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 1050)))
		expect(fixtures.answers.has('files:ikea receipt 2024')).toBe(true)
	})

	test('starts from nothing after the field was emptied, whatever is typed next', async () => {
		await type('sunset')
		await land('files:sunset', 'a', 'b')

		await type('')
		expect(ids()).toEqual([])

		await type('ikea receipt')
		expect(ids()).toEqual([])
		expect(search.isSearching).toBe(true)

		await type('')
		await type('sunset beach')
		expect(ids()).toEqual([])
	})

	test('drops the answer the moment a different question is typed, before it has settled', async () => {
		function Slow({query}: {query: string}) {
			search = useSearch({query, scope: 'files', limit: 10, debounceMs: 1000})
			return null
		}
		const typeSlowly = (query: string) =>
			act(() =>
				root.render(
					<QueryClientProvider client={client}>
						<Slow query={query} />
					</QueryClientProvider>,
				),
			)
		typeSlowly('sunset')
		await settle()
		await land('files:sunset', 'a', 'b')

		typeSlowly('sunset beach')
		expect(ids()).toEqual(['a', 'b'])

		typeSlowly('ikea receipt')
		expect(ids()).toEqual([])
		expect(search).toMatchObject({answeredQuery: '', isSearching: true})
	})

	test('starts from nothing for a different question, and for another scope', async () => {
		await type('sunset')
		await land('files:sunset', 'a', 'b')

		await type('ikea receipt')
		expect(ids()).toEqual([])

		await type('sunset')
		expect(ids()).toEqual(['a', 'b'])
		await type('sunset', 'photos')
		expect(ids()).toEqual([])
	})
})
