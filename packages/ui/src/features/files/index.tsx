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
import {useWatcherRefetch} from '@/features/files/hooks/use-watcher-refetch'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {useIsMobile} from '@/hooks/use-is-mobile'
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

	const isMobile = useIsMobile()
	const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
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

		// Close any open file viewer (text editor, image viewer, etc.)
		setViewerItem(null)

		// set selecting on mobile to false when navigating to a different path
		setIsSelectingOnMobile(false)

		// Close mobile sidebar on navigation
		setIsMobileSidebarOpen(false)
	}, [pathname, setSelectedItems, setViewerItem, setIsSelectingOnMobile])

	return (
		<MachineFoldersProvider enabled={user?.role === 'owner'}>
			<FilesDndWrapper>
				<RewindOverlayProvider>
					<SheetHeader className='flex flex-col gap-4 md:flex-row md:items-center md:gap-0'>
						<div className='flex items-center gap-4'>
							{isMobile ? (
								<HiMenuAlt2
									role='button'
									className='h-5 w-5 text-white/90'
									onClick={() => setIsMobileSidebarOpen(true)}
								/>
							) : null}
							<SheetTitle className='mr-2 leading-none lg:mr-0 lg:min-w-[224px] lg:text-36'>{t('files')}</SheetTitle>
						</div>
					</SheetHeader>
					<ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>
						{/* FileViewer renders the viewerItem from the store */}
						<FileViewer />

						<div className='mt-[-0.5rem] grid grid-cols-1 lg:grid-cols-[224px_1fr]'>
							{/* Sidebar */}
							{isMobile ? (
								<MobileSidebarWrapper isOpen={isMobileSidebarOpen} onClose={() => setIsMobileSidebarOpen(false)}>
									<Sidebar className='h-[calc(100svh-140px)]' />
								</MobileSidebarWrapper>
							) : (
								<Sidebar className='h-[calc(100vh-176px)]' />
							)}

							<div className='flex flex-col gap-3 lg:gap-5'>
								<ActionsBarProvider>
									<ActionsBar />
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
		</MachineFoldersProvider>
	)
}
