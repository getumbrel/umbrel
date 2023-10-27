import {matchSorter} from 'match-sorter'
import {memo, useDeferredValue, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbDots, TbSearch} from 'react-icons/tb'
import {JSONTree} from 'react-json-tree'
import {Link, Outlet} from 'react-router-dom'

import {LinkButton} from '@/components/ui/link-button'
import {NotificationBadge} from '@/components/ui/notification-badge'
import {AvailableAppsProvider, useAvailableApps} from '@/hooks/use-available-apps'
import {useQueryParams} from '@/hooks/use-query-params'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/shadcn-components/ui/dropdown-menu'
import {SheetDescription, SheetHeader, SheetTitle} from '@/shadcn-components/ui/sheet'

import {AddCommunityStoreDialog} from './add-community-store-dialog'
import {UpdatesDialog} from './updates-dialog'

export function AppStoreLayout() {
	const {t} = useTranslation()
	const title = t('app-store.title')
	useUmbrelTitle(title)

	const {addLinkSearchParams} = useQueryParams()
	const [searchQuery, setSearchQuery] = useState('')
	const deferredSearchQuery = useDeferredValue(searchQuery)

	return (
		<AvailableAppsProvider>
			<div className='flex flex-col gap-8'>
				<SheetHeader className='gap-5'>
					<div className='flex flex-wrap-reverse items-center gap-y-2'>
						<SheetTitle className='text-48 leading-none'>{title}</SheetTitle>
						<div className='flex-1' />
						<div className='flex items-center gap-3'>
							<LinkButton
								to={{search: addLinkSearchParams({dialog: 'updates'})}}
								variant='default'
								size='dialog'
								className='relative h-[33px]'
							>
								Updates
								<NotificationBadge count={2} />
							</LinkButton>
							<UpdatesDialog />
							<SearchInput value={searchQuery} onValueChange={setSearchQuery} />
						</div>
					</div>
					<SheetDescription className='flex items-baseline justify-between text-left text-17 font-medium -tracking-2 text-white/75'>
						{t('app-store.tagline')}
						<CommunityAppsDropdown />
					</SheetDescription>
				</SheetHeader>
				{deferredSearchQuery ? <SearchResultsMemoized query={deferredSearchQuery} /> : <Outlet />}
			</div>
		</AvailableAppsProvider>
	)
}

function SearchInput({value, onValueChange}: {value: string; onValueChange: (query: string) => void}) {
	return (
		<div className='flex items-center'>
			<TbSearch className='h-4 w-4 shrink-0 opacity-50' />
			<input
				className='w-[] bg-transparent p-1 text-15 outline-none'
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
				<DropdownMenuTrigger>
					<TbDots className='h-5 w-5' />
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end'>
					<DropdownMenuItem asChild>
						<Link to={{search: addLinkSearchParams({dialog: 'add-community-store'})}}>Community app stores</Link>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<AddCommunityStoreDialog />
		</>
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
