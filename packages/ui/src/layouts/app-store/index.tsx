import {matchSorter} from 'match-sorter'
import {memo, useDeferredValue, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbDots, TbSearch} from 'react-icons/tb'
import {Link, Outlet} from 'react-router-dom'

import {Loading} from '@/components/ui/loading'
import {useAvailableApps} from '@/hooks/use-available-apps'
import {useQueryParams} from '@/hooks/use-query-params'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {AppWithDescription} from '@/modules/app-store/discover/apps-grid-section'
import {
	appsGridClass,
	AppStoreSheetInner,
	cardFaintClass,
	sectionTitleClass,
	slideInFromBottomClass,
} from '@/modules/app-store/shared'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/shadcn-components/ui/dropdown-menu'
import {cn} from '@/shadcn-lib/utils'

import {CommunityAppStoreDialog} from './community-app-store-dialog'
import {UpdatesButton} from './updates-button'

export function AppStoreLayout() {
	const {t} = useTranslation()
	const title = t('app-store.title')
	useUmbrelTitle(title)

	const [searchQuery, setSearchQuery] = useState('')
	const deferredSearchQuery = useDeferredValue(searchQuery)

	return (
		<AppStoreSheetInner
			title={title}
			description={<>{t('app-store.tagline')}</>}
			titleRightChildren={
				<div className='flex max-w-full flex-1 flex-row-reverse items-center gap-3'>
					<CommunityAppsDropdown />
					<UpdatesButton />
					<div className='flex-1 md:hidden' />
					<SearchInput value={searchQuery} onValueChange={setSearchQuery} />
				</div>
			}
		>
			{deferredSearchQuery ? <SearchResultsMemoized query={deferredSearchQuery} /> : <Outlet />}
		</AppStoreSheetInner>
	)
}

function SearchInput({value, onValueChange}: {value: string; onValueChange: (query: string) => void}) {
	return (
		<div className='-ml-2 flex min-w-0 items-center rounded-full border border-transparent bg-transparent pl-2 transition-colors focus-within:border-white/5 focus-within:bg-white/6 hover:border-white/5 hover:bg-white/6'>
			<TbSearch className='h-4 w-4 shrink-0 opacity-50' />
			<input
				className='bg-transparent p-1 text-15 outline-none placeholder:text-white/40 max-md:w-[160px]'
				placeholder='Search apps'
				value={value}
				onChange={(e) => onValueChange(e.target.value)}
				// Prevent closing modal when pressing Escape
				onKeyDown={(e) => {
					if (e.key === 'Escape') {
						onValueChange('')
						e.preventDefault()
					}
				}}
			/>
		</div>
	)
}

function CommunityAppsDropdown() {
	const {addLinkSearchParams} = useQueryParams()
	return (
		<>
			<DropdownMenu>
				{/* tabIndex={-1} because we want user to be able to tab to results */}
				<DropdownMenuTrigger tabIndex={-1}>
					<TbDots className='h-5 w-5' />
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end'>
					<DropdownMenuItem asChild>
						<Link to={{search: addLinkSearchParams({dialog: 'add-community-store'})}}>Community app stores</Link>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<CommunityAppStoreDialog />
		</>
	)
}

function SearchResults({query}: {query: string}) {
	const {isLoading, apps} = useAvailableApps()

	if (isLoading) {
		return <Loading />
	}

	const appResults = matchSorter(apps, query, {
		keys: ['name', 'tagline', 'developer', 'website', 'description'],
		threshold: matchSorter.rankings.WORD_STARTS_WITH,
	})

	const title = (
		<span>
			<span className='opacity-60'>Results for</span> {query}
		</span>
	)

	return (
		<div className={cn(cardFaintClass, slideInFromBottomClass)}>
			<h3 className={cn(sectionTitleClass, 'p-2.5')}>{title}</h3>
			<div className={appsGridClass}>{appResults?.map((app) => <AppWithDescription key={app.id} app={app} />)}</div>
			{(!appResults || appResults.length === 0) && <NoResults />}
		</div>
	)
}

const NoResults = () => (
	<div className='py-4 text-center'>
		<span className='opacity-50'>No results</span> 👀
	</div>
)

const SearchResultsMemoized = memo(SearchResults)
