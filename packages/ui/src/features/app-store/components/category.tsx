import {ErrorBoundary} from 'react-error-boundary'
import {useTranslation} from 'react-i18next'
import {Link, Navigate, useParams} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'
import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {FadeInImg} from '@/components/ui/fade-in-img'
import {AppCardAction} from '@/features/app-store/components/app-card'
import {SortControl, useSortParam} from '@/features/app-store/components/sort-control'
import {VirtualAppGrid} from '@/features/app-store/components/virtual-app-grid'
import {
	appPath,
	categoryIcon,
	DISCOVER_PATH,
	storeCardClass,
	storeRevealClass,
	storeRevealDelay,
} from '@/features/app-store/constants'
import type {AppStoreStatus} from '@/features/app-store/data/catalog'
import {getAvailableSorts, getCategoryLabel, sortApps} from '@/features/app-store/data/catalog'
import {preloadFirstFewGalleryImages} from '@/features/app-store/data/gallery-preload'
import {useAppCardStateMap, useAppStatusMap} from '@/features/app-store/hooks/use-app-status'
import {useStorefront} from '@/features/app-store/hooks/use-storefront'
import {useIsSmallMobile} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'
import {useHomeFit} from '@/modules/desktop/home-fit'
import {useAvailableApps} from '@/providers/available-apps'
import type {AppStateOrLoading, RegistryApp} from '@/trpc/trpc'

export default function Category() {
	return (
		<ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>
			<CategoryContent />
		</ErrorBoundary>
	)
}

function CategoryContent() {
	const {t} = useTranslation()
	const {categoryId} = useParams<{categoryId: string}>()
	const {apps, appsGroupedByCategory, isLoading} = useAvailableApps()
	const storefront = useStorefront()
	const statuses = useAppStatusMap()
	const appStates = useAppCardStateMap(apps ?? [])
	const availableSorts = getAvailableSorts(storefront.dates)
	const sort = useSortParam(availableSorts)
	// Below md the tall featured cards would stack into a wall above the grid,
	// and on a phone on its side one card fills the screen; dropping them (not
	// just hiding) also skips their gallery image loads
	const isSmallMobile = useIsSmallMobile()
	const {low} = useHomeFit()

	if (!categoryId) return null
	// Category data is local truth; optional editorial metadata can enhance it
	// later but must never hold this route behind a network request.
	if (isLoading) return null

	// 'all' is the pseudo-category for the complete catalog
	const isAll = categoryId === 'all'
	const categoryApps = isAll ? (apps ?? []) : (appsGroupedByCategory?.[categoryId] ?? [])

	// Unknown category, or one that (no longer) has apps — e.g. a predefined
	// category whose apps have all been recategorized upstream
	if (categoryApps.length === 0) return <Navigate to={DISCOVER_PATH} replace />

	const sortedApps = sortApps(categoryApps, sort, storefront.dates)
	const icon = categoryIcon(categoryId)
	const featuredApps =
		isAll || isSmallMobile || low ? [] : (storefront.featuredByCategory.get(categoryId)?.slice(0, 3) ?? [])

	return (
		<>
			<header className={cn('flex items-center gap-2 md:gap-2.5', storeRevealClass)}>
				{icon && (
					<img
						src={icon}
						alt=''
						className='h-14 w-14 object-contain md:h-18 md:w-18 low:h-9 low:w-9'
						draggable={false}
					/>
				)}
				<h2 className='min-w-0 flex-1 truncate text-24 leading-tight font-semibold -tracking-3 md:text-32'>
					{getCategoryLabel(categoryId)}
				</h2>
			</header>
			{featuredApps.length > 0 && (
				<section
					className={cn('flex flex-col gap-3', storeRevealClass)}
					style={storeRevealDelay(70)}
					aria-label={t('app-store.featured-apps')}
				>
					<h3 className='truncate px-2.5 text-17 leading-tight font-semibold -tracking-3 md:text-19'>
						{t('app-store.featured-apps')}
					</h3>
					{/* Two columns up to xl, three from there: the third pick only
					    shows once the row can hold it, never orphaned on its own row */}
					<div className='grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3'>
						{featuredApps.map((app, index) => {
							const actionState = appStates.get(app.id)
							return (
								<FeaturedAppCard
									key={app.id}
									app={app}
									status={statuses?.get(app.id)}
									lifecycleState={actionState?.state}
									progress={actionState?.progress}
									className={index === 2 ? 'max-xl:hidden' : undefined}
								/>
							)
						})}
					</div>
				</section>
			)}
			<section className={cn('flex flex-col gap-3', featuredApps.length > 0 && 'mt-2')}>
				{/* Same heading treatment as "Featured apps" above, with the sort
				    control living on the row it actually sorts */}
				<div
					className={cn('flex items-center justify-between gap-3 px-2.5', storeRevealClass)}
					style={storeRevealDelay(featuredApps.length > 0 ? 130 : 70)}
				>
					<h3 className='min-w-0 truncate text-17 leading-tight font-semibold -tracking-3 md:text-19'>
						{isAll
							? t('app-store.section.all-apps')
							: t('app-store.all-category-apps', {category: getCategoryLabel(categoryId)})}
					</h3>
					<SortControl availableSorts={availableSorts} />
				</div>
				<VirtualAppGrid apps={sortedApps} statuses={statuses} revealDelayStart={featuredApps.length > 0 ? 180 : 130} />
			</section>
		</>
	)
}

