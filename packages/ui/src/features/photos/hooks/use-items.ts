import {
	keepPreviousData,
	useMutation,
	useQueryClient,
	type InfiniteData,
	type Query,
	type QueryClient,
	type QueryKey,
} from '@tanstack/react-query'
import {getQueryKey} from '@trpc/react-query'
import {useEffect, useMemo} from 'react'
import {useParams} from 'react-router-dom'

import {monthKeyOf, yearOf} from '@/features/photos/components/listing/time-rail/rail-scale'
import {usePhotosView} from '@/features/photos/components/view-context'
import {inBatches, inBatchesIsolating} from '@/features/photos/hooks/batches'
import {moveActivity} from '@/features/photos/hooks/move-activity'
import {authorizedHttpUrl} from '@/modules/auth/http-auth'
import {RouterInput, RouterOutput, trpcClient, trpcReact} from '@/trpc/trpc'
import {MS_PER_MINUTE} from '@/utils/date-time'

export type ItemFilter = NonNullable<RouterInput['photos']['items']['list']['filter']>
export type ItemsPage = RouterOutput['photos']['items']['list']
export type Item = ItemsPage['items'][number]
export type ItemDetail = RouterOutput['photos']['items']['get']
type Summary = RouterOutput['photos']['library']['summary']

// Every item URL is derived from the id — API responses carry no URL fields
// (see umbreld modules/photos/CONTRACT.md). The renditions: 192 feeds the
// zoomed-out mosaic and the filmstrip, 512 the grid tiles and covers, 1280
// the lightbox's resting image.
export type ThumbSize = 192 | 512 | 1280
export const itemThumbnailUrl = (id: string, size: ThumbSize) => `/api/photos/thumb/${encodeURIComponent(id)}?s=${size}`
export const itemOriginalUrl = (id: string, {download = false} = {}) =>
	`/api/photos/original/${encodeURIComponent(id)}${download ? '?download' : ''}`
// A live pair's motion clip — only answers for items with subKind 'live'
export const itemLiveUrl = (id: string) => `/api/photos/live/${encodeURIComponent(id)}`
export const itemsDownloadUrl = (ticket: string) => `/api/photos/download?ticket=${encodeURIComponent(ticket)}`

// tRPC's query-key prefix for every photos.items.list query (any filter, any cursor)
export const ITEMS_LIST_KEY = [['photos', 'items', 'list']] as const

// What names a list across the app: its filter, by value
export const listKey = (filter: ItemFilter) => JSON.stringify(filter)

// The oldest moment a date clause can name (the earliest a Date holds)
const BEGINNING = -8.64e15

// A list's tail: everything it holds that was taken before a moment. It is
// the same list asked through the filter's own date clause, so it is one
// request however far down the timeline that moment is — where the list from
// the top, keyset-paginated, would have to walk every page in between.
export const tailFilter = (filter: ItemFilter, before: number): ItemFilter => ({
	...filter,
	dates: (filter.dates ?? [{from: BEGINNING, to: before}])
		.map(({from, to}) => ({from, to: Math.min(to, before)}))
		.filter(({from, to}) => from < to),
})

// ── Keeping a list up to date ──
//
// A list is pages chained by cursor, and it grows two ways: a page of the
// session's size as the grid scrolls, and pages of a thousand spliced in by a
// jump along the rail or by Select all (see use-seek.ts). The query library
// knows neither: asked to refresh a list it fetches as many pages as the list
// had, each of the session's size, one after another. A timeline scrolled
// through is a hundred requests in a row; one that holds thousand-item pages
// comes back a fifth of its length, and the grid, with nothing left where it
// was scrolled to, is thrown somewhere else. It would do that whenever the
// tab came back into view, the socket reconnected, or anything invalidated
// Photos' queries.
//
// So lists are `static` to the library (it never refetches them on its own,
// not on mount or focus, not when invalidated) and Photos refreshes them
// itself, where a refresh is safe:
// - one that has just come on screen and holds a single page is fetched again
//   if it has gone stale (refreshHead), and a listing that is left keeps only
//   that page (trimList), so coming back to it is one request;
// - a change event refetches short lists in place and marks the rest stale
//   (see use-photos-events.ts);
// - a change that failed is undone by reading the list again as far as it
//   was loaded, in the largest pages there are (rereadList).

