import {useCallback, useEffect, useRef, useState} from 'react'

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

/**
 * Hook to fetch the contents of a directory with virtualized loading support
 *
 * @param path - Absolute path of the directory to list
 * @param options - Optional configuration for batch sizes
 * @returns Object containing directory contents, loading state, error information, and functions to load more items
 */
export function useListDirectory(
	path: string,
	{
		itemsOnScrollEnd = USE_LIST_DIRECTORY_LOAD_ITEMS.ON_SCROLL_END,
		initialItems = USE_LIST_DIRECTORY_LOAD_ITEMS.INITIAL,
	}: UseListDirectoryOptions = {},
) {
	const {preferences} = usePreferences()
	const {uploadingItems} = useGlobalFiles()

	// Keep track of loaded items and total count
	const loadedItemsRef = useRef<FileSystemItem[]>([])
	const hasMoreItemsRef = useRef(true)
	const [isFetchingMore, setIsFetchingMore] = useState(false)

	// Get TRPC context at the hook level
	const utils = trpcReact.useContext()

	// Fetch the directory contents
	const query = trpcReact.files.list.useQuery(
		{
			path,
			start: 0,
			count: initialItems,
			sortBy: preferences?.sortBy ?? 'name',
			sortOrder: preferences?.sortOrder ?? 'asc',
		},
		{
			enabled: Boolean(path),
			staleTime: 5_000,
			onSuccess: (data) => {
				loadedItemsRef.current = data?.items ?? []
				hasMoreItemsRef.current = data ? data.total > data.items.length : false
			},
			onError: (error) => {
				console.error(`Failed to fetch directory listing for '${path}':`, error)
			},
		},
	)

	const {data, isLoading, isError, error, refetch} = query

	// Reset when dependencies change
	useEffect(() => {
		loadedItemsRef.current = []
		hasMoreItemsRef.current = true
	}, [path, preferences?.sortBy, preferences?.sortOrder])

	// Function to fetch more items
	const fetchMoreItems = useCallback(
		async (startIndex: number) => {
			if (!hasMoreItemsRef.current || isLoading || isFetchingMore) return false

			setIsFetchingMore(true)

			try {
				// Use the utils from the outer scope instead of calling useContext inside
				const result = await utils.files.list.fetch({
					path,
					start: startIndex,
					count: itemsOnScrollEnd,
					sortBy: preferences?.sortBy ?? 'name',
					sortOrder: preferences?.sortOrder ?? 'asc',
				})

				setIsFetchingMore(false)

				if (result && result.items.length > 0) {
					// Make sure we don't add duplicates
					const newItems = result.items.filter(
						(newItem) => !loadedItemsRef.current.some((item) => item.path === newItem.path),
					)

					if (newItems.length > 0) {
						loadedItemsRef.current = [...loadedItemsRef.current, ...newItems]
						hasMoreItemsRef.current = result.total > loadedItemsRef.current.length
						return true
					}
				}

				hasMoreItemsRef.current = false
				return false
			} catch (err) {
				setIsFetchingMore(false)
				console.error(`Failed to fetch more items for '${path}':`, err)
				return false
			}
		},
		[path, itemsOnScrollEnd, isLoading, isFetchingMore, preferences?.sortBy, preferences?.sortOrder, utils.files.list],
	)

	// Reset state when needed
	const resetItems = useCallback(() => {
		loadedItemsRef.current = []
		hasMoreItemsRef.current = true
		refetch()
	}, [refetch])

	// Add path to items - useful for keys and operations
	let items: FileSystemItem[] = loadedItemsRef.current.length > 0 ? loadedItemsRef.current : (data?.items ?? [])

	// Find any uploading items for current directory
	const uploadingItemsInCurrentDirectory = uploadingItems.filter((item) => {
		const lastSlashIndex = item.path.lastIndexOf('/')
		const itemDirectory = item.path.substring(0, lastSlashIndex)
		return itemDirectory === path
	})

	// Combine uploading items with directory items and sort them
	if (uploadingItemsInCurrentDirectory.length > 0) {
		items = [...uploadingItemsInCurrentDirectory, ...items]
		items = sortFilesystemItems(items, preferences?.sortBy ?? 'name', preferences?.sortOrder ?? 'asc')
	}

	return {
		listing: data
			? {
					...data,
					items: items,
					hasMore: hasMoreItemsRef.current,
				}
			: undefined,
		isLoading,
		isError,
		error,
		fetchMoreItems,
		resetItems,
	}
}
