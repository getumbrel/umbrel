import {motion, useReducedMotion, useTransform} from 'motion/react'
import {useLayoutEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {RiCloseCircleFill} from 'react-icons/ri'
import {TbCircleArrowUp, TbDots, TbSearch} from 'react-icons/tb'
import {Link} from 'react-router-dom'
import {useWindowSize} from 'react-use'

import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {NotificationBadge} from '@/components/ui/notification-badge'
import {SheetHeader, SheetTitle} from '@/components/ui/sheet'
import {UMBREL_APP_STORE_ID} from '@/constants/app-store'
import {CategoryRail} from '@/features/app-store/components/category-rail'
import {UpdatesDialogConnected} from '@/features/app-store/components/updates-dialog'
import {storeRevealSoftClass} from '@/features/app-store/constants'
import {useStickyCollapse} from '@/features/app-store/hooks/use-sticky-collapse'
import type {useStoreSearch} from '@/features/app-store/hooks/use-store-search'
import {useAppsWithUpdates} from '@/hooks/use-apps-with-updates'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useQueryParams} from '@/hooks/use-query-params'
import {cn} from '@/lib/utils'
import {CommunityAppStoreDialog} from '@/modules/app-store/community-app-store-dialog'
import {SheetFixedContent} from '@/modules/sheet-top-fixed'
import {SheetStickyHeader} from '@/providers/sheet-sticky-header'
import {trpcReact} from '@/trpc/trpc'
import {useLinkToDialog} from '@/utils/dialog'

type StoreSearch = ReturnType<typeof useStoreSearch>
type UpdatesState = ReturnType<typeof useAppsWithUpdates>

const TITLE_ROW_HEIGHT = 36
const ROW_GAP = 20
const RAIL_HEIGHT = 44
const HEADER_HEIGHT = TITLE_ROW_HEIGHT + ROW_GAP + RAIL_HEIGHT
const BAR_HEIGHT = 64
const COLLAPSE_DISTANCE = 90
const NARROW_SEARCH_BELOW_W = 420

export function StoreHeader({search, isOwner}: {search: StoreSearch; isOwner: boolean}) {
	return isOwner ? <OwnerStoreHeader search={search} /> : <StoreHeaderChrome search={search} />
}

function OwnerStoreHeader({search}: {search: StoreSearch}) {
	const updates = useAppsWithUpdates()
	return (
		<>
			<StoreHeaderChrome search={search} updates={updates} showOwnerControls />
			{/* Both expanded and compact bars have triggers, but the URL-driven
			    singleton dialogs and their controller state mount exactly once. */}
			<UpdatesDialogConnected />
			<CommunityAppStoreDialog />
		</>
	)
}

function StoreHeaderChrome({
	search,
	updates,
	showOwnerControls = false,
}: {
	search: StoreSearch
	updates?: UpdatesState
	showOwnerControls?: boolean
}) {
	const isMobile = useIsMobile()
	return isMobile ? (
		<MobileStoreHeader search={search} updates={updates} showOwnerControls={showOwnerControls} />
	) : (
		<DesktopStoreHeader search={search} updates={updates} showOwnerControls={showOwnerControls} />
	)
}

