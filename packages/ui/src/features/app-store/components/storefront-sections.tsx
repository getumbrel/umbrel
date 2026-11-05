import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbChevronRight} from 'react-icons/tb'
import {Link} from 'react-router-dom'

import {FadeScroller} from '@/components/fade-scroller'
import {
	Carousel,
	CarouselArrows,
	CarouselContent,
	CarouselDots,
	CarouselItem,
	useCarouselAutoAdvance,
	useCarouselSnaps,
	type CarouselApi,
} from '@/components/ui/carousel'
import {FadeInImg} from '@/components/ui/fade-in-img'
import {AppCardCompact, AppChip} from '@/features/app-store/components/app-card'
import {AppGridSection} from '@/features/app-store/components/app-grid'
import {SectionHeading} from '@/features/app-store/components/section-heading'
import {appPath, categoryPath, sheetBleedClass, storeCardClass} from '@/features/app-store/constants'
import type {AppStoreStatus} from '@/features/app-store/data/catalog'
import {getCategoryLabel} from '@/features/app-store/data/catalog'
import {preloadFirstFewGalleryImages} from '@/features/app-store/data/gallery-preload'
import type {ResolvedSection, SpotlightBanner as SpotlightBannerData} from '@/features/app-store/data/storefront'
import {cn} from '@/lib/utils'
import type {RegistryApp} from '@/trpc/trpc'

// Renders one resolved editorial section. Sections fade in when remote data
// arrives, enhancing the already-complete local layout underneath.
export function StorefrontSectionView({
	section,
	statuses,
}: {
	section: ResolvedSection
	statuses?: Map<string, AppStoreStatus>
}) {
	switch (section.type) {
		case 'spotlight':
			return <SpotlightCarousel banners={section.banners} />
		case 'app-list':
			return section.layout === 'rail' ? (
				<AppRailSection overline={section.subtitle} title={section.title} apps={section.apps} statuses={statuses} />
			) : (
				<AppGridSection overline={section.subtitle} title={section.title} apps={section.apps} statuses={statuses} />
			)
		case 'category-feature':
			return (
				<CategoryFeatureSection
					categoryId={section.categoryId}
					title={section.title}
					description={section.description}
					apps={section.apps}
					artwork={section.artwork}
					textSide={section.textSide}
				/>
			)
	}
}

/**
 * The spotlight section's banners in one row, like the apps.umbrel.com
 * banner carousel: the active banner snaps centered while its neighbors peek
 * in from the sheet edges, auto-rotating on a 5s timer with the countdown
 * filling the active dot. The clock holds while dragging or hovering and
 * restarts when the slide changes. The slide narrows again past 1440px, where
 * the sheet stops growing, so the banner doesn't run away with the whole row on
 * a wide display, and follows the window's height so a 2:1 banner always fits a
 * short screen. A banner whose artwork fails to load simply leaves the row —
 * the artwork is the whole banner, there is nothing else to show in its place.
 */
