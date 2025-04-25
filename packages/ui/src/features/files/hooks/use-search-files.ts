// Hook to perform a filesystem search via the backend `files.search` endpoint.
// The query must be a non-empty string – an empty query automatically
// disables the request so we don't spam the backend with needless calls while
// the user is still typing or after they clear the search input.

import type {FileSystemItem} from '@/features/files/types'
import {trpcReact} from '@/trpc/trpc'

export interface UseSearchFilesReturn {
	results: FileSystemItem[]
	isLoading: boolean
	isError: boolean
	error: unknown
}

export function useSearchFiles(query: string): UseSearchFilesReturn {
	const trimmedQuery = query.trim()

	const {data, isLoading, isError, error} = trpcReact.files.search.useQuery(
		{query: trimmedQuery},
		{
			// disable the query if there is no search term
			enabled: trimmedQuery.length > 0,
			// keep the data in the cache for a minute
			gcTime: 60 * 1000,
		},
	)

	return {
		results: (data ?? []) as FileSystemItem[],
		isLoading,
		isError,
		error,
	}
}
