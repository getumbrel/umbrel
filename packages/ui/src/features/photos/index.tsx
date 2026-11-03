import {AnimatePresence, motion, useReducedMotion} from 'motion/react'
import {lazy, Suspense, useEffect, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {useTranslation} from 'react-i18next'
import {HiMenuAlt2} from 'react-icons/hi'
import {Outlet, useLocation} from 'react-router-dom'

import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {SheetHeader, SheetTitle} from '@/components/ui/sheet'
import {MobileSidebarWrapper} from '@/features/files/components/sidebar/mobile-sidebar-wrapper'
import {ActionsBar} from '@/features/photos/components/actions-bar'
import {MobileActions} from '@/features/photos/components/actions-bar/mobile-actions'
import {useBarDrop} from '@/features/photos/components/listing/surface'
import {MobileSearch, useSearchEngaged} from '@/features/photos/components/search'
import {PhotosSelectionProvider} from '@/features/photos/components/selection-context'
import {Sidebar} from '@/features/photos/components/sidebar'
import {UploadDropZone} from '@/features/photos/components/upload-drop-zone'
import {PhotosViewProvider} from '@/features/photos/components/view-context'
import {usePhotosEvents} from '@/features/photos/hooks/use-photos-events'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'
import {HttpUrlAuthorizerProvider} from '@/modules/auth/http-url-authorizer'
import {trpcReact} from '@/trpc/trpc'

// The sheet's title row. On phones it is also the search's stage: while a
// search is on, the field and its Cancel take the row (the way the desktop
// field takes the actions bar), and the title returns when it ends. Kept
// never shorter than the pills that share it, so their coming and going
// can't move what's below. A phone on its side gives the row to the grid
// (the actions bar takes its controls) until a search needs it.
function TitleRow({isMobile, openSidebar}: {isMobile: boolean; openSidebar: () => void}) {
	const {t} = useTranslation()
	const searching = useSearchEngaged() && isMobile
	const reduceMotion = useReducedMotion() ?? false
	const swap = (direction: 1 | -1) =>
		reduceMotion
			? {}
			: {
					initial: {opacity: 0, y: 6 * direction},
					animate: {opacity: 1, y: 0},
					exit: {opacity: 0, y: 6 * direction},
					transition: {duration: 0.2, ease: [0.215, 0.61, 0.355, 1] as const},
				}
	return (
		<SheetHeader
			className={cn('flex flex-col gap-4 md:flex-row md:items-center md:gap-0', !searching && 'phone-side:absolute')}
		>
			{/* Above the listing: the map runs up beneath it on phones */}
			<div className='relative z-10 flex min-h-11 w-full items-center'>
				<AnimatePresence initial={false} mode='popLayout'>
					{searching ? (
						<motion.div key='search' className='mr-5 flex min-w-0 flex-1 phone-side:mr-9' {...swap(1)}>
							<MobileSearch />
						</motion.div>
					) : (
						<motion.div key='title' className='flex min-w-0 flex-1 items-center gap-4' {...swap(-1)}>
							{isMobile ? (
								<HiMenuAlt2 role='button' className='h-5 w-5 text-white/90 phone-side:hidden' onClick={openSidebar} />
							) : null}
							<SheetTitle className='mr-2 leading-none lg:mr-0 lg:min-w-[224px] lg:text-36 panes:text-36 phone-side:sr-only'>
								{t('photos')}
							</SheetTitle>
							{/* Phones and tablets: the page's controls, clear of the sheet's close button */}
							<MobileActions className='mr-5 ml-auto lg:hidden phone-side:hidden' />
						</motion.div>
					)}
				</AnimatePresence>
			</div>
		</SheetHeader>
	)
}

const SourceDetailsDialog = lazy(() =>
	import('@/features/photos/components/sources/source-details-dialog').then((m) => ({default: m.SourceDetailsDialog})),
)
const ItemViewer = lazy(() =>
	import('@/features/photos/components/viewer/item-viewer').then((m) => ({default: m.ItemViewer})),
)
const AddSourceDialog = lazy(() =>
	import('@/features/photos/components/sources/add-source-dialog').then((m) => ({default: m.AddSourceDialog})),
)
const CreateAlbumDialog = lazy(() =>
	import('@/features/photos/components/albums/create-album-dialog').then((m) => ({default: m.CreateAlbumDialog})),
)
const RenameAlbumDialog = lazy(() =>
	import('@/features/photos/components/albums/rename-album-dialog').then((m) => ({default: m.RenameAlbumDialog})),
)

// Photos shell: mirrors the Files layout (title row, sidebar column, actions bar
// above the listing outlet) so the two system apps feel like siblings.
export default function PhotosLayout() {
	const {pathname} = useLocation()
	const isMobile = useIsMobile()
	const barDrop = useBarDrop()
	const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)

	// One subscription for the whole Photos surface: refetches on any change
	usePhotosEvents()

	// Whether there is a basemap, asked as Photos opens rather than as the map
	// does: the device's answer can wait on the planet's host (see umbreld's
	// map-tiles.ts), and the map can't be made before it. Held for as long as
	// Photos is open, for the map and the inspector's; nothing here reads it,
	// so its answer re-renders nothing
	trpcReact.photos.map.basemap.useQuery(undefined, {staleTime: Infinity, notifyOnChangeProps: []})

	// Close the mobile sidebar on navigation
	useEffect(() => {
		setIsMobileSidebarOpen(false)
	}, [pathname])

	return (
		<PhotosViewProvider>
			<PhotosSelectionProvider>
				{/* One token query for every thumbnail on the surface */}
				<HttpUrlAuthorizerProvider>
					<TitleRow isMobile={isMobile} openSidebar={() => setIsMobileSidebarOpen(true)} />
					<ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>
						{/* minmax(0,…): a fr column's implicit min is its content's
						    min-content, so a crowded actions bar would push the whole
						    column past the sheet's edge instead of compressing */}
						<div className='mt-[-0.5rem] grid grid-cols-1 lg:grid-cols-[224px_minmax(0,1fr)] phone-side:mt-0'>
							{/* Sidebar */}
							{isMobile ? (
								<MobileSidebarWrapper isOpen={isMobileSidebarOpen} onClose={() => setIsMobileSidebarOpen(false)}>
									<Sidebar className='h-[calc(100svh-140px)] low:h-[calc(100svh-56px)]' />
								</MobileSidebarWrapper>
							) : (
								// Above the listing: the map runs on beneath it
								<Sidebar className='relative z-10 h-[calc(100vh-176px)]' />
							)}

							{/* Files dropped anywhere on the pane upload into the library */}
							<UploadDropZone>
								{/* The bar rests --umbrel-photos-drop below its pinned place until
								    the listing scrolls; the listing's scroll timeline is scoped
								    here so the bar, its sibling, can follow it */}
								<div
									className='umbrel-photos-column flex flex-col gap-3 lg:gap-3'
									style={{['--umbrel-photos-drop' as string]: `${barDrop}px`}}
								>
									<ActionsBar onOpenSidebar={isMobile ? () => setIsMobileSidebarOpen(true) : undefined} />
									{/* Renders the listing for the current section */}
									<Outlet />
								</div>
							</UploadDropZone>
						</div>

						{/* Lazy loaded dialogs, opened via ?dialog=photos-source / photos-add-source / photos-create-album */}
						<Suspense>
							<SourceDetailsDialog />
						</Suspense>
						<Suspense>
							<AddSourceDialog />
						</Suspense>
						<Suspense>
							<CreateAlbumDialog />
						</Suspense>
						<Suspense>
							<RenameAlbumDialog />
						</Suspense>
						<Suspense>
							<ItemViewer />
						</Suspense>
					</ErrorBoundary>
				</HttpUrlAuthorizerProvider>
			</PhotosSelectionProvider>
		</PhotosViewProvider>
	)
}
