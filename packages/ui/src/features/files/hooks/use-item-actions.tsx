import {
	ArchiveRestore,
	ClipboardPaste,
	CloudDownload,
	CloudOff,
	Copy,
	Download,
	FolderOpen,
	FolderSearch,
	History,
	Network,
	Package,
	Pause,
	PencilLine,
	Play,
	Scissors,
	Star,
	StarOff,
	Trash2,
	Undo2,
	Unplug,
	Users,
} from 'lucide-react'
import type {ComponentType} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {SUPPORTED_ARCHIVE_EXTRACT_EXTENSIONS} from '@/features/files/constants'
import {cloudSyncForPath, useCloudActions, useCloudSyncs} from '@/features/files/hooks/use-cloud'
import {useFavorites} from '@/features/files/hooks/use-favorites'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useIsMember} from '@/features/files/hooks/use-home-path'
import {useItemClick} from '@/features/files/hooks/use-item-click'
import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import {useMemberShares} from '@/features/files/hooks/use-member-shares'
import {useNavigate as useFilesNavigate} from '@/features/files/hooks/use-navigate'
import {useNetworkStorage} from '@/features/files/hooks/use-network-storage'
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

// One thing that can be done to the selected items
export type ItemAction = {
	id: string
	label: string
	icon: ComponentType<{className?: string}>
	onSelect: () => void
	disabled?: boolean
	destructive?: boolean
	shortcut?: string
}

// Everything that can be done to the selected items, in the groups they are
// shown in. Worked out once here and drawn wherever a selection is acted on:
// the menu under the pointer, the bar's selection controls and the sheet a
// long press brings up on a touch screen. It acts on the store's selection,
// as the operations themselves do.
export function useItemActions() {
	const actions = useActionsOnSelection()
	// While Select all is still loading the rest of a folder, the selection is
	// short of what was asked for, and nothing is to act on the part as if it
	// were the whole: everything waits, greyed out, the moment it takes
	const isSelectingAll = useFilesStore((state) => state.isSelectingAll)
	if (!isSelectingAll) return actions
	const hold = <T extends ItemAction | undefined>(action: T) => (action ? {...action, disabled: true} : action)
	return {
		groups: actions.groups.map((group) => group.map((action) => ({...action, disabled: true}))),
		download: hold(actions.download),
		remove: hold(actions.remove),
		restore: hold(actions.restore),
	}
}

