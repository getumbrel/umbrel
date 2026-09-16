import {keepPreviousData} from '@tanstack/react-query'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'

import {USE_LIST_DIRECTORY_LOAD_ITEMS} from '@/features/files/constants'
import {useNetworkSharesQuery} from '@/features/files/hooks/use-network-shares-query'
import {usePreferences} from '@/features/files/hooks/use-preferences'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {transfers} from '@/features/files/transfers/transfers'
import {useUploadListingItems} from '@/features/files/transfers/use-transfers'
import type {FileSystemItem, ViewPreferences} from '@/features/files/types'
import {isDirectoryANetworkDevice} from '@/features/files/utils/is-directory-a-network-device-or-share'
import {getNetworkDirectoryListing} from '@/features/files/utils/network-directory-listing'
import {sortFilesystemItems} from '@/features/files/utils/sort-filesystem-items'
import {trpcReact} from '@/trpc/trpc'

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

	const sortBy = sortByOverride ?? preferences?.sortBy ?? 'name'
	const sortOrder = sortOrderOverride ?? preferences?.sortOrder ?? 'ascending'

	// Extra paginated items beyond the first page. The first page comes
	// directly from the query's `data.files` so we don't duplicate it in state.
	const [extraItems, setExtraItems] = useState<FileSystemItem[]>([])
	const [extraHasMore, setExtraHasMore] = useState<boolean | null>(null)
	const [isFetchingMore, setIsFetchingMore] = useState(false)
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
	// A disconnected share has nothing to show; the previous folder's placeholder
	// data must not linger (it would read as loading, hiding the explanation).
	const data = isDisconnectedShare ? undefined : (configuredListing ?? directoryQuery.data)
	// Disabling a query does not cancel its in-flight request, so a request that
	// stalls during an outage must not keep a listing we no longer need waiting.
	const isLoading = isNetworkPending || (isDirectoryQueryEnabled && directoryQuery.isLoading)
	// A disabled query can hold an error from before the configuration arrived
	// (e.g. listing a missing host directory while the role was still loading).
	const isError = isDisconnectedShare || (isDirectoryQueryEnabled && directoryQuery.isError)
	const error = disconnectedShareError ?? (isDirectoryQueryEnabled ? directoryQuery.error : null)
	const isPlaceholderData = !configuredListing && !isDisconnectedShare && directoryQuery.isPlaceholderData

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

	const hasMore = hasConfiguredListing ? false : isStaleDirectory ? true : (extraHasMore ?? data?.hasMore ?? true)

	// Keep the ref in sync for the skip-refetch-on-sort optimization
	fullyLoadedRef.current = items.length > 0 && !hasMore

	// Reset pagination state when the directory or sort changes.
	// Sort changes produce a new first page from the query, so extras
	// from the previous sort order must be cleared to avoid mixing.
	useEffect(() => {
		setExtraItems([])
		setExtraHasMore(null)
		setPaginationError(null)
		fullyLoadedRef.current = false
	}, [path, sortBy, sortOrder])

	// Guard against late responses landing in the wrong directory
	const requestIdRef = useRef(0)

	const fetchMoreItems = useCallback(async (): Promise<boolean> => {
		if (isLoading || isFetchingMore || !hasMore) return false

		setIsFetchingMore(true)
		setPaginationError(null)
		const thisRequest = ++requestIdRef.current

		const lastItem = items[items.length - 1]
		const lastFileName = lastItem?.path.split('/').pop()

		try {
			const result = await utils.files.list.fetch({
				path,
				lastFile: lastFileName,
				limit: itemsOnScrollEnd,
				sortBy,
				sortOrder,
			})

			// Ignore responses that belong to an outdated directory
			if (thisRequest !== requestIdRef.current) return false

			if (!result?.files?.length) {
				setExtraHasMore(false)
				return false
			}

			// O( n ) dedupe — append to extra items
			setExtraItems((prev) => {
				const map = new Map(prev.map((f) => [f.path, f]))
				result.files.forEach((f: FileSystemItem) => map.set(f.path, f))
				return Array.from(map.values())
			})
			setExtraHasMore(result.hasMore)
			return true
		} catch (e) {
			if (thisRequest === requestIdRef.current) setPaginationError(e)
			return false
		} finally {
			if (thisRequest === requestIdRef.current) setIsFetchingMore(false)
		}
	}, [items, path, itemsOnScrollEnd, sortBy, sortOrder, isLoading, isFetchingMore, hasMore, utils.files.list])

	// Items pending removal are filtered out for instant optimistic feedback.
	const pendingPaths = useFilesStore((s) => s.pendingPaths)
	// Items arriving via move/paste appear immediately before the server confirms.
	const incomingItems = useFilesStore((s) => s.incomingItems)
	const removeIncomingItems = useFilesStore((s) => s.removeIncomingItems)

	// Merge optimistic uploading items & *always* sort locally
	const directoryItems = useMemo(() => {
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

		return sortFilesystemItems([...visible, ...arriving], sortBy, sortOrder)
	}, [uploadingItems, items, path, sortBy, sortOrder, pendingPaths, incomingItems])

	// Clean up stale optimistic state after server data refreshes.
	// pendingPaths is read via getState() to avoid the effect running when
	// pending paths are added (which would immediately undo them).
	useEffect(() => {
		if (!data?.files) return

		// Clean up 'removing' entries only for items that are no longer in the
		// server data (removal succeeded). Entries for items still in the data
		// are kept: either the removal is still in-flight or the path was reused
		// (e.g. trash then upload same name).
		const serverPaths = new Set(data.files.map((f) => f.path))
		const {pendingPaths: currentPendingPaths} = useFilesStore.getState()
		const completedRemovals = [...currentPendingPaths.entries()]
			.filter(
				([itemPath, type]) =>
					type === 'removing' &&
					itemPath.substring(0, itemPath.lastIndexOf('/')) === path &&
					!serverPaths.has(itemPath),
			)
			.map(([itemPath]) => itemPath)
		if (completedRemovals.length > 0) {
			useFilesStore.getState().removePendingPaths(completedRemovals)
		}

		// Clean up incoming items that the server now includes
		const arrived = incomingItems.filter((item) => serverPaths.has(item.path)).map((item) => item.path)
		if (arrived.length > 0) {
			removeIncomingItems(arrived)
		}
	}, [data?.files, incomingItems, removeIncomingItems, path])

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
		listing: data && !isStaleDirectory ? {...data, items: directoryItems, hasMore} : undefined,
		isLoading: isLoadingItems,
		isError,
		error,
		fetchMoreItems,
	}
}
