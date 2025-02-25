import {lazy, Suspense, useEffect, useState} from 'react'
import {HiMenuAlt2} from 'react-icons/hi'
import {Outlet, useLocation} from 'react-router-dom'

import {FileViewer} from '@/features/files/components/file-viewer'
import {FilesDndWrapper} from '@/features/files/components/files-dnd-wrapper'
import {Sidebar} from '@/features/files/components/sidebar'
import {MobileSidebarWrapper} from '@/features/files/components/sidebar/mobile-sidebar-wrapper'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {SheetHeader, SheetTitle} from '@/shadcn-components/ui/sheet'

const EmptyTrashDialog = lazy(() => import('@/features/files/components/dialogs/empty-trash-dialog'))
const ShareInfoDialog = lazy(() => import('@/features/files/components/dialogs/share-info-dialog'))
const ExtensionChangeConfirmationDialog = lazy(
	() => import('@/features/files/components/dialogs/extension-change-confirmation-dialog'),
)
const PermanentlyDeleteConfirmationDialog = lazy(
	() => import('@/features/files/components/dialogs/permanently-delete-confirmation-dialog'),
)
const ExternalStorageUnsupportedDialog = lazy(
	() => import('@/features/files/components/dialogs/external-storage-unsupported-dialog'),
)

// TODO: Add error boundaries like the other features (e.g., app store)
export default function FilesLayout() {
	const {pathname} = useLocation()
	const {setSelectedItems} = useFilesStore()

	const isSelectingOnMobile = useFilesStore((state) => state.isSelectingOnMobile)
	const toggleIsSelectingOnMobile = useFilesStore((state) => state.toggleIsSelectingOnMobile)

	const isMobile = useIsMobile()
	const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)

	useEffect(() => {
		// TODO: Find a better place to do this
		// clear selected items when navigating to a different path
		setSelectedItems([])

		// set selecting on mobile to false when navigating to a different path
		if (isSelectingOnMobile) {
			toggleIsSelectingOnMobile()
		}

		// Close mobile sidebar on navigation
		setIsMobileSidebarOpen(false)

		// TODO: THIS IS A HACK
		// Save the current path to session storage
		// The Dock then uses this to restore the last visited path
		sessionStorage.setItem('lastFilesPath', pathname)
	}, [pathname])

	return (
		<FilesDndWrapper>
			<SheetHeader className='flex select-none flex-col gap-4 md:flex-row md:items-center md:gap-0'>
				<div className='flex items-center gap-4'>
					{isMobile ? (
						<HiMenuAlt2
							role='button'
							className='h-5 w-5 cursor-pointer text-white/90'
							onClick={() => setIsMobileSidebarOpen(true)}
						/>
					) : null}
					<SheetTitle className='mr-2 leading-none lg:mr-0 lg:min-w-[188px]'>Files</SheetTitle>
				</div>
			</SheetHeader>
			{/* FileViewer renders the viewerItem from the store */}
			<FileViewer />

			<div className='mt-[-0.5rem] grid select-none grid-cols-1 lg:mt-0 lg:grid-cols-[188px_1fr]'>
				{/* Desktop Sidebar */}
				{isMobile ? (
					<MobileSidebarWrapper isOpen={isMobileSidebarOpen} onClose={() => setIsMobileSidebarOpen(false)}>
						<Sidebar className='h-[calc(100svh-140px)]' />
					</MobileSidebarWrapper>
				) : (
					<Sidebar className='h-[calc(100vh-300px)]' />
				)}
				{/* Renders either DirectoryListing, RecentsListing, or TrashListing */}
				<Outlet />
			</div>

			{/* Lazy loaded dialogs */}
			<Suspense>
				<EmptyTrashDialog />
			</Suspense>
			<Suspense>
				<ExtensionChangeConfirmationDialog />
			</Suspense>
			<Suspense>
				<ShareInfoDialog />
			</Suspense>
			<Suspense>
				<PermanentlyDeleteConfirmationDialog />
			</Suspense>
			<Suspense>
				<ExternalStorageUnsupportedDialog />
			</Suspense>
		</FilesDndWrapper>
	)
}
