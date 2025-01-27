import {useSearchParams} from 'react-router-dom'

import {Listing} from '@/features/files/components/listing'
import {ITEMS_PER_PAGE} from '@/features/files/constants'
import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import {useNavigate} from '@/features/files/hooks/use-navigate'

export function AppsListing() {
	const [searchParams] = useSearchParams()
	const currentPage = parseInt(searchParams.get('page') || '1')
	const {currentPath} = useNavigate()

	const {listing, isLoading, error} = useListDirectory(currentPath, {
		start: (currentPage - 1) * ITEMS_PER_PAGE,
		count: ITEMS_PER_PAGE,
	})

	return (
		<Listing
			items={listing?.items ?? []}
			selectableItems={listing?.items ?? []}
			isLoading={isLoading}
			error={error}
			totalItems={listing?.total ?? 0}
			enableFileDrop={false}
		/>
	)
}
