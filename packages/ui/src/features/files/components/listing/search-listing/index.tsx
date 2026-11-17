// The search query is read directly from the URL (the `q` query parameter). We
// intentionally avoid any internal component state so that
// - The browser's address bar always reflects the current search.
// - The browser back-button naturally returns the user to the results after
//   they navigate into a file or folder.

import {Search} from 'lucide-react'
import {useEffect} from 'react'
import {useTranslation} from 'react-i18next'
import {useSearchParams} from 'react-router-dom'

import {Listing, StateView} from '@/features/files/components/listing'
import {useSetActionsBarConfig} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {SEARCH_MAX_RESULTS, useSearchFiles} from '@/features/files/hooks/use-search-files'
import {useFilesStore} from '@/features/files/store/use-files-store'

export function SearchListing() {
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

	useEffect(() => {
		setActionsBarConfig({hideSearch: false})
	}, [])

	// query the backend – the hook internally short-circuits when provided an
	// empty string, so clearing the search box stops the requests
	const {results, isLoading, isError, error} = useSearchFiles({query: queryParam})

	// search results are currently returned in a single batch so we keep
	// pagination disabled
	return (
		<Listing
			items={results}
			totalItems={results.length}
			// As many as a search brings back: there may well be more, and the count says so
			truncatedAt={results.length >= SEARCH_MAX_RESULTS ? results.length : undefined}
			isSearch
			selectableItems={results}
			isLoading={isLoading}
			error={isError ? error : undefined}
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
