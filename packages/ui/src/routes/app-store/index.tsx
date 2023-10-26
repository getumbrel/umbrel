import {matchSorter} from 'match-sorter'
import {memo, useDeferredValue, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbDots, TbSearch} from 'react-icons/tb'
import {JSONTree} from 'react-json-tree'
import {Link, Outlet, useParams} from 'react-router-dom'

import {LinkButton} from '@/components/ui/link-button'
import {NotificationBadge} from '@/components/ui/notification-badge'
import {AvailableAppsProvider, useAvailableApps} from '@/hooks/use-available-apps'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Button} from '@/shadcn-components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/shadcn-components/ui/dropdown-menu'
import {SheetDescription, SheetHeader, SheetTitle} from '@/shadcn-components/ui/sheet'
import {trpcReact} from '@/trpc/trpc'

import {Apps3UpSection} from './_components/apps-3-up-section'
import {AppsGallerySection} from './_components/apps-gallery-section'
import {AppsGridSection} from './_components/apps-grid-section'
import {AppsRowSection} from './_components/apps-row-section'

export function AppStore() {
	const {t} = useTranslation()
	const title = t('app-store.title')
	useUmbrelTitle(title)

	const appsQ = trpcReact.appStore.registry.useQuery()

	const [searchQuery, setSearchQuery] = useState('')
	const deferredSearchQuery = useDeferredValue(searchQuery)

	if (appsQ.isLoading) {
		return <p>Loading...</p>
	}

	return (
		<AvailableAppsProvider>
			<div className='flex flex-col gap-8'>
				<SheetHeader className='gap-5'>
					<div className='flex flex-wrap-reverse items-center gap-y-2'>
						<SheetTitle className='text-48 leading-none'>{title}</SheetTitle>
						<div className='flex-1' />
						<div className='flex items-center gap-3'>
							<LinkButton to='/app-store/updates' variant='default' size='dialog' className='relative h-[33px]'>
								Updates
								<NotificationBadge count={2} />
							</LinkButton>
							<div className='flex items-center'>
								<TbSearch className='h-4 w-4 shrink-0 opacity-50' />
								<input
									className='w-[] bg-transparent p-1 text-15 outline-none'
									placeholder='Search apps'
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									// Prevent closing modal when pressing Escape
									onKeyDown={(e) => {
										if (e.key === 'Escape') {
											setSearchQuery('')
											e.preventDefault()
										}
									}}
								/>
							</div>
						</div>
					</div>
					<SheetDescription className='flex items-baseline justify-between text-left text-17 font-medium -tracking-2 text-white/75'>
						{t('app-store.tagline')}
						<DropdownMenu>
							<DropdownMenuTrigger>
								<TbDots className='h-5 w-5' />
							</DropdownMenuTrigger>
							<DropdownMenuContent align='end'>
								<DropdownMenuItem asChild>
									<Link to='/app-store/add-community-store'>Community app stores</Link>
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</SheetDescription>
				</SheetHeader>
				{!searchQuery && <DiscoverContentMemoized />}
				{deferredSearchQuery && <SearchResultsMemoized query={deferredSearchQuery} />}
			</div>
			<Outlet />
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

const categories = [
	{
		id: 'discover',
		label: 'Discover',
	},
	{
		id: 'all',
		label: 'All Apps',
	},
	{
		id: 'files-productivity',
		label: 'Files & productivity',
	},
	{
		id: 'finance',
		label: 'Finance',
	},
	{
		id: 'media',
		label: 'Media',
	},
	{
		id: 'networking',
		label: 'Networking',
	},
	{
		id: 'social',
		label: 'Social',
	},
	{
		id: 'automation',
		label: 'Automation',
	},
	{
		id: 'developer-tools',
		label: 'Developer Tools',
	},
] as const

type Category = (typeof categories)[number]
type CategoryId = Category['id']

// const categoriesKeyed = keyBy(categories, 'id') as {
// 	[K in (typeof categories)[number]['id']]: Category
// }

function DiscoverContent() {
	const {categoryId} = useParams<{categoryId: CategoryId}>()
	const {isLoading, apps, appsKeyed} = useAvailableApps()

	if (isLoading) {
		return <p>Loading...</p>
	}

	const activeId = categoryId || categories[0].id

	return (
		<>
			<div className='umbrel-hide-scrollbar umbrel-fade-scroller-x -my-2 flex gap-[5px] overflow-x-auto py-2'>
				{categories.map((category) => (
					<LinkButton
						key={category.id}
						to={`/app-store/category/${category.id}`}
						variant={category.id === activeId ? 'primary' : 'default'}
						size='lg'
					>
						{category.label}
					</LinkButton>
				))}
			</div>
			<AppsGallerySection apps={apps.slice(0, 5)} />
			<AppsGridSection overline='Most installs' title='By popular demand' apps={apps.slice(0, 9)} />
			<AppsRowSection overline='Staff picks' title='Curated for you' apps={apps.slice(0, 5)} />
			<AppsGridSection overline='Recently published' title='Fresh from the oven' apps={apps.slice(0, 9)} />
			<Apps3UpSection
				apps={[appsKeyed['bitcoin'], appsKeyed['lightning'], appsKeyed['electrs']]}
				overline='Bitcoin'
				title='Node of your own, an ode to autonomy.'
				description='In this decentralized era, running your personal node is a breeze. Run your node, power the new internet, and take the blockchain by the blocks.'
			>
				<Button variant='secondary' size='dialog'>
					Browse Bitcoin apps
				</Button>
			</Apps3UpSection>
			<AppsGridSection overline='Must haves' title='Essentials for your Umbrel' apps={apps.slice(0, 9)} />
			<Apps3UpSection
				apps={[appsKeyed['immich'], appsKeyed['nextcloud'], appsKeyed['photoprism']]}
				overline='Files & productivity'
				title='Bytes in the right place.'
				description='The best place for all your photos, files, and movies is your place. 
				Browse apps that lets you truly own & self-host your data.'
				textLocation='right'
			>
				<Button variant='secondary' size='dialog'>
					Browse productivity apps
				</Button>
			</Apps3UpSection>
			<AppsGridSection overline='Under the radar' title='Hidden gems' apps={apps.slice(0, 9)} />
			<Apps3UpSection
				apps={[appsKeyed['jellyfin'], appsKeyed['plex'], appsKeyed['sonarr']]}
				overline='Bitcoin'
				title='Node of your own, an ode to autonomy.'
				description='In this decentralized era, running your personal node is a breeze. Run your node, power the new internet, and take the blockchain by the blocks.'
			>
				<Button variant='secondary' size='dialog'>
					Browse Bitcoin apps
				</Button>
			</Apps3UpSection>
		</>
	)
}

const DiscoverContentMemoized = memo(DiscoverContent)
