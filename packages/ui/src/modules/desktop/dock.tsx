import {motion, useMotionValue, useReducedMotion} from 'motion/react'
import React, {useLayoutEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useLocation, useNavigate} from 'react-router-dom'
import {useWindowSize} from 'react-use'

import {Glass} from '@/components/ui/glass'
import {getLastFilesPath} from '@/features/files/utils/last-files-path'
import {useAppsWithUpdates} from '@/hooks/use-apps-with-updates'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useSettingsNotificationCount} from '@/hooks/use-settings-notification-count'
import {cn} from '@/lib/utils'
import {systemAppsKeyed} from '@/providers/apps'
import {useWallpaper} from '@/providers/wallpaper'
import {trpcReact} from '@/trpc/trpc'
import {useLinkToDialog} from '@/utils/dialog'
import {IS_IPHONE_BROWSER} from '@/utils/misc'
import {tw} from '@/utils/tw'

import {DockItem} from './dock-item'
import {useDockTuck} from './dock-tuck'
import {homeFit} from './home-fit'
import {prefetchRouteChunks} from './prefetch-route-chunks'

// Safari's bar floats just below the window on an iPhone, so the dock can sit lower there
const DOCK_BOTTOM_PADDING_PX = IS_IPHONE_BROWSER ? 4 : 10
const DOCK_SIDE_PADDING_PX = 12
// The most items it holds, and the least space it leaves either side of the window
const DOCK_MAX_ITEMS = 6
const DOCK_MIN_WINDOW_MARGIN_PX = 8

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
	gap: number
	/** Space under the dock */
	bottom: number
}

// The window's bottom safe area: on an iPhone on its side, what Safari keeps
// clear for the home indicator. Only CSS can read it, so ask a throwaway element.
function useSafeAreaBottom() {
	const {width, height} = useWindowSize()
	const [safeAreaBottom, setSafeAreaBottom] = useState(0)
	useLayoutEffect(() => {
		const probe = document.createElement('div')
		probe.style.cssText = 'position:fixed;visibility:hidden;padding-bottom:env(safe-area-inset-bottom)'
		document.body.append(probe)
		setSafeAreaBottom(parseFloat(getComputedStyle(probe).paddingBottom) || 0)
		probe.remove()
	}, [width, height])
	return safeAreaBottom
}

function useDockDimensions(options?: {isPreview?: boolean}): DockDimensionsPx {
	const isMobile = useIsMobile()
	const windowSize = useWindowSize()
	const bottom = Math.max(DOCK_BOTTOM_PADDING_PX, useSafeAreaBottom())

	if (options?.isPreview) {
		const {iconSize, iconSizeZoomed, padding} = DOCK_DIMENSIONS_PX.preview
		return {iconSize, iconSizeZoomed, padding, dockHeight: iconSize + padding * 2, gap: 10, bottom}
	}

	// A phone on its side is wider than the mobile breakpoint, but it's still a phone
	const compact = isMobile || homeFit(windowSize).phoneScale
	const dimensions = compact ? DOCK_DIMENSIONS_PX.mobile : DOCK_DIMENSIONS_PX.desktop
	const {iconSizeZoomed, padding} = dimensions
	const gap = compact ? 8 : 10
	// Icons give way on the narrowest outer displays so the dock stays on screen
	const roomForIcons =
		windowSize.width - (DOCK_MIN_WINDOW_MARGIN_PX + DOCK_SIDE_PADDING_PX) * 2 - gap * (DOCK_MAX_ITEMS - 1)
	const iconSize = Math.min(dimensions.iconSize, Math.floor(roomForIcons / DOCK_MAX_ITEMS))
	return {iconSize, iconSizeZoomed, padding, dockHeight: iconSize + padding * 2, gap, bottom}
}

