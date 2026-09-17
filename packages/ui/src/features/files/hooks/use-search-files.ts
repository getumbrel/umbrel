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
	// The typed query hasn't reached the server yet
	isDebouncing: boolean
	isError: boolean
	error: unknown
}

export function useSearchFiles({
	query,
	maxResults = USE_LIST_DIRECTORY_LOAD_ITEMS.INITIAL,
	keepPreviousResults = false,
	staleTime,
}: {
	query: string
	maxResults?: number
	// Keep showing the last results while the next query is in flight instead of
	// clearing them, so a list doesn't flicker as the user types
	keepPreviousResults?: boolean
	// How long a result set stays fresh (the app's default is a minute); a
	// surface that comes and goes, like the command palette, asks for 0 so
	// each visit fetches again
	staleTime?: number
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
			// Spread, not `staleTime,`: an explicit undefined would override the
			// client's default rather than fall back to it
			...(staleTime !== undefined && {staleTime}),
			placeholderData: keepPreviousResults
				? (previousResults, previousQuery) => {
						// Only while the user keeps typing the same query: results for "photo"
						// can stand in for "photos", but not for "invoice"
						const previousInput = previousQuery?.queryKey[1] as {input?: {query?: string}} | undefined
						const previousSearch = previousInput?.input?.query
						return previousSearch && debouncedQuery.startsWith(previousSearch) ? previousResults : undefined
					}
				: undefined,
		},
	)

	return {
		results: (data ?? []) as FileSystemItem[],
		isLoading,
		isDebouncing: trimmedQuery !== debouncedQuery,
		isError,
		error,
	}
}
