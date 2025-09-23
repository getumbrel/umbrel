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

	// Local “pagination” state
	const [items, setItems] = useState<FileSystemItem[]>([])
	const [hasMore, setHasMore] = useState(true)
	const [isFetchingMore, setIsFetchingMore] = useState(false)
	const [paginationError, setPaginationError] = useState<unknown>(null)
	const [isLoadingItems, setIsLoadingItems] = useState(true)

	// helpers to know WHEN to skip refetch on sort changes
	const prevSortRef = useRef<{sortBy: string; sortOrder: string}>()
	const fullyLoaded = items.length > 0 && !hasMore
	const sortChanged =
		prevSortRef.current && (prevSortRef.current.sortBy !== sortBy || prevSortRef.current.sortOrder !== sortOrder)

	const skipBackendRequest = fullyLoaded && sortChanged

	// remember latest sort
	useEffect(() => {
		prevSortRef.current = {sortBy, sortOrder}
	}, [sortBy, sortOrder])

	//
	const {data, isLoading, isError, error} = trpcReact.files.list.useQuery(
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

	// Reset items only when the *directory* changes
	useEffect(() => {
		// Using our own loading state instead of the query's isLoading/isFetching to prevent
		// the empty view from briefly flashing when the items array is cleared during directory changes
		setIsLoadingItems(true)
		setItems([])
		setHasMore(true)
		setPaginationError(null)
	}, [path])

	// Seed items from the query result
	useEffect(() => {
		if (data?.files) {
			setIsLoadingItems(false)
			setItems(data.files)
			setHasMore(data.hasMore)
		}
	}, [path, data])

	// Stop loading if the query errors so the UI can render the error state
	useEffect(() => {
		if (isError) {
			setIsLoadingItems(false)
		}
	}, [isError])

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
				setHasMore(false)
				return false
			}

			// O( n ) dedupe
			setItems((prev) => {
				const map = new Map(prev.map((f) => [f.path, f]))
				result.files.forEach((f: FileSystemItem) => map.set(f.path, f))
				return Array.from(map.values())
			})
			setHasMore(result.hasMore)
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

	return {
		listing: data ? {...data, items: directoryItems, hasMore} : undefined,
		isLoading: isLoadingItems,
		isError,
		error,
		fetchMoreItems,
	}
}
