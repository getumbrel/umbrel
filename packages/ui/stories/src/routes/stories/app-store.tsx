import {H3} from '@stories/components'
import {useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {JSONTree} from 'react-json-tree'
import {arrayIncludes} from 'ts-extras'

import {appStateToString} from '@/components/cmdk'
import {InstallButton} from '@/components/install-button'
import {ProgressButton} from '@/components/progress-button'
import {GenericErrorText} from '@/components/ui/generic-error-text'
import {Loading} from '@/components/ui/loading'
import {useDemoInstallProgress} from '@/hooks/use-demo-progress'
import {AppStoreNav} from '@/modules/app-store/app-store-nav'
import {categoryishDescriptions} from '@/modules/app-store/constants'
import {AppGallerySection, AppsGallerySection} from '@/modules/app-store/gallery-section'
import {SelectDependenciesDialog} from '@/modules/app-store/select-dependencies-dialog'
import {UpdatesDialog} from '@/modules/app-store/updates-dialog'
import {AppsProvider} from '@/providers/apps'
import {AvailableAppsProvider, useAvailableApps} from '@/providers/available-apps'
import {useDiscoverQuery} from '@/routes/app-store/use-discover-query'
import {Button} from '@/shadcn-components/ui/button'
import {Separator} from '@/shadcn-components/ui/separator'
import {appStates, progressStates} from '@/trpc/trpc'

export default function AppStoreStory() {
	const allCategories = categoryishDescriptions.map((c) => c.id)

	return (
		<>
			<InstallButtonExamples />
			<div className='max-w-sm'>
				<AppStoreNav activeId='automation' allCategories={allCategories} />
				<AppStoreNav activeId='discover' allCategories={allCategories} />
				<AppStoreNav activeId='developer' allCategories={allCategories} />
			</div>

			<ErrorBoundary fallback={<GenericErrorText />}>
				<AppsProvider>
					<AvailableAppsProvider>
						<Inner />
					</AvailableAppsProvider>
				</AppsProvider>
			</ErrorBoundary>
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
	const demoUpdateProgress = useDemoInstallProgress()

	return (
		<div>
			<H3>Install Button</H3>
			<div className='flex flex-col items-end gap-1'>
				<ProgressButton
					variant={'destructive'}
					className='border-3 border [--progress-button-bg:blue] data-[progressing=true]:border-blue-500'
					size='xl'
					initial={{borderRadius: 10}}
					progress={demoUpdateProgress.progress}
					state={demoUpdateProgress.state}
					onClick={demoUpdateProgress.install}
				>
					progress button: {appStateToString(demoUpdateProgress.state)}
					{arrayIncludes(progressStates, demoUpdateProgress.state as string) && '...'}
				</ProgressButton>
				<InstallButton
					installSize='1.5GB'
					progress={progress}
					state={state}
					compatible={true}
					onInstallClick={install}
					onOpenClick={() => alert('foobar')}
				/>
				<Separator />
				{/* Loading state */}
				<InstallButton
					installSize='1.5GB'
					progress={demoUpdateProgress.progress}
					state='loading'
					compatible={true}
					onInstallClick={demoUpdateProgress.install}
					onOpenClick={() => alert('foobar')}
				/>
				{appStates.map((state) => (
					<div key={state}>
						{state}{' '}
						<InstallButton
							installSize='1.5GB'
							progress={50}
							state={state}
							compatible={true}
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
			<SelectDependenciesDialog
				appId='lightning'
				dependencies={[[{dependencyId: 'bitcoin', appId: 'bitcoin'}]]}
				open={open}
				onOpenChange={setOpen}
				onNext={() => {}}
			/>
		</>
	)
}

function InstallFirst2Example() {
	const [open, setOpen] = useState(false)
	return (
		<>
			<Button onClick={() => setOpen(true)}>Install Electrs App (show dialog only)</Button>
			<SelectDependenciesDialog
				appId='lightning'
				dependencies={[
					[{dependencyId: 'bitcoin', appId: 'bitcoin'}],
					[{dependencyId: 'lightning', appId: 'lightning'}],
				]}
				open={open}
				onOpenChange={setOpen}
				onNext={() => {}}
			/>
		</>
	)
}
