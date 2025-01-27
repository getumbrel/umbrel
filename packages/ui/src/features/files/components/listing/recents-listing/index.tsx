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
			totalItems={items.length} // we only track 50 max recents, so no need to paginate
			enableFileDrop={false}
		/>
	)
}
