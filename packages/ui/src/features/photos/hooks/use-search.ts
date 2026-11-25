import {useSearchArc, useSearchFootnote} from '@/features/search/use-search-footnote'
import {RouterOutput, trpcReact} from '@/trpc/trpc'

export type {SearchChip, SearchResponse, SearchStatus} from '@/features/search/types'
export type SearchInsights = RouterOutput['search']['insights']

// tRPC's query-key prefix for every search.query (any text, any scope)
export const SEARCH_QUERY_KEY = [['search', 'query']] as const

// Whether smart search is running and how far it has read the library. Kept
// current by usePhotosEvents (search:indexing-progress), so nothing polls —
// and, unlike the shared useSearchStatus, without a subscription per caller:
// half a dozen Photos components read this.
export const useSearchStatus = () =>
	trpcReact.search.status.useQuery(undefined, {retry: false, refetchOnWindowFocus: false})

// Whether free text can be searched by meaning. Until the status has
// answered it is taken to be so — on most devices it is, and guessing wrong
// only means one name-matched answer before the view settles — and a status
// that cannot be had at all means no.
export function useSmartSearch() {
	const status = useSearchStatus()
	return status.data ? status.data.available : !status.isError
}

// The one thing Photos' search has to say for itself while Search is not at
// full strength (see useSearchFootnote), for a search of words (`typed`): the
// models still loading, or the library still being read. The same count the
// command palette goes by, and not Photos' own of the media it is preparing:
// that one waits for what is said in videos to be written down, which holds
// no search back.
export function useSearchNote(typed: boolean) {
	const status = useSearchStatus().data
	return useSearchFootnote('photos', typed ? status : undefined)
}

// ... and how far along that reading is, for the arc in the field
export function useSearchNoteArc(typed: boolean) {
	const status = useSearchStatus().data
	return useSearchArc('photos', typed ? status : undefined)
}

// What Search knows about one item beyond what Photos stores: the place's
// name, text read off the picture, what is said in a video. Absent on
// devices without smart search; nothing here is worth an error.
export const useItemInsights = (photoId: string | undefined) =>
	trpcReact.search.insights.useQuery(
		{photoId: photoId ?? ''},
		{enabled: Boolean(photoId), retry: false, refetchOnWindowFocus: false, staleTime: 60_000},
	)
