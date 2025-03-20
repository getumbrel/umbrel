import {Listing} from '@/features/files/components/listing'
import {useListRecents} from '@/features/files/hooks/use-list-recents'

export function RecentsListing() {
	const {listing, isLoading, error} = useListRecents()
	const items = listing || []

	return (
		<Listing
			items={items}
			selectableItems={items}
			isLoading={isLoading}
			error={error}
			hasMore={false} // we only track 50 max recents, which is less than the initial batch size
			onLoadMore={async () => false} // no-op since we don't need to load more
			enableFileDrop={false}
		/>
	)
}
