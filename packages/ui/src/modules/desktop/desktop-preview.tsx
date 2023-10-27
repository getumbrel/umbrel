import {useEffect, useState} from 'react'
import {useLocalStorage} from 'react-use'

import {useInstalledApps} from '@/hooks/use-installed-apps'
import {useWallpaper} from '@/modules/desktop/wallpaper-context'

import {AppGrid} from './app-grid/app-grid'
import {AppIcon} from './app-icon'
import {Header} from './desktop-misc'
import {DockPreview} from './dock'
import {WidgetConfig, widgetConfigToWidget, WidgetWrapper} from './widgets'

export function DesktopPreview() {
	const W = 1440
	const H = 850
	const scale = 0.18
	const {wallpaper} = useWallpaper()

	// Delay mounting for performace
	const [show, setShow] = useState(false)
	useEffect(() => {
		const id = setTimeout(() => {
			setShow(true)
		}, 300)

		return () => {
			clearTimeout(id)
		}
	}, [])

	return (
		<div
			className='relative overflow-hidden rounded-5 bg-cover bg-center duration-100 animate-in fade-in'
			style={{
				width: W * scale,
				height: H * scale,
				backgroundImage: `url(${wallpaper.url})`,
			}}
			// Tell screen readers to ignore this element
			aria-hidden='true'
			// Prevent browser from interacting with children
			ref={(node) => node && node.setAttribute('inert', '')}
		>
			<div
				className='shrink-0 origin-top-left'
				style={{
					transform: `scale(${scale})`,
				}}
			>
				<div
					className='relative'
					style={{
						width: W,
						height: H,
					}}
				>
					{show && (
						<div
							className={
								'flex h-full flex-col items-center justify-between overflow-hidden duration-1000 animate-in fade-in'
							}
						>
							<DesktopContent />
							<div className='pb-5'>
								<DockPreview />
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	)
}

function DesktopContent() {
	const {allAppsKeyed, installedApps, isLoading} = useInstalledApps()
	const [selectedWidgets] = useLocalStorage<WidgetConfig[]>('selected-widgets', [])

	if (isLoading) return

	return (
		<>
			<div className='pt-12' />
			<Header />
			<div className='pt-12' />
			<div className='flex w-full flex-grow overflow-hidden'>
				<AppGrid
					widgets={selectedWidgets?.map((widget) => (
						<WidgetWrapper
							key={widget.endpoint}
							// Get the app name from the endpoint
							// TODO: should get app name from the widget config
							label={allAppsKeyed[widget.endpoint.split('/')[2]]?.name}
						>
							{widgetConfigToWidget(widget)}
						</WidgetWrapper>
					))}
					apps={installedApps.map((app) => (
						<AppIcon key={app.id} appId={app.id} src={app.icon} label={app.name} />
					))}
				/>
			</div>
		</>
	)
}

export function DesktopPreviewFrame({children}: {children: React.ReactNode}) {
	return (
		<div
			className='max-h-fit max-w-fit rounded-15 p-[1px]'
			style={{
				backgroundImage:
					'linear-gradient(135deg, rgba(237, 237, 237, 0.42) 0.13%, rgba(173, 173, 173, 0.12) 26.95%, rgba(0, 0, 0, 0.00) 81.15%, #404040 105.24%)',
				filter:
					'drop-shadow(0px 0px 0.6332594156265259px rgba(0, 21, 64, 0.14)) drop-shadow(0px 0.6332594156265259px 1.2665188312530518px rgba(0, 21, 64, 0.05))',
			}}
		>
			<div className='rounded-15 bg-[#0C0D0C] p-[9px]'>{children}</div>
		</div>
	)
}
