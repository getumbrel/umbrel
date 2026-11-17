import {keepPreviousData, replaceEqualDeep} from '@tanstack/react-query'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'

import {CLOUD_PATH, RECENTS_PATH, SEARCH_PATH, USE_LIST_DIRECTORY_LOAD_ITEMS} from '@/features/files/constants'
import {useNetworkSharesQuery} from '@/features/files/hooks/use-network-shares-query'
import {usePreferences} from '@/features/files/hooks/use-preferences'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {transfers} from '@/features/files/transfers/transfers'
import {useUploadListingItems} from '@/features/files/transfers/use-transfers'
import type {FileSystemItem, ViewPreferences} from '@/features/files/types'
import {isDirectoryANetworkDevice} from '@/features/files/utils/is-directory-a-network-device-or-share'
import {getNetworkDirectoryListing} from '@/features/files/utils/network-directory-listing'
import {compareFilesystemItems, sortFilesystemItems} from '@/features/files/utils/sort-filesystem-items'
import {trpcReact} from '@/trpc/trpc'

// How many items a request for more of a folder may ask for. The server reads
// and sorts the whole folder for every request, however few items it hands
// back, so what a long folder costs is round trips, not rows. Scrolling asks
// for as many items as are already loaded (250, then 250, 500, 1,000 …), up to
// a size that keeps one response to a few hundred KB. Loading the rest of a
// folder in one go (Select all, a typed name that isn't loaded yet) and
// reading loaded pages again after a change ask in the largest steps.
const MAX_SCROLL_PAGE_ITEMS = 2_500
const MAX_BULK_PAGE_ITEMS = 5_000

// The pages a listing has loaded beyond its first, and the listing (folder
// and sort order) they belong to: pages from another one are never shown
type ExtraPages = {key: string; items: FileSystemItem[]; hasMore: boolean | null}
const NO_EXTRA_PAGES: ExtraPages = {key: '', items: [], hasMore: null}

// Folders that a mounted listing has loaded beyond the first page. Several
// hooks list the folder on screen (the listing itself, the actions, the new
// folder flow), each from its first page, but only the listing loads more,
// so only it can tell whether an item past the first page is really gone.
// While there is one, clearing optimistic state is left to it (see below).
const listingsWithExtraPages = new Map<string, number>()

const nameOf = (item: FileSystemItem | undefined) => item?.path.split('/').pop()

// Items read again, with every one that came back as it was still the object
// it was (and the array itself, if nothing changed at all): whatever is drawn
// from them is then left alone, as the first page's own query does for it
function keepUnchanged(previous: FileSystemItem[], next: FileSystemItem[]) {
	const known = new Map(previous.map((item) => [item.path, item]))
	const kept = next.map((item) => {
		const before = known.get(item.path)
		return before ? replaceEqualDeep(before, item) : item
	})
	return kept.length === previous.length && kept.every((item, index) => item === previous[index]) ? previous : kept
}

// Optimistic state the server has caught up with, for a folder whose loaded
// items have just been read again. A removal is over when its item is gone
// from them: one still there is either in flight or its path was reused
// (e.g. trash then upload same name), and stays masked. An arrival is over
// when the server lists it.
function settleOptimisticState(path: string, loaded: readonly FileSystemItem[]) {
	const serverPaths = new Set(loaded.map((item) => item.path))
	const {pendingPaths, incomingItems, removePendingPaths, removeIncomingItems} = useFilesStore.getState()
	const completedRemovals = [...pendingPaths.entries()]
		.filter(
			([itemPath, type]) =>
				type === 'removing' && itemPath.substring(0, itemPath.lastIndexOf('/')) === path && !serverPaths.has(itemPath),
		)
		.map(([itemPath]) => itemPath)
	if (completedRemovals.length > 0) removePendingPaths(completedRemovals)
	const arrived = incomingItems.filter((item) => serverPaths.has(item.path)).map((item) => item.path)
	if (arrived.length > 0) removeIncomingItems(arrived)
}

interface UseListDirectoryOptions {
	itemsOnScrollEnd?: number
	initialItems?: number
	/** Override the user's sort preference, e.g. for a preview that wants newest first */
	sortBy?: ViewPreferences['sortBy']
	sortOrder?: ViewPreferences['sortOrder']
	enabled?: boolean
}

