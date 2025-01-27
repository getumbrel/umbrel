import {usePreferences} from '@/features/files/hooks/use-preferences'
import type {FileSystemItem} from '@/features/files/types'
import {sortFilesystemItems} from '@/features/files/utils/sort-filesystem-items'
import {useGlobalFiles} from '@/providers/global-files'
import {trpcReact} from '@/trpc/trpc'

interface UseListDirectoryOptions {
	start?: number
	count?: number
}

/**
 * Hook to fetch the contents of a directory with optional pagination and sorting
 *
 * @param path - Absolute path of the directory to list
 * @param options - Optional configuration for pagination and sorting
 * @returns Object containing directory contents, loading state, and error information
 */
export function useListDirectory(path: string, {start = 0, count = 100}: UseListDirectoryOptions = {}) {
	const {preferences} = usePreferences()
	const {uploadingItems} = useGlobalFiles()

	// Fetch the directory contents
	const {data, isLoading, isError, error} = trpcReact.files.list.useQuery(
		{
			path,
			start,
			count,
			sortBy: preferences?.sortBy ?? 'name',
			sortOrder: preferences?.sortOrder ?? 'asc',
		},
		{
			enabled: Boolean(path),
			keepPreviousData: true,
			staleTime: 5_000,
			onError: (error) => {
				console.error(`Failed to fetch directory listing for '${path}':`, error)
			},
		},
	)

	// Add path to items - useful for keys and operations
	let items: FileSystemItem[] = data?.items ?? []

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
				}
			: undefined,
		isLoading,
		isError,
		error,
	}
}
