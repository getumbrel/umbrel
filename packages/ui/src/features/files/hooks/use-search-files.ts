// Hook to perform a filesystem search via the backend `files.search` endpoint.
// The query must be a non-empty string – an empty query automatically
// disables the request so we don't spam the backend with needless calls while
// the user is still typing or after they clear the search input.

import {useState} from 'react'
import {useDebounce} from 'react-use'

import {USE_LIST_DIRECTORY_LOAD_ITEMS} from '@/features/files/constants'
import type {FileSystemItem} from '@/features/files/types'
import {trpcReact} from '@/trpc/trpc'

export interface UseSearchFilesReturn {
	results: FileSystemItem[]
	isLoading: boolean
	isError: boolean
	error: unknown
}

export function useSearchFiles({
	query,
	maxResults = USE_LIST_DIRECTORY_LOAD_ITEMS.INITIAL,
}: {
	query: string
	maxResults?: number
}): UseSearchFilesReturn {
	const trimmedQuery = query.trim()
	const [debouncedQuery, setDebouncedQuery] = useState(trimmedQuery)

	// debounce the query param so we only hit the backend at most once every
	// 350ms while the user is typing their search term
	useDebounce(
		() => {
			setDebouncedQuery(trimmedQuery)
		},
		350,
		[trimmedQuery],
	)

	const {data, isLoading, isError, error} = trpcReact.files.search.useQuery(
		{query: debouncedQuery, maxResults},
		{
			// disable the query if there is no search term
			enabled: debouncedQuery.length > 0,
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