export function useListDirectory(
	path: string,
	{
		itemsOnScrollEnd = USE_LIST_DIRECTORY_LOAD_ITEMS.ON_SCROLL_END,
		initialItems = USE_LIST_DIRECTORY_LOAD_ITEMS.INITIAL,
		enabled = true,
		sortBy: sortByOverride,
		sortOrder: sortOrderOverride,
	}: UseListDirectoryOptions = {},
) {
	const {preferences} = usePreferences()
	// Uploads heading here, plus a placeholder for each folder still being created
	const uploadingItems = useUploadListingItems(path)
	const utils = trpcReact.useUtils()
	// Shared context menus and rename controls also mount this hook in views
	// whose items come from other APIs and have no directory of their own.
	const isUiOnlyPath = [SEARCH_PATH, RECENTS_PATH, CLOUD_PATH].some(
		(root) => path === root || path.startsWith(`${root}/`),
	)

	const sortBy = sortByOverride ?? preferences?.sortBy ?? 'name'
	const sortOrder = sortOrderOverride ?? preferences?.sortOrder ?? 'ascending'

	// Extra paginated items beyond the first page. The first page comes
	// directly from the query's `data.files` so we don't duplicate it in state.
	// The ref holds the same pages for requests that outlive a render: a
	// request reads what is loaded when it starts and again when it lands.
	const listingKey = `${path}\n${sortBy}\n${sortOrder}`
	const [extraPages, setExtraPagesState] = useState<ExtraPages>(NO_EXTRA_PAGES)
	const extraPagesRef = useRef<ExtraPages>(NO_EXTRA_PAGES)
	const setExtraPages = useCallback((pages: ExtraPages) => {
		extraPagesRef.current = pages
		setExtraPagesState(pages)
	}, [])
	const extraItems = extraPages.key === listingKey ? extraPages.items : NO_EXTRA_PAGES.items
	const extraHasMore = extraPages.key === listingKey ? extraPages.hasMore : null
	const [, setPaginationError] = useState<unknown>(null)

	// Skip refetch when all items are loaded and only the sort changed (we can re-sort locally)
	const prevSortRef = useRef<{sortBy: string; sortOrder: string} | undefined>(undefined)
	const fullyLoadedRef = useRef(false)
	const sortChanged =
		prevSortRef.current && (prevSortRef.current.sortBy !== sortBy || prevSortRef.current.sortOrder !== sortOrder)
	const skipBackendRequest = fullyLoadedRef.current && !!sortChanged

	useEffect(() => {
		prevSortRef.current = {sortBy, sortOrder}
	}, [sortBy, sortOrder])

	const isNetworkPath = path === '/Network' || path.startsWith('/Network/')
	const isNetworkContainer = path === '/Network' || isDirectoryANetworkDevice(path)
	const networkShares = useNetworkSharesQuery({enabled: enabled && isNetworkPath})
	const shares = networkShares.data
	// Configuration is authoritative for /Network and configured hosts: mount
	// directories disappear during an outage. Unconfigured host paths and paths
	// inside a share still list the filesystem, so a removed host reads "does not
	// exist" rather than "offline". A shares error with no data also falls back.
	const hasConfiguredListing =
		!!shares &&
		(path === '/Network' ||
			(isNetworkContainer &&
				shares.some((share) => share.mountPath.slice(0, share.mountPath.lastIndexOf('/')) === path)))
	const mountedSharePaths = hasConfiguredListing
		? shares
				.filter((share) => share.isMounted && share.mountPath.startsWith(path + '/'))
				.map((share) => share.mountPath)
				.sort()
				.join('\n')
		: ''
	const hasMountedShares = mountedSharePaths !== ''
	// A configured share that is not mounted has no directory to list.
	const isDisconnectedShare =
		!!shares &&
		!isNetworkContainer &&
		shares.some((share) => !share.isMounted && (path === share.mountPath || path.startsWith(share.mountPath + '/')))
	const isNetworkPending = isNetworkPath && networkShares.isPending

	const isDirectoryQueryEnabled =
		enabled &&
		!!path &&
		!isUiOnlyPath &&
		!skipBackendRequest &&
		!isNetworkPending &&
		!isDisconnectedShare &&
		(!hasConfiguredListing || hasMountedShares)
	const directoryQuery = trpcReact.files.list.useQuery(
		// A configured listing renders every share, so it needs metadata for all of
		// them in one page (the backend accepts any positive limit for `list`).
		{path, limit: hasConfiguredListing ? Number.MAX_SAFE_INTEGER : initialItems, sortBy, sortOrder},
		{
			enabled: isDirectoryQueryEnabled,
			placeholderData: keepPreviousData,
			staleTime: 5_000,
			// Apps are deliberately not recursively watched. Refresh only the
			// directory being browsed, and pause polling while the tab is hidden.
			refetchInterval: path === '/Apps' || path.startsWith('/Apps/') ? 5_000 : false,
			refetchIntervalInBackground: false,
			// Don't retry on error. Backend errors like ENOENT/EIO/does-not-exist are deterministic, not transient.
			// This gives us quick feedback to the user.
			retry: false,
			refetchOnWindowFocus: false,
		},
	)

	// A share that (re)connects needs its real metadata and capabilities from the
	// filesystem; a share that disconnects is rendered from configuration alone.
	const mountedRef = useRef({path, mountedSharePaths})
	useEffect(() => {
		const previous = mountedRef.current
		mountedRef.current = {path, mountedSharePaths}
		if (previous.path === path && previous.mountedSharePaths !== mountedSharePaths && hasMountedShares) {
			utils.files.list.invalidate({path})
		}
	}, [path, mountedSharePaths, hasMountedShares, utils.files.list])

	const configuredListing = useMemo(
		() =>
			hasConfiguredListing
				? getNetworkDirectoryListing(path, shares, directoryQuery.data?.path === path ? directoryQuery.data : undefined)
				: undefined,
		[hasConfiguredListing, shares, path, directoryQuery.data],
	)
	// Selection can outlive a mount-status refresh. Refresh selected network
	// entries too, so keyboard and toolbar actions cannot use stale capabilities.
	useEffect(() => {
		if (!enabled || !configuredListing) return
		const {selectedItems, setSelectedItems} = useFilesStore.getState()
		const byPath = new Map(configuredListing.files.map((item) => [item.path, item]))
		let changed = false
		const next = selectedItems.flatMap((item) => {
			if (item.path.slice(0, item.path.lastIndexOf('/')) !== path) return [item]
			const updated = byPath.get(item.path)
			if (!updated) {
				changed = true
				return []
			}
			if (
				updated.isDisconnected === item.isDisconnected &&
				updated.modified === item.modified &&
				updated.operations.join() === item.operations.join()
			) {
				return [item]
			}
			changed = true
			return [updated]
		})
		if (changed) setSelectedItems(next)
	}, [enabled, configuredListing, path])

	const disconnectedShareError = useMemo(
		() => (isDisconnectedShare ? new Error('[network-share-disconnected]') : null),
		[isDisconnectedShare],
	)
	// UI-only views and disconnected shares must not retain the previous folder's
	// data or writable capabilities, even when the disabled query still holds it.
	const data = isUiOnlyPath || isDisconnectedShare ? undefined : (configuredListing ?? directoryQuery.data)
	// Disabling a query does not cancel its in-flight request, so a request that
	// stalls during an outage must not keep a listing we no longer need waiting.
	const isLoading = isNetworkPending || (isDirectoryQueryEnabled && directoryQuery.isLoading)
	// A disabled query can hold an error from before the configuration arrived
	// (e.g. listing a missing host directory while the role was still loading).
	const isError = isDisconnectedShare || (isDirectoryQueryEnabled && directoryQuery.isError)
	const error = disconnectedShareError ?? (isDirectoryQueryEnabled ? directoryQuery.error : null)
	const isPlaceholderData =
		!isUiOnlyPath && !configuredListing && !isDisconnectedShare && directoryQuery.isPlaceholderData

	// Track the previous path so we can distinguish placeholder data from
	// a directory change (hide old items) vs a sort change (keep showing items).
	// Only update when we have real data (not placeholder), so isNewDirectory
	// stays true for the entire loading period, not just the first render.
	const prevPathRef = useRef(path)
	if (!isPlaceholderData && !isLoading) {
		prevPathRef.current = path
	}
	const isNewDirectory = prevPathRef.current !== path

	// When data is placeholder from a different directory, return empty so we
	// don't flash stale files. But if it's placeholder from the same directory
	// (e.g., sort changed), keep showing the current items.
	const isStaleDirectory = isPlaceholderData && isNewDirectory
	const items = useMemo(() => {
		if (!data?.files || isStaleDirectory) return []
		if (configuredListing || extraItems.length === 0) return data.files
		const map = new Map(data.files.map((f) => [f.path, f]))
		extraItems.forEach((f: FileSystemItem) => map.set(f.path, f))
		return Array.from(map.values())
	}, [data?.files, extraItems, isStaleDirectory, configuredListing])

	const hasMore =
		isUiOnlyPath || hasConfiguredListing ? false : isStaleDirectory ? true : (extraHasMore ?? data?.hasMore ?? true)

	// Keep the ref in sync for the skip-refetch-on-sort optimization
	fullyLoadedRef.current = items.length > 0 && !hasMore

	// Reset pagination state when the directory or sort changes.
	// Sort changes produce a new first page from the query, so extras
	// from the previous sort order must be cleared to avoid mixing.
	useEffect(() => {
		setExtraPages({key: listingKey, items: [], hasMore: null})
		setPaginationError(null)
		fullyLoadedRef.current = false
	}, [listingKey, setExtraPages])

	// Everything a request for more reads, as of the latest render. A request
	// is for one listing (folder and sort order): by the time it lands the
	// listing may be another, and its answer is then dropped.
	const canPage = enabled && !!data && !isLoading && !isStaleDirectory && !isUiOnlyPath && !hasConfiguredListing
	const latestRef = useRef({listingKey, path, sortBy, sortOrder, itemsOnScrollEnd, canPage, firstPage: data})
	latestRef.current = {listingKey, path, sortBy, sortOrder, itemsOnScrollEnd, canPage, firstPage: data}
	const loadedExtraPages = useCallback(
		() => (extraPagesRef.current.key === latestRef.current.listingKey ? extraPagesRef.current : NO_EXTRA_PAGES),
		[],
	)
	const stillHasMore = useCallback(() => {
		const {canPage, firstPage} = latestRef.current
		return canPage && (loadedExtraPages().hasMore ?? firstPage?.hasMore ?? true)
	}, [loadedExtraPages])

	// Requests for more run one at a time, in the order they were asked for:
	// each starts from the last item the one before it loaded
	const queueRef = useRef<Promise<unknown>>(Promise.resolve())
	const enqueue = useCallback(<T>(task: () => Promise<T>): Promise<T> => {
		const run = queueRef.current.then(task, task)
		queueRef.current = run.catch(() => {})
		return run
	}, [])
	// Raised when what is loaded has changed under a request in flight, whose
	// answer would bring back what was just taken out (see the move below)
	const generationRef = useRef(0)

	useEffect(
		() =>
			transfers.onTransition((item) => {
				if (
					item.kind !== 'move' ||
					item.state !== 'completed' ||
					!item.sourcePath ||
					item.resultPath === item.sourcePath ||
					(item.sourcePath.slice(0, item.sourcePath.lastIndexOf('/')) || '/') !== path
				)
					return
				// Take the moved row out of the later pages at once, rather than
				// when they are next read again, and only once the move has
				// actually succeeded. A page still on its way was read before it.
				generationRef.current++
				const pages = extraPagesRef.current
				setExtraPages({...pages, items: pages.items.filter((entry) => entry.path !== item.sourcePath)})
			}),
		[path, setExtraPages],
	)

	// One request for more of the folder, from the last item loaded. True when it brought some.
	const requestMore = useCallback(
		(limit: (loaded: number) => number): Promise<boolean> =>
			enqueue(async () => {
				const {listingKey: key, path, sortBy, sortOrder, firstPage} = latestRef.current
				if (!stillHasMore()) return false
				const generation = generationRef.current
				const isCurrent = () => key === latestRef.current.listingKey && generation === generationRef.current
				const loaded = loadedExtraPages().items
				const lastFile = nameOf(loaded.at(-1) ?? firstPage?.files.at(-1))
				setPaginationError(null)
				try {
					// Reusing a cached page could bring back a file that has since moved.
					const result = await utils.files.list.fetch(
						{path, lastFile, limit: limit((firstPage?.files.length ?? 0) + loaded.length), sortBy, sortOrder},
						{staleTime: 0},
					)
					// Not for a listing that is no longer on screen, nor over a row taken out meanwhile
					if (!isCurrent()) return false
					if (!result?.files?.length) {
						setExtraPages({key, items: loaded, hasMore: false})
						return false
					}
					// O( n ) dedupe — append to extra items
					const map = new Map(loaded.map((f) => [f.path, f]))
					result.files.forEach((f: FileSystemItem) => map.set(f.path, f))
					setExtraPages({key, items: Array.from(map.values()), hasMore: result.hasMore})
					return true
				} catch (e) {
					if (isCurrent()) setPaginationError(e)
					return false
				}
			}),
		[enqueue, loadedExtraPages, stillHasMore, setExtraPages, utils.files.list],
	)

	// The next page, as scrolling nears the end of what is loaded. One at a
	// time: asked again while a page is on its way, it answers with that page.
	const nextPageRef = useRef<Promise<boolean> | null>(null)
	const fetchMoreItems = useCallback((): Promise<boolean> => {
		if (!stillHasMore()) return Promise.resolve(false)
		nextPageRef.current ??= requestMore((loaded) =>
			Math.min(MAX_SCROLL_PAGE_ITEMS, Math.max(latestRef.current.itemsOnScrollEnd, loaded)),
		).finally(() => {
			nextPageRef.current = null
		})
		return nextPageRef.current
	}, [requestMore, stillHasMore])

	// The rest of the folder, for what has to know all of it (Select all, a
	// typed name that isn't among the loaded items). True once nothing is left
	// to load.
	const fetchAllItems = useCallback(async (): Promise<boolean> => {
		const key = latestRef.current.listingKey
		const isCurrent = () => key === latestRef.current.listingKey
		for (let failures = 0; isCurrent() && stillHasMore(); ) {
			// A page already on its way counts: it is waited for, and the rest asked for after it
			const loaded = await (nextPageRef.current ?? requestMore(() => MAX_BULK_PAGE_ITEMS))
			// An answer can be dropped (a row moved out under it) and is asked for again; one that keeps failing is not
			if (!loaded && isCurrent() && stillHasMore() && ++failures > 2) return false
		}
		return isCurrent() && latestRef.current.canPage && !stillHasMore()
	}, [requestMore, stillHasMore])

	// The first page is read again whenever something changes (the watcher, an
	// operation finishing), and nothing else reads the later pages again: left
	// alone they keep rows that have gone and miss the ones that moved into
	// their range. So each time the first page has been read, what is loaded
	// beyond it is read again too, from that page's new last item, and swapped
	// in whole. Reads that pile up while one is in flight collapse into one.
	const rereadQueuedRef = useRef(false)
	const rereadExtraPages = useCallback(() => {
		if (rereadQueuedRef.current) return
		rereadQueuedRef.current = true
		void enqueue(async () => {
			rereadQueuedRef.current = false
			const {listingKey: key, path, sortBy, sortOrder, firstPage, canPage} = latestRef.current
			const count = loadedExtraPages().items.length
			if (!canPage || !firstPage || count === 0) return
			// The folder now fits in its first page
			if (!firstPage.hasMore || firstPage.files.length === 0) {
				setExtraPages({key, items: [], hasMore: null})
				settleOptimisticState(path, firstPage.files)
				return
			}
			const generation = generationRef.current
			const reread: FileSystemItem[] = []
			let hasMore = true
			try {
				while (hasMore && reread.length < count) {
					const result = await utils.files.list.fetch(
						{
							path,
							lastFile: nameOf(reread.at(-1) ?? firstPage.files.at(-1)),
							limit: Math.min(MAX_BULK_PAGE_ITEMS, count - reread.length),
							sortBy,
							sortOrder,
						},
						{staleTime: 0},
					)
					if (key !== latestRef.current.listingKey || generation !== generationRef.current) return
					reread.push(...result.files)
					hasMore = result.hasMore && result.files.length > 0
				}
			} catch {
				// What is loaded stays as it was: the next read gets another go
				return
			}
			const before = loadedExtraPages()
			const items = keepUnchanged(before.items, reread)
			if (items !== before.items || hasMore !== before.hasMore) setExtraPages({key, items, hasMore})
			settleOptimisticState(path, [...firstPage.files, ...items])
		})
	}, [enqueue, loadedExtraPages, setExtraPages, utils.files.list])
	const firstPageReadAt = isDirectoryQueryEnabled ? directoryQuery.dataUpdatedAt : undefined
	useEffect(() => {
		if (firstPageReadAt) rereadExtraPages()
	}, [firstPageReadAt, rereadExtraPages])

	// While this listing holds pages beyond the first, it is the one that says when optimistic state is over
	const hasExtraPages = extraItems.length > 0
	useEffect(() => {
		if (!hasExtraPages) return
		listingsWithExtraPages.set(path, (listingsWithExtraPages.get(path) ?? 0) + 1)
		return () => {
			const count = (listingsWithExtraPages.get(path) ?? 1) - 1
			if (count > 0) listingsWithExtraPages.set(path, count)
			else listingsWithExtraPages.delete(path)
		}
	}, [hasExtraPages, path])

	// Items pending removal are filtered out for instant optimistic feedback.
	const pendingPaths = useFilesStore((s) => s.pendingPaths)
	// Items arriving via move/paste appear immediately before the server confirms.
	const incomingItems = useFilesStore((s) => s.incomingItems)

	// Merge optimistic uploading items & *always* sort locally
	const {directoryItems, hiddenRenamedPaths} = useMemo(() => {
		// Placeholders (a landed upload, a folder still being created) yield to
		// the real entry once the server lists it; a file still uploading stays
		// beside the entry it may be replacing
		const serverPaths = new Set(items.map((item) => item.path))
		const optimistic = uploadingItems.filter(
			(u) => (u.isUploading && u.type !== 'directory') || !serverPaths.has(u.path),
		)
		const allItems = [...optimistic, ...items]
		const visible = allItems.filter((item) => pendingPaths.get(item.path) !== 'removing')

		// Add incoming items whose parent matches this directory and aren't already in the listing
		const existingPaths = new Set(visible.map((item) => item.path))
		const arriving = incomingItems.filter(
			(item) => item.path.substring(0, item.path.lastIndexOf('/')) === path && !existingPaths.has(item.path),
		)

		// Keep the original source in the boundary calculation, even while hidden.
		const loadedBoundary = items.reduce<FileSystemItem | undefined>(
			(last, item) => (!last || compareFilesystemItems(item, last, sortBy, sortOrder) > 0 ? item : last),
			undefined,
		)
		const hiddenRenamedPaths: string[] = []
		const visibleArrivals = arriving.filter((item) => {
			// A rename beyond the loaded range stays selected, but must not appear
			// at a false end of the folder. Normal paging will reveal it later.
			if (
				item.renamedFrom &&
				hasMore &&
				(!loadedBoundary || compareFilesystemItems(item, loadedBoundary, sortBy, sortOrder) > 0)
			) {
				hiddenRenamedPaths.push(item.path)
				return false
			}
			return true
		})

		return {
			directoryItems: sortFilesystemItems([...visible, ...visibleArrivals], sortBy, sortOrder),
			hiddenRenamedPaths,
		}
	}, [uploadingItems, items, path, sortBy, sortOrder, pendingPaths, incomingItems, hasMore])

	// Clean up stale optimistic state each time the server's data has been
	// read. pendingPaths is read via getState() to avoid the effect running
	// when pending paths are added (which would immediately undo them). A
	// listing holding later pages judges by all of them, once they have been
	// read again too (see rereadExtraPages): the first page alone cannot tell
	// an item on a later page from one that is gone.
	useEffect(() => {
		if (!data?.files || listingsWithExtraPages.has(path)) return
		settleOptimisticState(path, data.files)
	}, [data?.files, firstPageReadAt, incomingItems, path])

	// Landed uploads the server now lists, on any loaded page, no longer need
	// their held row. Kept apart from the removal cleanup above, which judges
	// a deletion by the first page and must only run when that page changes.
	useEffect(() => {
		const loadedPaths = new Set(items.map((item) => item.path))
		const listed = uploadingItems
			.filter((item) => !item.isUploading && item.tempId && loadedPaths.has(item.path))
			.map((item) => item.tempId!)
		if (listed.length > 0) transfers.acknowledgeListed(listed)
	}, [items, uploadingItems])

	// Derive loading state from the query directly.
	// Loading when: query is fetching and we have no real data for this path.
	const isLoadingItems = isLoading || isStaleDirectory

	return {
		listing: data && !isStaleDirectory ? {...data, items: directoryItems, hasMore, hiddenRenamedPaths} : undefined,
		isLoading: isLoadingItems,
		isError,
		error,
		fetchMoreItems,
		fetchAllItems,
	}
}
