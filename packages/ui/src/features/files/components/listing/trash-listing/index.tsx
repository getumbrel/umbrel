import {Trash2} from 'lucide-react'
import {useEffect} from 'react'
import {useTranslation} from 'react-i18next'

import {FlameIcon} from '@/features/files/assets/flame-icon'
import {Listing, StateView} from '@/features/files/components/listing'
import {useSetActionsBarConfig} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {useConfirmation} from '@/providers/confirmation'

export function TrashListing() {
	const {t} = useTranslation()
	const {currentPath} = useNavigate()
	const {listing, isLoading, error, fetchMoreItems, fetchAllItems} = useListDirectory(currentPath)
	const {emptyTrash} = useFilesOperations()
	const confirm = useConfirmation()
	const setActionsBarConfig = useSetActionsBarConfig()
	const addPendingPaths = useFilesStore((s) => s.addPendingPaths)
	const removePendingPaths = useFilesStore((s) => s.removePendingPaths)

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
			const paths = items.map((item) => item.path)
			addPendingPaths(paths, 'removing')
			emptyTrash().catch(() => {
				removePendingPaths(paths)
			})
		} catch {
			// User cancelled
		}
	}

	const disableActionsAndHidePath = isTrashEmpty || !!error

	useEffect(() => {
		setActionsBarConfig({
			actions: [
				{
					id: 'empty-trash',
					label: t('files-action.empty-trash'),
					icon: FlameIcon,
					onSelect: () => void handleEmptyTrash(),
					disabled: disableActionsAndHidePath,
					pill: true,
				},
			],
			hidePath: !!error,
			hideSearch: true,
		})
	}, [disableActionsAndHidePath, error])

	return (
		<Listing
			hiddenRenamedPaths={listing?.hiddenRenamedPaths}
			items={items}
			totalItems={listing?.totalFiles}
			truncatedAt={listing?.truncatedAt}
			totalSize={listing?.size}
			selectableItems={items}
			isLoading={isLoading}
			error={error}
			hasMore={listing?.hasMore ?? false}
			onLoadMore={fetchMoreItems}
			onLoadAll={fetchAllItems}
			enableFileDrop={false}
			CustomEmptyView={EmptyStateTrash}
		/>
	)
}

function EmptyStateTrash() {
	const {t} = useTranslation()
	return (
		<StateView icon={<Trash2 className='size-9 text-white/30' strokeWidth={1.5} />} title={t('files-empty.trash')} />
	)
}