// How long a list is taken as it is: the app's own stale time
const LIST_FRESH_MS = MS_PER_MINUTE
// The most the contract hands over in one page
const LIST_PAGE_MAX = 1000

// (the first page's param is null: the library's "from the top")
type ItemsList = InfiniteData<ItemsPage, string | null | undefined>
type ListInput = {filter: ItemFilter; limit: number}

// What a cached list was asked with, from its tRPC query key
// ([path, {input: {filter, limit}, type: 'infinite'}])
const listInput = (queryKey: readonly unknown[]): Partial<ListInput> =>
	(queryKey[1] as {input?: Partial<ListInput>} | undefined)?.input ?? {}

// Whether every page of a list is one the query itself could have fetched.
// Only such a list comes back as it was from the library's own refetch.
export function isUniformList(query: Pick<Query, 'queryKey' | 'state'>) {
	const limit = listInput(query.queryKey).limit ?? Infinity
	const pages = (query.state.data as ItemsList | undefined)?.pages ?? []
	return pages.every((page) => page.items.length <= limit)
}

const findList = (queryClient: QueryClient, queryKey: QueryKey) =>
	queryClient.getQueryCache().find<ItemsList>({queryKey, exact: true})

// A list that has come on screen with one page to its name, gone stale since
// it was fetched: asked for again. One page can only come back as one page.
export function refreshHead(queryClient: QueryClient, queryKey: QueryKey) {
	const query = findList(queryClient, queryKey)
	if (!query || query.state.data?.pages.length !== 1 || query.state.fetchStatus !== 'idle') return
	if (!query.state.isInvalidated && Date.now() - query.state.dataUpdatedAt < LIST_FRESH_MS) return
	void query.fetch().catch(() => undefined)
}

// A listing that has been left keeps its first page: what it shows first when
// it is come back to, at the top, where every listing starts
export function trimList(queryClient: QueryClient, queryKey: QueryKey) {
	const query = findList(queryClient, queryKey)
	const data = query?.state.data
	if (!query || !data || data.pages.length <= 1) return
	const {isInvalidated, dataUpdatedAt} = query.state
	// As old as it was, and as stale: writing it would otherwise make it new
	queryClient.setQueryData<ItemsList>(
		queryKey,
		{pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1)},
		{updatedAt: dataUpdatedAt},
	)
	if (isInvalidated) query.invalidate()
}

// Reads a list again from the top as far as it was loaded, and puts what
// came back in its place: for a list on screen that an undone change has left
// wrong. A thousand at a time, so a long list is a handful of requests. If
// the list was changed again meanwhile it is left as it is, and stays stale.
export async function rereadList(queryClient: QueryClient, query: Query<ItemsList>) {
	const {filter} = listInput(query.queryKey)
	const before = query.state.data
	if (!filter || !before) return
	const loaded = before.pages.reduce((count, page) => count + page.items.length, 0)
	const pages: ItemsPage[] = []
	// The first page's param is kept as it was: the library's own way of
	// saying "from the top" (null), which is no cursor to the server
	const pageParams = before.pageParams.slice(0, 1)
	let cursor: string | undefined
	for (let read = 0; pages.length === 0 || (cursor !== undefined && read < loaded); ) {
		const page: ItemsPage = await trpcClient.photos.items.list.query({filter, cursor, limit: LIST_PAGE_MAX})
		if (pages.length > 0) pageParams.push(cursor)
		pages.push(page)
		read += page.items.length
		cursor = page.nextCursor
	}
	if (query.state.data !== before || findList(queryClient, query.queryKey) !== query) return
	queryClient.setQueryData<ItemsList>(query.queryKey, {pages, pageParams})
}

