import {motion, Variant} from 'framer-motion'
import {useLocation, useNavigate} from 'react-router-dom'

import {useUserApps} from '@/hooks/use-user-apps'
import {useWidgets} from '@/hooks/use-widgets'

import {widgetConfigToWidget} from '../widgets'
import {WidgetWrapper} from '../widgets/shared/widget-wrapper'
import {AppGrid} from './app-grid/app-grid'
import {AppIconConnected} from './app-icon'
import {Header, Search} from './desktop-misc'
import {DockSpacer} from './dock'

export function DesktopContent({onSearchClick}: {onSearchClick?: () => void}) {
	const {pathname} = useLocation()
	const navigate = useNavigate()

	const {allAppsKeyed, userApps, isLoading} = useUserApps()
	const widgets = useWidgets()

	if (isLoading) return null
	if (!userApps) return null
	if (userApps.length === 0 && pathname === '/') navigate('/install-first-app')

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
					widgets={widgets.selected.map((widget) => (
						<WidgetWrapper
							key={widget.endpoint}
							// Get the app name from the endpoint
							// TODO: should get app name from the widget config
							label={allAppsKeyed[widget.endpoint.split('/')[2]]?.name}
						>
							{widgetConfigToWidget(widget)}
						</WidgetWrapper>
					))}
					apps={userApps.map((app) => (
						// <motion.div
						// 	key={app.id}
						// 	layout
						// 	initial={{
						// 		opacity: 1,
						// 		scale: 0.8,
						// 	}}
						// 	animate={{
						// 		opacity: 1,
						// 		scale: 1,
						// 	}}
						// 	exit={{
						// 		opacity: 0,
						// 		scale: 0.5,
						// 	}}
						// 	transition={{
						// 		type: 'spring',
						// 		stiffness: 500,
						// 		damping: 30,
						// 	}}
						// >
						<AppIconConnected key={app.id} appId={app.id} />
						// </motion.div>
					))}
				/>
			</motion.div>
			<Search onClick={onSearchClick} />
			<div className='pt-6' />
			<DockSpacer />
		</motion.div>
	)
}
