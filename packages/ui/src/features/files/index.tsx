import {lazy, Suspense, useEffect, useState} from 'react'
import {HiMenuAlt2} from 'react-icons/hi'
import {Outlet, useLocation} from 'react-router-dom'

import {FileViewer} from '@/features/files/components/file-viewer'
import {FilesDndWrapper} from '@/features/files/components/files-dnd-wrapper'
import {ActionsBar} from '@/features/files/components/listing/actions-bar'
import {ActionsBarProvider} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {RewindOverlay} from '@/features/files/components/rewind'
import {RewindOverlayProvider} from '@/features/files/components/rewind/overlay-context'
import {Sidebar} from '@/features/files/components/sidebar'
import {MobileSidebarWrapper} from '@/features/files/components/sidebar/mobile-sidebar-wrapper'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {SheetHeader, SheetTitle} from '@/shadcn-components/ui/sheet'
import {t} from '@/utils/i18n'

const ShareInfoDialog = lazy(() => import('@/features/files/components/dialogs/share-info-dialog'))
const PermanentlyDeleteConfirmationDialog = lazy(
	() => import('@/features/files/components/dialogs/permanently-delete-confirmation-dialog'),
)
const ExternalStorageUnsupportedDialog = lazy(
	() => import('@/features/files/components/dialogs/external-storage-unsupported-dialog'),
)
const AddNetworkShareDialog = lazy(() => import('@/features/files/components/dialogs/add-network-share-dialog'))
const FormatDriveDialog = lazy(() => import('@/features/files/components/dialogs/format-drive-dialog'))

// TODO: Add error boundaries like the other features (e.g., app store)
export default function FilesLayout() {
	const {pathname} = useLocation()
	const {setSelectedItems} = useFilesStore()

	const setIsSelectingOnMobile = useFilesStore((state) => state.setIsSelectingOnMobile)

	const isMobile = useIsMobile()
	const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
	const isReadOnly = useIsFilesReadOnly()

	useEffect(() => {
		// TODO: Find a better place to do this
		// clear selected items when navigating to a different path
		// NOTE: when we remove/change this, we need to update
		// packages/ui/src/features/files/cmdk-search-provider.tsx
		// to set the selected item correctly
		setSelectedItems([])

		// set selecting on mobile to false when navigating to a different path
		setIsSelectingOnMobile(false)

		// Close mobile sidebar on navigation
		setIsMobileSidebarOpen(false)
	}, [pathname, setSelectedItems, setIsSelectingOnMobile])

	return (
		<FilesDndWrapper>
			<RewindOverlayProvider>
				<SheetHeader className='flex select-none flex-col gap-4 md:flex-row md:items-center md:gap-0'>
					<div className='flex items-center gap-4'>
						{isMobile ? (
							<HiMenuAlt2
								role='button'
								className='h-5 w-5 cursor-pointer text-white/90'
								onClick={() => setIsMobileSidebarOpen(true)}
							/>
						) : null}
						<SheetTitle className='mr-2 leading-none lg:mr-0 lg:min-w-[188px]'>{t('files')}</SheetTitle>
					</div>
				</SheetHeader>
				{/* FileViewer renders the viewerItem from the store */}
				<FileViewer />

				<div className='mt-[-0.5rem] grid select-none grid-cols-1 lg:mt-0 lg:grid-cols-[188px_1fr]'>
					{/* Sidebar */}
					{isMobile ? (
						<MobileSidebarWrapper isOpen={isMobileSidebarOpen} onClose={() => setIsMobileSidebarOpen(false)}>
							<Sidebar className='h-[calc(100svh-140px)]' />
						</MobileSidebarWrapper>
					) : (
						<Sidebar className='h-[calc(100vh-300px)]' />
					)}

					<div className='flex flex-col gap-3 lg:gap-6'>
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
						<Suspense>
							<ShareInfoDialog />
						</Suspense>
						<Suspense>
							<PermanentlyDeleteConfirmationDialog />
						</Suspense>
						<Suspense>
							<ExternalStorageUnsupportedDialog />
						</Suspense>
						<Suspense>
							<AddNetworkShareDialog />
						</Suspense>
						<Suspense>
							<FormatDriveDialog />
						</Suspense>
					</>
				) : null}
			</RewindOverlayProvider>
		</FilesDndWrapper>
	)
}
