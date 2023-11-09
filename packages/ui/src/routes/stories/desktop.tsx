import {useMotionValue} from 'framer-motion'
import {useState} from 'react'

import {InstalledAppsProvider, useInstalledApps} from '@/hooks/use-installed-apps'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {H2} from '@/layouts/stories'
import {AppGrid} from '@/modules/desktop/app-grid/app-grid'
import {AppIcon} from '@/modules/desktop/app-icon'
import {DesktopPreview} from '@/modules/desktop/desktop-preview'
import {DockItem} from '@/modules/desktop/dock-item'
import {
	ActionsWidget,
	BackdropBlurVariantContext,
	FourUpWidget,
	NotificationsWidget,
	ProgressWidget,
	StatWithButtonsWidget,
	ThreeUpWidget,
} from '@/modules/desktop/widgets'
import {TablerIcon} from '@/modules/desktop/widgets/tabler-icon'
import {Input} from '@/shadcn-components/ui/input'

export function DesktopStory() {
	useUmbrelTitle('Desktop')

	return (
		<>
			<H2>Desktop Preview</H2>
			<InstalledAppsProvider>
				<DesktopPreview />
			</InstalledAppsProvider>
			<H2>Dock</H2>
			<DockExample />
			<H2>Widgets</H2>
			<WidgetExamples />
			<H2>App Grid</H2>
			<InstalledAppsProvider>
				<AppGridExamples />
				<AppsDump />
			</InstalledAppsProvider>
		</>
	)
}

function AppsDump() {
	const {installedApps, isLoading} = useInstalledApps()

	if (isLoading || !installedApps) return

	return (
		<div className='flex flex-col gap-4 p-4'>
			<H2>Apps dump</H2>
			<div className='flex flex-wrap items-center'>
				{installedApps.map((app) => (
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

function WidgetExamples() {
	const [iconName, setIconName] = useState('cpu')

	return (
		<div>
			<div className='p-6'>
				<Input value={iconName} onValueChange={setIconName} />
				<TablerIcon iconName={iconName} />
			</div>
			<BackdropBlurVariantContext.Provider value='default'>
				<main className='flex flex-wrap gap-6 overflow-hidden bg-cover bg-center p-6'>
					{/* <Widget
          title="Blockchain sync"
          value="86.92%"
          progress={0.8692}
          label="Bitcoin Node"
          withBackdropBlur
        />
        <Widget
          title="Storage"
          value="256 GB"
          valueSub="/ 2 TB"
          progress={(256 / 1024) * 2}
          progressLabel="1.75 TB left"
          label="Settings"
          withBackdropBlur
        /> */}
					<div className='w-full'>Settings</div>
					<ProgressWidget
						title='Storage'
						value='256 GB'
						valueSub='/ 2 TB'
						progressLabel='1.75 TB left'
						progress={0.25}
					/>
					<ProgressWidget
						title='Memory'
						value='5.8 GB'
						valueSub='/ 16 GB'
						progressLabel='11.4 GB left'
						progress={0.3625}
					/>
					<ThreeUpWidget />
					<div className='w-full'>Bitcoin</div>
					<ProgressWidget title='Blockchain sync' value='86.92%' progress={0.8692} />
					<StatWithButtonsWidget title='Bitcoin Wallet' value='1,845,893' valueSub='sats' />
					<FourUpWidget />
					<div className='w-full'>Nostr</div>
					<ActionsWidget />
					<NotificationsWidget />
				</main>
			</BackdropBlurVariantContext.Provider>
		</div>
	)
}

function AppGridExamples() {
	const {installedApps} = useInstalledApps()
	if (!installedApps) return null

	return (
		<>
			<div>No apps</div>
			<AppGridWrapper>
				<AppGrid />
			</AppGridWrapper>
			<div>1 app</div>
			<AppGridWrapper>
				<AppGrid
					apps={installedApps.slice(0, 1).map((app) => (
						<AppIcon key={app.id} appId={app.id} src={app.icon} label={app.name} port={app.port} />
					))}
				/>
			</AppGridWrapper>
			<div>3 apps</div>
			<AppGridWrapper>
				<AppGrid
					apps={installedApps.slice(0, 3).map((app) => (
						<AppIcon key={app.id} appId={app.id} src={app.icon} label={app.name} port={app.port} />
					))}
				/>
			</AppGridWrapper>
			<div>All apps</div>
			<AppGridWrapper>
				<AppGrid
					apps={installedApps.map((app) => (
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
