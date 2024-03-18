import prettyBytes from 'pretty-bytes'
import {useState} from 'react'
import {useTimeout} from 'react-use'
import {arrayIncludes} from 'ts-extras'

import {useAppInstall} from '@/hooks/use-app-install'
import {useLaunchApp} from '@/hooks/use-launch-app'
import {AppPermissionsDialog} from '@/modules/app-store/app-permissions-dialog'
import {UMBREL_APP_STORE_ID} from '@/modules/app-store/constants'
import {InstallTheseFirstDialog} from '@/modules/app-store/install-these-first-dialog'
import {useApps} from '@/providers/apps'
import {installedStates, RegistryApp} from '@/trpc/trpc'

import {InstallButton} from './install-button'

export function InstallButtonConnected({
	app,
	registryId = UMBREL_APP_STORE_ID,
}: {
	app: RegistryApp
	registryId?: string
}) {
	const appInstall = useAppInstall(app.id)
	const [showDepsDialog, setShowDepsDialog] = useState(false)
	const [showAppPermissionsDialog, setShowAppPermissionsDialog] = useState(false)
	const {userAppsKeyed, isLoading} = useApps()
	const openApp = useLaunchApp()

	const [show] = useTimeout(400)

	if (!show() || isLoading || !userAppsKeyed) {
		return (
			<InstallButton
				key={app.id}
				installSize={app.installSize ? prettyBytes(app.installSize) : undefined}
				progress={appInstall.progress}
				state='loading'
			/>
		)
	}
	// Uninstalled deps, or deps in the middle of something (like install or update)
	// TODO: Also check if app is ready? `&& userAppsKeyed[dep].state === 'ready'`
	// Will want to mark apps as in progress so we don't show that an app needs to be installed first
	const deps = app.dependencies ?? []
	const areDepsAllInstalled = deps.every((dep) => arrayIncludes(installedStates, userAppsKeyed[dep]?.state))

	const install = () => {
		if (deps.length > 0) {
			if (areDepsAllInstalled) {
				setShowAppPermissionsDialog(true)
			} else {
				setShowDepsDialog(true)
			}
			return
		}
		appInstall.install()
	}

	return (
		<>
			<InstallButton
				// `key` to prevent framer-motion from thinking install buttons from different pages are the same and animating between them
				key={app.id}
				installSize={app.installSize ? prettyBytes(app.installSize) : undefined}
				// progress={userApp?.installProgress}
				// state={userApp?.state || 'initial'}
				progress={appInstall.progress}
				state={appInstall.state}
				onInstallClick={install}
				onOpenClick={() => openApp(app.id)}
			/>
			<InstallTheseFirstDialog
				appId={app.id}
				registryId={registryId}
				dependencies={deps}
				open={showDepsDialog}
				onOpenChange={setShowDepsDialog}
			/>
			<AppPermissionsDialog
				appId={app.id}
				registryId={registryId}
				appsUsed={deps}
				open={showAppPermissionsDialog}
				onOpenChange={setShowAppPermissionsDialog}
				onNext={() => appInstall.install()}
			/>
		</>
	)
}
