import {useEffect} from 'react'
import {useTranslation} from 'react-i18next'

import {EmptyFolderIcon} from '@/features/files/assets/empty-folder-icon'
import {Listing} from '@/features/files/components/listing'
import {useSetActionsBarConfig} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import {useNavigate} from '@/features/files/hooks/use-navigate'

export function AppsListing() {
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
			CustomEmptyView={EmptyStateApps}
		/>
	)
}

// App data directories appear here as apps get installed, not by adding files
function EmptyStateApps() {
	const {t} = useTranslation()

	return (
		<div className='flex h-full flex-col items-center justify-center gap-3 p-4 pt-0 text-center'>
			<EmptyFolderIcon />
			<div className='text-12 text-white/40'>{t('files-empty.apps')}</div>
		</div>
	)
}
