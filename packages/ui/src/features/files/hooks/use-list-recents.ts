import {keepPreviousData} from '@tanstack/react-query'

import {usePreferences} from '@/features/files/hooks/use-preferences'
import type {FileSystemItem} from '@/features/files/types'
import {sortFilesystemItems} from '@/features/files/utils/sort-filesystem-items'
import {trpcReact} from '@/trpc/trpc'

/**
 * Hook to fetch recently accessed files and directories
 *
 * @returns Object containing recently accessed items, loading state, and error information
 */
export function useListRecents() {
	// Fetch the directory contents
	const {data, isLoading, isError, error} = trpcReact.files.recents.useQuery(undefined, {
		placeholderData: keepPreviousData,
		staleTime: 5_000,
	})

	const {preferences} = usePreferences()

	// Sort the listing based on user preferences.
	// We sort them here instead of re-quering with updated preferences
	// because unlike useListDirectory, we know the max recent items is 50
	// so they're all already on the client side.
	const sortedListing = data
		? sortFilesystemItems(
				data.filter((item): item is FileSystemItem => item !== null),
				preferences?.sortBy ?? 'name',
				preferences?.sortOrder ?? 'ascending',
			)
		: []

	return {
		listing: sortedListing,
		isLoading,
		isError,
		error,
	}
}
