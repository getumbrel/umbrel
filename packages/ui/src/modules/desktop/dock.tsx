import {motion, useMotionValue} from 'framer-motion'
import React, {Suspense} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {useLocation} from 'react-router-dom'

import {useAppsWithUpdates} from '@/hooks/use-apps-with-updates'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useQueryParams} from '@/hooks/use-query-params'
import {useSettingsNotificationCount} from '@/hooks/use-settings-notification-count'
import {systemAppsKeyed} from '@/providers/apps'
import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

import {DockItem} from './dock-item'
import {LogoutDialog} from './logout-dialog'

const LiveUsageDialog = React.lazy(() => import('@/routes/live-usage'))
const WhatsNewModal = React.lazy(() => import('@/routes/whats-new-modal').then((m) => ({default: m.WhatsNewModal})))

const DOCK_BOTTOM_PADDING_PX = 10

const DOCK_DIMENSIONS_PX = {
	preview: {
		iconSize: 50,
		iconSizeZoomed: 80,
		padding: 12,
	},
	desktop: {
		iconSize: 50,
		iconSizeZoomed: 80,
		padding: 12,
	},
	mobile: {
		iconSize: 48,
		iconSizeZoomed: 60,
		padding: 8,
	},
} as const

type DockDimensionsPx = {
	iconSize: number
	iconSizeZoomed: number
	padding: number
	dockHeight: number
}

function useDockDimensions(options?: {isPreview?: boolean}): DockDimensionsPx {
	const isMobile = useIsMobile()

	if (options?.isPreview) {
		const {iconSize, iconSizeZoomed, padding} = DOCK_DIMENSIONS_PX.preview
		return {iconSize, iconSizeZoomed, padding, dockHeight: iconSize + padding * 2}
	}

	const dimensions = isMobile ? DOCK_DIMENSIONS_PX.mobile : DOCK_DIMENSIONS_PX.desktop
	const {iconSize, iconSizeZoomed, padding} = dimensions
	return {iconSize, iconSizeZoomed, padding, dockHeight: iconSize + padding * 2}
}

export function Dock() {
	const {pathname} = useLocation()
	const {addLinkSearchParams} = useQueryParams()
	const mouseX = useMotionValue(Infinity)
	const settingsNotificationCount = useSettingsNotificationCount()
	const {appsWithUpdates} = useAppsWithUpdates()
	const isMobile = useIsMobile()
	const {iconSize, iconSizeZoomed, padding, dockHeight} = useDockDimensions()

	const appUpdateCount = appsWithUpdates.length

	// TODO: THIS IS A HACK
	// We need a better approach to track the last visited path (possibly scroll position too?)
	// inside every page. We do this right now for the File app because it's has the most
	// UX-advantage (eg. user accidentally clicking close while they're in a deeply nested path)
	const lastFilesPath = sessionStorage.getItem('lastFilesPath')

	return (
		<>
			<motion.div
				initial={{translateY: 80, opacity: 0}}
				animate={{translateY: 0, opacity: 1}}
				transition={{type: 'spring', stiffness: 200, damping: 20, delay: 0.2, duration: 0.2}}
				onPointerMove={(e) => e.pointerType === 'mouse' && mouseX.set(e.pageX)}
				onPointerLeave={() => mouseX.set(Infinity)}
				className={cn(dockClass, isMobile && 'gap-2')}
				style={{
					height: dockHeight,
					paddingBottom: padding,
				}}
			>
				<DockItem
					iconSize={iconSize}
					iconSizeZoomed={iconSizeZoomed}
					to={systemAppsKeyed['UMBREL_home'].systemAppTo}
					open={pathname === '/'}
					bg={systemAppsKeyed['UMBREL_home'].icon}
					mouseX={mouseX}
				/>
				<DockItem
					iconSize={iconSize}
					iconSizeZoomed={iconSizeZoomed}
					to={systemAppsKeyed['UMBREL_app-store'].systemAppTo}
					open={pathname.startsWith(systemAppsKeyed['UMBREL_app-store'].systemAppTo)}
					bg={systemAppsKeyed['UMBREL_app-store'].icon}
					notificationCount={appUpdateCount}
					mouseX={mouseX}
				/>
				<DockItem
					iconSize={iconSize}
					iconSizeZoomed={iconSizeZoomed}
					to={lastFilesPath || systemAppsKeyed['UMBREL_files'].systemAppTo}
					// TODO: This is hack, we should use the systemAppTo but currently systemAppTo is /files/Home
					// so this fails the check when the path is /files/Recents, /files/Trash, etc.
					// We need a proper redirect to /files/Home when the user navigates to /files
					open={pathname.startsWith('/files')}
					bg={systemAppsKeyed['UMBREL_files'].icon}
					mouseX={mouseX}
				/>
				<DockItem
					iconSize={iconSize}
					iconSizeZoomed={iconSizeZoomed}
					to={systemAppsKeyed['UMBREL_settings'].systemAppTo}
					open={pathname.startsWith(systemAppsKeyed['UMBREL_settings'].systemAppTo)}
					bg={systemAppsKeyed['UMBREL_settings'].icon}
					notificationCount={settingsNotificationCount}
					mouseX={mouseX}
				/>
				<DockItem
					iconSize={iconSize}
					iconSizeZoomed={iconSizeZoomed}
					to={{search: addLinkSearchParams({dialog: 'live-usage'})}}
					open={pathname.startsWith(systemAppsKeyed['UMBREL_live-usage'].systemAppTo)}
					bg={systemAppsKeyed['UMBREL_live-usage'].icon}
					mouseX={mouseX}
				/>
				<DockItem
					iconSize={iconSize}
					iconSizeZoomed={iconSizeZoomed}
					to={systemAppsKeyed['UMBREL_widgets'].systemAppTo}
					open={pathname.startsWith(systemAppsKeyed['UMBREL_widgets'].systemAppTo)}
					bg={systemAppsKeyed['UMBREL_widgets'].icon}
					mouseX={mouseX}
				/>
			</motion.div>
			<LogoutDialog />

			<ErrorBoundary fallbackRender={() => null}>
				<Suspense>
					<LiveUsageDialog />
				</Suspense>
			</ErrorBoundary>
			<ErrorBoundary fallbackRender={() => null}>
				<Suspense>
					<WhatsNewModal />
				</Suspense>
			</ErrorBoundary>
		</>
	)
}

