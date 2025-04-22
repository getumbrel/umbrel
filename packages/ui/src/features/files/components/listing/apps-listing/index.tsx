import {Listing} from '@/features/files/components/listing'
import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import {useNavigate} from '@/features/files/hooks/use-navigate'

export function AppsListing() {
	const {currentPath} = useNavigate()

	const {listing, isLoading, error, fetchMoreItems} = useListDirectory(currentPath)

	return (
		<Listing
			items={listing?.items ?? []}
			selectableItems={listing?.items ?? []}
			isLoading={isLoading}
			error={error}
			hasMore={listing?.hasMore ?? false}
			onLoadMore={fetchMoreItems}
			enableFileDrop={false}
			totalItems={listing?.totalFiles}
			truncatedAt={listing?.truncatedAt}
		/>
	)
}
