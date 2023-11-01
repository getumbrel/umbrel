import {Loading} from '@/components/ui/loading'
import {useAvailableApps} from '@/hooks/use-available-apps'
import {AppsGallerySection} from '@/modules/app-store/gallery-section'

export function AppStoreStory() {
	const {isLoading, apps} = useAvailableApps()

	if (isLoading) {
		return <Loading />
	}
	return (
		<div>
			Hello
			<AppsGallerySection apps={apps.slice(0, 5)} />
		</div>
	)
}
