import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbArrowLeft} from 'react-icons/tb'
import {useNavigate, useParams} from 'react-router-dom'
import {groupBy} from 'remeda'
import {objectKeys} from 'ts-extras'

import {Loading} from '@/components/ui/loading'
import {SheetHeader, SheetTitle} from '@/components/ui/sheet'
import {communityAppPath} from '@/constants/app-store'
import {AppGridSection, AppStoreEmptyState, AppStoreNotFound} from '@/features/app-store/components/app-grid'
import {StorePills} from '@/features/app-store/components/category-rail'
import {StoreSearchInput} from '@/features/app-store/components/store-header'
import {storeRevealClass, storeRevealDelay, storeRevealSoftClass} from '@/features/app-store/constants'
import {getCategoryLabel, getNavCategories} from '@/features/app-store/data/catalog'
import {createAppStoreSearch} from '@/features/app-store/data/search'
import {useAppStatusMap} from '@/features/app-store/hooks/use-app-status'
import {useStoreSearch} from '@/features/app-store/hooks/use-store-search'
import {StoreActionsProvider} from '@/features/app-store/providers/store-actions'
import {cn} from '@/lib/utils'
import {CommunityBadge} from '@/modules/community-app-store/community-badge'
import {trpcReact, type RegistryApp} from '@/trpc/trpc'

export default function CommunityAppStoreHome() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const {appStoreId} = useParams<{appStoreId: string}>()
	const registryId = appStoreId ?? ''

	const registryQ = trpcReact.appStore.registry.useQuery()
	const statuses = useAppStatusMap(registryId)
	const search = useStoreSearch()
	const [activeCategory, setActiveCategory] = useState('all')

	const appStore = registryQ.data?.find((appStore) => appStore?.meta.id === appStoreId)
	const appStoreName = appStore?.meta.name

	if (registryQ.isLoading) {
		return <Loading />
	}

	if (registryQ.isError || !registryQ.data) {
		throw new Error('No data')
	}

	if (!appStore) {
		return (
			<AppStoreNotFound
				title={t('community-app-store.not-found.title')}
				description={t('community-app-store.not-found.description')}
			/>
		)
	}

	const apps = appStore.apps
	const appsGroupedByCategory = groupBy(apps, (app) => app.category)
	const makeTo = (app: RegistryApp) => communityAppPath(registryId, app.id)
	// Local and instant, like the main store: registry fields only, scoped to this store
	const results = search.deferredQuery ? createAppStoreSearch(apps)(search.deferredQuery) : undefined
	// All apps first, then this store's categories in the catalog's order (no Discover here)
	const navIds = getNavCategories(appsGroupedByCategory).filter((navId) => navId !== 'discover')
	const pills = navIds.map((navId) => ({id: navId, label: getCategoryLabel(navId)}))
	// The rail only earns its place when there is a category to pick besides All
	const showPills = pills.length > 2
	const categoryId = navIds.includes(activeCategory) ? activeCategory : 'all'

	return (
		<StoreActionsProvider>
			<div className='flex flex-col gap-5 md:gap-6'>
				<SheetHeader className={cn('gap-4', storeRevealSoftClass)}>
					<div className='flex flex-col gap-3 px-2.5 md:px-0'>
						<button
							onClick={() => navigate('/app-store')}
							className='flex items-center gap-1 self-start underline-offset-2 outline-hidden focus-visible:underline'
						>
							<TbArrowLeft className='h-5 w-5' />
							{t('community-app-store.back-to-umbrel-app-store')}
						</button>
						<CommunityBadge className='self-start' />
						{/* Search sits on its own full-width row on mobile, beside the title on desktop */}
						<div className='flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between'>
							<SheetTitle className='leading-none'>
								{t('community-app-store.page-title', {name: appStoreName})}
							</SheetTitle>
							<StoreSearchInput
								className='max-w-none md:max-w-[200px]'
								inputRef={search.setActiveInput}
								value={search.query}
								onValueChange={search.setQuery}
							/>
						</div>
						{showPills && !search.deferredQuery && (
							<StorePills items={pills} activeId={categoryId} onSelect={setActiveCategory} />
						)}
					</div>
				</SheetHeader>
				{results ? (
					<div key='search' className={storeRevealClass} style={storeRevealDelay(70)}>
						{results.length > 0 ? (
							<AppGridSection
								title={
									<>
										<span className='opacity-50'>{t('app-store.search.results-for')}</span> {search.deferredQuery}
									</>
								}
								rightChildren={
									<span className='text-13 whitespace-nowrap text-white/40'>
										{t('app-store.search.result-count', {count: results.length})}
									</span>
								}
								apps={results}
								statuses={statuses}
								makeTo={makeTo}
							/>
						) : (
							<AppStoreEmptyState
								title={t('app-store.search.no-results')}
								description={t('app-store.search.no-results-description')}
							/>
						)}
					</div>
				) : categoryId !== 'all' ? (
					<div key={categoryId} className={storeRevealClass} style={storeRevealDelay(70)}>
						<AppGridSection
							title={getCategoryLabel(categoryId)}
							rightChildren={
								<span className='text-13 whitespace-nowrap text-white/40'>
									{t('community-app-stores.app-count', {count: appsGroupedByCategory[categoryId]?.length ?? 0})}
								</span>
							}
							apps={appsGroupedByCategory[categoryId] ?? []}
							statuses={statuses}
							makeTo={makeTo}
						/>
					</div>
				) : (
					objectKeys(appsGroupedByCategory).map((category, index) => (
						<div key={category} className={storeRevealClass} style={storeRevealDelay(Math.min(70 + index * 70, 420))}>
							<AppGridSection
								title={getCategoryLabel(category)}
								apps={appsGroupedByCategory[category]}
								statuses={statuses}
								makeTo={makeTo}
							/>
						</div>
					))
				)}
			</div>
		</StoreActionsProvider>
	)
}
