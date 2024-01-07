import {useMotionValue} from 'framer-motion'
import {useState} from 'react'
import {JSONTree} from 'react-json-tree'

import {InstallButton} from '@/components/install-button'
import {useAppInstall} from '@/hooks/use-app-install'
import {AppsProvider, useApps} from '@/hooks/use-apps'
import {useAvailableApps} from '@/hooks/use-available-apps'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {H2} from '@/layouts/stories'
import {AppGrid} from '@/modules/desktop/app-grid/app-grid'
import {AppIcon} from '@/modules/desktop/app-icon'
import {DesktopPreview} from '@/modules/desktop/desktop-preview'
import {DockItem} from '@/modules/desktop/dock-item'
import {UninstallTheseFirstDialog} from '@/modules/desktop/uninstall-these-first-dialog'
import {Button} from '@/shadcn-components/ui/button'

export default function DesktopStory() {
	useUmbrelTitle('Desktop')

	return (
		<>
			<AppsProvider>
				<H2>Install Example</H2>
				<InstallExample />
				<H2>Uninstall Example</H2>
				<UninstallExample />
				<H2>App Icon</H2>
				<AppIconExamples />
				<H2>Desktop Preview</H2>
				<DesktopPreview />
				<H2>Dock</H2>
				<DockExample />
				<H2>App Grid</H2>
				<AppGridExamples />
				<AppsDump />
			</AppsProvider>
		</>
	)
}

function InstallExample() {
	const {install, uninstall, uninstallAll, state, progress} = useAppInstall('agora')

	return (
		<div>
			<Button onClick={install}>Install Agora</Button>
			<Button onClick={uninstall}>Uninstall Agora</Button>
			<Button onClick={uninstallAll}>Uninstall All</Button>
			<div>
				<InstallButton
					onInstallClick={install}
					onOpenClick={() => alert('open agora')}
					state={state}
					progress={progress}
				/>
			</div>
			<div>
				Install status:
				{/* <JSONTree data={installStatusQ.data} /> */}
				<JSONTree data={{state, progress}} />
			</div>
		</div>
	)
}

function UninstallExample() {
	const [open, setOpen] = useState(false)
	return (
		<>
			<Button onClick={() => setOpen(true)}>Uninstall Bitcoin App</Button>
			<UninstallTheseFirstDialog
				appId='bitcoin'
				toUninstallFirstIds={['lightning', 'mempool']}
				open={open}
				onOpenChange={setOpen}
			/>
		</>
	)
}

function AppIconExamples() {
	// const availableApps = useAvailableApps()
	// const iconSrc = availableApps.apps?.[0].icon
	// if (!iconSrc) return null

	const iconSrc = 'https://picsum.photos/200/200'

	return (
		<div className='flex flex-wrap gap-2'>
			<AppIcon appId='foobar' label={'foobar'} src={iconSrc} port={12345} state='ready' />
			<AppIcon appId='foobar' label={'foobar'} src={iconSrc} port={12345} state='installing' />
			<AppIcon appId='foobar' label={'foobar'} src={iconSrc} port={12345} state='offline' />
			<AppIcon appId='foobar' label={'foobar'} src={iconSrc} port={12345} state='uninstalling' />
			<AppIcon appId='foobar' label={'foobar'} src={iconSrc} port={12345} state='updating' />
		</div>
	)
}

function AppsDump() {
	const {apps, isLoading} = useAvailableApps()

	if (isLoading || !apps) return

	return (
		<div className='flex flex-col gap-4 p-4'>
			<H2>Apps dump</H2>
			<div className='flex flex-wrap items-center'>
				{apps.map((app) => (
					<div key={app.id} className='flex h-28 w-28 flex-col items-center gap-2.5 p-3 pb-0'>
						<img alt={app.name} src={app.icon} width={64} height={64} className='rounded-15' />
						<span className='max-w-full truncate text-13'>{app.name}</span>
					</div>
				))}
			</div>
		</div>
	)
}

function DockExample() {
	const mouseX = useMotionValue(Infinity)

	return (
		<>
			<div className='flex items-center gap-4 rounded-15 bg-neutral-800 p-3'>
				<DockItem bg='/dock/home.png' mouseX={mouseX} notificationCount={0} />
				<DockItem bg='/dock/home.png' mouseX={mouseX} notificationCount={1} />
				<DockItem bg='/dock/home.png' mouseX={mouseX} notificationCount={2} />
				<DockItem bg='/dock/home.png' mouseX={mouseX} notificationCount={99} />
				<DockItem bg='/dock/home.png' mouseX={mouseX} notificationCount={999} />
				<H2>Interactive:</H2>
				<DockItemInteractive />
				<H2>No bg:</H2>
				<DockItem mouseX={mouseX} notificationCount={2} />
			</div>
		</>
	)
}

function DockItemInteractive() {
	const [open, setOpen] = useState(false)
	const mouseX = useMotionValue(-1000)

	return <DockItem bg='/dock/home.png' mouseX={mouseX} open={open} onClick={() => setOpen(true)} />
}

function AppGridExamples() {
	const {userApps} = useApps()
	if (!userApps) return null

	return (
		<>
			<div>No apps</div>
			<AppGridWrapper>
				<AppGrid />
			</AppGridWrapper>
			<div>1 app</div>
			<AppGridWrapper>
				<AppGrid
					apps={userApps.slice(0, 1).map((app) => (
						<AppIcon key={app.id} appId={app.id} src={app.icon} label={app.name} port={app.port} />
					))}
				/>
			</AppGridWrapper>
			<div>3 apps</div>
			<AppGridWrapper>
				<AppGrid
					apps={userApps.slice(0, 3).map((app) => (
						<AppIcon key={app.id} appId={app.id} src={app.icon} label={app.name} port={app.port} />
					))}
				/>
			</AppGridWrapper>
			<div>All apps</div>
			<AppGridWrapper>
				<AppGrid
					apps={userApps.map((app) => (
						<AppIcon key={app.id} appId={app.id} src={app.icon} label={app.name} port={app.port} />
					))}
				/>
			</AppGridWrapper>
		</>
	)
}

function AppGridWrapper({children}: {children: React.ReactNode}) {
	return <div className='h-[400px] w-full overflow-hidden bg-neutral-900'>{children}</div>
}
