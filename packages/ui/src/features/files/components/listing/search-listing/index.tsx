// The search query is read directly from the URL (the `q` query parameter). We
// intentionally avoid any internal component state so that
// - The browser's address bar always reflects the current search.
// - The browser back-button naturally returns the user to the results after
//   they navigate into a file or folder.

import {Search} from 'lucide-react'
import {useEffect, useMemo} from 'react'
import {useTranslation} from 'react-i18next'
import {useSearchParams} from 'react-router-dom'

import {Listing, StateView} from '@/features/files/components/listing'
import {useSetActionsBarConfig} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {SearchChips} from '@/features/search/search-chips'
import {useSearch} from '@/features/search/use-search'

// The most results a search brings back
const SEARCH_MAX_RESULTS = 200

export function SearchListing() {
	const {t} = useTranslation()
	const clearSelectedItems = useFilesStore((state) => state.clearSelectedItems)

	const setActionsBarConfig = useSetActionsBarConfig()

	// read the current search term from the URL
	const [params] = useSearchParams()
	const queryParam = params.get('q') ?? ''

	useEffect(() => {
		// clear any selected items that the user may have selected from the
		// previous search results
		clearSelectedItems()
	}, [queryParam])

	// Results are ranked by the backend and listed in that order. While the
	// next query is on its way the previous results stay put, so the listing
	// neither blanks nor says "no results" mid-keystroke.
	const search = useSearch({query: queryParam, scope: 'files', limit: SEARCH_MAX_RESULTS})
	// Each result as the Files item it is: its `file` is the file exactly as
	// Files reports it, and the item remembers the result it came from, so a
	// listing shows why it matched and a viewer opens where it did
	const results = useMemo(
		() => search.results.map((result) => ({...result.file, searchResult: result})),
		[search.results],
	)
	// Beside the label, what the query was understood to filter by: each whole,
	// on one line the bar scrolls sideways when it has not the room for them
	useEffect(() => {
		setActionsBarConfig({
			pathAccessory: <SearchChips chips={search.chips} className='w-max flex-nowrap [&>li]:shrink-0' />,
			hideSearch: false,
		})
	}, [search.chips])

	// search results are returned in a single batch so we keep pagination disabled
	return (
		<Listing
			items={results}
			totalItems={results.length}
			// Search found more than it brings back, and the count says so
			truncatedAt={search.hasMore ? results.length : undefined}
			isSearch
			selectableItems={results}
			isLoading={search.isSearching && results.length === 0}
			// A search that could not be made says so in its own words: the
			// server's are not written to be read. Results a failed refresh left
			// standing stay.
			error={search.isError && results.length === 0 ? new Error(t('cmdk.search-failed')) : undefined}
			hasMore={false}
			onLoadMore={async () => false}
			CustomEmptyView={() => <EmptySearchView query={queryParam} />}
			enableFileDrop={false} // disable dropping files
		/>
	)
}

function EmptySearchView({query}: {query: string}) {
	const {t} = useTranslation()
	return (
		<StateView
			icon={<Search className='size-9 text-white/30' strokeWidth={1.5} />}
			title={query === '' ? t('files-search.default') : t('files-search.no-results', {query})}
		/>
	)
}
