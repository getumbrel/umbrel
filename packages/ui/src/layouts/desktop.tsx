import {useEffect} from 'react'

import {useCmdkOpen} from '@/components/cmdk'
import {AppSettingsDialog} from '@/modules/app-store/app-page/app-settings-dialog'
import {DefaultCredentialsDialog} from '@/modules/app-store/app-page/default-credentials-dialog'
import {DesktopContent} from '@/modules/desktop/desktop-content'
import {InstallFirstApp} from '@/modules/desktop/install-first-app'
import {DesktopWifiButtonConnected} from '@/modules/wifi/desktop-wifi-button-connected'
import {useApps} from '@/providers/apps'
import {tw} from '@/utils/tw'

export function Desktop() {
	const {userApps, isLoading} = useApps()

	if (isLoading) {
		return null
	}

	if (userApps?.length === 0) {
		return <InstallFirstAppPage />
	}

	return <DesktopPage />
}

function InstallFirstAppPage() {
	return (
		<>
			<InstallFirstApp />
			<DesktopWifiButtonConnected className={topRightPositionerClass} />
		</>
	)
}

function DesktopPage() {
	const {setOpen} = useCmdkOpen()

	// Prevent scrolling on the desktop because it interferes with `AppGridGradientMasking` and causes tearing effect
	useEffect(() => {
		document.documentElement.style.overflow = 'hidden'
		return () => {
			document.documentElement.style.overflow = ''
		}
	}, [])

	return (
		<>
			<div
				className={
					// `relative` positioning keeps children above <Wallpaper /> since that element is positioned `fixed`
					'relative flex h-[100dvh] w-full flex-col items-center justify-between'
				}
			>
				<DesktopContent onSearchClick={() => setOpen(true)} />
				<DesktopWifiButtonConnected className={topRightPositionerClass} />
			</div>
			<DefaultCredentialsDialog />
			<AppSettingsDialog />
		</>
	)
}

const topRightPositionerClass = tw`absolute right-5 top-5 z-10`
