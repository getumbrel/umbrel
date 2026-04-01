import {Upload} from 'lucide-react'
import {useEffect, useLayoutEffect, useRef} from 'react'
import {useTranslation} from 'react-i18next'
import {RiClipboardLine} from 'react-icons/ri'
import {TbWorldPlus} from 'react-icons/tb'
import {useNavigate as useRouterNavigate} from 'react-router-dom'

import {ContextMenuItem, ContextMenuShortcut} from '@/components/ui/context-menu'
import {DropdownMenuItem} from '@/components/ui/dropdown-menu'
import {IconButton} from '@/components/ui/icon-button'
import {AddFolderIcon} from '@/features/files/assets/add-folder-icon'
import {Listing} from '@/features/files/components/listing'
import {useSetActionsBarConfig} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {EmptyStateDirectory, EmptyStateNetwork} from '@/features/files/components/listing/directory-listing/empty-state'
import {UploadInput} from '@/features/files/components/shared/upload-input'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useNewFolder} from '@/features/files/hooks/use-new-folder'
import {useIsFilesEmbedded} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FilesStore} from '@/features/files/store/use-files-store'
import {trpcReact} from '@/trpc/trpc'
import {useLinkToDialog} from '@/utils/dialog'

// `marqueeScale` is threaded through so embedded contexts (like Rewind) can tell marquee selection
// about the CSS transform that shrinks the Files UI.
export function DirectoryListing({marqueeScale = 1}: {marqueeScale?: number} = {}) {
	const {t} = useTranslation()
	const {
		currentPath,
		uiPath,
		isBrowsingApps,
		isBrowsingExternalStorage,
		isViewingExternalDrives,
		isViewingNetworkDevices,
		isViewingNetworkShares,
		isBrowsingNetworkStorage,
		navigateToDirectory,
	} = useNavigate()
	const isEmbedded = useIsFilesEmbedded()
	const setActionsBarConfig = useSetActionsBarConfig()
	const {listing, isLoading, error, fetchMoreItems} = useListDirectory(currentPath)
	const routerNavigate = useRouterNavigate()
	const linkToDialog = useLinkToDialog()

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

	// For "New Text File"
	const utils = trpcReact.useUtils()
	const setViewerItem = useFilesStore((s) => s.setViewerItem)
	const startNewTextFile = async () => {
		const baseName = t('files-action.new-text-file-name')
		const ext = '.txt'
		let name = baseName + ext
		// Find a unique name
		const existingNames = new Set((listing?.items ?? []).map((item) => item.name))
		if (existingNames.has(name)) {
			let index = 2
			while (existingNames.has(`${baseName} (${index})${ext}`)) index++
			name = `${baseName} (${index})${ext}`
		}
		const filePath = currentPath + '/' + name
		try {
			// Create empty file via upload endpoint
			await fetch(`/api/files/upload?path=${encodeURIComponent(filePath)}&collision=keep-both`, {
				method: 'POST',
				body: '',
				headers: {'Content-Type': 'text/plain; charset=utf-8'},
			})
			await utils.files.list.invalidate({path: currentPath})
			// Open the new file in the editor
			setViewerItem({name, path: filePath, type: 'text/plain', size: 0, modified: Date.now(), operations: []})
		} catch {
			// Silently fail — the file listing will show the new file if it was created
		}
	}

	// Additional items for the directory context menu
	// Disable write actions (New Folder, Upload, Paste) for read-only directories
	const additionalContextMenuItems =
		isViewingExternalDrives || isViewingNetworkDevices || isViewingNetworkShares ? null : (
			<>
				<ContextMenuItem onClick={startNewFolder}>{t('files-action.new-folder')}</ContextMenuItem>
				<ContextMenuItem onClick={startNewTextFile}>{t('files-action.new-text-file')}</ContextMenuItem>
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

	// Disable actions while loading or on error; only hide the path bar on error
	const disableActions = Boolean(isLoading || error)
	const hidePath = Boolean(error)

	// In embedded contexts (e.g., Rewind), if the current directory doesn't exist in a snapshot,
	// we automatically fall back to the nearest existing parent.
	// We use useLayoutEffect to navigate before paint to avoid a visible flicker of the error screen ("No such file or folder").
	useLayoutEffect(() => {
		if (!isEmbedded || !error) return
		// climb the logical UI path to the nearest existing parent
		const logicalBase = uiPath.startsWith('/Apps') ? '/Apps' : '/Home'
		const lastSlash = uiPath.lastIndexOf('/')
		const parentUi = lastSlash > 0 ? uiPath.slice(0, lastSlash) : logicalBase
		if (parentUi && parentUi !== uiPath) navigateToDirectory(parentUi)
	}, [isEmbedded, error, uiPath, navigateToDirectory])

	// Desktop actions
	// - At /Network (devices view): show "Add share" action
	// - Elsewhere (non-readonly): show New Folder and Upload
	let DesktopActions: React.ReactNode = null
	if (isViewingNetworkDevices) {
		DesktopActions = (
			<IconButton
				icon={TbWorldPlus}
				onClick={() => routerNavigate(linkToDialog('files-add-network-share'))}
				disabled={disableActions}
			>
				{t('files-action.add-network-device')}
			</IconButton>
		)
	} else if (!(isViewingExternalDrives || isViewingNetworkShares)) {
		DesktopActions = (
			<>
				<IconButton icon={AddFolderIcon} onClick={startNewFolder} disabled={disableActions}>
					{t('files-folder')}
				</IconButton>
				<IconButton icon={Upload} onClick={handleUploadClick} disabled={disableActions}>
					{t('files-action.upload')}
				</IconButton>
			</>
		)
	}

	// Mobile actions
	let MobileDropdownActions: React.ReactNode = null
	if (isViewingNetworkDevices) {
		MobileDropdownActions = (
			<DropdownMenuItem onClick={() => routerNavigate(linkToDialog('files-add-network-share'))}>
				<TbWorldPlus className='mr-2 h-4 w-4' />
				{t('files-action.add-network-device')}
			</DropdownMenuItem>
		)
	} else if (!(isViewingExternalDrives || isViewingNetworkShares)) {
		MobileDropdownActions = (
			<>
				<DropdownMenuItem onClick={startNewFolder} disabled={disableActions}>
					<AddFolderIcon className='mr-2 h-4 w-4 opacity-50' />
					{t('files-action.new-folder')}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={handleUploadClick} disabled={disableActions}>
					<Upload className='mr-2 h-4 w-4 opacity-50' />
					{t('files-action.upload')}
				</DropdownMenuItem>
				<DropdownMenuItem
					onClick={() => pasteItemsFromClipboard({toDirectory: currentPath})}
					disabled={disableActions || !hasItemsInClipboard()}
				>
					<RiClipboardLine className='mr-2 h-4 w-4 opacity-50' />
					{t('files-action.paste')}
				</DropdownMenuItem>
			</>
		)
	}

	useEffect(() => {
		setActionsBarConfig({
			desktopActions: DesktopActions,
			mobileActions: MobileDropdownActions,
			hidePath,
			hideSearch: isBrowsingApps || isBrowsingExternalStorage || isBrowsingNetworkStorage, // hide search if browsing apps, external storage, or network
		})
	}, [
		disableActions,
		hidePath,
		isBrowsingApps,
		isBrowsingExternalStorage,
		isViewingExternalDrives,
		isViewingNetworkDevices,
		isViewingNetworkShares,
		isBrowsingNetworkStorage,
	])

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
				enableFileDrop={!isViewingExternalDrives && !isViewingNetworkDevices && !isViewingNetworkShares}
				CustomEmptyView={isViewingNetworkDevices ? EmptyStateNetwork : EmptyStateDirectory}
				marqueeScale={marqueeScale}
			/>
		</>
	)
}
