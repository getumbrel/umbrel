import {matchSorter} from 'match-sorter'
import {memo, useDeferredValue, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbSearch} from 'react-icons/tb'
import {JSONTree} from 'react-json-tree'

import {AvailableAppsProvider, useAvailableApps} from '@/hooks/use-available-apps'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {SheetDescription, SheetHeader, SheetTitle} from '@/shadcn-components/ui/sheet'

export function AppStore() {
	const {t} = useTranslation()
	useUmbrelTitle(t('app-store'))

	const [searchQuery, setSearchQuery] = useState('')
	const deferredSearchQuery = useDeferredValue(searchQuery)

	return (
		<AvailableAppsProvider>
			<SheetHeader>
				<div className='flex items-center'>
					<SheetTitle className='text-48 leading-none'>{t('app-store')}</SheetTitle>
					<div className='flex-1' />
					<div className='flex items-center'>
						<TbSearch className='h-5 w-5 shrink-0' />
						<input
							className='bg-transparent p-2'
							type='search'
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
						/>
					</div>
				</div>
				<SheetDescription>{t('explore-all-the-apps')}</SheetDescription>
			</SheetHeader>
			{!searchQuery && <DiscoverContentMemoized />}
			{deferredSearchQuery && <SearchResultsMemoized query={deferredSearchQuery} />}
		</AvailableAppsProvider>
	)
}

function SearchResults({query}: {query: string}) {
	const {isLoading, apps} = useAvailableApps()

	if (isLoading) {
		return <p>Loading...</p>
	}

	const results = matchSorter(apps, query, {
		keys: ['name', 'tagline', 'description', 'developer', 'website'],
	})

	return (
		<div>
			Results for {query}
			<JSONTree data={results} shouldExpandNodeInitially={() => true} />
		</div>
	)
}

const SearchResultsMemoized = memo(SearchResults)

function DiscoverContent() {
	const {isLoading, apps} = useAvailableApps()

	if (isLoading) {
		return <p>Loading...</p>
	}

	return (
		<div>
			<JSONTree data={apps} />
		</div>
	)
}

const DiscoverContentMemoized = memo(DiscoverContent)
