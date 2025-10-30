import {motion, Variant} from 'framer-motion'
import {useLocation} from 'react-router-dom'

import {useWidgets} from '@/hooks/use-widgets'
import {Widget} from '@/modules/widgets'
import {WidgetContainer} from '@/modules/widgets/shared/shared'
import {WidgetWrapper} from '@/modules/widgets/shared/widget-wrapper'
import {useApps} from '@/providers/apps'
import {trpcReact} from '@/trpc/trpc'

import {AppGrid} from './app-grid/app-grid'
import {AppIconConnected, AppLabel} from './app-icon'
import {Search} from './desktop-misc'
import {DockSpacer} from './dock'
import {Header} from './header'

export function DesktopContent({onSearchClick}: {onSearchClick?: () => void}) {
	const {pathname} = useLocation()

	const getQuery = trpcReact.user.get.useQuery()
	const name = getQuery.data?.name

	const {userApps, isLoading} = useApps()
	const widgets = useWidgets()

	if (isLoading || widgets.isLoading) return null
	if (!userApps) return null
	if (!name) return null

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
			initial={{opacity: 1}}
			transition={{duration: 0.15, ease: 'easeOut'}}
		>
			<div className='pt-6 md:pt-8' />
			<Header userName={name} />
			<div className='pt-6 md:pt-8' />
			<div className='flex w-full grow overflow-hidden'>
				<AppGrid
					widgets={widgets.selected.map((widget, i) => (
						<motion.div
							key={widget.id}
							layout
							initial={{
								opacity: 0,
							}}
							animate={{
								opacity: 1,
							}}
							exit={{
								opacity: 0,
							}}
							transition={{
								duration: 0.5,
								ease: 'easeInOut',
							}}
						>
							<WidgetWrapper
								// Get the app name from the endpoint
								label={widget.app.name}
							>
								{widget.app.state === 'ready' ? (
									<Widget appId={widget.app.id} config={widget} />
								) : (
									<WidgetContainer className='grid place-items-center text-13 text-white/50'>
										<AppLabel state={widget.app.state} />
									</WidgetContainer>
								)}
							</WidgetWrapper>
						</motion.div>
					))}
					apps={userApps.map((app, i) => (
						<motion.div
							key={app.id}
							layout
							initial={{
								opacity: 0,
								scale: 0.75,
							}}
							animate={{
								opacity: 1,
								scale: 1,
							}}
							exit={{
								opacity: 0,
								scale: 0.75,
							}}
							transition={{
								delay: (widgets.selected.length * 1.5 + i) * 0.01,
								duration: 0.2,
								ease: 'easeOut',
							}}
						>
							<AppIconConnected appId={app.id} />
						</motion.div>
					))}
				/>
			</div>
			<Search onClick={onSearchClick} />
			<div className='pt-6' />
			<DockSpacer />
		</motion.div>
	)
}
