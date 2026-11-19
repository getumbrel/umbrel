import {AnimatePresence, motion, useReducedMotion} from 'motion/react'
import {lazy, Suspense, useEffect, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {useTranslation} from 'react-i18next'
import {HiMenuAlt2} from 'react-icons/hi'
import {Outlet, useLocation} from 'react-router-dom'

import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {SheetHeader, SheetTitle} from '@/components/ui/sheet'
import {FileViewer} from '@/features/files/components/file-viewer'
import {FilesDndWrapper} from '@/features/files/components/files-dnd-wrapper'
import {ItemActionsSheet} from '@/features/files/components/item-actions-sheet'
import {ActionsBar} from '@/features/files/components/listing/actions-bar'
import {ActionsBarProvider} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {MobileActions} from '@/features/files/components/listing/actions-bar/mobile-actions'
import {MobileSearch} from '@/features/files/components/listing/actions-bar/search'
import {RewindOverlay} from '@/features/files/components/rewind'
import {RewindOverlayProvider} from '@/features/files/components/rewind/overlay-context'
import {Sidebar} from '@/features/files/components/sidebar'
import {MobileSidebarWrapper} from '@/features/files/components/sidebar/mobile-sidebar-wrapper'
import {FilesSearchProvider, useFilesSearch} from '@/features/files/hooks/use-files-search'
import {MachineFoldersProvider} from '@/features/files/hooks/use-machine-folder'
import {useNavigate as useFilesNavigate} from '@/features/files/hooks/use-navigate'
import {useWatcherRefetch} from '@/features/files/hooks/use-watcher-refetch'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {useIsPhone, useIsPhoneNow} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'
import {HttpUrlAuthorizerProvider} from '@/modules/auth/http-url-authorizer'
import {DockSpacer} from '@/modules/desktop/dock'
import {trpcReact} from '@/trpc/trpc'

const ShareInfoDialog = lazy(() => import('@/features/files/components/dialogs/share-info-dialog'))
const ShareUsersDialog = lazy(() => import('@/features/files/components/dialogs/share-users-dialog'))
const PermanentlyDeleteConfirmationDialog = lazy(
	() => import('@/features/files/components/dialogs/permanently-delete-confirmation-dialog'),
)
const AddNetworkShareDialog = lazy(() => import('@/features/files/components/dialogs/add-network-share-dialog'))
const FormatDriveDialog = lazy(() => import('@/features/files/components/dialogs/format-drive-dialog'))
const CloudAddDialog = lazy(() => import('@/features/files/components/dialogs/cloud-add-dialog'))

// The sheet's title row. On a phone it also holds the page's buttons, in the
// room beside "Files", and it is the search's stage: while a search is on,
// the field and its Cancel take the row, and the title returns when it ends.
// Kept never shorter than the pills that share it, so their coming and going
// can't move what's below. A phone on its side gives the row to the listing
// (the actions bar takes its controls) until a search needs it. On a tablet,
// as on a desktop, the bar comes up into this row beside the title and keeps
// its own controls and its own search. The same row, to the pixel, as Photos'.
function TitleRow({hasSidebarDrawer, openSidebar}: {hasSidebarDrawer: boolean; openSidebar: () => void}) {
	const {t} = useTranslation()
	const isPhone = useIsPhone()
	const search = useFilesSearch()
	const searching = isPhone && (search?.open || search?.query !== '')
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
			<div className='relative z-10 flex min-h-11 w-full items-center'>
				<AnimatePresence initial={false} mode='popLayout'>
					{searching ? (
						// (Clear of the sheet's close button: see the note on the title's controls below)
						<motion.div key='search' className='mr-9 flex min-w-0 flex-1' {...swap(1)}>
							<MobileSearch />
						</motion.div>
					) : (
						<motion.div key='title' className='flex min-w-0 flex-1 items-center gap-4' {...swap(-1)}>
							{hasSidebarDrawer ? (
								<button
									type='button'
									onClick={openSidebar}
									aria-label={t('files-sidebar.navigation')}
									className='shrink-0 phone-side:hidden'
								>
									<HiMenuAlt2 className='h-5 w-5 text-white/90' />
								</button>
							) : null}
							<SheetTitle className='mr-2 min-w-0 leading-none whitespace-nowrap lg:mr-0 lg:w-[224px] lg:text-36 panes:text-36 phone-side:sr-only'>
								{t('files')}
							</SheetTitle>
							{/* Phones: the page's controls, clear of the sheet's close button. Not
							    of its glyph alone: under a finger the button answers across the
							    whole 44px of the sheet's corner, and anything of this row in that
							    square would close the window when tapped. The sheet's own 12px
							    of padding and these 36px keep the last control out of it */}
							<MobileActions className='mr-9 ml-auto lg:hidden phone-side:hidden tablet:hidden' />
						</motion.div>
					)}
				</AnimatePresence>
			</div>
		</SheetHeader>
	)
}

