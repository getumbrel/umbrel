import {useEffect, useState} from 'react'

import {FadeInImg} from '@/components/ui/fade-in-img'
import UmbrelLogo from '@/components/umbrel-logo'
import {useWidgets} from '@/hooks/use-widgets'
import {cn} from '@/lib/utils'
import {greetingMessage} from '@/modules/desktop/greeting-message'
import {WidgetType} from '@/modules/widgets/shared/constants'
import {systemAppsKeyed, useApps} from '@/providers/apps'
import {useWallpaper, WallpaperId} from '@/providers/wallpaper'
import {trpcReact} from '@/trpc/trpc'
import {tw} from '@/utils/tw'

export function DesktopPreviewConnected() {
	const wallpaper = useWallpaper()

	const getQuery = trpcReact.user.get.useQuery()
	const name = getQuery.data?.name

	const {userApps, isLoading} = useApps()
	const widgets = useWidgets()

	if (isLoading || widgets.isLoading) return null
	if (!userApps) return null
	if (!name) return null

	return (
		<DesktopPreview
			key={wallpaper.wallpaper.id}
			wallpaperId={wallpaper.wallpaper.id}
			userName={name}
			widgets={widgets.selected}
			apps={userApps}
		/>
	)
}

export function DesktopPreview({
	wallpaperId,
	userName,
	widgets,
	apps,
}: {
	wallpaperId?: WallpaperId
	userName: string
	// TODO: in the future, we might do something with the widget type and display a skeleton
	widgets?: {id: string; type: WidgetType; app: {name: string}}[]
	apps?: {name: string; icon: string}[]
}) {
	const appsPerRow = 6
	const appWidth = 28
	const appHeight = 22
	const appRows = widgets && widgets.length > 0 ? 2 : 3

	const widgetWidth = appWidth * 2
	const widgetHeight = appHeight * 1.4

	// Delay mounting for performance
	const [show, setShow] = useState(false)
	useEffect(() => {
		const id = setTimeout(() => setShow(true), 300)
		return () => clearTimeout(id)
	}, [])

	return (
		<div>
			{wallpaperId && (
				<FadeInImg
					key={wallpaperId}
					src={`/assets/wallpapers/generated-small/${wallpaperId}.jpg`}
					className='absolute h-full w-full object-cover object-center'
					style={{
						animation: 'animate-unblur 0.7s',
					}}
				/>
			)}
			{/* <Wallpaper isPreview /> */}
			{show && (
				<div className='absolute inset-0 flex animate-in flex-col items-center duration-700 fade-in'>
					<div className='h-2.5 flex-1' />
					<Header userName={userName} />
					<div className='h-1 flex-1' />
					{/* <div className='flex-1'></div> */}
					{widgets && widgets?.length > 0 && (
						<>
							<div className='flex items-center'>
								{widgets?.slice(0, 3)?.map((widget, i) => (
									<div
										key={i}
										style={{
											width: widgetWidth,
											height: widgetHeight,
										}}
										className={cn('flex flex-col px-1', 'animate-in delay-100 duration-200 fill-mode-both fade-in')}
									>
										<div className='w-full flex-1 shrink-0 rounded-3 border-hpx border-white/5 bg-neutral-900/70' />
										{/* <div className='origin-top-left scale-[.15]'>
											<LoadingWidget type={widget.type} />
										</div> */}
										<AppLabel>{widget.app.name}</AppLabel>
									</div>
								))}
							</div>
							<div className='h-1' />
						</>
					)}
					<div
						className='grid shrink-0 grid-cols-6 content-start overflow-hidden'
						style={{
							height: appHeight * appRows,
							width: appWidth * appsPerRow,
						}}
					>
						{apps?.map((app, i) => (
							<div
								key={app.name}
								style={{width: appWidth, height: appHeight, animationDelay: `${i * 10 + 100}ms`}}
								className={cn('grid place-items-center', 'animate-in duration-200 fill-mode-both zoom-in-50 fade-in')}
							>
								<div className='flex w-full min-w-0 flex-col items-center'>
									<div className='overflow-hidden rounded-3 bg-white/20'>
										<FadeInImg src={app.icon} className='h-3 w-3' />
									</div>
									<AppLabel>{app.name}</AppLabel>
								</div>
							</div>
						))}
					</div>
					<div className='h-1 flex-1' />
					<div className={dockPreviewClass}>
						<DockItemPreview icon={systemAppsKeyed['UMBREL_home'].icon} />
						<DockItemPreview icon={systemAppsKeyed['UMBREL_app-store'].icon} />
						<DockItemPreview icon={systemAppsKeyed['UMBREL_files'].icon} />
						<DockItemPreview icon={systemAppsKeyed['UMBREL_settings'].icon} />
						{/* <div className='border-r border-white/10' /> */}
						<DockItemPreview icon={systemAppsKeyed['UMBREL_live-usage'].icon} />
						<DockItemPreview icon={systemAppsKeyed['UMBREL_widgets'].icon} />
					</div>
					<div className='h-[2px]' />
				</div>
			)}
		</div>
	)
}

function AppLabel({children}: {children: string}) {
	return <div className='mt-[1px] w-full truncate text-center text-[2px] tracking-1'>{children}</div>
}

function DockItemPreview({icon}: {icon: string}) {
	return <FadeInImg src={icon} className='h-3 w-3' />
}

const dockPreviewClass = tw`mx-auto animate-in slide-in-from-bottom-2 flex gap-1 rounded-5 bg-neutral-900/70 p-[3px] shrink-0 border-hpx border-white/10`

function Header({userName}: {userName: string}) {
	return (
		<div className='flex animate-in flex-col items-center duration-300 slide-in-from-bottom-2'>
			<UmbrelLogo className='w-[20px]' />
			<div className='text-center text-[9px] font-bold'>{greetingMessage(userName)}</div>
		</div>
	)
}
