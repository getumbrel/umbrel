import {useEffect} from 'react'
import {useTranslation} from 'react-i18next'

import {EmptyFolderIcon} from '@/features/files/assets/empty-folder-icon'
import {Listing} from '@/features/files/components/listing'
import {useSetActionsBarConfig} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import {useNavigate} from '@/features/files/hooks/use-navigate'

// The /Machines root, mirroring AppsListing: its directories are created by
// Machines, so no uploads, new folders, paste or file drops are offered here.
export function MachinesListing() {
	const {currentPath} = useNavigate()
	const setActionsBarConfig = useSetActionsBarConfig()
	const {listing, isLoading, error, fetchMoreItems} = useListDirectory(currentPath)

	useEffect(() => {
		setActionsBarConfig({
			hidePath: !!error,
			hideSearch: true,
		})
	}, [error])

	return (
		<Listing
			hiddenRenamedPaths={listing?.hiddenRenamedPaths}
			items={listing?.items ?? []}
			selectableItems={listing?.items ?? []}
			isLoading={isLoading}
			error={error}
			hasMore={listing?.hasMore ?? false}
			onLoadMore={fetchMoreItems}
			enableFileDrop={false}
			totalItems={listing?.totalFiles}
			truncatedAt={listing?.truncatedAt}
			CustomEmptyView={EmptyStateMachines}
		/>
	)
}

// Machine directories appear here as machines get created, not by adding files
function EmptyStateMachines() {
	const {t} = useTranslation()

	return (
		<div className='flex h-full flex-col items-center justify-center gap-3 p-4 pt-0 text-center'>
			<EmptyFolderIcon />
			<div className='text-12 text-white/40'>{t('files-empty.machines')}</div>
		</div>
	)
}
