// @vitest-environment jsdom

import {QueryClient, QueryClientProvider, useQuery} from '@tanstack/react-query'
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import type {SearchSurface} from './status'
import type {SearchStatus} from './types'
import {useSearchArc, useSearchFootnote, useSearchWork} from './use-search-footnote'

const count = (completed: number, total: number) => ({completed, total})
const fixtures = vi.hoisted(() => ({
	asked: 0,
	failing: false,
	progress: {} as Record<string, {completed: number; total: number}>,
}))

// search.indexing as React Query runs it, answering with the counts of the moment
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		search: {
			indexing: {
				useQuery: (_input: undefined, options: object) =>
					useQuery({
						queryKey: [['search', 'indexing']],
						queryFn: async () => {
							fixtures.asked++
							if (fixtures.failing) throw new Error('could not be counted')
							return {enabled: true, progress: {...fixtures.progress}}
						},
						...options,
					}),
			},
		},
	},
}))
vi.mock('react-i18next', () => ({
	// The line says its number, formatted for the language
	useTranslation: () => ({
		t: (key: string, options?: {percent?: string}) => (options?.percent ? `${key} ${options.percent}` : key),
		i18n: {language: 'en'},
	}),
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

// The line while a surface's work is under way: the sentence, its short form, and the number both say
const analyzing = (what: 'library' | 'files', percent: number) => ({
	text: `search.analyzing.${what} ${percent}%`,
	short: `search.analyzing-short.${what} ${percent}%`,
	percent,
	number: `${percent}%`,
})

const UP: SearchStatus = {available: true, indexing: count(10, 1000)}

describe('useSearchFootnote', () => {
	let container: HTMLDivElement
	let root: ReturnType<typeof createRoot>
	let client: QueryClient
	let footnote: ReturnType<typeof useSearchFootnote>
	// Every line drawn, in order: what flashed by as well as what stayed
	let drawn: Array<ReturnType<typeof useSearchFootnote>>

	function Probe({surface, status}: {surface: Exclude<SearchSurface, 'people'>; status: SearchStatus | undefined}) {
		footnote = useSearchFootnote(surface, status)
		drawn.push(footnote)
		return null
	}

	const show = async (surface: Exclude<SearchSurface, 'people'>, status: SearchStatus | undefined) => {
		await act(async () => {
			root.render(
				<QueryClientProvider client={client}>
					<Probe surface={surface} status={status} />
				</QueryClientProvider>,
			)
		})
		// React Query tells its observers a task after an answer lands
		await pass(20)
	}
	const pass = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

	beforeEach(() => {
		vi.useFakeTimers()
		fixtures.asked = 0
		fixtures.failing = false
		drawn = []
		fixtures.progress = {
			previews: count(1000, 1000),
			embedding: count(1000, 1000),
			text: count(1000, 1000),
			faces: count(1000, 1000),
			speech: count(0, 400),
		}
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
		client = new QueryClient()
	})

	afterEach(async () => {
		await act(async () => root.unmount())
		container.remove()
		client.clear()
		vi.useRealTimers()
	})

	test('asks nothing and says nothing until there is a search to speak of', async () => {
		fixtures.progress.faces = count(100, 1000)
		await show('everywhere', undefined)
		expect(footnote).toBeUndefined()
		expect(fixtures.asked).toBe(0)
	})

	test('says nothing once all but speech is read, and stops asking', async () => {
		await show('everywhere', UP)
		expect(footnote).toBeUndefined()
		await pass(60_000)
		expect(fixtures.asked).toBe(1)
	})

	test('shows how far along the reading is, follows it, and is gone when it is done', async () => {
		fixtures.progress.faces = count(100, 1000)
		await show('everywhere', UP)
		expect(footnote).toEqual(analyzing('library', 70))
		fixtures.progress.faces = count(400, 1000)
		await pass(5000)
		expect(footnote).toEqual(analyzing('library', 80))
		fixtures.progress.faces = count(1000, 1000)
		await pass(5000)
		expect(footnote).toBeUndefined()
	})

	test('never draws the counts of an earlier look when a search is typed again', async () => {
		fixtures.progress.faces = count(100, 1000)
		await show('everywhere', UP)
		expect(footnote?.percent).toBe(70)
		// The field is cleared, and the reading finishes meanwhile
		await show('everywhere', undefined)
		expect(footnote).toBeUndefined()
		fixtures.progress.faces = count(1000, 1000)
		drawn = []
		await show('everywhere', UP)
		expect(drawn.length).toBeGreaterThan(0)
		expect(drawn.every((line) => line === undefined)).toBe(true)

		// ... nor when the new count cannot be had
		fixtures.progress.faces = count(100, 1000)
		await show('everywhere', undefined)
		await show('everywhere', UP)
		expect(footnote?.percent).toBe(70)
		await show('everywhere', undefined)
		fixtures.failing = true
		drawn = []
		await show('everywhere', UP)
		expect(drawn.every((line) => line === undefined)).toBe(true)
	})

	test('counts again when there is more to read, long after it stopped asking', async () => {
		await show('everywhere', UP)
		await pass(60_000)
		expect(footnote).toBeUndefined()
		expect(fixtures.asked).toBe(1)
		// Five hundred files arrive: the status, which is streamed, says so
		fixtures.progress.embedding = count(1000, 1500)
		await show('everywhere', {available: true, indexing: count(10, 1500)})
		expect(footnote).toEqual(analyzing('library', 85))
		fixtures.progress.embedding = count(1250, 1500)
		await pass(5000)
		expect(footnote?.percent).toBe(92)
	})

	test('does not keep counting while the reading waits for memory, and picks it up after', async () => {
		fixtures.progress.faces = count(100, 1000)
		await show('everywhere', {available: true, indexing: {...count(10, 1000), waitingForMemory: true}})
		expect(footnote).toEqual({text: 'search.analyzing-waiting-for-memory', percent: 70})
		await pass(60_000)
		expect(fixtures.asked).toBe(1)
		fixtures.progress.faces = count(400, 1000)
		await show('everywhere', UP)
		expect(footnote).toEqual(analyzing('library', 80))
		await pass(5000)
		expect(fixtures.asked).toBe(3)
	})

	test('holds Files back for text and what photos show, not for faces', async () => {
		fixtures.progress.faces = count(100, 1000)
		await show('files', UP)
		expect(footnote).toBeUndefined()
		fixtures.progress.text = count(500, 1000)
		await act(async () => void (await client.refetchQueries()))
		await pass(20)
		expect(footnote).toEqual(analyzing('files', 75))
	})

	test('says nothing of a few files just added, and speaks once there is enough to', async () => {
		fixtures.progress.text = count(995, 1000)
		await show('everywhere', UP)
		expect(footnote).toBeUndefined()
		// Still there a minute on: counted again, and still not spoken of
		await pass(60_000)
		expect(footnote).toBeUndefined()
		expect(fixtures.asked).toBeGreaterThan(1)

		fixtures.progress.text = count(1000, 1400)
		await pass(5000)
		expect(footnote).toEqual(analyzing('library', 88))
		// Nearly through: the arc does not hang on for the last few
		fixtures.progress.text = count(1390, 1400)
		await pass(5000)
		expect(footnote).toBeUndefined()
	})

	test('leaves a device that is not reading to say why, without counting', async () => {
		fixtures.progress.faces = count(100, 1000)
		await show('everywhere', {available: false, reason: 'starting', indexing: count(0, 0)})
		expect(footnote).toEqual({text: 'search.starting'})
		expect(fixtures.asked).toBe(0)
	})

	test('shows no line, arc or faces count on a device with the reading switched off, without counting', async () => {
		fixtures.progress.faces = count(100, 1000)
		const off: SearchStatus = {available: true, indexing: {...count(10, 1000), off: true}}
		let arc: ReturnType<typeof useSearchArc>
		let faces: ReturnType<typeof useSearchWork>
		function Surfaces() {
			arc = useSearchArc('photos', off)
			faces = useSearchWork('people', off)
			return <Probe surface='everywhere' status={off} />
		}
		await act(async () => {
			root.render(
				<QueryClientProvider client={client}>
					<Surfaces />
				</QueryClientProvider>,
			)
		})
		await pass(60_000)
		expect(drawn.every((line) => line === undefined)).toBe(true)
		expect(arc!).toBeUndefined()
		expect(faces!).toBeNull()
		expect(fixtures.asked).toBe(0)
	})

	test('tells a device that only matches names so for its first search, and never again', async () => {
		const namesOnly: SearchStatus = {available: false, reason: 'unsupported-device', indexing: count(0, 0)}
		await show('photos', namesOnly)
		expect(footnote).toEqual({text: 'search.names-only'})
		// Still said while that search is up
		await pass(60_000)
		expect(footnote).toEqual({text: 'search.names-only'})
		await show('photos', undefined)
		expect(footnote).toBeUndefined()
		await show('everywhere', namesOnly)
		expect(footnote).toBeUndefined()
		expect(fixtures.asked).toBe(0)
	})
})
