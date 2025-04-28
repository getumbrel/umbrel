import {Upload} from 'lucide-react'
import {useEffect, useRef} from 'react'
import {RiClipboardLine} from 'react-icons/ri'

import {IconButton} from '@/components/ui/icon-button'
import {AddFolderIcon} from '@/features/files/assets/add-folder-icon'
import {Listing} from '@/features/files/components/listing'
import {useSetActionsBarConfig} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {EmptyStateDirectory} from '@/features/files/components/listing/directory-listing/empty-state'
import {UploadInput} from '@/features/files/components/shared/upload-input'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useNewFolder} from '@/features/files/hooks/use-new-folder'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FilesStore} from '@/features/files/store/use-files-store'
import {ContextMenuItem, ContextMenuShortcut} from '@/shadcn-components/ui/context-menu'
import {DropdownMenuItem} from '@/shadcn-components/ui/dropdown-menu'
import {t} from '@/utils/i18n'

export function DirectoryListing() {
	const {currentPath, isBrowsingApps, isBrowsingExternalStorage, isViewingExternalDrives} = useNavigate()
	const setActionsBarConfig = useSetActionsBarConfig()
	const {listing, isLoading, error, fetchMoreItems} = useListDirectory(currentPath)

	// Grab the potential "new folder" item from store
	const newFolder = useFilesStore((state: FilesStore) => state.newFolder)

	// Merge new folder (if any) at the top of the list
	const items = newFolder ? [newFolder, ...(listing?.items || [])] : listing?.items || []

	// For "Paste" command
	const {pasteItemsFromClipboard} = useFilesOperations()
	const hasItemsInClipboard = useFilesStore((state: FilesStore) => state.hasItemsInClipboard)

	// For "New Folder"
	const {startNewFolder} = useNewFolder()

	// For "Upload"
	const uploadInputRef = useRef<HTMLInputElement | null>(null)
	const handleUploadClick = () => {
		uploadInputRef.current?.click()
	}

	// Additional items for the directory context menu
	const additionalContextMenuItems = isViewingExternalDrives ? null : (
		<>
			<ContextMenuItem onClick={startNewFolder}>{t('files-action.new-folder')}</ContextMenuItem>
			<ContextMenuItem onClick={handleUploadClick}>{t('files-action.upload')}</ContextMenuItem>
			<ContextMenuItem
				onClick={() => pasteItemsFromClipboard({toDirectory: currentPath})}
				disabled={!hasItemsInClipboard()}
			>
				{t('files-action.paste')}
				<ContextMenuShortcut>⌘V</ContextMenuShortcut>
			</ContextMenuItem>
		</>
	)

	// Filter out items that are currently uploading to prevent them from being selected via marquee selection or keyboard shortcuts
	const selectableItems = (listing?.items ?? []).filter((item) => !item.isUploading)

	// Hide the path bar and disable actions if there's an error or loading state
	const hidePathAndDisableActions = Boolean(isLoading || error)

	// Desktop actions
	const DesktopActions = isViewingExternalDrives ? null : (
		<>
			<IconButton icon={AddFolderIcon} onClick={startNewFolder} disabled={hidePathAndDisableActions}>
				{t('files-folder')}
			</IconButton>
			<IconButton icon={Upload} onClick={handleUploadClick} disabled={hidePathAndDisableActions}>
				{t('files-action.upload')}
			</IconButton>
		</>
	)

	// Mobile actions
	const MobileDropdownActions = isViewingExternalDrives ? null : (
		<>
			<DropdownMenuItem onClick={startNewFolder} disabled={hidePathAndDisableActions}>
				<AddFolderIcon className='mr-2 h-4 w-4 opacity-50' />
				{t('files-action.new-folder')}
			</DropdownMenuItem>
			<DropdownMenuItem onClick={handleUploadClick} disabled={hidePathAndDisableActions}>
				<Upload className='mr-2 h-4 w-4 opacity-50' />
				{t('files-action.upload')}
			</DropdownMenuItem>
			<DropdownMenuItem
				onClick={() => pasteItemsFromClipboard({toDirectory: currentPath})}
				disabled={hidePathAndDisableActions || !hasItemsInClipboard()}
			>
				<RiClipboardLine className='mr-2 h-4 w-4 opacity-50' />
				{t('files-action.paste')}
			</DropdownMenuItem>
		</>
	)

	useEffect(() => {
		setActionsBarConfig({
			desktopActions: DesktopActions,
			mobileActions: MobileDropdownActions,
			hidePath: hidePathAndDisableActions,
			hideSearch: isBrowsingApps || isBrowsingExternalStorage, // hide search if browsing apps or external storage
		})
	}, [hidePathAndDisableActions, isBrowsingApps, isBrowsingExternalStorage, isViewingExternalDrives])

	return (
		<>
			<UploadInput ref={uploadInputRef} />
			<Listing
				items={items}
				totalItems={listing?.totalFiles}
				truncatedAt={listing?.truncatedAt}
				selectableItems={selectableItems}
				isLoading={isLoading}
				error={error}
				hasMore={listing?.hasMore ?? false}
				onLoadMore={fetchMoreItems}
				additionalContextMenuItems={additionalContextMenuItems}
				enableFileDrop={!isViewingExternalDrives}
				CustomEmptyView={EmptyStateDirectory}
			/>
		</>
	)
}
