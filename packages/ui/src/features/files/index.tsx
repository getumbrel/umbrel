import {lazy, Suspense, useEffect, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {useTranslation} from 'react-i18next'
import {HiMenuAlt2} from 'react-icons/hi'
import {Outlet, useLocation} from 'react-router-dom'

import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {SheetHeader, SheetTitle} from '@/components/ui/sheet'
import {FileViewer} from '@/features/files/components/file-viewer'
import {FilesDndWrapper} from '@/features/files/components/files-dnd-wrapper'
import {ActionsBar} from '@/features/files/components/listing/actions-bar'
import {ActionsBarProvider} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {RewindOverlay} from '@/features/files/components/rewind'
import {RewindOverlayProvider} from '@/features/files/components/rewind/overlay-context'
import {Sidebar} from '@/features/files/components/sidebar'
import {MobileSidebarWrapper} from '@/features/files/components/sidebar/mobile-sidebar-wrapper'
import {MachineFoldersProvider} from '@/features/files/hooks/use-machine-folder'
import {useNavigate as useFilesNavigate} from '@/features/files/hooks/use-navigate'
import {useWatcherRefetch} from '@/features/files/hooks/use-watcher-refetch'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {useIsPhoneNow} from '@/hooks/use-is-mobile'
import {HttpUrlAuthorizerProvider} from '@/modules/auth/http-url-authorizer'
import {trpcReact} from '@/trpc/trpc'

const ShareInfoDialog = lazy(() => import('@/features/files/components/dialogs/share-info-dialog'))
const ShareUsersDialog = lazy(() => import('@/features/files/components/dialogs/share-users-dialog'))
const PermanentlyDeleteConfirmationDialog = lazy(
	() => import('@/features/files/components/dialogs/permanently-delete-confirmation-dialog'),
)
const AddNetworkShareDialog = lazy(() => import('@/features/files/components/dialogs/add-network-share-dialog'))
const FormatDriveDialog = lazy(() => import('@/features/files/components/dialogs/format-drive-dialog'))
const CloudAddDialog = lazy(() => import('@/features/files/components/dialogs/cloud-add-dialog'))

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
						{/* On a phone on its side the title gives its row to the listing, and
						    the sidebar button moves into the actions bar */}
						<SheetHeader className='flex flex-col gap-4 md:flex-row md:items-center md:gap-0 phone-side:absolute'>
							<div className='flex items-center gap-4'>
								{hasSidebarDrawer ? (
									<HiMenuAlt2
										role='button'
										className='h-5 w-5 text-white/90 phone-side:hidden'
										onClick={() => setIsMobileSidebarOpen(true)}
									/>
								) : null}
								<SheetTitle className='mr-2 leading-none lg:mr-0 lg:min-w-[224px] lg:text-36 panes:text-36 phone-side:sr-only'>
									{t('files')}
								</SheetTitle>
							</div>
						</SheetHeader>
						<ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>
							{/* FileViewer renders the viewerItem from the store */}
							<FileViewer />

							<div className='mt-[-0.5rem] grid grid-cols-1 lg:grid-cols-[224px_1fr] panes:grid-cols-[192px_minmax(0,1fr)] phone-side:mt-0 phone-side:grid-cols-1'>
								{/* Sidebar */}
								{hasSidebarDrawer ? (
									<MobileSidebarWrapper isOpen={isMobileSidebarOpen} onClose={() => setIsMobileSidebarOpen(false)}>
										<Sidebar className='h-[calc(100svh-140px)] low:h-[calc(100svh-56px)]' />
									</MobileSidebarWrapper>
								) : (
									// Ends with the listing, so Trash and Rewind stay above the dock
									<Sidebar className='h-[calc(100vh-176px)] panes:h-[calc(100svh-var(--sheet-top)-var(--page-top)-146px)]' />
								)}

								<div className='flex min-w-0 flex-col gap-3 lg:gap-5 phone-side:gap-2'>
									<ActionsBarProvider>
										<ActionsBar onOpenSidebar={hasSidebarDrawer ? () => setIsMobileSidebarOpen(true) : undefined} />
										{/* Renders either DirectoryListing, AppsListing, RecentsListing, or TrashListing */}
										<Outlet />
									</ActionsBarProvider>
								</div>
							</div>

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
					</RewindOverlayProvider>
				</FilesDndWrapper>
			</HttpUrlAuthorizerProvider>
		</MachineFoldersProvider>
	)
}
