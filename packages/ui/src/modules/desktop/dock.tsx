import {motion, useMotionValue} from 'framer-motion'
import React, {Suspense} from 'react'
import {useLocation} from 'react-router-dom'

import {useAppsWithUpdates} from '@/hooks/use-apps-with-updates'
import {useQueryParams} from '@/hooks/use-query-params'
import {useSettingsNotificationCount} from '@/hooks/use-settings-notification-count'
import {systemAppsKeyed} from '@/providers/apps'
import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

import {DockItem} from './dock-item'
import {LogoutDialog} from './logout-dialog'

const LiveUsageDialog = React.lazy(() => import('@/routes/live-usage'))

export const ICON_SIDE = 50
export const ICON_SIDE_ZOOMED = 80
const PADDING = 12
export const DOCK_HEIGHT = ICON_SIDE + PADDING * 2
export const FROM_BOTTOM = 10

export function Dock() {
	const {pathname} = useLocation()
	const {addLinkSearchParams} = useQueryParams()
	const mouseX = useMotionValue(Infinity)
	const settingsNotificationCount = useSettingsNotificationCount()
	const {appsWithUpdates} = useAppsWithUpdates()

	const appUpdateCount = appsWithUpdates.length

	return (
		<>
			<motion.div
				initial={{y: 0, opacity: 0}}
				animate={{y: 0, opacity: 1}}
				onPointerMove={(e) => e.pointerType === 'mouse' && mouseX.set(e.pageX)}
				onPointerLeave={() => mouseX.set(Infinity)}
				className={dockClass}
				style={{
					height: DOCK_HEIGHT,
					paddingBottom: PADDING,
				}}
			>
				<DockItem
					to={systemAppsKeyed['UMBREL_home'].systemAppTo}
					open={pathname === '/'}
					bg={systemAppsKeyed['UMBREL_home'].icon}
					mouseX={mouseX}
				/>
				<DockItem
					to={systemAppsKeyed['UMBREL_app-store'].systemAppTo}
					open={pathname.startsWith(systemAppsKeyed['UMBREL_app-store'].systemAppTo)}
					bg={systemAppsKeyed['UMBREL_app-store'].icon}
					notificationCount={appUpdateCount}
					mouseX={mouseX}
				/>
				<DockItem
					to={systemAppsKeyed['UMBREL_settings'].systemAppTo}
					open={pathname.startsWith(systemAppsKeyed['UMBREL_settings'].systemAppTo)}
					bg={systemAppsKeyed['UMBREL_settings'].icon}
					notificationCount={settingsNotificationCount}
					mouseX={mouseX}
				/>
				<DockItem
					to={{search: addLinkSearchParams({dialog: 'live-usage'})}}
					open={pathname.startsWith(systemAppsKeyed['UMBREL_live-usage'].systemAppTo)}
					bg={systemAppsKeyed['UMBREL_live-usage'].icon}
					mouseX={mouseX}
				/>
				<DockItem
					to={systemAppsKeyed['UMBREL_widgets'].systemAppTo}
					open={pathname.startsWith(systemAppsKeyed['UMBREL_widgets'].systemAppTo)}
					bg={systemAppsKeyed['UMBREL_widgets'].icon}
					mouseX={mouseX}
				/>
			</motion.div>
			<LogoutDialog />
			<Suspense>
				<LiveUsageDialog />
			</Suspense>
		</>
	)
}

export function DockPreview() {
	const mouseX = useMotionValue(Infinity)

	return (
		<div
			className={dockPreviewClass}
			style={{
				height: DOCK_HEIGHT,
				paddingBottom: PADDING,
			}}
		>
			<DockItem bg={systemAppsKeyed['UMBREL_home'].icon} mouseX={mouseX} />
			<DockItem bg={systemAppsKeyed['UMBREL_app-store'].icon} mouseX={mouseX} />
			<DockItem bg={systemAppsKeyed['UMBREL_settings'].icon} mouseX={mouseX} />
			<DockDivider />
			<DockItem bg={systemAppsKeyed['UMBREL_live-usage'].icon} mouseX={mouseX} />
			<DockItem bg={systemAppsKeyed['UMBREL_widgets'].icon} mouseX={mouseX} />
		</div>
	)
}

export function DockSpacer({className}: {className?: string}) {
	return <div className={cn('w-full shrink-0', className)} style={{height: DOCK_HEIGHT + FROM_BOTTOM}} />
}

export function DockBottomPositioner({children}: {children: React.ReactNode}) {
	return (
		<div className='fixed bottom-0 left-1/2 z-50 -translate-x-1/2' style={{paddingBottom: FROM_BOTTOM}}>
			{children}
		</div>
	)
}

const dockClass = tw`mx-auto flex items-end gap-4 rounded-2xl bg-black/10 contrast-more:bg-neutral-700 backdrop-blur-2xl contrast-more:backdrop-blur-none px-3 shadow-dock shrink-0 will-change-transform transform-gpu border-hpx border-white/10`
const dockPreviewClass = tw`mx-auto flex items-end gap-4 rounded-2xl bg-neutral-900/80 px-3 shadow-dock shrink-0 border-hpx border-white/10`

const DockDivider = () => (
	<div className='br grid w-1 place-items-center' style={{height: ICON_SIDE}}>
		<div className='h-7 border-r border-white/10' />
	</div>
)