export function DockPreview() {
	const mouseX = useMotionValue(Infinity)
	const {iconSize, iconSizeZoomed, padding, dockHeight} = useDockDimensions({isPreview: true})

	return (
		<div
			className={dockPreviewClass}
			style={{
				height: dockHeight,
				paddingBottom: padding,
			}}
		>
			<DockItem
				bg={systemAppsKeyed['UMBREL_home'].icon}
				mouseX={mouseX}
				iconSize={iconSize}
				iconSizeZoomed={iconSizeZoomed}
			/>
			<DockItem
				bg={systemAppsKeyed['UMBREL_app-store'].icon}
				mouseX={mouseX}
				iconSize={iconSize}
				iconSizeZoomed={iconSizeZoomed}
			/>
			<DockItem
				bg={systemAppsKeyed['UMBREL_files'].icon}
				mouseX={mouseX}
				iconSize={iconSize}
				iconSizeZoomed={iconSizeZoomed}
			/>
			<DockItem
				bg={systemAppsKeyed['UMBREL_settings'].icon}
				mouseX={mouseX}
				iconSize={iconSize}
				iconSizeZoomed={iconSizeZoomed}
			/>
			<DockDivider iconSize={iconSize} />
			<DockItem
				bg={systemAppsKeyed['UMBREL_live-usage'].icon}
				mouseX={mouseX}
				iconSize={iconSize}
				iconSizeZoomed={iconSizeZoomed}
			/>
			<DockItem
				bg={systemAppsKeyed['UMBREL_widgets'].icon}
				mouseX={mouseX}
				iconSize={iconSize}
				iconSizeZoomed={iconSizeZoomed}
			/>
		</div>
	)
}

export function DockSpacer({className}: {className?: string}) {
	const {dockHeight} = useDockDimensions()
	return <div className={cn('w-full shrink-0', className)} style={{height: dockHeight + DOCK_BOTTOM_PADDING_PX}} />
}

export function DockBottomPositioner({children}: {children: React.ReactNode}) {
	return (
		<div className='fixed bottom-0 left-1/2 z-50 -translate-x-1/2' style={{paddingBottom: DOCK_BOTTOM_PADDING_PX}}>
			{children}
		</div>
	)
}

const dockClass = tw`mx-auto flex items-end gap-3 rounded-2xl bg-black/10 contrast-more:bg-neutral-700 backdrop-blur-2xl contrast-more:backdrop-blur-none px-3 shadow-dock shrink-0 will-change-transform transform-gpu border-hpx border-white/10`
const dockPreviewClass = tw`mx-auto flex items-end gap-4 rounded-2xl bg-neutral-900/80 px-3 shadow-dock shrink-0 border-hpx border-white/10`

const DockDivider = ({iconSize}: {iconSize: number}) => (
	<div className='br grid w-1 place-items-center' style={{height: iconSize}}>
		<div className='h-7 border-r border-white/10' />
	</div>
)