export function SpotlightCarousel({banners}: {banners: SpotlightBannerData[]}) {
	const [api, setApi] = useState<CarouselApi>()
	const [failedAppIds, setFailedAppIds] = useState<ReadonlySet<string>>(new Set())
	const [hovered, setHovered] = useState(false)
	const [focusWithin, setFocusWithin] = useState(false)
	const shown = banners.filter((banner) => !failedAppIds.has(banner.app.id))
	const {snapCount, activeIndex} = useCarouselSnaps(api)
	const countdown = useCarouselAutoAdvance(api, {enabled: shown.length > 1, paused: hovered || focusWithin})

	const onArtworkError = (appId: string) => setFailedAppIds((prev) => new Set(prev).add(appId))

	if (shown.length === 0) return null
	if (shown.length === 1) return <SpotlightBanner banner={shown[0]} onArtworkError={onArtworkError} />

	return (
		<section
			aria-label={shown.map((banner) => banner.app.name).join(' · ')}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			onFocusCapture={() => setFocusWithin(true)}
			onBlurCapture={(event) => {
				const nextTarget = event.relatedTarget
				if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) setFocusWithin(false)
			}}
		>
			<Carousel
				setApi={setApi}
				className='-mx-3 md:-mx-[40px] xl:-mx-[70px]'
				opts={{align: 'center', containScroll: 'trimSnaps'}}
			>
				<CarouselContent containerClassName='px-3 md:px-[40px] xl:px-[70px]' className='-ml-3 md:-ml-4'>
					{shown.map((banner) => (
						<CarouselItem
							key={banner.app.id}
							className='basis-[min(86%,120dvh)] pl-3 md:basis-[min(78%,120dvh)] md:pl-4 min-[1440px]:basis-[min(70%,120dvh)]'
						>
							<SpotlightBanner banner={banner} onArtworkError={onArtworkError} />
						</CarouselItem>
					))}
				</CarouselContent>
			</Carousel>
			<div className='mt-3 flex items-center justify-between pointer-coarse:justify-center'>
				<CarouselDots
					count={snapCount}
					activeIndex={activeIndex}
					onSelect={(index) => api?.scrollTo(index)}
					countdown={countdown}
				/>
				{/* Arrows wrap around the ends, like the apps.umbrel.com banners */}
				<CarouselArrows
					onPrev={() => api?.scrollTo((activeIndex - 1 + snapCount) % snapCount)}
					onNext={() => api?.scrollTo((activeIndex + 1) % snapCount)}
				/>
			</div>
		</section>
	)
}

export function AppRailSection({
	overline,
	title,
	apps,
	statuses,
}: {
	overline?: string
	title: string
	apps: RegistryApp[]
	statuses?: Map<string, AppStoreStatus>
}) {
	return (
		<section className='flex flex-col gap-3'>
			<SectionHeading overline={overline} title={title} />
			{/* overflow-y-hidden because overflow-x:auto would otherwise force the
			    vertical axis to auto too, making any 1px of decoration scrollable */}
			<FadeScroller
				direction='x'
				className={cn('umbrel-hide-scrollbar flex gap-2.5 overflow-x-auto overflow-y-hidden py-1', sheetBleedClass)}
			>
				{apps.map((app) => (
					<AppCardCompact key={app.id} app={app} status={statuses?.get(app.id)} />
				))}
			</FadeScroller>
		</section>
	)
}

function SpotlightBanner({
	banner: {app, artwork},
	onArtworkError,
}: {
	banner: SpotlightBannerData
	onArtworkError: (appId: string) => void
}) {
	const {t} = useTranslation()

	// The artwork is a complete editorial composition (icon, name and headline
	// are part of the image), so it renders untouched and the banner is just a
	// link to the app it shows
	return (
		<Link
			to={appPath(app.id)}
			state={{fromAppStore: true}}
			onMouseEnter={() => preloadFirstFewGalleryImages(app)}
			aria-label={app.name}
			className={cn(
				storeCardClass,
				'group relative block overflow-hidden outline-hidden focus-visible:ring-2 focus-visible:ring-white/25',
			)}
		>
			<div className='relative aspect-[2/1] w-full'>
				<FadeInImg
					src={artwork.dark}
					alt=''
					loading='lazy'
					className='absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-[1.015]'
					onError={() => onArtworkError(app.id)}
				/>
				<span className='absolute right-3 bottom-3 flex items-center gap-0.5 rounded-full bg-black/40 py-1.5 pr-2 pl-3 text-12 font-medium text-white/90 backdrop-blur-md transition-colors duration-200 group-hover:bg-black/60 max-md:hidden md:right-5 md:bottom-5'>
					{t('app.view')}
					<TbChevronRight className='h-3.5 w-3.5' />
				</span>
			</div>
		</Link>
	)
}

