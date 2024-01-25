import {motion, useMotionValue} from 'framer-motion'
import {useLocation} from 'react-router-dom'

import {systemAppsKeyed} from '@/hooks/use-apps'
import {useAppsWithUpdates} from '@/hooks/use-apps-with-updates'
import {useQueryParams} from '@/hooks/use-query-params'
import {useSettingsNotificationCount} from '@/hooks/use-settings-notification-count'
import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

import {DockItem} from './dock-item'
import {LogoutDialog} from './logout-dialog'

export const ICON_SIDE = 50
export const ICON_SIDE_ZOOMED = 80
const PADDING = 12
export const DOCK_HEIGHT = ICON_SIDE + PADDING * 2
export const FROM_BOTTOM = 10

export function Dock() {
	const {addLinkSearchParams} = useQueryParams()
	const {pathname} = useLocation()
	const mouseX = useMotionValue(Infinity)
	const settingsNotificationCount = useSettingsNotificationCount()
	const {appsWithUpdates} = useAppsWithUpdates()

	const appUpdateCount = appsWithUpdates.length

	return (
		<>
			<motion.div
				initial={{y: 90}}
				animate={{y: 0}}
				exit={{y: 90}}
				transition={{delay: 0.8}}
				onPointerMove={(e) => e.pointerType === 'mouse' && mouseX.set(e.pageX)}
				onPointerLeave={() => mouseX.set(Infinity)}
				className={dockClass}
				style={{
					height: DOCK_HEIGHT,
					paddingBottom: PADDING,
				}}
			>
				<DockItem
					to={systemAppsKeyed['home'].systemAppTo}
					open={pathname === '/' || pathname === '/install-first-app'}
					bg={systemAppsKeyed['home'].icon}
					mouseX={mouseX}
				/>
				<DockItem
					to={systemAppsKeyed['app-store'].systemAppTo}
					open={pathname.startsWith(systemAppsKeyed['app-store'].systemAppTo)}
					bg={systemAppsKeyed['app-store'].icon}
					notificationCount={appUpdateCount}
					mouseX={mouseX}
				/>
				<DockItem
					// to={{pathname: '/settings', search: addLinkSearchParams({dialog: 'live-usage'})}}
					to={systemAppsKeyed['settings'].systemAppTo}
					open={pathname.startsWith(systemAppsKeyed['settings'].systemAppTo)}
					bg={systemAppsKeyed['settings'].icon}
					notificationCount={settingsNotificationCount}
					mouseX={mouseX}
				/>
				<DockItem
					// to={systemAppsKeyed['live-usage'].systemAppTo}
					to={{pathname: '/settings', search: addLinkSearchParams({dialog: 'live-usage'})}}
					open={pathname.startsWith(systemAppsKeyed['live-usage'].systemAppTo)}
					bg={systemAppsKeyed['live-usage'].icon}
					mouseX={mouseX}
				/>
				<DockItem
					to={systemAppsKeyed['widgets'].systemAppTo}
					open={pathname.startsWith(systemAppsKeyed['widgets'].systemAppTo)}
					bg={systemAppsKeyed['widgets'].icon}
					mouseX={mouseX}
				/>
				{/* <DockDivider /> */}
				{/* <DockItem to={{search: addLinkSearchParams({dialog: 'logout'})}} bg='/dock/exit.png' mouseX={mouseX} /> */}
			</motion.div>
			<LogoutDialog />
		</>
	)
}

export function DockPreview() {
	const mouseX = useMotionValue(Infinity)

	return (
		<div
			className={dockClass}
			style={{
				height: DOCK_HEIGHT,
				paddingBottom: PADDING,
			}}
		>
			<DockItem bg={systemAppsKeyed['home'].icon} mouseX={mouseX} />
			<DockItem bg={systemAppsKeyed['app-store'].icon} mouseX={mouseX} />
			<DockItem bg={systemAppsKeyed['settings'].icon} mouseX={mouseX} />
			<DockDivider />
			<DockItem bg={systemAppsKeyed['live-usage'].icon} mouseX={mouseX} />
			<DockItem bg={systemAppsKeyed['widgets'].icon} mouseX={mouseX} />
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

const DockDivider = () => (
	<div className='br grid w-1 place-items-center' style={{height: ICON_SIDE}}>
		<div className='h-7 border-r border-white/10' />
	</div>
)
