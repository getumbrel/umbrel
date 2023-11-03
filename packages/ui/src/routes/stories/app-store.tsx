import {Loading} from '@/components/ui/loading'
import {AppsGallerySection} from '@/modules/app-store/gallery-section'
import {useDiscoverQuery} from '@/routes/app-store/use-discover-query'

export function AppStoreStory() {
	const discoverQ = useDiscoverQuery()

	if (discoverQ.isLoading) {
		return <Loading />
	}

	if (!discoverQ.data) {
		throw new Error('No data')
	}

	const {banners} = discoverQ.data

	return (
		<div>
			<AppsGallerySection banners={banners} />
		</div>
	)
}
