import {H2} from '@stories/components'
import {useMotionValue} from 'framer-motion'
import {useState} from 'react'
import {JSONTree} from 'react-json-tree'

import {InstallButton} from '@/components/install-button'
import {toast} from '@/components/ui/toast'
import {useAppInstall, useUninstallAllApps} from '@/hooks/use-app-install'
import {AppGrid} from '@/modules/desktop/app-grid/app-grid'
import {AppIcon} from '@/modules/desktop/app-icon'
import {DesktopPreview} from '@/modules/desktop/desktop-preview'
import {DockItem} from '@/modules/desktop/dock-item'
import {UninstallTheseFirstDialog} from '@/modules/desktop/uninstall-these-first-dialog'
import {AppsProvider} from '@/providers/apps'
import {useAvailableApps} from '@/providers/available-apps'
import {brandHslLighter, brandHslLightest, wallpapers} from '@/providers/wallpaper'
import {Button} from '@/shadcn-components/ui/button'
import {appStates} from '@/trpc/trpc'

export default function DesktopStory() {
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
				<H2>Wallpaper</H2>
				<WallpaperExamples />
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
	const {install, uninstall, state, progress} = useAppInstall('agora')
	const uninstallAll = useUninstallAllApps()

	return (
		<div>
			<Button onClick={() => install()}>Install Agora</Button>
			<Button onClick={uninstall}>Uninstall Agora</Button>
			<Button onClick={uninstallAll}>Uninstall All</Button>
			<div>
				<InstallButton
					onInstallClick={install}
					onOpenClick={() => alert('open agora')}
					state={state}
					compatible={true}
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
			{appStates.map((state) => (
				<div key={state}>
					{state}
					<AppIcon label={'foobar'} src={iconSrc} state={state} progress={50} onClick={() => toast(state)} />
				</div>
			))}
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
	const iconSize = 50
	const iconSizeZoomed = 80

	return (
		<>
			<div className='flex items-center gap-4 rounded-15 bg-neutral-800 p-3'>
				<DockItem
					bg='/figma-exports/dock-home.png'
					mouseX={mouseX}
					notificationCount={0}
					iconSize={iconSize}
					iconSizeZoomed={iconSizeZoomed}
				/>
				<DockItem
					bg='/figma-exports/dock-home.png'
					mouseX={mouseX}
					notificationCount={1}
					iconSize={iconSize}
					iconSizeZoomed={iconSizeZoomed}
				/>
				<DockItem
					bg='/figma-exports/dock-home.png'
					mouseX={mouseX}
					notificationCount={2}
					iconSize={iconSize}
					iconSizeZoomed={iconSizeZoomed}
				/>
				<DockItem
					bg='/figma-exports/dock-home.png'
					mouseX={mouseX}
					notificationCount={99}
					iconSize={iconSize}
					iconSizeZoomed={iconSizeZoomed}
				/>
				<DockItem
					bg='/figma-exports/dock-home.png'
					mouseX={mouseX}
					notificationCount={999}
					iconSize={iconSize}
					iconSizeZoomed={iconSizeZoomed}
				/>
				<H2>Interactive:</H2>
				<DockItemInteractive />
				<H2>No bg:</H2>
				<DockItem mouseX={mouseX} notificationCount={2} iconSize={iconSize} iconSizeZoomed={iconSizeZoomed} />
			</div>
		</>
	)
}

function DockItemInteractive() {
	const [open, setOpen] = useState(false)
	const mouseX = useMotionValue(-1000)
	const iconSize = 50
	const iconSizeZoomed = 80

	return (
		<DockItem
			bg='/figma-exports/dock-home.png'
			mouseX={mouseX}
			open={open}
			onClick={() => setOpen(true)}
			iconSize={iconSize}
			iconSizeZoomed={iconSizeZoomed}
		/>
	)
}

function AppGridExamples() {
	const {apps, isLoading} = useAvailableApps()
	if (!apps || isLoading) return null

	const handleClick = () => alert('clicked')

	return (
		<>
			<div>No apps</div>
			<AppGridWrapper>
				<AppGrid />
			</AppGridWrapper>
			<div>1 app</div>
			<AppGridWrapper>
				<AppGrid
					apps={apps.slice(0, 1).map((app) => (
						<AppIcon key={app.id} src={app.icon} label={app.name} onClick={handleClick} />
					))}
				/>
			</AppGridWrapper>
			<div>3 apps</div>
			<AppGridWrapper>
				<AppGrid
					apps={apps.slice(0, 3).map((app) => (
						<AppIcon key={app.id} src={app.icon} label={app.name} onClick={handleClick} />
					))}
				/>
			</AppGridWrapper>
			<div>All apps</div>
			<AppGridWrapper>
				<AppGrid
					apps={apps.map((app) => (
						<AppIcon key={app.id} src={app.icon} label={app.name} onClick={handleClick} />
					))}
				/>
			</AppGridWrapper>
		</>
	)
}

function AppGridWrapper({children}: {children: React.ReactNode}) {
	return <div className='h-[400px] w-full overflow-hidden bg-neutral-900'>{children}</div>
}

function WallpaperExamples() {
	return (
		<div className='flex flex-wrap gap-2'>
			{wallpapers.map((w) => (
				<div key={w.id} className='relative'>
					<img src={w.url} alt={w.id} className='h-32' />
					<div className='absolute bottom-0 left-0 right-0 flex bg-black/50 p-2 backdrop-blur-md'>
						<div
							style={{
								backgroundColor: `hsl(${w.brandColorHsl})`,
							}}
							className='0 h-4 w-4'
						/>
						<div
							style={{
								backgroundColor: `hsl(${brandHslLighter(w.brandColorHsl)})`,
							}}
							className='0 h-4 w-4'
						/>
						<div
							style={{
								backgroundColor: `hsl(${brandHslLightest(w.brandColorHsl)})`,
							}}
							className='0 h-4 w-4'
						/>
					</div>
				</div>
			))}
		</div>
	)
}
