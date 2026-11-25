import type {RouterInput, RouterOutput} from '@/trpc/trpc'

export type SearchResponse = RouterOutput['search']['query']
export type SearchResult = SearchResponse['results'][number]
export type SearchChip = SearchResponse['understood']['chips'][number]
export type SearchMoment = NonNullable<SearchResult['moment']>
export type SearchSnippetText = NonNullable<SearchResult['snippet']>
export type SearchStatus = RouterOutput['search']['status']
export type SearchScope = NonNullable<RouterInput['search']['query']['scope']>