// The timeline: one infinite query per filter, newest first, keyset-paginated.
// The page size is the session's (see PhotosView.pageSize): it is part of the
// query's identity, so every caller — the grid, the lightbox, the selection
// bar — asks with the same one and shares the pages.
// `keepPrevious` holds the last filter's list up while the next one loads —
// for a search being refined, where the old results morphing into the new
// beats a spinner between every keystroke.
// `owner` is the listing that puts the list on screen, as against the bar
// and the lightbox, which read whatever it holds: when it leaves, the list
// is cut back to its first page.
//
// After a jump far down the timeline the list is its tail from there (see
// PhotosView.tail) until the list from the top has been paged down to meet
// it. Every caller gets the same one, so what the lightbox steps through and
// the selection bar counts is what the grid shows.
export function useItems(filter: ItemFilter, {enabled = true, keepPrevious = false, owner = false} = {}) {
	const {pageSize, tail} = usePhotosView()
	const queryClient = useQueryClient()
	const paging = {
		getNextPageParam: (lastPage: ItemsPage) => lastPage.nextCursor,
		initialCursor: undefined,
		// Photos refreshes its lists itself: see "Keeping a list up to date"
		staleTime: 'static' as const,
	}
	const whole = trpcReact.photos.items.list.useInfiniteQuery(
		{filter, limit: pageSize},
		{...paging, enabled, placeholderData: keepPrevious ? keepPreviousData : undefined},
	)
	const key = useMemo(() => listKey(filter), [filter])
	const wholeKey = useMemo(
		() => getQueryKey(trpcReact.photos.items.list, {filter, limit: pageSize}, 'infinite'),
		[filter, pageSize],
	)
	useEffect(() => {
		if (enabled) refreshHead(queryClient, wholeKey)
	}, [enabled, queryClient, wholeKey])
	useEffect(() => {
		if (!owner) return
		return () => trimList(queryClient, wholeKey)
	}, [owner, queryClient, wholeKey])
	const before = tail?.list === key ? tail.before : undefined
	const lower = useMemo(() => (before === undefined ? filter : tailFilter(filter, before)), [filter, before])
	// The tail is fetched before it is opened: its pages are already here
	const tailed = trpcReact.photos.items.list.useInfiniteQuery(
		{filter: lower, limit: pageSize},
		{...paging, enabled: enabled && before !== undefined},
	)
	const isTail = before !== undefined && tailed.data !== undefined
	const query = isTail ? tailed : whole
	const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data])
	return {
		items,
		// The moment the list runs back from, when it is a tail
		before: isTail ? before : undefined,
		// How many the filter matches in all, beyond the pages loaded so far
		total: whole.data?.pages[0]?.total,
		isLoading: whole.isLoading,
		error: query.error,
		hasMore: Boolean(query.hasNextPage),
		isLoadingMore: query.isFetchingNextPage,
		// cancelRefetch: false makes a call during an in-flight fetch a no-op instead
		// of cancelling and restarting it, so render-driven requests can't thrash.
		// Held-up previous results (placeholder) can't page: their cursor belongs
		// to the filter before this one.
		loadMore: () => {
			if (query.hasNextPage && !query.isFetchingNextPage && !query.isPlaceholderData)
				void query.fetchNextPage({cancelRefetch: false})
		},
	}
}

export function useItem(id: string | undefined, deleted = false) {
	return trpcReact.photos.items.get.useQuery({id: id ?? '', deleted}, {enabled: Boolean(id)})
}

export function useItemNeighbors(id: string | undefined, filter: ItemFilter) {
	return trpcReact.photos.items.neighbors.useQuery({id: id ?? '', filter}, {enabled: Boolean(id)})
}

// The filter a cached list was fetched with
const listFilter = (queryKey: readonly unknown[]): ItemFilter => listInput(queryKey).filter ?? {}

// ── Counting a change as it is asked for ──
//
// The bar counts from the library summary, and the summary only changes once
// the server has finished: it moves files to the Trash one at a time, a
// thousand take it most of half a minute, and all that while the tiles are
// long gone from the grid and the bar still counts them. So the summary is
// told what a change will come to the moment it is asked for, from what the
// lists know of the items: how many, their kind, whether they are favourites,
// the month they were taken in (which is the rail's calendar). What it cannot
// know (their size, their source) and anything it gets wrong, the summary
// read once the change has settled puts right.
const atLeastZero = <T extends Record<string, number>>(numbers: T) =>
	Object.fromEntries(Object.entries(numbers).map(([name, value]) => [name, Math.max(0, value)])) as T

