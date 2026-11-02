import {useEffect} from 'react'
import {useLocation} from 'react-router-dom'

import {useCmdkOpen} from '@/components/cmdk'
import {AppSettingsDialogConnected} from '@/features/app-store/components/app-settings-dialog-connected'
import {StoreActionsProvider} from '@/features/app-store/providers/store-actions'
import {ONBOARDING_COMPLETE_NOTIFICATION, useNotificationsQuery} from '@/hooks/use-notifications'
import {AppLaunchDialog} from '@/modules/app-store/app-page/app-launch-dialog'
import {AppShareUsersDialog} from '@/modules/desktop/app-share-users-dialog'
import {DesktopContent} from '@/modules/desktop/desktop-content'
import {prefetchRouteChunks} from '@/modules/desktop/prefetch-route-chunks'
import {useWallpaperUnderBrowserBar} from '@/modules/desktop/wallpaper-under-browser-bar'
import {WelcomeDesktop} from '@/modules/desktop/welcome-desktop'
import {DesktopWifiButtonConnected} from '@/modules/wifi/desktop-wifi-button-connected'
import {useApps} from '@/providers/apps'
import {tw} from '@/utils/tw'

export function Desktop() {
	const {userApps, isLoading} = useApps()

	// The welcome desktop shows on a fresh account with no apps yet while the
	// `onboarding-complete` notification is present: the owner gets a device-
	// level one at registration, members an account-scoped one when they're
	// created. Dismissing clears the notification, and installing (or being
	// shared) an app ends it too: the welcome has no app grid, so the real
	// desktop takes over as soon as there is something to show on it. Wait
	// for the list before deciding so the normal desktop never flashes first.
	const {notifications, isLoading: isLoadingNotifications} = useNotificationsQuery()
	const showWelcome = notifications.includes(ONBOARDING_COMPLETE_NOTIFICATION) && userApps?.length === 0

	// Prefetch main dock route chunks on idle so they're instant on first click.
	// These are static JS files — no auth required to fetch them. Lives here
	// rather than in DesktopPage so the welcome desktop, whose next click is
	// almost always the App Store, gets warmed too.
	useEffect(() => {
		if ('requestIdleCallback' in window) {
			const id = requestIdleCallback(prefetchRouteChunks)
			return () => cancelIdleCallback(id)
		}
		// Fallback for Safari (no requestIdleCallback): use a short timeout
		const id = setTimeout(prefetchRouteChunks, 200)
		return () => clearTimeout(id)
	}, [])

	if (isLoading || isLoadingNotifications) {
		return null
	}

	return (
		<>
			{showWelcome ? <WelcomeDesktopPage /> : <DesktopPage />}
			{/* The App Store sheet renders beside this layout, so mount its URL-driven
			    dialogs here for both welcome and regular desktops. */}
			<AppLaunchDialog />
			<StoreActionsProvider>
				<AppSettingsDialogConnected />
			</StoreActionsProvider>
			<AppShareUsersDialog />
		</>
	)
}

function WelcomeDesktopPage() {
	return (
		<>
			<WelcomeDesktop />
			<DesktopWifiButtonConnected className={topRightPositionerClass} />
		</>
	)
}

function DesktopPage() {
	const {setOpen} = useCmdkOpen()
	const {pathname} = useLocation()

	// Prevent scrolling on the desktop because it interferes with `AppGridGradientMasking` and causes tearing effect
	useEffect(() => {
		document.documentElement.style.overflow = 'hidden'
		return () => {
			document.documentElement.style.overflow = ''
		}
	}, [])
	// Sheets and Machines cover Home and stop at Safari's bar, so the wallpaper only goes under it on Home itself
	useWallpaperUnderBrowserBar(pathname === '/')

	return (
		<div
			className={
				// `relative` positioning keeps children above <Wallpaper /> since that element is positioned too
				'relative flex h-[100dvh] w-full flex-col items-center justify-between'
			}
		>
			<DesktopContent onSearchClick={() => setOpen(true)} />
			<DesktopWifiButtonConnected className={topRightPositionerClass} />
		</div>
	)
}

const topRightPositionerClass = tw`absolute right-5 top-5 z-10`