/**
 * A remote-curated category pick: a tall editorial card with the app's first
 * screenshot filling the top, its last few pixels melting into the surface
 * just above the icon and copy anchored beneath it, and the same working
 * action button as the grids. Apps without a gallery get the tiles'
 * luminosity-normalized icon glow instead.
 */
function FeaturedAppCard({
	app,
	status,
	lifecycleState,
	progress,
	className,
}: {
	app: RegistryApp
	status?: AppStoreStatus
	lifecycleState?: AppStateOrLoading
	progress?: number
	className?: string
}) {
	const gallerySrc = app.gallery[0]

	return (
		<div
			onMouseEnter={() => preloadFirstFewGalleryImages(app)}
			className={cn(
				storeCardClass,
				'group relative flex h-[280px] flex-col justify-end overflow-hidden p-4 transition-colors duration-300 hover:bg-white/6',
				// Hairline over the card edge — the material's own border sits under
				// the artwork, so it needs to be an overlay to show at the top
				'after:pointer-events-none after:absolute after:inset-0 after:rounded-24 after:ring-1 after:ring-white/8 after:ring-inset',
				className,
			)}
		>
			{/* Backdrop: the first screenshot, ending just above the copy row
			    (280 - p-4 - 56px icon = 208px). Its bottom third melts into the
			    surface on an ease-out ramp (front-loaded stops: mostly opaque for
			    longer, then a soft tail) — a straight linear fade reads as a
			    hard edge. The row itself sits on plain card. */}
			{gallerySrc ? (
				<div
					aria-hidden
					className='absolute inset-x-0 top-0 h-[200px] [mask-image:linear-gradient(to_bottom,black_64%,rgba(0,0,0,0.75)_78%,rgba(0,0,0,0.35)_90%,transparent)]'
				>
					<FadeInImg
						src={gallerySrc}
						alt=''
						loading='lazy'
						className='h-full w-full object-cover object-top opacity-80 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-[1.02]'
					/>
				</div>
			) : (
				// Same normalized glow as the rail tiles: the icon's hue over a
				// fixed mid-gray luminosity base
				<div
					aria-hidden
					className='absolute top-2 left-1/2 isolate h-24 w-24 -translate-x-1/2 scale-150 opacity-30 blur-xl'
				>
					<div className='absolute inset-0 bg-neutral-400' />
					<img src={app.icon} alt='' className='absolute inset-0 h-full w-full mix-blend-color' draggable={false} />
				</div>
			)}
			{/* Stretched link: the whole card navigates, the action stays independent */}
			<Link
				to={appPath(app.id)}
				state={{fromAppStore: true}}
				aria-label={app.name}
				className='absolute inset-0 rounded-24 outline-hidden ring-inset focus-visible:ring-2 focus-visible:ring-white/25'
			/>
			<div className='pointer-events-none relative flex items-center gap-3'>
				<AppIcon src={app.icon} size={56} className='shrink-0 rounded-12' />
				<div className='flex min-w-0 flex-1 flex-col gap-0.5'>
					<h3 className='truncate text-15 leading-tight font-semibold -tracking-3'>{app.name}</h3>
					<p className='line-clamp-2 w-full min-w-0 text-12 leading-tight opacity-40'>{app.tagline}</p>
				</div>
				<span className='pointer-events-auto'>
					<AppCardAction app={app} status={status} lifecycleState={lifecycleState} progress={progress} />
				</span>
			</div>
		</div>
	)
}