// `count` items on their way to the Trash, or back from it to the library;
// `items` is as many of them as the lists hold
export function summaryAfterMove(summary: Summary, items: Item[], count: number, to: 'trash' | 'library'): Summary {
	const by = to === 'trash' ? -1 : 1
	const counts = {...summary.counts, items: summary.counts.items + by * count}
	counts.deleted -= by * count
	const bySubKind = {...summary.bySubKind}
	const months = new Map(summary.months.map(({year, month, count}) => [year * 12 + month - 1, count]))
	for (const item of items) {
		counts[item.kind === 'video' ? 'videos' : 'photos'] += by
		if (item.isFavorite) counts.favorites += by
		if (item.subKind) bySubKind[item.subKind] += by
		const key = monthKeyOf(item.takenAt)
		months.set(key, (months.get(key) ?? 0) + by)
	}
	return {
		...summary,
		counts: atLeastZero(counts),
		bySubKind: atLeastZero(bySubKind),
		// Newest first, and no month left standing empty
		months: [...months]
			.filter(([, count]) => count > 0)
			.sort(([a], [b]) => b - a)
			.map(([key, count]) => ({year: yearOf(key), month: key - yearOf(key) * 12 + 1, count})),
	}
}

// Cache-level edits so a mutation shows instantly and never triggers a
// refetch of every loaded page. Lists are marked stale for their next mount.
export function useItemCache() {
	const queryClient = useQueryClient()
	const utils = trpcReact.useUtils()
	const settle = () => {
		void utils.photos.library.summary.invalidate()
		void queryClient.invalidateQueries({queryKey: ITEMS_LIST_KEY, refetchType: 'none'})
	}
	// The change didn't happen: the lists on screen are read again, to show
	// what the change had already taken out of them or altered in them
	const recover = () => {
		void utils.photos.library.summary.invalidate()
		void queryClient.invalidateQueries({queryKey: ITEMS_LIST_KEY, refetchType: 'none'})
		for (const query of queryClient.getQueryCache().findAll({queryKey: ITEMS_LIST_KEY, type: 'active'})) {
			void rereadList(queryClient, query as Query<ItemsList>).catch(() => undefined)
		}
	}
	const patch = (ids: string[], update: (item: Item) => Item) => {
		const set = new Set(ids)
		queryClient.setQueriesData<InfiniteData<ItemsPage>>({queryKey: ITEMS_LIST_KEY}, (data) =>
			data
				? {
						...data,
						pages: data.pages.map((page) => ({
							...page,
							items: page.items.map((item) => (set.has(item.id) ? update(item) : item)),
						})),
					}
				: data,
		)
	}
	// Drops the items from every list, or only from the lists `inList` picks
	// (the ones the items have actually left)
	const remove = (ids: string[], inList?: (filter: ItemFilter) => boolean) => {
		const set = new Set(ids)
		const filters = {
			queryKey: ITEMS_LIST_KEY,
			predicate: inList && ((query: {queryKey: readonly unknown[]}) => inList(listFilter(query.queryKey))),
		}
		queryClient.setQueriesData<InfiniteData<ItemsPage>>(filters, (data) =>
			data
				? {...data, pages: data.pages.map((page) => ({...page, items: page.items.filter((item) => !set.has(item.id))}))}
				: data,
		)
	}
	// The items themselves, as many as any list holds: for counting what a
	// change does before the lists let go of them
	const known = (ids: string[]) => {
		const wanted = new Set(ids)
		const found = new Map<string, Item>()
		for (const [, data] of queryClient.getQueriesData<ItemsList>({queryKey: ITEMS_LIST_KEY})) {
			for (const page of data?.pages ?? []) {
				for (const item of page.items) if (wanted.has(item.id)) found.set(item.id, item)
			}
		}
		return [...found.values()]
	}
	const count = (change: (summary: Summary) => Summary) =>
		utils.photos.library.summary.setData(undefined, (summary) => summary && change(summary))
	return {patch, remove, settle, recover, known, count}
}