export default function FilesLayout() {
	const {t} = useTranslation()
	const {pathname} = useLocation()
	const {setSelectedItems} = useFilesStore()
	const setViewerItem = useFilesStore((state) => state.setViewerItem)
	const setIsSelectingOnMobile = useFilesStore((state) => state.setIsSelectingOnMobile)
	const {currentPath} = useFilesNavigate()

	const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
	// Tablets and inner displays keep the sidebar beside the listing. Phones, and
	// anything too short for it, open it as a drawer. It follows the keyboard, as
	// the layout's `phone-side` variant does.
	const hasSidebarDrawer = useIsPhoneNow()
	const isReadOnly = useIsFilesReadOnly()
	const {data: user} = trpcReact.user.get.useQuery()
	const canManageSambaShares = user?.role === 'owner' || user?.sambaEnabled === true

	// One subscription for the whole Files surface: refreshes every mounted
	// listing (main view, /Apps, /Trash, sidebar trash) on external changes
	useWatcherRefetch()

	useEffect(() => {
		// TODO: Find a better place to do this
		// clear selected items when navigating to a different path
		// NOTE: when we remove/change this, we need to update the Files results
		// in packages/ui/src/components/cmdk-sources.tsx to set the selected item
		// correctly
		setSelectedItems([])

		// Close any open file viewer (text editor, image viewer, etc.), unless its
		// file is in the folder now shown: a search result elsewhere is revealed
		// and opened in one go
		const {viewerItem} = useFilesStore.getState()
		if (viewerItem?.path.slice(0, viewerItem.path.lastIndexOf('/')) !== currentPath) setViewerItem(null)

		// set selecting on mobile to false when navigating to a different path
		setIsSelectingOnMobile(false)
		useFilesStore.getState().closeActionSheet()

		// Close mobile sidebar on navigation
		setIsMobileSidebarOpen(false)
	}, [pathname, setSelectedItems, setViewerItem, setIsSelectingOnMobile])

	return (
		<MachineFoldersProvider enabled={user?.role === 'owner'}>
			{/* Thumbnails carry the API token; one provider serves every icon in
			    the listing, the sidebar and the dialogs (see FileItemIcon) */}
			<HttpUrlAuthorizerProvider>
				<FilesDndWrapper>
					<RewindOverlayProvider>
						<ActionsBarProvider>
							<FilesSearchProvider>
								<TitleRow hasSidebarDrawer={hasSidebarDrawer} openSidebar={() => setIsMobileSidebarOpen(true)} />
								<ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>
									{/* FileViewer renders the viewerItem from the store */}
									<FileViewer />

									{/* Fills the rest of the sheet, down to its bottom edge: the listing
									    runs on beneath the dock, as the Photos grid does, and clears it
									    at the end of its scroll. */}
									<div className='mt-[-0.5rem] grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[224px_minmax(0,1fr)] panes:grid-cols-[192px_minmax(0,1fr)] phone-side:mt-0 phone-side:grid-cols-1'>
										{/* Sidebar */}
										{hasSidebarDrawer ? (
											<MobileSidebarWrapper
												isOpen={isMobileSidebarOpen}
												onClose={() => setIsMobileSidebarOpen(false)}
												label={t('files-sidebar.navigation')}
											>
												<Sidebar className='h-[calc(100svh-140px)] low:h-[calc(100svh-56px)]' />
											</MobileSidebarWrapper>
										) : (
											// Beside the listing. On a tablet it ends above the dock, so Trash
											// and Rewind stay in reach. The desktop has room beside the dock,
											// so it carries on down past it.
											<div className='flex min-h-0 flex-col'>
												<Sidebar className='min-h-0 flex-1 lg:pb-5' />
												<DockSpacer className='lg:hidden' />
											</div>
										)}

										<div className='flex min-h-0 min-w-0 flex-col gap-3 phone-side:gap-2'>
											<ActionsBar onOpenSidebar={hasSidebarDrawer ? () => setIsMobileSidebarOpen(true) : undefined} />
											{/* Renders either DirectoryListing, AppsListing, RecentsListing, or TrashListing,
											    each filling the height under the actions bar */}
											<div className='min-h-0 flex-1'>
												<Outlet />
											</div>
										</div>
									</div>

									{/* What a held item offers, on a touch screen */}
									<ItemActionsSheet />

									{/* Rewind overlay rendered at root so that it doesn't disappear on Files re-render if user changes screensize*/}
									<RewindOverlay />

									{/* Lazy loaded dialogs on non-read-only mode */}
									{!isReadOnly ? (
										<>
											{canManageSambaShares && (
												<Suspense>
													<ShareInfoDialog />
												</Suspense>
											)}
											<Suspense>
												<ShareUsersDialog />
											</Suspense>
											<Suspense>
												<PermanentlyDeleteConfirmationDialog />
											</Suspense>
											<Suspense>
												<AddNetworkShareDialog />
											</Suspense>
											<Suspense>
												<FormatDriveDialog />
											</Suspense>
											<Suspense>
												<CloudAddDialog />
											</Suspense>
										</>
									) : null}
								</ErrorBoundary>
							</FilesSearchProvider>
						</ActionsBarProvider>
					</RewindOverlayProvider>
				</FilesDndWrapper>
			</HttpUrlAuthorizerProvider>
		</MachineFoldersProvider>
	)
}