export function Dock() {
	const {t} = useTranslation()
	const {pathname} = useLocation()
	const navigate = useNavigate()
	const linkToDialog = useLinkToDialog()
	const mouseX = useMotionValue(Infinity)
	const settingsNotificationCount = useSettingsNotificationCount()
	const {appsWithUpdates} = useAppsWithUpdates()
	const {iconSize, iconSizeZoomed, padding, dockHeight, gap, bottom} = useDockDimensions()
	const {wallpaperImgRef} = useWallpaper()
	const tucked = useDockTuck((state) => state.tucked)
	const reduceMotion = useReducedMotion()

	// Members browse the app store read-only, updates are owner-only
	const {data: user} = trpcReact.user.get.useQuery()
	const isMember = user?.role === 'member'
	const isOwner = user?.role === 'owner'

	const appUpdateCount = appsWithUpdates.length

	// Read sessionStorage at click time, not render time, because React Compiler
	// may cache the render-time read and return a stale value.
	const navigateToLastFilesPath = (e: React.MouseEvent) => {
		e.preventDefault()
		const lastFilesPath = getLastFilesPath(user?.userId)
		navigate(lastFilesPath || systemAppsKeyed['UMBREL_files'].systemAppTo)
	}

	return (
		<motion.div
			initial={{translateY: 80, opacity: 0}}
			animate={{translateY: 0, opacity: 1}}
			transition={{type: 'spring', stiffness: 200, damping: 20, delay: 0.2, duration: 0.2}}
			// The pointer reaching the dock precedes a click by a few hundred ms —
			// enough to finish warming a route chunk the idle prefetch didn't get to
			onPointerEnter={prefetchRouteChunks}
			onPointerMove={(e) => e.pointerType === 'mouse' && mouseX.set(e.pageX)}
			onPointerLeave={() => mouseX.set(Infinity)}
			className='shrink-0 transform-gpu will-change-transform'
		>
			<motion.div
				animate={{y: tucked ? dockHeight + bottom : 0}}
				initial={false}
				transition={reduceMotion ? {duration: 0} : dockTuckSpring}
			>
				<Glass
					{...dockGlassProps}
					// Only on the bare desktop: the WebGL fallback lens sees just the
					// wallpaper, and on other routes page content scrolls under the dock
					refractionTarget={pathname === '/' ? wallpaperImgRef : undefined}
					className={dockClass}
					style={{
						height: dockHeight,
						paddingBottom: padding,
						gap,
					}}
				>
					<DockItem
						iconSize={iconSize}
						iconSizeZoomed={iconSizeZoomed}
						to={systemAppsKeyed['UMBREL_files'].systemAppTo}
						onClick={navigateToLastFilesPath}
						open={pathname.startsWith('/files')}
						bg={systemAppsKeyed['UMBREL_files'].icon}
						label={t('files')}
						mouseX={mouseX}
					/>
					<DockItem
						iconSize={iconSize}
						iconSizeZoomed={iconSizeZoomed}
						to={systemAppsKeyed['UMBREL_photos'].systemAppTo}
						open={pathname.startsWith(systemAppsKeyed['UMBREL_photos'].systemAppTo)}
						bg={systemAppsKeyed['UMBREL_photos'].icon}
						label={t('photos')}
						mouseX={mouseX}
					/>
					<DockItem
						iconSize={iconSize}
						iconSizeZoomed={iconSizeZoomed}
						to={systemAppsKeyed['UMBREL_app-store'].systemAppTo}
						open={
							pathname.startsWith(systemAppsKeyed['UMBREL_app-store'].systemAppTo) ||
							// Community stores live outside /app-store but are still the App Store
							pathname.startsWith('/community-app-store')
						}
						bg={systemAppsKeyed['UMBREL_app-store'].icon}
						label={t('app-store.title')}
						notificationCount={isMember ? undefined : appUpdateCount}
						mouseX={mouseX}
					/>
					{isOwner && (
						<DockItem
							iconSize={iconSize}
							iconSizeZoomed={iconSizeZoomed}
							to={systemAppsKeyed['UMBREL_machines'].systemAppTo}
							open={pathname.startsWith(systemAppsKeyed['UMBREL_machines'].systemAppTo)}
							bg={systemAppsKeyed['UMBREL_machines'].icon}
							label={t('machines')}
							mouseX={mouseX}
						/>
					)}
					<DockItem
						iconSize={iconSize}
						iconSizeZoomed={iconSizeZoomed}
						to={systemAppsKeyed['UMBREL_settings'].systemAppTo}
						open={pathname.startsWith(systemAppsKeyed['UMBREL_settings'].systemAppTo)}
						bg={systemAppsKeyed['UMBREL_settings'].icon}
						label={t('settings')}
						notificationCount={settingsNotificationCount}
						mouseX={mouseX}
					/>
					<DockItem
						iconSize={iconSize}
						iconSizeZoomed={iconSizeZoomed}
						to={linkToDialog('live-usage')}
						open={pathname.startsWith(systemAppsKeyed['UMBREL_live-usage'].systemAppTo)}
						bg={systemAppsKeyed['UMBREL_live-usage'].icon}
						label={t('live-usage')}
						mouseX={mouseX}
					/>
				</Glass>
			</motion.div>
		</motion.div>
	)
}

export function DockPreview() {
	const mouseX = useMotionValue(Infinity)
	const {iconSize, iconSizeZoomed, padding, dockHeight} = useDockDimensions({isPreview: true})

	return (
		<Glass
			{...dockGlassProps}
			className={dockPreviewClass}
			style={{
				height: dockHeight,
				paddingBottom: padding,
			}}
		>
			<DockItem
				bg={systemAppsKeyed['UMBREL_files'].icon}
				mouseX={mouseX}
				iconSize={iconSize}
				iconSizeZoomed={iconSizeZoomed}
			/>
			<DockItem
				bg={systemAppsKeyed['UMBREL_photos'].icon}
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
				bg={systemAppsKeyed['UMBREL_machines'].icon}
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
			<DockItem
				bg={systemAppsKeyed['UMBREL_live-usage'].icon}
				mouseX={mouseX}
				iconSize={iconSize}
				iconSizeZoomed={iconSizeZoomed}
			/>
		</Glass>
	)
}

// How much of the bottom of the screen the dock takes, in px: what content
// that runs beneath it must leave clear to scroll fully into view
export function useDockClearance() {
	const {dockHeight, bottom} = useDockDimensions()
	return dockHeight + bottom
}

export function DockSpacer({className}: {className?: string}) {
	const height = useDockClearance()
	return <div className={cn('w-full shrink-0', className)} style={{height}} />
}

export function DockBottomPositioner({children}: {children: React.ReactNode}) {
	const {bottom} = useDockDimensions()
	return (
		<div className='fixed bottom-0 left-1/2 z-50 -translate-x-1/2' style={{paddingBottom: bottom}}>
			{children}
		</div>
	)
}

// Critically damped: the dock leaves and returns without bouncing
const dockTuckSpring = {type: 'spring' as const, stiffness: 400, damping: 40}

// Clearer glass than the widget defaults: barely any blur or tint, hard refraction
const dockGlassProps = {blur: 1.5, saturate: 1.4, brightness: 0.9, scale: 70, chroma: 0.24, bevel: 1.0} as const

const dockClass = tw`mx-auto flex items-end rounded-2xl contrast-more:bg-neutral-700 px-3 shadow-dock-drop shrink-0`
const dockPreviewClass = tw`mx-auto flex items-end gap-4 rounded-2xl px-3 shadow-dock-drop shrink-0`