function CategoryFeatureSection({
	categoryId,
	title,
	description,
	apps,
	artwork,
	textSide,
}: {
	categoryId: string
	title: string
	description: string
	apps: RegistryApp[]
	artwork: {dark: string}
	textSide: 'left' | 'right'
}) {
	const {t} = useTranslation()
	const [artworkFailed, setArtworkFailed] = useState(false)

	return (
		<section className={cn(storeCardClass, 'relative overflow-hidden')}>
			{/* From 640px: the artwork fills the card and the copy sits on its clear
			    side. Below it: the artwork is the backdrop of the card's top —
			    cropped to its busy side (the icon cluster opposite the clear
			    side) and scaled to the area's height so the icons stay large —
			    melting into the surface through an eased mask; the copy then
			    sits over that fade at the bottom, so nothing is ever legible
			    only by luck. */}
			<div
				className={cn(
					'absolute inset-x-0 top-0 h-[280px]',
					'max-sm:[mask-image:linear-gradient(to_bottom,black_50%,rgba(0,0,0,0.6)_74%,rgba(0,0,0,0.2)_88%,transparent_96%)]',
					'sm:inset-0 sm:h-auto',
				)}
			>
				{!artworkFailed && (
					<FadeInImg
						src={artwork.dark}
						alt=''
						loading='lazy'
						className={cn(
							'absolute inset-0 h-full w-full object-cover',
							textSide === 'left' ? 'max-sm:object-[72%_50%]' : 'max-sm:object-[28%_50%]',
						)}
						onError={() => setArtworkFailed(true)}
					/>
				)}
				{artworkFailed && <div className='absolute inset-0 bg-linear-to-br from-white/10 to-white/2' />}
			</div>
			{/* Below 640px the copy mirrors the artwork: icons cropped to the left
			    mean the text, chips and link anchor to the right, and vice
			    versa. From there it's a side column, read left-aligned either way. */}
			<div
				className={cn(
					'relative flex flex-col gap-3 p-4 max-sm:pt-[216px] sm:min-h-[260px] sm:w-1/2 sm:justify-center sm:gap-4 sm:p-6 md:min-h-[280px] md:p-8 lg:min-h-[320px]',
					textSide === 'right' && 'max-sm:items-end max-sm:text-right sm:ml-auto',
				)}
			>
				<div className='flex flex-col gap-1.5'>
					<h2 className='text-20 leading-tight font-semibold -tracking-3 sm:text-24'>{title}</h2>
					<p className='max-w-md text-13 leading-snug opacity-60'>{description}</p>
				</div>
				{/* A right-anchored rail still has to scroll from its start when the
				    chips overflow, so the first chip carries an auto left margin
				    (right-aligns while they fit, collapses to zero once they don't)
				    instead of justify-end, which would clip the leading chips */}
				<FadeScroller
					direction='x'
					className={cn(
						// Pulled left by the chips' own inner padding (pl-1.5) so the first
						// icon lines up with the headline instead of sitting 6px in
						'umbrel-hide-scrollbar -mx-4 flex gap-1.5 overflow-x-auto pr-4 pl-2.5 sm:mr-0 sm:-ml-1.5 sm:flex-wrap sm:overflow-visible sm:px-0',
						textSide === 'right' && 'max-sm:self-stretch max-sm:[&>*:first-child]:ml-auto',
					)}
				>
					{apps.slice(0, 6).map((app) => (
						<AppChip key={app.id} app={app} />
					))}
				</FadeScroller>
				<Link
					to={categoryPath(categoryId)}
					className={cn(
						'flex items-center gap-0.5 self-start text-13 font-medium text-white/70 outline-hidden transition-colors duration-200 hover:text-white focus-visible:text-white',
						textSide === 'right' && 'max-sm:self-end',
					)}
				>
					{t('app-store.browse-category-apps', {category: getCategoryLabel(categoryId)})}
					<TbChevronRight className='h-3.5 w-3.5' />
				</Link>
			</div>
		</section>
	)
}