// What can be done to a selection of any size. Each is one change on screen —
// made at once, undone as one if it fails — however many requests it takes to
// tell the server (see batches.ts).
export function useItemActions() {
	const {patch, remove, settle, recover, known, count} = useItemCache()
	const utils = trpcReact.useUtils()
	const server = utils.client.photos.items
	// A delete or a restore of a selection, which carries on past the items
	// the server cannot move (see inBatchesIsolating). All of them refused is
	// the change failing. Some of them is the change made, with those few left
	// where they were: they are handed back for the caller to say how many,
	// and the lists are read again to show them.
	const moveAll = async (ids: string[], send: (batch: string[]) => Promise<unknown>) => {
		const {failed, error} = await inBatchesIsolating(ids, send)
		if (failed.length === ids.length) throw error
		return {failed}
	}
	const showLeftBehind = ({failed}: {failed: string[]}) => {
		if (failed.length > 0) recover()
	}
	// The album whose page this is, if it is one: what leaves the library from
	// here leaves that album too
	const {albumId} = useParams()
	const setFavorite = useMutation({
		mutationFn: ({ids, favorite}: {ids: string[]; favorite: boolean}) =>
			inBatches(ids, (batch) => server.setFavorite.mutate({ids: batch, favorite})),
		onMutate: ({ids, favorite}) => {
			const changed = known(ids).filter((item) => item.isFavorite !== favorite).length
			count((summary) => ({
				...summary,
				counts: {...summary.counts, favorites: Math.max(0, summary.counts.favorites + (favorite ? changed : -changed))},
			}))
			patch(ids, (item) => ({...item, isFavorite: favorite}))
			// … and an unfavorited item is no longer in Favorites
			if (!favorite) remove(ids, (filter) => filter.favorite === true)
		},
		onSettled: () => {
			settle()
			// Every detail in one pass, not one pass over the cache for each
			// item: a whole view favorited at once is twenty thousand of them
			void utils.photos.items.get.invalidate()
		},
		onError: recover,
	})
	// Deleting or restoring moves an item between lists, so it leaves whichever
	// list it is in right now; the destination list picks it up when next shown.
	// The server is a while about it, and nothing is read from it until it has
	// finished (see move-activity.ts).
	const settleMove = () => {
		moveActivity.end()
		settle()
	}
	const move = (to: 'trash' | 'library') => ({
		onMutate: ({ids}: {ids: string[]}) => {
			moveActivity.begin()
			const items = known(ids)
			count((summary) => summaryAfterMove(summary, items, ids.length, to))
			if (albumId && to === 'trash') {
				utils.photos.albums.list.setData(undefined, (albums) =>
					albums?.map((album) =>
						album.id === albumId ? {...album, count: Math.max(0, album.count - ids.length)} : album,
					),
				)
			}
			remove(ids)
		},
		onError: recover,
		onSettled: settleMove,
	})
	const del = useMutation({
		mutationFn: ({ids}: {ids: string[]}) => moveAll(ids, (batch) => server.delete.mutate({ids: batch})),
		...move('trash'),
		onSuccess: showLeftBehind,
	})
	const restore = useMutation({
		mutationFn: ({ids}: {ids: string[]}) => moveAll(ids, (batch) => server.restore.mutate({ids: batch})),
		...move('library'),
		onSuccess: showLeftBehind,
	})
	const deletePermanently = useMutation({
		// With no ids it is everything in the Trash, which the server finds itself
		mutationFn: async ({ids}: {ids?: string[]}) => {
			if (ids) return moveAll(ids, (batch) => server.deletePermanently.mutate({ids: batch}))
			await server.deletePermanently.mutate({})
			return {failed: []}
		},
		onSuccess: showLeftBehind,
		onMutate: ({ids}) => {
			moveActivity.begin()
			if (!ids) return
			count((summary) => ({
				...summary,
				counts: {...summary.counts, deleted: Math.max(0, summary.counts.deleted - ids.length)},
			}))
			remove(ids)
		},
		onError: recover,
		onSettled: (_data, _error, {ids}) => {
			moveActivity.end()
			if (ids) settle()
			else recover()
		},
	})
	return {
		setFavorite: setFavorite.mutateAsync,
		deleteItems: del.mutateAsync,
		restoreItems: restore.mutateAsync,
		deletePermanently: deletePermanently.mutateAsync,
	}
}

// Downloads items through the browser: one file, or a zip of several. The
// URL is derived from the ids and authorized like any other file URL.
export function useDownloadItems() {
	const createDownload = trpcReact.photos.items.createDownload.useMutation()
	return async (ids: string[]) => {
		const {ticket} = await createDownload.mutateAsync({ids})
		const anchor = document.createElement('a')
		anchor.href = await authorizedHttpUrl(itemsDownloadUrl(ticket))
		anchor.download = ''
		document.body.append(anchor)
		anchor.click()
		anchor.remove()
	}
}
