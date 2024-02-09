import {useState} from 'react'

import {Loading} from '@/components/ui/loading'
import {useDebugInstallRandomApps} from '@/hooks/use-debug-install-random-apps'
import {AppStoreNav} from '@/modules/app-store/app-store-nav'
import {AppGallerySection, AppsGallerySection} from '@/modules/app-store/gallery-section'
import {InstallTheseFirstDialog} from '@/modules/app-store/install-these-first-dialog'
import {AvailableAppsProvider} from '@/providers/available-apps'
import {useDiscoverQuery} from '@/routes/app-store/use-discover-query'
import {Button} from '@/shadcn-components/ui/button'

export default function AppStoreStory() {
	return (
		<>
			<div className='max-w-sm'>
				<AppStoreNav activeId='automation' />
				<AppStoreNav activeId='discover' />
				<AppStoreNav activeId='developer' />
			</div>
			<AvailableAppsProvider>
				<Inner />
			</AvailableAppsProvider>
			<AppGallerySection
				galleryId='immich'
				gallery={[
					'https://getumbrel.github.io/umbrel-apps-gallery/immich/1.jpg',
					'https://getumbrel.github.io/umbrel-apps-gallery/immich/2.jpg',
					'https://getumbrel.github.io/umbrel-apps-gallery/immich/3.jpg',
				]}
			/>
		</>
	)
}

function Inner() {
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
			<InstallABunchOfApps />
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

function InstallABunchOfApps() {
	const handleInstallABunch = useDebugInstallRandomApps()
	return <Button onClick={handleInstallABunch}>Install a bunch of apps</Button>
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
