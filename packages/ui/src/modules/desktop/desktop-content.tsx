import {motion, Variant} from 'framer-motion'
import {useLocation} from 'react-router-dom'
import {useLocalStorage} from 'react-use'

import {useInstalledApps} from '@/hooks/use-installed-apps'

import {AppGrid} from './app-grid/app-grid'
import {AppIcon} from './app-icon'
import {AppGridGradientMasking, Header, Search} from './desktop-misc'
import {DockSpacer} from './dock'
import {WidgetConfig, widgetConfigToWidget, WidgetWrapper} from './widgets'

export function DesktopContent() {
	const {pathname} = useLocation()

	const {allAppsKeyed, installedApps, isLoading} = useInstalledApps()
	const [selectedWidgets] = useLocalStorage<WidgetConfig[]>('selected-widgets', [])

	if (isLoading) return

	type DesktopVariant = 'default' | 'edit-widgets' | 'overlayed'
	const variant: DesktopVariant =
		pathname === '/' ? 'default' : pathname.startsWith('/edit-widgets') ? 'edit-widgets' : 'overlayed'

	const variants: Record<DesktopVariant, Variant> = {
		default: {
			opacity: 1,
		},
		'edit-widgets': {
			translateY: -20,
			opacity: 0,
		},
		overlayed: {
			translateY: 0,
			opacity: 0,
			transition: {
				duration: 0,
			},
		},
	}

	return (
		<>
			<motion.div
				className='flex h-full w-full select-none flex-col items-center justify-between'
				variants={variants}
				animate={variant}
				initial={{opacity: 0}}
				transition={{duration: 0.15, ease: 'easeOut'}}
			>
				<div className='pt-6 md:pt-12' />
				<Header />
				<div className='pt-6 md:pt-12' />
				<motion.div
					className='flex w-full grow overflow-hidden'
					initial={{opacity: 0, scale: 1}}
					animate={{opacity: 1, scale: 1}}
					exit={{opacity: 0, scale: 1}}
					transition={variant === 'overlayed' ? {duration: 0} : {duration: 0.2, ease: 'easeOut', delay: 0.2}}
				>
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
				</motion.div>
				<Search />
				<div className='pt-6' />
				<DockSpacer />
			</motion.div>
			{/* NOTE:
        Keep `AppGridGradientMasking` here rather than deeper down in component heirarchy to avoid being animated up and down when widget selector opens and closes.
      */}
			<AppGridGradientMasking />
		</>
	)
}
