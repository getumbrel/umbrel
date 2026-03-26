import {keepPreviousData} from '@tanstack/react-query'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'

import {USE_LIST_DIRECTORY_LOAD_ITEMS} from '@/features/files/constants'
import {usePreferences} from '@/features/files/hooks/use-preferences'
import type {FileSystemItem} from '@/features/files/types'
import {sortFilesystemItems} from '@/features/files/utils/sort-filesystem-items'
import {useGlobalFiles} from '@/providers/global-files'
import {trpcReact} from '@/trpc/trpc'

interface UseListDirectoryOptions {
	itemsOnScrollEnd?: number
	initialItems?: number
}

export function useListDirectory(
	path: string,
	{
		itemsOnScrollEnd = USE_LIST_DIRECTORY_LOAD_ITEMS.ON_SCROLL_END,
		initialItems = USE_LIST_DIRECTORY_LOAD_ITEMS.INITIAL,
	}: UseListDirectoryOptions = {},
) {
	const {preferences} = usePreferences()
	const {uploadingItems} = useGlobalFiles()
	const utils = trpcReact.useUtils()

	const sortBy = preferences?.sortBy ?? 'name'
	const sortOrder = preferences?.sortOrder ?? 'ascending'

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

	const {data, isLoading, isError, error, isPlaceholderData} = trpcReact.files.list.useQuery(
		{path, limit: initialItems, sortBy, sortOrder},
		{
			enabled: !!path && !skipBackendRequest,
			placeholderData: keepPreviousData,
			staleTime: 5_000,
			// Don't retry on error. Backend errors like ENOENT/EIO/does-not-exist are deterministic, not transient.
			// This gives us quick feedback to the user.
			retry: false,
			refetchOnWindowFocus: false,
		},
	)

	// Track the previous path so we can distinguish placeholder data from
	// a directory change (hide old items) vs a sort change (keep showing items).
	const prevPathRef = useRef(path)
	const isNewDirectory = prevPathRef.current !== path
	useEffect(() => {
		prevPathRef.current = path
	}, [path])

	// When data is placeholder from a different directory, return empty so we
	// don't flash stale files. But if it's placeholder from the same directory
	// (e.g., sort changed), keep showing the current items.
	const isStaleDirectory = isPlaceholderData && isNewDirectory
	const items = useMemo(() => {
		if (!data?.files || isStaleDirectory) return []
		if (extraItems.length === 0) return data.files
		const map = new Map(data.files.map((f) => [f.path, f]))
		extraItems.forEach((f: FileSystemItem) => map.set(f.path, f))
		return Array.from(map.values())
	}, [data?.files, extraItems, isStaleDirectory])

	const hasMore = isStaleDirectory ? true : (extraHasMore ?? data?.hasMore ?? true)

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

	// Merge optimistic uploading items & *always* sort locally
	const directoryItems = useMemo(() => {
		const optimistic = uploadingItems.filter((u) => u.path.substring(0, u.path.lastIndexOf('/')) === path)
		return sortFilesystemItems([...optimistic, ...items], sortBy, sortOrder)
	}, [uploadingItems, items, path, sortBy, sortOrder])

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