function useActionsOnSelection() {
	const {t} = useTranslation()
	const isReadOnly = useIsFilesReadOnly()
	const isMember = useIsMember()
	const navigate = useNavigate()
	const {addLinkSearchParams} = useQueryParams()
	const linkToDialog = useLinkToDialog()
	const confirm = useConfirmation()

	const selectedItems = useFilesStore((state) => state.selectedItems)
	const hasItemsInClipboard = useFilesStore((state) => state.clipboardItems.length > 0)
	const isItemInClipboard = useFilesStore((state) => state.isItemInClipboard)
	const setRenamingItemPath = useFilesStore((state) => state.setRenamingItemPath)

	const {canShowRewind, onClick: onRewind} = useRewindAction(selectedItems)
	const {
		restoreSelectedItems,
		trashSelectedItems,
		downloadSelectedItems,
		archiveSelectedItems,
		pasteItemsFromClipboard,
		extractSelectedItems,
	} = useFilesOperations()
	const {handleDoubleClick} = useItemClick()

	const {currentPath, isBrowsingTrash, isBrowsingRecents, isBrowsingSearch, isViewingExternalDrives, revealItem} =
		useFilesNavigate()
	// Compressing and extracting both write into the current directory (the
	// archive, or its contents), so both need it to be writable
	const {listing} = useListDirectory(currentPath)
	const canWriteHere = listing?.operations.includes('writable') ?? false

	const {isPathShared, isAddingShare, isRemovingShare, canManageShares} = useShares()
	const {memberShares, shareForPath} = useMemberShares()
	const hasMembers = useHasMembers()
	const {isPathFavorite, addFavorite, removeFavorite, isAddingFavorite, isRemovingFavorite} = useFavorites()
	const {removeHostOrShare, isRemovingShare: isRemovingNetworkShare} = useNetworkStorage()
	const {data: clouds} = useCloudSyncs()
	const {pauseSync, resumeSync, runNow, removeSync} = useCloudActions()

	const none = {groups: [] as ItemAction[][], download: undefined, remove: undefined, restore: undefined}
	const item = selectedItems[0]
	if (isReadOnly || !item) return none

	const deletePermanently: ItemAction = {
		id: 'delete',
		label: t('files-action.delete'),
		icon: Trash2,
		onSelect: () => navigate(linkToDialog('files-permanently-delete-confirmation')),
		destructive: true,
		shortcut: '⌘⌫',
	}

	// In the Trash there is only putting back and deleting for good
	if (isBrowsingTrash) {
		const restore: ItemAction = {
			id: 'restore',
			label: t('files-action.restore'),
			icon: Undo2,
			onSelect: restoreSelectedItems,
		}
		return {groups: [[restore], [deletePermanently]], download: undefined, remove: deletePermanently, restore}
	}
	// Nothing is done to a drive in /External, or to an item still on its way up
	if (isViewingExternalDrives || ('isUploading' in item && item.isUploading)) return none

	const one = selectedItems.length === 1

	// Allow/disallow actions based on backend operations. Disconnected network
	// entries carry no operations, so the checks below reject them.
	const canOpen =
		one && !(item.isDisconnected && isDirectoryANetworkShare(item.path)) && !isDirectoryAnUmbrelBackup(item.name)
	const canRename = one && canPerformFileOperation(item, 'rename') && !isDirectoryAnUmbrelBackup(item.name)
	const canDownload = selectedItems.every((selected) => !selected.isDisconnected)
	const canCut = selectedItems.every((selected) => canPerformFileOperation(selected, 'move'))
	const canCopy = selectedItems.every((selected) => canPerformFileOperation(selected, 'copy'))
	const canPaste =
		hasItemsInClipboard &&
		one &&
		!isItemInClipboard(item) &&
		item.type === 'directory' &&
		canPerformFileOperation(item, 'writable')
	const canTrash = canPerformFileOperation(item, 'trash')
	const canPermanentlyDelete = canPerformFileOperation(item, 'delete')
	const canExtract =
		canWriteHere &&
		selectedItems.every(
			(selected) =>
				canPerformFileOperation(selected, 'unarchive') &&
				SUPPORTED_ARCHIVE_EXTRACT_EXTENSIONS.some((ext) => selected.name.toLowerCase().endsWith(ext)),
		)
	// Compressing reads the items, and it isn't offered for anything the
	// backend keeps read-only — an installed machine's runtime state, media
	// mounted read-only, backups, network hosts — which it signals by
	// withholding `writable` (protection from moving or deleting alone, as on
	// /Home/Downloads or an app's folder, keeps `writable`)
	const canArchive =
		canWriteHere &&
		selectedItems.every(
			(selected) => canPerformFileOperation(selected, 'copy') && canPerformFileOperation(selected, 'writable'),
		)

	const isShared = isPathShared(item.path)
	const canShare =
		canManageShares &&
		one &&
		!isShared &&
		!isAddingShare &&
		canPerformFileOperation(item, 'share') &&
		!isDirectoryAnUmbrelBackup(item.name)
	const canRemoveShare = canManageShares && one && isShared && !isRemovingShare
	// Share a directory with member accounts (owner only, memberShares is
	// undefined for members so the item never shows for them)
	const isShareableWithUsersPath = item.path === '/Home' || item.path.startsWith('/Home/')
	const canShareWithUsers =
		one &&
		hasMembers &&
		memberShares !== undefined &&
		item.type === 'directory' &&
		isShareableWithUsersPath &&
		!isDirectoryAnUmbrelBackup(item.name)
	const isFavorite = isPathFavorite(item.path)
	const canFavorite =
		one &&
		!isFavorite &&
		!isAddingFavorite &&
		canPerformFileOperation(item, 'favorite') &&
		!isDirectoryAnUmbrelBackup(item.name)
	const canRemoveFavorite = one && isFavorite && !isRemovingFavorite

	const isNetworkHost = isDirectoryANetworkDevice(item.path) // /Network/hostname
	const isNetworkShare = isDirectoryANetworkShare(item.path) // /Network/hostname/share
	const canEjectNetwork = !isMember && (isNetworkHost || isNetworkShare) && !isRemovingNetworkShare

	const openDialogFor = (dialog: 'files-share-info' | 'files-share-users') => () =>
		navigate({
			search: addLinkSearchParams({dialog, [`${dialog}-name`]: item.name, [`${dialog}-path`]: item.path}),
		})

	// Cloud verbs when the selected folder is a download destination.
	// Mutation safety is enforced server-side; these are conveniences.
	// Only the current account's Cloud records are returned by the API, so
	// these controls can never reveal or operate on another member's job.
	const itemCloud = one ? cloudSyncForPath(clouds, item.path) : undefined
	const removeCloud = async () => {
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

	const download: ItemAction = {
		id: 'download',
		label: one ? t('files-action.download') : t('files-action.download-items', {count: selectedItems.length}),
		icon: Download,
		// Everything in this folder selected: the folder can be downloaded in their place (see downloadSelectedItems)
		onSelect: () =>
			void downloadSelectedItems({
				wholeFolder:
					listing?.path === currentPath && selectedItems.length === listing.totalFiles ? currentPath : undefined,
			}),
		disabled: !canDownload,
	}
	const remove: ItemAction | undefined = canTrash
		? {
				id: 'trash',
				label: t('files-action.trash'),
				icon: Trash2,
				onSelect: trashSelectedItems,
				destructive: true,
				shortcut: '⌘⌫',
			}
		: canPermanentlyDelete
			? deletePermanently
			: undefined

	const groups: ItemAction[][] = [
		[
			...(isBrowsingRecents || isBrowsingSearch
				? [
						{
							id: 'show-in-folder',
							label: t('files-action.show-in-folder'),
							icon: FolderSearch,
							onSelect: () => revealItem(item),
							disabled: !one,
						},
					]
				: []),
			{
				id: 'open',
				label: t('files-action.open'),
				icon: FolderOpen,
				onSelect: () => handleDoubleClick(item),
				disabled: !canOpen,
			},
		],
		itemCloud
			? [
					{
						id: 'cloud-run',
						label: t('files-cloud.download-now'),
						icon: CloudDownload,
						onSelect: () => void runNow(itemCloud.id).catch(() => {}),
						disabled: itemCloud.status.state === 'running' || itemCloud.status.state === 'queued',
					},
					itemCloud.pauseReasons
						? {
								id: 'cloud-resume',
								label: t('files-cloud.resume'),
								icon: Play,
								onSelect: () => void resumeSync(itemCloud.id).catch(() => {}),
							}
						: {
								id: 'cloud-pause',
								label: t('files-cloud.pause'),
								icon: Pause,
								onSelect: () => void pauseSync(itemCloud.id).catch(() => {}),
							},
					{
						id: 'cloud-remove',
						label: t('files-cloud.remove-download'),
						icon: CloudOff,
						onSelect: () => void removeCloud(),
						destructive: true,
					},
				]
			: [],
		[
			{
				id: 'rename',
				label: t('files-action.rename'),
				icon: PencilLine,
				onSelect: () => setRenamingItemPath(item.path),
				disabled: !canRename,
			},
			download,
		],
		[
			{
				id: 'cut',
				label: t('files-action.cut'),
				icon: Scissors,
				onSelect: () => useFilesStore.getState().cutItemsToClipboard(),
				disabled: !canCut,
				shortcut: '⌘X',
			},
			{
				id: 'copy',
				label: t('files-action.copy'),
				icon: Copy,
				onSelect: () => useFilesStore.getState().copyItemsToClipboard(),
				disabled: !canCopy,
				shortcut: '⌘C',
			},
			{
				id: 'paste',
				label: t('files-action.paste'),
				icon: ClipboardPaste,
				onSelect: () => void pasteItemsFromClipboard({toDirectory: item.path}),
				disabled: !canPaste,
				shortcut: '⌘V',
			},
			// Rewind restores from the owner's backups, which members can't reach
			...(isMember
				? []
				: [{id: 'rewind', label: t('rewind'), icon: History, onSelect: onRewind, disabled: !canShowRewind}]),
		],
		remove ? [remove] : [],
		[
			{
				id: 'compress',
				label: t('files-action.compress'),
				icon: Package,
				onSelect: () => void archiveSelectedItems(),
				disabled: !canArchive,
			},
			{
				id: 'uncompress',
				label: t('files-action.uncompress'),
				icon: ArchiveRestore,
				onSelect: extractSelectedItems,
				disabled: !canExtract,
			},
		],
		[
			...(canManageShares
				? [
						isShared
							? {
									id: 'sharing',
									label: t('files-action.sharing'),
									icon: Network,
									onSelect: openDialogFor('files-share-info'),
									disabled: !canRemoveShare,
								}
							: {
									id: 'share',
									label: t('files-action.share'),
									icon: Network,
									onSelect: openDialogFor('files-share-info'),
									disabled: !canShare,
								},
					]
				: []),
			...(canShareWithUsers
				? [
						{
							id: 'share-users',
							label: shareForPath(item.path)
								? t('files-action.sharing-with-users')
								: t('files-action.share-with-users'),
							icon: Users,
							onSelect: openDialogFor('files-share-users'),
						},
					]
				: []),
			isFavorite
				? {
						id: 'remove-favorite',
						label: t('files-action.remove-favorite'),
						icon: StarOff,
						onSelect: () => void removeFavorite({path: item.path}),
						disabled: !canRemoveFavorite,
					}
				: {
						id: 'add-favorite',
						label: t('files-action.add-favorite'),
						icon: Star,
						onSelect: () => void addFavorite({path: item.path}),
						disabled: !canFavorite,
					},
		],
		canEjectNetwork
			? [
					{
						id: 'eject-network',
						label: isNetworkHost ? t('files-action.remove-network-host') : t('files-action.remove-network-share'),
						icon: Unplug,
						onSelect: () => void removeHostOrShare(item.path),
					},
				]
			: [],
	].filter((group) => group.length > 0)

	return {groups, download, remove, restore: undefined}
}

// The same groups with what can't be done here left out, for surfaces short
// on room where a greyed-out row is only something to scroll past
export function availableActions(groups: ItemAction[][], {without = []}: {without?: string[]} = {}) {
	return groups
		.map((group) => group.filter((action) => !action.disabled && !without.includes(action.id)))
		.filter((group) => group.length > 0)
}
