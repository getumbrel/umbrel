import {useState} from 'react'

import {Loading} from '@/components/ui/loading'
import {useAvailableApps} from '@/hooks/use-available-apps'
import {AppGallerySection, AppsGallerySection} from '@/modules/app-store/gallery-section'
import {InstallTheseFirstDialog} from '@/modules/app-store/install-these-first-dialog'
import {useDiscoverQuery} from '@/routes/app-store/use-discover-query'
import {Button} from '@/shadcn-components/ui/button'
import {trpcReact} from '@/trpc/trpc'

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
	const apps = useAvailableApps()

	const installMut = trpcReact.user.apps.install.useMutation({
		onSuccess: () => {
			window.location.reload()
		},
	})
	const handleInstallABunch = () => {
		const toInstall = apps?.apps?.slice(0, 20) ?? []
		toInstall.map((app) => installMut.mutate({appId: app.id}))
	}
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
