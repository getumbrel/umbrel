import {useNavigate} from 'react-router-dom'

import {SUPPORTED_ARCHIVE_EXTRACT_EXTENSIONS} from '@/features/files/constants'
import {useFavorites} from '@/features/files/hooks/use-favorites'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useItemClick} from '@/features/files/hooks/use-item-click'
import {useNavigate as useFilesNavigate} from '@/features/files/hooks/use-navigate'
import {useShares} from '@/features/files/hooks/use-shares'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {isOperationAllowed} from '@/features/files/utils/allowed-filesystem-operation'
import {useQueryParams} from '@/hooks/use-query-params'
import {useGlobalFiles} from '@/providers/global-files'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuTrigger,
} from '@/shadcn-components/ui/context-menu'
import {contextMenuClasses} from '@/shadcn-components/ui/shared/menu'
import {useLinkToDialog} from '@/utils/dialog'
import {t} from '@/utils/i18n'

interface FileItemContextMenuProps {
	item: FileSystemItem
	children: React.ReactNode
	onRenameClick: () => void
}

export const FileItemContextMenu = ({item, children, onRenameClick}: FileItemContextMenuProps) => {
	const navigate = useNavigate()
	const {addLinkSearchParams} = useQueryParams()
	const {isBrowsingTrash, isBrowsingRecents, navigateToDirectory} = useFilesNavigate()
	const {cancelUpload} = useGlobalFiles()
	const selectedItems = useFilesStore((state) => state.selectedItems)
	const setSelectedItems = useFilesStore((state) => state.setSelectedItems)
	const isItemSelected = useFilesStore((state) => state.isItemSelected)

	const hasItemsInClipboard = useFilesStore((state) => state.hasItemsInClipboard)
	const copyItemsToClipboard = useFilesStore((state) => state.copyItemsToClipboard)
	const cutItemsToClipboard = useFilesStore((state) => state.cutItemsToClipboard)
	const isItemInClipboard = useFilesStore((state) => state.isItemInClipboard)

	const {isPathShared, isAddingShare, isRemovingShare} = useShares()
	const {isPathFavorite, addFavorite, removeFavorite, isAddingFavorite, isRemovingFavorite} = useFavorites()
	const {handleDoubleClick} = useItemClick()
	const {
		restoreSelectedItems,
		trashSelectedItems,
		downloadSelectedItems,
		archiveSelectedItems,
		pasteItemsFromClipboard,
		extractSelectedItems,
	} = useFilesOperations()

	const openShareInfoDialog = () => {
		navigate({
			search: addLinkSearchParams({
				dialog: 'files-share-info',
				'files-share-info-name': item.name,
				'files-share-info-path': item.path,
			}),
		})
	}

	const linkToDialog = useLinkToDialog()

	type ContextMenuItem = {
		id: string
		label?: string
		onClick?: () => void
		shortcut?: string
		destructive?: boolean
		type?: 'separator'
		disabled?: boolean
	}

	let contextMenuItems: ContextMenuItem[] = []

	// If the item is in trash
	if (isBrowsingTrash) {
		contextMenuItems = [
			{id: 'restore', label: t('files-action.restore'), onClick: restoreSelectedItems},
			{
				id: 'delete-permanently',
				label: t('files-action.delete'),
				onClick: () => navigate(linkToDialog('files-permanently-delete-confirmation')),
				destructive: true,
			},
		]
	}
	// If the item is uploading
	else if ('isUploading' in item && item.isUploading) {
		contextMenuItems = [
			{
				id: 'cancel-upload',
				label: t('files-action.cancel-upload'),
				onClick: () => cancelUpload(item.tempId ?? ''),
				destructive: true,
			},
		]
	} else {
		// If the item is in recents
		if (isBrowsingRecents) {
			contextMenuItems = [
				{
					id: 'enclosing-folder',
					label: t('files-action.show-in-folder'),
					onClick: () => navigateToDirectory(item.path.slice(0, -item.name.length)),
				},
			]
		}

		const hasOneSelectedItem = selectedItems.length === 1

		// allow/disallow actions based on backend operations
		const canOpen = hasOneSelectedItem
		const canRename = hasOneSelectedItem && isOperationAllowed(item.path, 'rename')
		const canDownload = true // always allowed
		const canCut = selectedItems.every((itm) => isOperationAllowed(itm.path, 'move'))
		const canCopy = selectedItems.every((itm) => isOperationAllowed(itm.path, 'copy'))
		const canPaste =
			hasItemsInClipboard() && hasOneSelectedItem && !isItemInClipboard(item) && isOperationAllowed(item.path, 'paste')
		const canTrash = isOperationAllowed(item.path, 'trash')
		const canArchive = selectedItems.every((itm) => isOperationAllowed(itm.path, 'archive'))
		const canExtract = selectedItems.every(
			(itm) =>
				isOperationAllowed(itm.path, 'extract') &&
				SUPPORTED_ARCHIVE_EXTRACT_EXTENSIONS.some((ext) => itm.name.toLowerCase().endsWith(ext)),
		)
		const canShare =
			hasOneSelectedItem && !isPathShared(item.path) && !isAddingShare && isOperationAllowed(item.path, 'share')
		const canRemoveShare = hasOneSelectedItem && isPathShared(item.path) && !isRemovingShare
		const canFavorite =
			hasOneSelectedItem && !isPathFavorite(item.path) && !isAddingFavorite && isOperationAllowed(item.path, 'favorite')
		const canRemoveFavorite = hasOneSelectedItem && isPathFavorite(item.path) && !isRemovingFavorite

		// Full context menu
		contextMenuItems.push(
			{
				id: 'open',
				label: t('files-action.open'),
				onClick: () => handleDoubleClick(item),
				disabled: !canOpen,
			},
			{id: 'rename', label: t('files-action.rename'), onClick: onRenameClick, disabled: !canRename},
			{
				id: 'download',
				label:
					selectedItems.length > 1
						? t('files-action.download-items', {count: selectedItems.length})
						: t('files-action.download'),
				onClick: downloadSelectedItems,
				disabled: !canDownload,
			},
			{id: 'separator1', type: 'separator'},
			{id: 'cut', label: t('files-action.cut'), onClick: cutItemsToClipboard, shortcut: '⌘X', disabled: !canCut},
			{id: 'copy', label: t('files-action.copy'), onClick: copyItemsToClipboard, shortcut: '⌘C', disabled: !canCopy},
			{
				id: 'paste',
				label: t('files-action.paste'),
				onClick: () => pasteItemsFromClipboard({toDirectory: item.path}),
				shortcut: '⌘V',
				disabled: !canPaste,
			},
			{
				id: 'trash',
				label: t('files-action.trash'),
				onClick: trashSelectedItems,
				shortcut: '⌘⌫',
				destructive: true,
				disabled: !canTrash,
			},
			{id: 'separator', type: 'separator'},
			{
				id: 'compress',
				label: t('files-action.compress'),
				onClick: archiveSelectedItems,
				disabled: !canArchive,
			},
			{
				id: 'uncompress',
				label: t('files-action.uncompress'),
				onClick: extractSelectedItems,
				disabled: !canExtract,
			},
			{id: 'separator2', type: 'separator'},
			isPathShared(item.path)
				? {
						id: 'sharing',
						label: t('files-action.sharing'),
						onClick: openShareInfoDialog,
						disabled: !canRemoveShare,
					}
				: {
						id: 'share',
						label: t('files-action.share'),
						onClick: openShareInfoDialog,
						disabled: !canShare,
					},
			isPathFavorite(item.path)
				? {
						id: 'remove-from-favorites',
						label: t('files-action.remove-favorite'),
						onClick: () => removeFavorite({path: item.path}),
						disabled: !canRemoveFavorite,
					}
				: {
						id: 'add-to-favorites',
						label: t('files-action.add-favorite'),
						onClick: () => addFavorite({path: item.path}),
						disabled: !canFavorite,
					},
		)
	}

	return (
		<>
			<ContextMenu
				onOpenChange={(isOpen) => {
					// if the menu opens and the item is not selected, select it
					if (isOpen && !isItemSelected(item)) {
						setSelectedItems([item])
					}
				}}
			>
				<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
				<ContextMenuContent className='w-48'>
					{contextMenuItems.map((menuItem) =>
						menuItem.type === 'separator' ? (
							<ContextMenuSeparator key={menuItem.id} />
						) : (
							<ContextMenuItem
								key={menuItem.id}
								onClick={menuItem.onClick}
								className={menuItem.destructive ? contextMenuClasses.item.rootDestructive : undefined}
								disabled={menuItem.disabled}
							>
								{menuItem.label}
								{menuItem.shortcut && <ContextMenuShortcut>{menuItem.shortcut}</ContextMenuShortcut>}
							</ContextMenuItem>
						),
					)}
				</ContextMenuContent>
			</ContextMenu>
		</>
	)
}
