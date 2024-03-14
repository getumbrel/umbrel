import {useState} from 'react'
import {JSONTree} from 'react-json-tree'

import {InstallButton} from '@/components/install-button'
import {Loading} from '@/components/ui/loading'
import {useDemoInstallProgress} from '@/hooks/use-demo-progress'
import {H3} from '@/layouts/stories'
import {AppStoreNav} from '@/modules/app-store/app-store-nav'
import {AppGallerySection, AppsGallerySection} from '@/modules/app-store/gallery-section'
import {InstallTheseFirstDialog} from '@/modules/app-store/install-these-first-dialog'
import {UpdatesDialog} from '@/modules/app-store/updates-button'
import {AvailableAppsProvider, useAvailableApps} from '@/providers/available-apps'
import {useDiscoverQuery} from '@/routes/app-store/use-discover-query'
import {Button} from '@/shadcn-components/ui/button'
import {Separator} from '@/shadcn-components/ui/separator'
import {appStates} from '@/trpc/trpc'

export default function AppStoreStory() {
	return (
		<>
			<InstallButtonExamples />
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
			<AppUpdatesZeroExample />
			<AppUpdatesTwoExample />
			<AppUpdatesManyExample />
			<InstallFirstExample />
			<InstallFirst2Example />
			<TorOnlyApps />
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

function TorOnlyApps() {
	const {apps} = useAvailableApps()

	return <JSONTree data={apps?.filter((app) => app.torOnly)} />
}

function AppUpdatesZeroExample() {
	const [open, setOpen] = useState(false)
	return (
		<>
			<Button onClick={() => setOpen(true)}>Updates (0)</Button>
			<UpdatesDialog
				open={open}
				onOpenChange={setOpen}
				appsWithUpdates={[]}
				titleRightChildren={
					<Button size='dialog' variant='primary' onClick={() => alert('update all')}>
						Update all
					</Button>
				}
			/>
		</>
	)
}

function AppUpdatesTwoExample() {
	const [open, setOpen] = useState(false)
	const {apps} = useAvailableApps()

	return (
		<>
			<Button onClick={() => setOpen(true)}>Updates (3)</Button>
			<UpdatesDialog
				open={open}
				onOpenChange={setOpen}
				appsWithUpdates={apps?.slice(0, 3) ?? []}
				titleRightChildren={
					<Button size='dialog' variant='primary' onClick={() => alert('update all')}>
						Update all
					</Button>
				}
			/>
		</>
	)
}

function AppUpdatesManyExample() {
	const [open, setOpen] = useState(false)
	const {apps} = useAvailableApps()

	return (
		<>
			<Button onClick={() => setOpen(true)}>Updates (15)</Button>
			<UpdatesDialog
				open={open}
				onOpenChange={setOpen}
				appsWithUpdates={apps?.slice(0, 15) ?? []}
				titleRightChildren={
					<Button size='dialog' variant='primary' onClick={() => alert('update all')}>
						Update all
					</Button>
				}
			/>
		</>
	)
}

function InstallButtonExamples() {
	const {progress, state, install} = useDemoInstallProgress()

	return (
		<div>
			<H3>Install Button</H3>
			<div className='flex flex-col items-end gap-1'>
				<InstallButton
					installSize='1.5GB'
					progress={progress}
					state={state}
					onInstallClick={install}
					onOpenClick={() => alert('foobar')}
				/>
				<Separator />
				{appStates.map((state) => (
					<div key={state}>
						{state}{' '}
						<InstallButton
							installSize='1.5GB'
							progress={50}
							state={state}
							onInstallClick={() => {
								alert('install ' + state)
							}}
							onOpenClick={() => alert('open' + state)}
						/>
					</div>
				))}
			</div>
		</div>
	)
}

function InstallFirstExample() {
	const [open, setOpen] = useState(false)
	return (
		<>
			<Button onClick={() => setOpen(true)}>Install Lightning App (show dialog only)</Button>
			<InstallTheseFirstDialog appId='lightning' toInstallFirstIds={['bitcoin']} open={open} onOpenChange={setOpen} />
		</>
	)
}

function InstallFirst2Example() {
	const [open, setOpen] = useState(false)
	return (
		<>
			<Button onClick={() => setOpen(true)}>Install Electrs App (show dialog only)</Button>
			<InstallTheseFirstDialog
				appId='lightning'
				toInstallFirstIds={['bitcoin', 'lightning']}
				open={open}
				onOpenChange={setOpen}
			/>
		</>
	)
}
