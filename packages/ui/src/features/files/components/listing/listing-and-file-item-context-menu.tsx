import {useTranslation} from 'react-i18next'
import {RiArrowDropDownLine, RiArrowDropUpLine} from 'react-icons/ri'
import {useNavigate} from 'react-router-dom'

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
} from '@/components/ui/context-menu'
import {contextMenuClasses} from '@/components/ui/shared/menu'
import {SORT_BY_OPTIONS, SUPPORTED_ARCHIVE_EXTRACT_EXTENSIONS} from '@/features/files/constants'
import {cloudSyncForPath, useCloudActions, useCloudSyncs} from '@/features/files/hooks/use-cloud'
import {useFavorites} from '@/features/files/hooks/use-favorites'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useIsMember} from '@/features/files/hooks/use-home-path'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useItemClick} from '@/features/files/hooks/use-item-click'
import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import {useMemberShares} from '@/features/files/hooks/use-member-shares'
import {useNavigate as useFilesNavigate} from '@/features/files/hooks/use-navigate'
import {useNetworkStorage} from '@/features/files/hooks/use-network-storage'
import {usePreferences} from '@/features/files/hooks/use-preferences'
import {useRewindAction} from '@/features/files/hooks/use-rewind-action'
import {useShares} from '@/features/files/hooks/use-shares'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {canPerformFileOperation} from '@/features/files/utils/file-capabilities'
import {
	isDirectoryANetworkDevice,
	isDirectoryANetworkShare,
} from '@/features/files/utils/is-directory-a-network-device-or-share'
import {isDirectoryAnUmbrelBackup} from '@/features/files/utils/is-directory-an-umbrel-backup'
import {useQueryParams} from '@/hooks/use-query-params'
import {useHasMembers} from '@/modules/user-sharing'
import {useConfirmation} from '@/providers/confirmation'
import {useLinkToDialog} from '@/utils/dialog'

interface ListingAndFileItemContextMenuProps {
	children: React.ReactNode
	menuItems?: React.ReactNode
}

