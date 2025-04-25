import {useEffect} from 'react'

import {IconButton} from '@/components/ui/icon-button'
import {FlameIcon} from '@/features/files/assets/flame-icon'
import {Listing} from '@/features/files/components/listing'
import {useSetActionsBarConfig} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useConfirmation} from '@/providers/confirmation'
import {ContextMenuItem} from '@/shadcn-components/ui/context-menu'
import {DropdownMenuItem} from '@/shadcn-components/ui/dropdown-menu'
import {t} from '@/utils/i18n'

export function TrashListing() {
	const {currentPath} = useNavigate()
	const {listing, isLoading, error, fetchMoreItems} = useListDirectory(currentPath)
	const {emptyTrash} = useFilesOperations()
	const confirm = useConfirmation()
	const setActionsBarConfig = useSetActionsBarConfig()

	const items = listing?.items || []
	const isTrashEmpty = items.length === 0

	const handleEmptyTrash = async () => {
		if (isTrashEmpty) return
		try {
			await confirm({
				title: t('files-empty-trash.title'),
				message: t('files-empty-trash.description'),
				actions: [
					{label: t('files-empty-trash.confirm'), value: 'confirm', variant: 'destructive'},
					{label: t('cancel'), value: 'cancel', variant: 'default'},
				],
				icon: FlameIcon,
			})
			emptyTrash()
		} catch (error) {
			// User cancelled
		}
	}

	const disableActionsAndHidePath = isTrashEmpty || !!error

	const additionalContextMenuItems = (
		<ContextMenuItem onClick={handleEmptyTrash} disabled={disableActionsAndHidePath}>
			{t('files-action.empty-trash')}
		</ContextMenuItem>
	)

	const DesktopActions = (
		<IconButton
			icon={FlameIcon}
			onClick={handleEmptyTrash}
			disabled={disableActionsAndHidePath}
			className={disableActionsAndHidePath ? 'pointer-events-none opacity-60' : ''}
		>
			{t('files-action.empty-trash')}
		</IconButton>
	)

	const MobileActions = (
		<DropdownMenuItem onClick={handleEmptyTrash} disabled={disableActionsAndHidePath}>
			<FlameIcon className='mr-2 h-4 w-4 opacity-50' />
			{t('files-action.empty-trash')}
		</DropdownMenuItem>
	)

	useEffect(() => {
		setActionsBarConfig({
			desktopActions: DesktopActions,
			mobileActions: MobileActions,
			hidePath: disableActionsAndHidePath,
			hideSearch: true,
		})
	}, [disableActionsAndHidePath])

	return (
		<Listing
			items={items}
			totalItems={listing?.totalFiles}
			truncatedAt={listing?.truncatedAt}
			selectableItems={items}
			isLoading={isLoading}
			error={error}
			hasMore={listing?.hasMore ?? false}
			onLoadMore={fetchMoreItems}
			enableFileDrop={false}
			additionalContextMenuItems={additionalContextMenuItems}
		/>
	)
}