function DesktopStoreHeader({
	search,
	updates,
	showOwnerControls,
}: {
	search: StoreSearch
	updates?: UpdatesState
	showOwnerControls: boolean
}) {
	const {t} = useTranslation()
	const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)
	const {progress, wrapperY, pinned, settled} = useStickyCollapse(anchor, COLLAPSE_DISTANCE)
	const reduceMotion = Boolean(useReducedMotion())
	const reducedProgress = useTransform(progress, (value): number => (value > 0 ? 1 : 0))
	const collapseProgress = reduceMotion ? reducedProgress : progress
	const showRail = !search.deferredQuery
	const headerHeight = showRail ? HEADER_HEIGHT : TITLE_ROW_HEIGHT

	const clusterRef = useRef<HTMLDivElement>(null)
	const [clusterWidth, setClusterWidth] = useState(300)
	useLayoutEffect(() => {
		const cluster = clusterRef.current
		if (!cluster) return
		const measure = () => setClusterWidth(cluster.getBoundingClientRect().width)
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(cluster)
		return () => observer.disconnect()
	}, [])

	const titleOpacity = useTransform(collapseProgress, [0, 0.45], [1, 0])
	const titleY = useTransform(collapseProgress, [0, 1], [0, -8])
	const clusterY = useTransform(collapseProgress, [0, 1], [0, (BAR_HEIGHT - TITLE_ROW_HEIGHT) / 2])
	const railY = useTransform(collapseProgress, [0, 1], [TITLE_ROW_HEIGHT + ROW_GAP, (BAR_HEIGHT - RAIL_HEIGHT) / 2])
	const railRight = useTransform(collapseProgress, [0, 1], [0, clusterWidth + 16])

	return (
		<>
			{/* This in-flow anchor owns the natural position and space; the visual
			    tree below is portalled once and follows it until it reaches chrome. */}
			<div ref={setAnchor} data-testid='store-header-anchor' style={{height: headerHeight}} />

			{anchor && (
				<SheetFixedContent>
					<motion.div
						data-testid='store-scroll-header'
						className={cn('pointer-events-none absolute inset-x-0 top-0 z-[55]', storeRevealSoftClass)}
						style={{y: wrapperY, height: headerHeight}}
					>
						<div className='relative mx-3 h-full md:mx-[40px] xl:mx-[70px]'>
							<motion.div style={{opacity: titleOpacity, y: titleY}} className='absolute top-0 left-0'>
								<SheetTitle className='leading-none whitespace-nowrap lg:text-36'>{t('app-store.title')}</SheetTitle>
							</motion.div>
							<motion.div
								ref={clusterRef}
								style={{y: clusterY}}
								className='pointer-events-auto absolute top-0 right-0 flex items-center gap-2'
							>
								<StoreSearchInput
									inputRef={search.setActiveInput}
									value={search.query}
									onValueChange={search.setQuery}
								/>
								{showOwnerControls && <OwnerControls updates={updates} />}
							</motion.div>
							{showRail && (
								<motion.div style={{y: railY, right: railRight}} className='pointer-events-auto absolute top-0 left-0'>
									<CategoryRail />
								</motion.div>
							)}
						</div>
					</motion.div>
				</SheetFixedContent>
			)}

			<SheetStickyHeader visible={pinned} surfaceVisible={settled} animateContent={false} fadeSurface>
				<DialogCloseButton surface='sheet' />
			</SheetStickyHeader>
		</>
	)
}

function MobileStoreHeader({
	search,
	updates,
	showOwnerControls,
}: {
	search: StoreSearch
	updates?: UpdatesState
	showOwnerControls: boolean
}) {
	const {t} = useTranslation()
	return (
		<SheetHeader className={cn('gap-4 low:gap-2', storeRevealSoftClass)}>
			{/* The sheet's close button sits in this row's top-right corner on phones;
			    the right padding keeps the controls clear of it. From md the sheet's
			    own padding does that, and the row lines up with the content below */}
			<div className='flex flex-wrap items-center gap-x-3 gap-y-3 pr-8 pl-2.5 md:pr-0 md:pl-0'>
				<SheetTitle className='leading-none whitespace-nowrap'>{t('app-store.title')}</SheetTitle>
				<div className='flex min-w-0 flex-1 items-center justify-end gap-2'>
					<StoreSearchInput inputRef={search.setActiveInput} value={search.query} onValueChange={search.setQuery} />
					{showOwnerControls && <OwnerControls updates={updates} />}
				</div>
			</div>
			{!search.deferredQuery && <CategoryRail />}
		</SheetHeader>
	)
}

