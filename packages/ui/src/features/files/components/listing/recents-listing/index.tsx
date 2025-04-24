import {useEffect} from 'react'

import {Listing} from '@/features/files/components/listing'
import {useSetActionsBarConfig} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {useListRecents} from '@/features/files/hooks/use-list-recents'

export function RecentsListing() {
	const {listing, isLoading, error} = useListRecents()
	const items = listing || []
	const setActionsBarConfig = useSetActionsBarConfig()

	useEffect(() => {
		setActionsBarConfig({
			hidePath: !!error,
		})
	}, [error])

	return (
		<Listing
			items={items}
			totalItems={items.length} // Since there's no pagination for recents, as it's capped at 50
			selectableItems={items}
			isLoading={isLoading}
			error={error}
			hasMore={false} // we only track 50 max recents, which is less than the initial batch size
			onLoadMore={async () => false} // no-op since we don't need to load more
			enableFileDrop={false}
		/>
	)
}
