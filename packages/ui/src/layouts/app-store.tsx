import {motion} from 'framer-motion'
import {memo, useDeferredValue, useEffect, useMemo, useRef, useState} from 'react'
import {TbDots, TbSearch} from 'react-icons/tb'
import {Link, Outlet, useSearchParams} from 'react-router-dom'
import {useKeyPressEvent} from 'react-use'

import {Loading} from '@/components/ui/loading'
import {useQueryParams} from '@/hooks/use-query-params'
import {CommunityAppStoreDialog} from '@/modules/app-store/community-app-store-dialog'
import {AppWithDescription} from '@/modules/app-store/discover/apps-grid-section'
import {
	appsGridClass,
	AppStoreSheetInner,
	cardFaintClass,
	sectionTitleClass,
	slideInFromBottomClass,
} from '@/modules/app-store/shared'
import {UpdatesButton} from '@/modules/app-store/updates-button'
import {useAvailableApps} from '@/providers/available-apps'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/shadcn-components/ui/dropdown-menu'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'
import {createSearch} from '@/utils/search'

export function AppStoreLayout() {
	const title = t('app-store.title')

	const [searchParams, setSearchParams] = useSearchParams()
	const [searchQuery, setSearchQuery] = useState(searchParams.get('q') ?? '')
	const deferredSearchQuery = useDeferredValue(searchQuery)

	const inputRef = useRef<HTMLInputElement>(null)

	// Remember query as part of the URL so we can navigate back to the results
	useEffect(() => {
		if (deferredSearchQuery) searchParams.set('q', deferredSearchQuery)
		else searchParams.delete('q')
		setSearchParams(searchParams, {replace: true})
	}, [deferredSearchQuery])

	useKeyPressEvent(
		(e) => e.key === '/',
		undefined, // if doing focus here, input gets a '/' in it
		() => inputRef.current?.focus(),
	)

	return (
		<AppStoreSheetInner
			title={title}
			titleRightChildren={
				<motion.div layout className='flex max-w-full flex-1 flex-row-reverse items-center gap-3'>
					<CommunityAppsDropdown />
					<UpdatesButton />
					<div className='flex-1 md:hidden' />
					<SearchInput inputRef={inputRef} value={searchQuery} onValueChange={setSearchQuery} />
				</motion.div>
			}
		>
			{deferredSearchQuery ? <SearchResultsMemoized query={deferredSearchQuery} /> : <Outlet />}
		</AppStoreSheetInner>
	)
}

function SearchInput({
	value,
	onValueChange,
	inputRef,
}: {
	value: string
	onValueChange: (query: string) => void
	inputRef?: React.Ref<HTMLInputElement>
}) {
	return (
		<div className='-ml-2 flex min-w-0 items-center rounded-full border border-transparent bg-transparent pl-2 transition-colors focus-within:border-white/5 focus-within:bg-white/6 hover:border-white/5 hover:bg-white/6'>
			<TbSearch className='h-4 w-4 shrink-0 opacity-50' />
			{/* Set specific input width so it's consistent across browsers */}
			<input
				ref={inputRef}
				className='w-[160px] bg-transparent p-1 text-15 outline-none placeholder:text-white/40'
				placeholder={t('app-store.search-apps')}
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
						<Link to={{search: addLinkSearchParams({dialog: 'add-community-store'})}}>
							{t('app-store.menu.community-app-stores')}
						</Link>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<CommunityAppStoreDialog />
		</>
	)
}

function SearchResults({query}: {query: string}) {
	const {isLoading, apps} = useAvailableApps()

	const search = useMemo(
		() =>
			createSearch(apps ?? [], [
				{
					name: 'name',
					weight: 3,
				},
				{
					name: 'tagline',
					weight: 1,
				},
				{
					name: 'description',
					weight: 1,
				},
				{
					name: 'website',
					weight: 1,
				},
			]),
		[apps],
	)

	const appResults = search(query)

	if (isLoading) {
		return <Loading />
	}

	const title = (
		<span>
			<span className='opacity-60'>{t('app-store.search.results-for')}</span> {query}
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
		<span className='opacity-50'>{t('app-store.search.no-results')}</span> 👀
	</div>
)

const SearchResultsMemoized = memo(SearchResults)