export function StoreSearchInput({
	value,
	onValueChange,
	inputRef,
	className,
}: {
	value: string
	onValueChange: (query: string) => void
	inputRef?: React.Ref<HTMLInputElement>
	className?: string
}) {
	const {t} = useTranslation()
	// On the narrowest phones the field can't hold "Search apps", and a clipped word looks broken
	const narrow = useWindowSize().width < NARROW_SEARCH_BELOW_W
	return (
		<div
			className={cn(
				'settings-edge-material flex h-9 w-full max-w-[200px] min-w-0 shrink items-center gap-2 rounded-full bg-white/3 px-3 text-white/55 transition-colors duration-200',
				'focus-within:bg-white/7 focus-within:text-white/80 hover:bg-white/6',
				className,
			)}
		>
			<TbSearch className='h-4 w-4 shrink-0 opacity-70' />
			<input
				ref={inputRef}
				className='min-w-0 flex-1 bg-transparent text-13 text-white outline-hidden placeholder:text-white/35'
				placeholder={narrow ? t('search') : t('app-store.search-apps')}
				value={value}
				onChange={(event) => onValueChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key !== 'Escape') return
					if (value) onValueChange('')
					else event.currentTarget.blur()
					event.preventDefault()
				}}
			/>
			{value && (
				<button
					type='button'
					aria-label={t('app-store.search.clear')}
					onPointerDown={(event) => event.preventDefault()}
					onClick={() => onValueChange('')}
					className='shrink-0 opacity-50 outline-hidden transition-opacity hover:opacity-90 focus-visible:opacity-90'
				>
					<RiCloseCircleFill className='h-4 w-4' />
				</button>
			)}
		</div>
	)
}

function OwnerControls({updates}: {updates?: UpdatesState}) {
	return (
		<>
			<UpdatesTrigger updates={updates} />
			<CommunityAppsMenuTrigger />
		</>
	)
}

function UpdatesTrigger({updates}: {updates?: UpdatesState}) {
	const {t} = useTranslation()
	const linkToDialog = useLinkToDialog()
	if (!updates || updates.isLoading || updates.appsWithUpdates.length === 0) return null

	return (
		<Link
			to={linkToDialog('updates')}
			aria-label={t('app-updates.updates-available-count', {count: updates.appsWithUpdates.length})}
			className='settings-edge-material relative flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white/3 px-3 text-13 font-medium text-white/70 outline-hidden transition-colors duration-200 hover:bg-white/6 hover:text-white focus-visible:ring-2 focus-visible:ring-white/25'
		>
			<TbCircleArrowUp className='h-4 w-4' />
			<span className='max-md:hidden'>{t('app-store.updates')}</span>
			<NotificationBadge count={updates.appsWithUpdates.length} />
		</Link>
	)
}

function CommunityAppsMenuTrigger() {
	const {t} = useTranslation()
	const {addLinkSearchParams} = useQueryParams()
	// Already cached by AvailableAppsProvider — no extra request
	const registryQ = trpcReact.appStore.registry.useQuery()
	const communityStores = (registryQ.data ?? []).filter(
		(repo): repo is NonNullable<typeof repo> => repo !== null && repo.meta.id !== UMBREL_APP_STORE_ID,
	)
	const manageLink = {search: addLinkSearchParams({dialog: 'add-community-store'})}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				tabIndex={-1}
				className='settings-edge-material flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/3 text-white/70 transition-colors duration-200 hover:bg-white/6 hover:text-white'
				aria-label={t('app-store.menu.community-app-stores')}
			>
				<TbDots className='h-4.5 w-4.5' />
			</DropdownMenuTrigger>
			<DropdownMenuContent className='p-1' align='end'>
				{communityStores.length === 0 ? (
					<DropdownMenuItem asChild>
						<Link to={manageLink}>{t('app-store.menu.community-app-stores')}</Link>
					</DropdownMenuItem>
				) : (
					// With stores added, each one is a hover away instead of buried
					// behind the manage dialog
					<DropdownMenuSub>
						<DropdownMenuSubTrigger className='gap-3'>
							{t('app-store.menu.community-app-stores')}
						</DropdownMenuSubTrigger>
						<DropdownMenuPortal>
							<DropdownMenuSubContent className='max-w-64 p-1'>
								<DropdownMenuItem asChild>
									<Link to={manageLink}>{t('app-store.menu.manage-community-app-stores')}</Link>
								</DropdownMenuItem>
								<DropdownMenuSeparator className='-mx-1 my-1' />
								{communityStores.map((repo) => (
									<DropdownMenuItem key={repo.meta.id} asChild>
										<Link to={`/community-app-store/${repo.meta.id}`} title={repo.meta.name} className='min-w-0'>
											<span className='min-w-0 truncate'>{repo.meta.name}</span>
										</Link>
									</DropdownMenuItem>
								))}
							</DropdownMenuSubContent>
						</DropdownMenuPortal>
					</DropdownMenuSub>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
