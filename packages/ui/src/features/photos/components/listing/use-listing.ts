import {useCallback, useEffect, useMemo, useRef} from 'react'
import {useLocation, useParams} from 'react-router-dom'

import {planSearch, type SearchChip, type SearchPlan} from '@/features/photos/components/search/plan'
import {usePhotosView} from '@/features/photos/components/view-context'
import {sectionPath} from '@/features/photos/constants'
import {useItems, type Item, type ItemFilter} from '@/features/photos/hooks/use-items'
import {useSmartSearch} from '@/features/photos/hooks/use-search'
import {refinesQuery} from '@/features/search/refine'
import {hasHighlight} from '@/features/search/snippet'
import type {SearchMoment, SearchSnippetText} from '@/features/search/types'
import {trpcReact} from '@/trpc/trpc'

// How many results a ranked search asks for at a time. A relevance list is
// read from the top, so the first page is most of what anyone looks at; the
// rest come a page at a time as the list is scrolled, and every surface
// (grid, lightbox, selection bar) shares the pages.
const RANKED_LIMIT = 120

const NO_ITEMS: Item[] = []
const NO_MOMENTS: ReadonlyMap<string, SearchMoment> = new Map()
const NO_SNIPPETS: ReadonlyMap<string, SearchSnippetText> = new Map()

// How the view on screen is being answered (see search/plan.ts)
export function useSearchPlan(): SearchPlan {
	const {section, sourceId, albumId, personId} = useParams()
	const {search, mapArea} = usePhotosView()
	const smart = useSmartSearch()
	// Only on the map: the page come to from it renders once before the map
	// has taken its area away
	const onMap = useLocation().pathname === sectionPath('map')
	const mapBounds = onMap ? mapArea?.bounds : undefined
	return useMemo(
		() =>
			planSearch({
				route: {section, sourceId, albumId, personId},
				text: search.appliedText,
				tokens: search.tokens,
				smart,
				map: onMap ? {bounds: mapBounds} : undefined,
			}),
		[section, sourceId, albumId, personId, search.appliedText, search.tokens, smart, onMap, mapBounds],
	)
}

// The list filter for the view on screen, as the timeline would ask for it:
// what the map draws its points from and lists beside them
export function useRouteFilter(): ItemFilter {
	const plan = useSearchPlan()
	return plan.mode === 'timeline' ? plan.filter : plan.fallback
}

export type Listing = {
	// 'timeline': newest first, date headers, pages. 'ranked': a search's
	// results, best match first, in pages too.
	mode: 'timeline' | 'ranked'
	// The list filter behind the view — in ranked mode the one it would fall
	// back to, which still says what the route narrows (Deleted, an album)
	filter: ItemFilter
	items: Item[]
	// How many the view holds. Unknown while `pending`: the list shown then
	// answers another question, and its count would be claimed by this one
	total?: number
	isLoading: boolean
	hasMore: boolean
	// The moment the timeline runs back from, when it is a tail (see useItems)
	before?: number
	loadMore: () => void
	// Ranked only: pages the search to its end, and resolves with the id of
	// everything it found — or with null if it could not be had whole (a page
	// failed, or another search was asked meanwhile). The timeline's is the
	// rail's (see Seek.loadAll).
	loadAll?: () => Promise<string[] | null>
	// A ranked search is on its way and the list shown is still the one
	// before it — nothing should be concluded from it (an empty screen, an
	// item's neighbours, what the words were understood as)
	pending: boolean
	// Ranked results that matched at a moment of a video, by item id
	moments: ReadonlyMap<string, SearchMoment>
	// … and the ones found by words in them (read off a photo, said in a
	// video), by item id: the words, so the inspector can point at them
	snippets: ReadonlyMap<string, SearchSnippetText>
	// Which search the ranked items shown answer. It changes when another
	// answer takes the screen, not when the same one is fetched again.
	answer?: string
	// What Search read out of the typed words: the filters, and the words
	// left over. Only ever of the search as it stands, never while `pending`.
	understood?: {chips: readonly SearchChip[]; text: string}
}

// Whether the answer to one ranked search may stand in while the next is
// fetched: only while the words are being refined (see refinesQuery) or stay
// as they are while the view around them changes (a token added). Results
// then re-rank in place instead of blinking away. Under a different question
// they would simply be the wrong photos, labelled as its best matches.
export function holdsRankedAnswer(previous: string, next: string) {
	return previous === next || refinesQuery(previous, next)
}

