import {useEffect, useRef, useState} from 'react'

import {trpcReact} from '@/trpc/trpc'

import {refinesQuery} from './refine'
import type {SearchResponse, SearchResult, SearchScope, SearchStatus} from './types'

const NO_RESULTS: SearchResult[] = []
const NO_CHIPS: SearchResponse['understood']['chips'] = []

// How long a refinement waits for the answer before it. A backend that takes
// longer than this is asked anyway, as it always was.
const HOLD_MS = 1000

// One search of everything the backend understands, paced for typing: the
// request goes out once the query has rested for `debounceMs`, and while a
// query is being refined the last answer stays on screen until the next
// lands, so a list neither empties nor reshuffles between keystrokes. A
// different question starts from nothing (see refinesQuery). A refinement is
// asked once the answer before it is in: the backend answers one search at a
// time and cannot be told to drop one, so every question sent while it is busy
// is one more the last has to wait behind. Results come ranked; callers must
// not re-sort them.
export function useSearch({
	query,
	scope,
	limit,
	enabled = true,
	debounceMs = 200,
	staleTime,
}: {
	query: string
	scope: SearchScope
	limit: number
	enabled?: boolean
	debounceMs?: number
	// How long an answer stays fresh (the app's default is a minute). A surface
	// that comes and goes, like the command palette, asks for 0.
	staleTime?: number
}) {
	const typed = query.trim()
	const settled = useSettledValue(typed, debounceMs)
	// The query put to the backend, which trails `settled` while it is held
	const [asked, setAsked] = useState(settled)
	const wanted = enabled && typed.length > 0 && asked.length > 0

	// The query the results on screen answer, which trails the field while
	// typing; links built from a result carry this one. Emptying the field
	// forgets it: nothing is carried across an empty field.
	const answered = useRef('')
	if (!wanted) answered.current = ''

	const search = trpcReact.search.query.useQuery(
		{query: asked, scope, limit},
		{
			enabled: wanted,
			retry: false,
			gcTime: 60 * 1000,
			// Spread, not `staleTime,`: an explicit undefined would override the
			// client's default rather than fall back to it
			...(staleTime !== undefined && {staleTime}),
			// A superseded query's answer is dropped rather than awaited
			trpc: {abortOnUnmount: true},
			// The last answer stands in while the next is fetched, but only for
			// the search it belongs to: the same scope (photos must not pose as
			// files while a scope switch loads) and the same query, refined.
			// React Query would otherwise hand back whatever it answered last,
			// however long ago and whatever was asked.
			placeholderData: (previous, previousQuery) => {
				const input = (previousQuery?.queryKey[1] as {input?: {query?: string; scope?: SearchScope}} | undefined)?.input
				const stands =
					input?.scope === scope && input.query === answered.current && refinesQuery(answered.current, asked)
				return stands ? previous : undefined
			},
		},
	)

	// Decided while rendering, so a query that is not held goes out in the
	// render that settled it
	const held = asked !== settled && settled !== '' && search.isFetching && refinesQuery(asked, settled)
	if (asked !== settled && !held) setAsked(settled)
	useEffect(() => {
		if (!held) return
		const handle = setTimeout(() => setAsked(settled), HOLD_MS)
		return () => clearTimeout(handle)
	}, [held, settled])

	if (wanted && search.data && !search.isPlaceholderData) answered.current = asked
	// The answer on screen stands only while what is typed refines it. The
	// field trails behind the typing (the debounce), and through that wait a
	// different question would sit over the last one's results, where Enter
	// opens one of them.
	const data = wanted && refinesQuery(answered.current, typed) ? search.data : undefined

	return {
		results: data?.results ?? NO_RESULTS,
		chips: data?.understood.chips ?? NO_CHIPS,
		answeredQuery: data ? answered.current || asked : '',
		// Whether more was found than the `limit` that was brought back
		hasMore: data?.nextCursor !== undefined,
		// Typed but not yet answered: debouncing, or on the wire
		isSearching: enabled && typed.length > 0 && (typed !== asked || search.isFetching),
		isError: wanted && search.isError,
		error: search.error,
	}
}

// What Search can do right now and how far through the library it is, kept
// live by the indexing-progress stream. Nothing while not `enabled`, even
// with an answer cached: a surface that has stood down has no status to show.
export function useSearchStatus(enabled = true): SearchStatus | undefined {
	const utils = trpcReact.useUtils()
	const status = trpcReact.search.status.useQuery(undefined, {enabled, retry: false})
	trpcReact.eventBus.listen.useSubscription(
		{event: 'search:indexing-progress'},
		{
			enabled,
			onData: (data) => utils.search.status.setData(undefined, data as SearchStatus),
			// The query above still answers; progress just stops ticking
			onError: () => {},
		},
	)
	return enabled ? status.data : undefined
}

// `value`, once it has stopped changing for `delayMs`. Clearing applies at
// once, so stale results never outlive the text.
function useSettledValue(value: string, delayMs: number) {
	const [settled, setSettled] = useState(value)
	useEffect(() => {
		if (value === '') return setSettled('')
		const handle = setTimeout(() => setSettled(value), delayMs)
		return () => clearTimeout(handle)
	}, [value, delayMs])
	return settled
}