export function ListingAndFileItemContextMenu({children, menuItems}: ListingAndFileItemContextMenuProps) {
	const {t} = useTranslation()
	const isReadOnly = useIsFilesReadOnly()
	const isMember = useIsMember()
	const {preferences, setView, setSortBy} = usePreferences()

	// Files related state
	const selectedItems = useFilesStore((state) => state.selectedItems)
	const hasItemsInClipboard = useFilesStore((state) => state.hasItemsInClipboard)
	const isItemInClipboard = useFilesStore((state) => state.isItemInClipboard)

	// Rewind action, including logic for when it can be shown and how to navigate
	const {canShowRewind, onClick: onRewind} = useRewindAction(selectedItems)

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
		currentPath,
		isBrowsingTrash,
		isBrowsingRecents,
		isBrowsingSearch,
		isViewingExternalDrives,
		navigateToDirectory,
	} = useFilesNavigate()
	// Compressing and extracting both write into the current directory (the
	// archive, or its contents), so both need it to be writable
	const {listing} = useListDirectory(currentPath)
	const canWriteHere = listing?.operations.includes('writable') ?? false

	const {isPathShared, isAddingShare, isRemovingShare, canManageShares} = useShares()
	const {memberShares, shareForPath} = useMemberShares()
	const hasMembers = useHasMembers()
	const {isPathFavorite, addFavorite, removeFavorite, isAddingFavorite, isRemovingFavorite} = useFavorites()
	const {removeHostOrShare, isRemovingShare: isRemovingNetworkShare} = useNetworkStorage()
	const isTouchDevice = useIsTouchDevice()
	const {data: clouds} = useCloudSyncs()
	const {pauseSync, resumeSync, runNow, removeSync} = useCloudActions()
	const confirm = useConfirmation()

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
						<ContextMenuShortcut>⌘⌫</ContextMenuShortcut>
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

			// allow/disallow actions based on backend operations. Disconnected
			// network entries carry no operations, so the checks below reject them.
			const canOpen =
				hasOneSelectedItem &&
				!(item.isDisconnected && isDirectoryANetworkShare(item.path)) &&
				!isDirectoryAnUmbrelBackup(item.name)
			const canRename =
				hasOneSelectedItem && canPerformFileOperation(item, 'rename') && !isDirectoryAnUmbrelBackup(item.name)
			const canDownload = selectedItems.every((selected) => !selected.isDisconnected)
			const canCut = selectedItems.every((item) => canPerformFileOperation(item, 'move'))
			const canCopy = selectedItems.every((item) => canPerformFileOperation(item, 'copy'))
			const canPaste =
				hasItemsInClipboard() &&
				hasOneSelectedItem &&
				!isItemInClipboard(item) &&
				item.type === 'directory' &&
				canPerformFileOperation(item, 'writable')
			const canTrash = canPerformFileOperation(item, 'trash')
			const canPermanentlyDelete = canPerformFileOperation(item, 'delete')
			const canExtract =
				canWriteHere &&
				selectedItems.every(
					(itm) =>
						canPerformFileOperation(itm, 'unarchive') &&
						SUPPORTED_ARCHIVE_EXTRACT_EXTENSIONS.some((ext) => itm.name.toLowerCase().endsWith(ext)),
				)

			const canShare =
				canManageShares &&
				hasOneSelectedItem &&
				!isPathShared(item.path) &&
				!isAddingShare &&
				canPerformFileOperation(item, 'share') &&
				!isDirectoryAnUmbrelBackup(item.name)
			const canRemoveShare = canManageShares && hasOneSelectedItem && isPathShared(item.path) && !isRemovingShare

			// Share a directory with member accounts (owner only, memberShares is
			// undefined for members so the item never renders for them)
			const isShareableWithUsersPath =
				item.path === '/Home' || item.path.startsWith('/Home/') || item.path.startsWith('/Apps/')
			const canShareWithUsers =
				hasOneSelectedItem &&
				hasMembers &&
				memberShares !== undefined &&
				item.type === 'directory' &&
				isShareableWithUsersPath &&
				!isDirectoryAnUmbrelBackup(item.name)
			const canFavorite =
				hasOneSelectedItem &&
				!isPathFavorite(item.path) &&
				!isAddingFavorite &&
				canPerformFileOperation(item, 'favorite') &&
				!isDirectoryAnUmbrelBackup(item.name)
			const canRemoveFavorite = hasOneSelectedItem && isPathFavorite(item.path) && !isRemovingFavorite
			// Compressing reads the items, and it isn't offered for anything the
			// backend keeps read-only — an installed machine's runtime state, media
			// mounted read-only, backups, network hosts — which it signals by
			// withholding `writable` (protection from moving or deleting alone, as on
			// /Home/Downloads or an app's folder, keeps `writable`)
			const canArchive =
				canWriteHere &&
				selectedItems.every((itm) => canPerformFileOperation(itm, 'copy') && canPerformFileOperation(itm, 'writable'))

			// Network eject logic
			const isNetworkHost = isDirectoryANetworkDevice(item.path) // /Network/hostname
			const isNetworkShare = isDirectoryANetworkShare(item.path) // /Network/hostname/share
			const canEjectNetwork = !isMember && (isNetworkHost || isNetworkShare) && !isRemovingNetworkShare

			const openShareInfoDialog = () => {
				navigate({
					search: addLinkSearchParams({
						dialog: 'files-share-info',
						'files-share-info-name': item.name,
						'files-share-info-path': item.path,
					}),
				})
			}

			const openShareUsersDialog = () => {
				navigate({
					search: addLinkSearchParams({
						dialog: 'files-share-users',
						'files-share-users-name': item.name,
						'files-share-users-path': item.path,
					}),
				})
			}

			// Cloud verbs when the selected folder is a download destination.
			// Mutation safety is enforced server-side; these are conveniences.
			// Only the current account's Cloud records are returned by the API, so
			// these controls can never reveal or operate on another member's job.
			const itemCloud = hasOneSelectedItem ? cloudSyncForPath(clouds, item.path) : undefined
			const canRunNow = itemCloud && itemCloud.status.state !== 'running' && itemCloud.status.state !== 'queued'
			const handleRemoveCloud = async () => {
				if (!itemCloud) return
				try {
					await confirm({
						title: t('files-cloud.remove-confirm-title', {folder: item.name}),
						message: t('files-cloud.remove-confirm-message'),
						actions: [
							{label: t('files-cloud.remove-confirm-action'), value: 'remove', variant: 'destructive'},
							{label: t('cancel'), value: 'cancel', variant: 'default'},
						],
					})
					removeSync(itemCloud.id).catch(() => {})
				} catch {
					// User cancelled
				}
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
					{itemCloud && (
						<>
							<ContextMenuItem disabled={!canRunNow} onClick={() => runNow(itemCloud.id).catch(() => {})}>
								{t('files-cloud.download-now')}
							</ContextMenuItem>
							{itemCloud.pauseReasons ? (
								<ContextMenuItem onClick={() => resumeSync(itemCloud.id).catch(() => {})}>
									{t('files-cloud.resume')}
								</ContextMenuItem>
							) : (
								<ContextMenuItem onClick={() => pauseSync(itemCloud.id).catch(() => {})}>
									{t('files-cloud.pause')}
								</ContextMenuItem>
							)}
							<ContextMenuItem className={contextMenuClasses.item.rootDestructive} onClick={handleRemoveCloud}>
								{t('files-cloud.remove-download')}
							</ContextMenuItem>
							<ContextMenuSeparator />
						</>
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
					<ContextMenuItem disabled={!canShowRewind} onClick={onRewind}>
						{t('rewind')}
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
							<ContextMenuShortcut>⌘⌫</ContextMenuShortcut>
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
					{canManageShares &&
						(isPathShared(item.path) ? (
							<ContextMenuItem disabled={!canRemoveShare} onClick={openShareInfoDialog}>
								{t('files-action.sharing')}
							</ContextMenuItem>
						) : (
							<ContextMenuItem disabled={!canShare} onClick={openShareInfoDialog}>
								{t('files-action.share')}
							</ContextMenuItem>
						))}
					{canShareWithUsers && (
						<ContextMenuItem onClick={openShareUsersDialog}>
							{shareForPath(item.path) ? t('files-action.sharing-with-users') : t('files-action.share-with-users')}
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
