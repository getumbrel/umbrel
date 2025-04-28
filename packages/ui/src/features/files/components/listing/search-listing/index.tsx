// The search query is read directly from the URL (the `q` query parameter). We
// intentionally avoid any internal component state so that
// - The browser's address bar always reflects the current search.
// - The browser back-button naturally returns the user to the results after
//   they navigate into a file or folder.

import {useEffect} from 'react'
import {useSearchParams} from 'react-router-dom'

import {Listing} from '@/features/files/components/listing'
import {useSetActionsBarConfig} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {useSearchFiles} from '@/features/files/hooks/use-search-files'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {t} from '@/utils/i18n'

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
		setActionsBarConfig({
			hidePath: true,
			hideSearch: false,
		})
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
	return (
		<div className='flex h-full items-center justify-center text-xs text-neutral-500'>
			{query === '' ? t('files-search.default') : t('files-search.no-results', {query})}
		</div>
	)
}
