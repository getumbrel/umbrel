import {useState} from 'react'

import {Loading} from '@/components/ui/loading'
import {AppGallerySection, AppsGallerySection} from '@/modules/app-store/gallery-section'
import {InstallTheseFirstDialog} from '@/modules/app-store/install-these-first-dialog'
import {useDiscoverQuery} from '@/routes/app-store/use-discover-query'
import {Button} from '@/shadcn-components/ui/button'

export default function AppStoreStory() {
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
			<InstallFirstExample />
			<AppsGallerySection banners={banners} />
			<AppGallerySection
				galleryId='immich'
				gallery={[
					'https://getumbrel.github.io/umbrel-apps-gallery/immich/1.jpg',
					'https://getumbrel.github.io/umbrel-apps-gallery/immich/2.jpg',
					'https://getumbrel.github.io/umbrel-apps-gallery/immich/3.jpg',
				]}
			/>
		</div>
	)
}

function InstallFirstExample() {
	const [open, setOpen] = useState(false)
	return (
		<>
			<Button onClick={() => setOpen(true)}>Install Lightning App</Button>
			<InstallTheseFirstDialog appId='lightning' toInstallFirstIds={['bitcoin']} open={open} onOpenChange={setOpen} />
		</>
	)
}
