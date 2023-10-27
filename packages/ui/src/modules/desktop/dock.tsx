import {motion, useMotionValue} from 'framer-motion'
import {useLocation} from 'react-router-dom'

import {systemAppsKeyed} from '@/hooks/use-installed-apps'
import {useQueryParams} from '@/hooks/use-query-params'
import {cn} from '@/shadcn-lib/utils'

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

	return (
		<>
			<motion.div
				initial={{y: 90}}
				animate={{y: 0}}
				exit={{y: 90}}
				transition={{delay: 0.3}}
				onPointerMove={(e) => e.pointerType === 'mouse' && mouseX.set(e.pageX)}
				onPointerLeave={() => mouseX.set(Infinity)}
				className={dockClass}
				style={{
					viewTransitionName: 'dock',
					height: DOCK_HEIGHT,
					paddingBottom: PADDING,
				}}
			>
				<DockItem open={pathname === '/'} bg={systemAppsKeyed['home'].icon} mouseX={mouseX} to='/' />
				<DockItem
					open={pathname === '/app-store'}
					bg={systemAppsKeyed['app-store'].icon}
					mouseX={mouseX}
					to='/app-store'
				/>
				<DockItem
					open={pathname === '/settings'}
					bg={systemAppsKeyed['settings'].icon}
					mouseX={mouseX}
					to='/settings'
					notificationCount={2}
				/>
				<DockDivider />
				<DockItem to={{search: addLinkSearchParams({dialog: 'logout'})}} bg='/dock/exit.png' mouseX={mouseX} />
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
			<DockItem bg='/dock/exit.png' mouseX={mouseX} />
		</div>
	)
}

export function DockSpacer({className}: {className?: string}) {
	return <div className={cn('w-full shrink-0', className)} style={{height: DOCK_HEIGHT + FROM_BOTTOM}} />
}

export function DockBottomPositioner({children}: {children: React.ReactNode}) {
	return (
		<div className='fixed bottom-0 left-1/2 z-30 -translate-x-1/2' style={{paddingBottom: FROM_BOTTOM}}>
			{children}
		</div>
	)
}

const dockClass = `mx-auto flex items-end gap-4 rounded-2xl bg-black/10 backdrop-blur-2xl px-3 shadow-dock shrink-0`

const DockDivider = () => (
	<div className='br grid w-1 place-items-center' style={{height: ICON_SIDE}}>
		<div className='h-7 border-r border-white/10' />
	</div>
)
