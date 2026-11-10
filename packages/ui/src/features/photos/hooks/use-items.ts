import {keepPreviousData, useQueryClient, type InfiniteData} from '@tanstack/react-query'
import {useMemo} from 'react'

import {usePhotosView} from '@/features/photos/components/view-context'
import {authorizedHttpUrl} from '@/modules/auth/http-auth'
import {RouterInput, RouterOutput, trpcReact} from '@/trpc/trpc'

export type ItemFilter = NonNullable<RouterInput['photos']['items']['list']['filter']>
export type ItemsPage = RouterOutput['photos']['items']['list']
export type Item = ItemsPage['items'][number]
export type ItemDetail = RouterOutput['photos']['items']['get']

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

// The timeline: one infinite query per filter, newest first, keyset-paginated.
// The page size is the session's (see PhotosView.pageSize): it is part of the
// query's identity, so every caller — the grid, the lightbox, the selection
// bar — asks with the same one and shares the pages.
// `keepPrevious` holds the last filter's list up while the next one loads —
// for a search being refined, where the old results morphing into the new
// beats a spinner between every keystroke.
//
// After a jump far down the timeline the list is its tail from there (see
// PhotosView.tail) until the list from the top has been paged down to meet
// it. Every caller gets the same one, so what the lightbox steps through and
// the selection bar counts is what the grid shows.
export function useItems(filter: ItemFilter, {enabled = true, keepPrevious = false} = {}) {
	const {pageSize, tail} = usePhotosView()
	const paging = {getNextPageParam: (lastPage: ItemsPage) => lastPage.nextCursor, initialCursor: undefined}
	const whole = trpcReact.photos.items.list.useInfiniteQuery(
		{filter, limit: pageSize},
		{...paging, enabled, placeholderData: keepPrevious ? keepPreviousData : undefined},
	)
	const key = useMemo(() => listKey(filter), [filter])
	const before = tail?.list === key ? tail.before : undefined
	const lower = useMemo(() => (before === undefined ? filter : tailFilter(filter, before)), [filter, before])
	// The tail is fetched before it is opened: its pages are already here, and
	// mounting it must not ask for them again
	const tailed = trpcReact.photos.items.list.useInfiniteQuery(
		{filter: lower, limit: pageSize},
		{...paging, enabled: enabled && before !== undefined, refetchOnMount: false},
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

// The filter a cached list was fetched with, from its tRPC query key
// ([path, {input: {filter, limit}, type: 'infinite'}])
const listFilter = (queryKey: readonly unknown[]): ItemFilter =>
	(queryKey[1] as {input?: {filter?: ItemFilter}} | undefined)?.input?.filter ?? {}

// Cache-level edits so a mutation shows instantly and never triggers a
// refetch of every loaded page. Lists are marked stale for their next mount.
export function useItemCache() {
	const queryClient = useQueryClient()
	const utils = trpcReact.useUtils()
	const settle = () => {
		void utils.photos.library.summary.invalidate()
		void queryClient.invalidateQueries({queryKey: ITEMS_LIST_KEY, refetchType: 'none'})
	}
	const recover = () => {
		void utils.photos.library.summary.invalidate()
		void queryClient.invalidateQueries({queryKey: ITEMS_LIST_KEY, refetchType: 'active'})
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
	return {patch, remove, settle, recover}
}

export function useItemActions() {
	const {patch, remove, settle, recover} = useItemCache()
	const utils = trpcReact.useUtils()
	const setFavorite = trpcReact.photos.items.setFavorite.useMutation({
		onMutate: ({ids, favorite}) => {
			patch(ids, (item) => ({...item, isFavorite: favorite}))
			// … and an unfavorited item is no longer in Favorites
			if (!favorite) remove(ids, (filter) => filter.favorite === true)
		},
		onSettled: (_data, _error, {ids}) => {
			settle()
			for (const id of ids) void utils.photos.items.get.invalidate({id})
		},
		onError: recover,
	})
	// Deleting or restoring moves an item between lists, so it leaves whichever
	// list it is in right now; the destination list picks it up when next shown
	const removeFromLists = {onMutate: ({ids}: {ids: string[]}) => remove(ids), onError: recover, onSettled: settle}
	const del = trpcReact.photos.items.delete.useMutation(removeFromLists)
	const restore = trpcReact.photos.items.restore.useMutation(removeFromLists)
	const deletePermanently = trpcReact.photos.items.deletePermanently.useMutation({
		onMutate: ({ids}) => ids && remove(ids),
		onError: recover,
		onSettled: (_data, _error, {ids}) => (ids ? settle() : recover()),
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
