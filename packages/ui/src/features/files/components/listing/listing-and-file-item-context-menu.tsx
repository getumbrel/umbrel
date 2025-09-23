import {RiArrowDropDownLine, RiArrowDropUpLine} from 'react-icons/ri'
import {useNavigate} from 'react-router-dom'

import {SORT_BY_OPTIONS, SUPPORTED_ARCHIVE_EXTRACT_EXTENSIONS} from '@/features/files/constants'
import {useFavorites} from '@/features/files/hooks/use-favorites'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useItemClick} from '@/features/files/hooks/use-item-click'
import {useNavigate as useFilesNavigate} from '@/features/files/hooks/use-navigate'
import {useNetworkStorage} from '@/features/files/hooks/use-network-storage'
import {usePreferences} from '@/features/files/hooks/use-preferences'
import {useShares} from '@/features/files/hooks/use-shares'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {
	isDirectoryANetworkDevice,
	isDirectoryANetworkShare,
} from '@/features/files/utils/is-directory-a-network-device-or-share'
import {isDirectoryAnUmbrelBackup} from '@/features/files/utils/is-directory-an-umbrel-backup'
import {useQueryParams} from '@/hooks/use-query-params'
import {
	ContextMenu,
	ContextMenuCheckboxItem,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from '@/shadcn-components/ui/context-menu'
import {contextMenuClasses} from '@/shadcn-components/ui/shared/menu'
import {useLinkToDialog} from '@/utils/dialog'
import {t} from '@/utils/i18n'

interface ListingAndFileItemContextMenuProps {
	children: React.ReactNode
	menuItems?: React.ReactNode
}

export function ListingAndFileItemContextMenu({children, menuItems}: ListingAndFileItemContextMenuProps) {
	const isReadOnly = useIsFilesReadOnly()
	const {preferences, setView, setSortBy} = usePreferences()

	// Files related state
	const selectedItems = useFilesStore((state) => state.selectedItems)
	const hasItemsInClipboard = useFilesStore((state) => state.hasItemsInClipboard)
	const isItemInClipboard = useFilesStore((state) => state.isItemInClipboard)

	// Global rename helper
	const setRenamingItemPath = useFilesStore((state) => state.setRenamingItemPath)

	const navigate = useNavigate()
	const {addLinkSearchParams} = useQueryParams()

	// Helpers
	const {
		restoreSelectedItems,
		trashSelectedItems,
		downloadSelectedItems,
		archiveSelectedItems,
		pasteItemsFromClipboard,
		extractSelectedItems,
	} = useFilesOperations()

	const {handleDoubleClick} = useItemClick()

	const linkToDialog = useLinkToDialog()

	const {
		isBrowsingTrash,
		isBrowsingRecents,
		isBrowsingSearch,
		isViewingExternalDrives,
		isViewingNetworkDevices,
		isViewingNetworkShares,
		navigateToDirectory,
	} = useFilesNavigate()

	const {isPathShared, isAddingShare, isRemovingShare} = useShares()
	const {isPathFavorite, addFavorite, removeFavorite, isAddingFavorite, isRemovingFavorite} = useFavorites()
	const {removeHostOrShare, isRemovingShare: isRemovingNetworkShare, doesHostHaveMountedShares} = useNetworkStorage()
	const isTouchDevice = useIsTouchDevice()

	// If read-only, just render children without wrapping menu
	if (isReadOnly) return <>{children}</>

	const hasSelectedItems = selectedItems.length > 0

	// Determine if the context menu should behave as a file menu or a listing menu.
	const isFileMenu = hasSelectedItems

	// Build menu items depending on mode
	let contextMenuContent: React.ReactNode = null

	if (isFileMenu) {
		// We'll base the computation on the first selected item. Some actions will
		// be disabled depending on the capabilities of all selected items.
		const item = selectedItems[0]

		if (isBrowsingTrash) {
			// if the item is in the trash
			contextMenuContent = (
				<>
					<ContextMenuItem onClick={restoreSelectedItems}>{t('files-action.restore')}</ContextMenuItem>
					<ContextMenuItem
						onClick={() => navigate(linkToDialog('files-permanently-delete-confirmation'))}
						className={contextMenuClasses.item.rootDestructive}
					>
						{t('files-action.delete')}
					</ContextMenuItem>
				</>
			)
		} else if (isViewingExternalDrives) {
			// if the item is actually a drive in /External
			contextMenuContent = null
		} else if ('isUploading' in item && item.isUploading) {
			// if the item is uploading
			contextMenuContent = null
		} else {
			// if the item is not in the trash or recents
			const hasOneSelectedItem = selectedItems.length === 1

			// allow/disallow actions based on backend operations
			const isUnmountedNetworkHost = isDirectoryANetworkDevice(item.path) && !doesHostHaveMountedShares(item.path)
			const canOpen = hasOneSelectedItem && !isUnmountedNetworkHost && !isDirectoryAnUmbrelBackup(item.name)
			const canRename =
				hasOneSelectedItem && item.operations.includes('rename') && !isDirectoryAnUmbrelBackup(item.name)
			const canDownload = !isUnmountedNetworkHost // disable for unmounted network hosts
			const canCut = selectedItems.every((itm) => itm.operations.includes('move'))
			const canCopy = selectedItems.every((itm) => itm.operations.includes('copy')) && !isUnmountedNetworkHost
			const canPaste =
				hasItemsInClipboard() && hasOneSelectedItem && !isItemInClipboard(item) && item.type === 'directory'
			const canTrash = item.operations.includes('trash')
			const canPermanentlyDelete = item.operations.includes('delete')
			const canExtract = selectedItems.every(
				(itm) =>
					itm.operations.includes('unarchive') &&
					SUPPORTED_ARCHIVE_EXTRACT_EXTENSIONS.some((ext) => itm.name.toLowerCase().endsWith(ext)),
			)

			const canShare =
				hasOneSelectedItem &&
				!isPathShared(item.path) &&
				!isAddingShare &&
				item.operations.includes('share') &&
				!isDirectoryAnUmbrelBackup(item.name)
			const canRemoveShare = hasOneSelectedItem && isPathShared(item.path) && !isRemovingShare
			const canFavorite =
				hasOneSelectedItem &&
				!isPathFavorite(item.path) &&
				!isAddingFavorite &&
				item.operations.includes('favorite') &&
				!isDirectoryAnUmbrelBackup(item.name)
			const canRemoveFavorite = hasOneSelectedItem && isPathFavorite(item.path) && !isRemovingFavorite
			const canArchive = !(isViewingNetworkDevices || isViewingNetworkShares || isDirectoryAnUmbrelBackup(item.name))

			// Network eject logic
			const isNetworkHost = isDirectoryANetworkDevice(item.path) // /Network/hostname
			const isNetworkShare = isDirectoryANetworkShare(item.path) // /Network/hostname/share
			const canEjectNetwork = (isNetworkHost || isNetworkShare) && !isRemovingNetworkShare

			const openShareInfoDialog = () => {
				navigate({
					search: addLinkSearchParams({
						dialog: 'files-share-info',
						'files-share-info-name': item.name,
						'files-share-info-path': item.path,
					}),
				})
			}

			contextMenuContent = (
				<>
					{/* if browsing recents or search, show the "show in enclosing folder" option */}
					{(isBrowsingRecents || isBrowsingSearch) && (
						<ContextMenuItem onClick={() => navigateToDirectory(item.path.slice(0, -item.name.length))}>
							{t('files-action.show-in-folder')}
						</ContextMenuItem>
					)}
					{!isTouchDevice && (
						<ContextMenuItem
							disabled={!canOpen}
							onClick={() => {
								handleDoubleClick(item)
							}}
						>
							{t('files-action.open')}
						</ContextMenuItem>
					)}
					<ContextMenuItem disabled={!canRename} onClick={() => setRenamingItemPath(item.path)}>
						{t('files-action.rename')}
					</ContextMenuItem>
					<ContextMenuItem disabled={!canDownload} onClick={downloadSelectedItems}>
						{selectedItems.length > 1
							? t('files-action.download-items', {count: selectedItems.length})
							: t('files-action.download')}
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem disabled={!canCut} onClick={() => useFilesStore.getState().cutItemsToClipboard()}>
						{t('files-action.cut')}
						<ContextMenuShortcut>⌘X</ContextMenuShortcut>
					</ContextMenuItem>
					<ContextMenuItem disabled={!canCopy} onClick={() => useFilesStore.getState().copyItemsToClipboard()}>
						{t('files-action.copy')}
						<ContextMenuShortcut>⌘C</ContextMenuShortcut>
					</ContextMenuItem>
					<ContextMenuItem disabled={!canPaste} onClick={() => pasteItemsFromClipboard({toDirectory: item.path})}>
						{t('files-action.paste')}
						<ContextMenuShortcut>⌘V</ContextMenuShortcut>
					</ContextMenuItem>
					{canTrash || canPermanentlyDelete ? <ContextMenuSeparator /> : null}
					{canTrash && (
						<ContextMenuItem
							onClick={trashSelectedItems}
							className={contextMenuClasses.item.rootDestructive}
							disabled={!canTrash}
						>
							{t('files-action.trash')}
							<ContextMenuShortcut>⌘⌫</ContextMenuShortcut>
						</ContextMenuItem>
					)}
					{canPermanentlyDelete && (
						<ContextMenuItem
							onClick={() => navigate(linkToDialog('files-permanently-delete-confirmation'))}
							className={contextMenuClasses.item.rootDestructive}
							disabled={!canPermanentlyDelete}
						>
							{t('files-action.delete')}
						</ContextMenuItem>
					)}
					<ContextMenuSeparator />
					<ContextMenuItem disabled={!canArchive} onClick={archiveSelectedItems}>
						{t('files-action.compress')}
					</ContextMenuItem>
					<ContextMenuItem disabled={!canExtract} onClick={extractSelectedItems}>
						{t('files-action.uncompress')}
					</ContextMenuItem>
					<ContextMenuSeparator />
					{isPathShared(item.path) ? (
						<ContextMenuItem disabled={!canRemoveShare} onClick={openShareInfoDialog}>
							{t('files-action.sharing')}
						</ContextMenuItem>
					) : (
						<ContextMenuItem disabled={!canShare} onClick={openShareInfoDialog}>
							{t('files-action.share')}
						</ContextMenuItem>
					)}
					{isPathFavorite(item.path) ? (
						<ContextMenuItem disabled={!canRemoveFavorite} onClick={() => removeFavorite({path: item.path})}>
							{t('files-action.remove-favorite')}
						</ContextMenuItem>
					) : (
						<ContextMenuItem disabled={!canFavorite} onClick={() => addFavorite({path: item.path})}>
							{t('files-action.add-favorite')}
						</ContextMenuItem>
					)}
					{canEjectNetwork && (
						<>
							<ContextMenuSeparator />
							<ContextMenuItem disabled={!canEjectNetwork} onClick={() => removeHostOrShare(item.path)}>
								{isNetworkHost ? t('files-action.remove-network-host') : t('files-action.remove-network-share')}
							</ContextMenuItem>
						</>
					)}
				</>
			)
		}
	} else {
		// Listing menu (no items selected)
		contextMenuContent = (
			<>
				{menuItems ? (
					<>
						{menuItems}
						<ContextMenuSeparator />
					</>
				) : null}
				<ContextMenuSub>
					<ContextMenuSubTrigger>{t('files-view.view-as')}</ContextMenuSubTrigger>
					<ContextMenuSubContent className='w-28'>
						<ContextMenuCheckboxItem checked={preferences?.view === 'list'} onCheckedChange={() => setView('list')}>
							{t('files-view.list')}
						</ContextMenuCheckboxItem>
						<ContextMenuCheckboxItem checked={preferences?.view === 'icons'} onCheckedChange={() => setView('icons')}>
							{t('files-view.icons')}
						</ContextMenuCheckboxItem>
					</ContextMenuSubContent>
				</ContextMenuSub>
				<ContextMenuSub>
					<ContextMenuSubTrigger>{t('files-view.sort-by')}</ContextMenuSubTrigger>
					<ContextMenuSubContent className='w-24'>
						{SORT_BY_OPTIONS.map((option) => (
							<ContextMenuItem
								key={option.sortBy}
								onClick={() => setSortBy(option.sortBy)}
								className='flex items-center justify-between'
							>
								{t(option.labelTKey)}
								{option.sortBy === preferences?.sortBy && (
									<>
										{preferences.sortOrder === 'ascending' ? (
											<RiArrowDropUpLine className='h-5 w-5' />
										) : (
											<RiArrowDropDownLine className='h-5 w-5' />
										)}
									</>
								)}
							</ContextMenuItem>
						))}
					</ContextMenuSubContent>
				</ContextMenuSub>
			</>
		)
	}

	if (!contextMenuContent) return children

	return (
		<ContextMenu modal={false}>
			<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
			<ContextMenuContent className='w-48'>{contextMenuContent}</ContextMenuContent>
		</ContextMenu>
	)
}