// The items the current view lists, whichever engine answers it. Everything
// that walks "the list on screen" — the grid, the lightbox's arrows and
// filmstrip, the selection bar, the count in the bar — reads it here, so a
// ranked search is walked in ranked order everywhere without any of them
// knowing there are two engines.
// `owner`: the screen that holds the list, which trims it back to its first
// pages when it leaves (see useItems)
export function useListing({enabled = true, owner = false}: {enabled?: boolean; owner?: boolean} = {}): Listing {
	const plan = useSearchPlan()
	const {search} = usePhotosView()
	const wantsRanked = plan.mode === 'ranked'
	const rankedInput = wantsRanked
		? {query: plan.query, scope: 'photos' as const, limit: RANKED_LIMIT, filter: plan.filter, placeIds: plan.placeIds}
		: {query: '', scope: 'photos' as const, limit: RANKED_LIMIT}
	// The ranked search whose answer is on screen, forgotten once the view
	// has been anything else: nothing is carried across an emptied field
	const answered = useRef<string | undefined>(undefined)
	if (!wantsRanked) answered.current = undefined
	// Photos decides what is in the view and Search the order: the view goes
	// as the filter the timeline would use, the words alone as the query
	const rankedQuery = trpcReact.search.query.useInfiniteQuery(rankedInput, {
		enabled: enabled && wantsRanked,
		initialCursor: 0,
		getNextPageParam: (last) => last.nextCursor,
		// React Query would hand back whatever it answered last, however long
		// ago; only the answer on screen, to this search being refined, stands in
		placeholderData: (previous, previousQuery) => {
			const input = (previousQuery?.queryKey[1] as {input?: typeof rankedInput} | undefined)?.input
			const held =
				input !== undefined &&
				JSON.stringify(input) === answered.current &&
				holdsRankedAnswer(input.query, rankedInput.query)
			return held ? previous : undefined
		},
		retry: false,
		refetchOnWindowFocus: false,
		// How long an answer is taken as it is. The screen that holds the list
		// says: for the bar and the lightbox it never ages, or starting a
		// selection or opening a photo would have Search answer every page
		// on screen again. A change to the library still marks it stale for all.
		staleTime: owner ? 30_000 : Infinity,
	})
	// Search could not answer (an older umbreld, a model that fell over):
	// the search degrades to the name match it always was. Only for want of
	// an answer: a later page or a refresh that fails leaves the one on screen.
	const ranked = wantsRanked && !rankedQuery.isLoadingError
	const filter = wantsRanked ? plan.fallback : plan.filter
	const list = useItems(filter, {enabled: enabled && !ranked, keepPrevious: search.active, owner})

	const pages = rankedQuery.data?.pages
	// What the search understood and how much it found are the same on every page
	const results = pages?.[0]
	const held = rankedQuery.isPlaceholderData
	if (ranked && results && !held) answered.current = JSON.stringify(rankedInput)
	const rankedItems = useMemo(() => {
		const items: Item[] = []
		const moments = new Map<string, SearchMoment>()
		const snippets = new Map<string, SearchSnippetText>()
		const seen = new Set<string>()
		// Already ranked by Search, and already only what the view holds: the
		// order is the answer, never re-sorted
		for (const {photo, moment, snippet} of pages?.flatMap((page) => page.results) ?? []) {
			// One photo can be found at two paths; it is one tile
			if (!photo || seen.has(photo.id)) continue
			seen.add(photo.id)
			items.push(photo)
			if (moment) moments.set(photo.id, moment)
			if (snippet && hasHighlight(snippet)) snippets.set(photo.id, snippet)
		}
		return {items, moments, snippets}
	}, [pages])
	const {isFetchingNextPage, fetchNextPage} = rankedQuery
	// A page that failed ends the list where it got to, until the search is
	// read again: asked for whenever the list's end is near, it would be
	// asked for over and over
	const hasNextPage = rankedQuery.hasNextPage && !rankedQuery.isFetchNextPageError
	const loadMoreRanked = useCallback(() => {
		if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
	}, [hasNextPage, isFetchingNextPage, fetchNextPage])
	// The search being asked, for a run of pages to notice it has been replaced
	const asking = useRef('')
	asking.current = JSON.stringify(rankedInput)
	// … or that the screen asking has gone, and no one is left to select them
	const mounted = useRef(true)
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])
	const loadAllRanked = useCallback(async () => {
		const asked = asking.current
		for (;;) {
			// (A refresh under way is joined instead, and brings no page: asked again)
			const {data, hasNextPage, isError} = await fetchNextPage({cancelRefetch: false})
			if (isError || !data || asking.current !== asked || !mounted.current) return null
			if (!hasNextPage)
				return data.pages.flatMap((page) => page.results.flatMap(({photo}) => (photo ? [photo.id] : [])))
		}
	}, [fetchNextPage])

	if (ranked && results) {
		return {
			mode: 'ranked',
			filter,
			items: rankedItems.items,
			// A held answer is the previous search's: its count and what it
			// understood are not this one's to show. The count is of everything
			// found, of which the pages fetched so far are listed.
			total: held ? undefined : Math.max(results.total, rankedItems.items.length),
			isLoading: false,
			hasMore: !held && hasNextPage,
			loadMore: held ? noop : loadMoreRanked,
			loadAll: loadAllRanked,
			pending: held,
			moments: rankedItems.moments,
			snippets: rankedItems.snippets,
			answer: answered.current,
			understood: held ? undefined : results.understood,
		}
	}
	// A different question asked over a search's results is awaited with
	// nothing: the timeline has not been on screen since those results took
	// its place, and would be the whole library flashing by between two answers
	const items = ranked && answered.current !== undefined ? NO_ITEMS : list.items
	return {
		mode: 'timeline',
		filter,
		items,
		// The first ranked answer is awaited over whatever was listed before,
		// whose count is that list's and not the search's
		total: ranked ? undefined : list.total,
		isLoading: ranked ? items.length === 0 : list.isLoading,
		hasMore: ranked ? false : list.hasMore,
		before: ranked ? undefined : list.before,
		loadMore: ranked ? noop : list.loadMore,
		pending: ranked,
		moments: NO_MOMENTS,
		snippets: NO_SNIPPETS,
	}
}

function noop() {}
