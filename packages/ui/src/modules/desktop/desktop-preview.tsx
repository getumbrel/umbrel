import {useEffect, useState} from 'react'

import {useWidgets} from '@/hooks/use-widgets'
import {Widget} from '@/modules/widgets'
import {BackdropBlurVariantContext} from '@/modules/widgets/shared/backdrop-blur-context'
import {WidgetWrapper} from '@/modules/widgets/shared/widget-wrapper'
import {useApps} from '@/providers/apps'
import {Wallpaper} from '@/providers/wallpaper'
import {trpcReact} from '@/trpc/trpc'

import {AppGrid} from './app-grid/app-grid'
import {AppIcon} from './app-icon'
import {DockPreview} from './dock'
import {Header} from './header'

export function DesktopPreview() {
	const W = 1440
	const H = 850
	const scale = 0.18

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
			className='relative overflow-hidden rounded-5 duration-100 animate-in'
			style={{
				width: W * scale,
				height: H * scale,
				transform: `translateZ(0)`, // Force rounded border clipping in Safari
			}}
			// Tell screen readers to ignore this element
			aria-hidden='true'
			// Prevent browser from interacting with children
			ref={(node) => node && node.setAttribute('inert', '')}
		>
			<Wallpaper isPreview />
			<div
				className='shrink-0 origin-top-left'
				style={{
					transform: `scale3d(${scale}, ${scale}, 1)`,
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
								'flex h-full flex-col items-center justify-between overflow-hidden duration-300 animate-in fade-in'
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
	const {userApps, isLoading} = useApps()
	const {selected} = useWidgets()
	const getQuery = trpcReact.user.get.useQuery()
	const name = getQuery.data?.name

	if (isLoading) return null
	if (!userApps) return null
	if (!name) return null

	return (
		<BackdropBlurVariantContext.Provider value='default'>
			<div className='pt-12' />
			<Header userName={name} />
			<div className='pt-12' />
			<div className='flex w-full flex-grow overflow-hidden'>
				<AppGrid
					onlyFirstPage
					widgets={selected?.map((widget) => (
						<WidgetWrapper key={widget.id} label={widget.app.name}>
							<Widget appId={widget.app.id} config={widget} />
						</WidgetWrapper>
					))}
					apps={userApps.map((app) => (
						<AppIcon key={app.id} src={app.icon} label={app.name} onClick={() => alert(app.name)} />
					))}
				/>
			</div>
		</BackdropBlurVariantContext.Provider>
	)
}

export function DesktopPreviewFrame({children}: {children: React.ReactNode}) {
	const W = 1440
	const H = 850
	const scale = 0.18

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
			<div className='rounded-15 bg-[#0C0D0C] p-[9px]'>
				<div
					className='relative overflow-hidden rounded-5 duration-100 animate-in fade-in'
					style={{
						width: W * scale,
						height: H * scale,
						transform: `translateZ(0)`, // Force rounded border clipping in Safari
					}}
					// Tell screen readers to ignore this element
					aria-hidden='true'
					// Prevent browser from interacting with children
					ref={(node) => node && node.setAttribute('inert', '')}
				>
					{children}
				</div>
			</div>
		</div>
	)
}
