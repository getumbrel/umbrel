import prettyBytes from 'pretty-bytes'
import {useState} from 'react'

import {useAppInstall} from '@/hooks/use-app-install'
import {useApps} from '@/hooks/use-apps'
import {useLaunchApp} from '@/hooks/use-launch-app'
import {UMBREL_APP_STORE_ID} from '@/modules/app-store/constants'
import {InstallTheseFirstDialog} from '@/modules/app-store/install-these-first-dialog'
import {RegistryApp} from '@/trpc/trpc'

import {InstallButton, installButtonClass} from './install-button'

export function ConnectedInstallButton({
	app,
	registryId = UMBREL_APP_STORE_ID,
}: {
	app: RegistryApp
	registryId?: string
}) {
	const appInstall = useAppInstall(app.id)
	const state = appInstall.state
	const [showDepsDialog, setShowDepsDialog] = useState(false)
	const {userAppsKeyed, isLoading} = useApps()
	const openApp = useLaunchApp()

	if (isLoading) return null
	if (!userAppsKeyed) return null

	// Uninstalled deps, or deps in the middle of something (like install or update)
	// TODO: Also check if app is ready? `&& userAppsKeyed[dep].state === 'ready'`
	// Will want to mark apps as in progress so we don't show that an app needs to be installed first
	const deps = app.dependencies?.filter((dep) => !(dep in userAppsKeyed)) ?? []

	const install = () => {
		if (deps.length > 0) {
			setShowDepsDialog(true)
			return
		}
		appInstall.install()
	}

	// Sometimes the app is not available, but the user has it installed
	if (state === 'offline' || state === 'uninstalling') {
		return (
			<button disabled className={installButtonClass}>
				{appInstall.state === 'offline' && 'Offline'}
				{appInstall.state === 'uninstalling' && 'Uninstalling'}
			</button>
		)
	}

	return (
		<>
			<InstallButton
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
				toInstallFirstIds={deps}
				open={showDepsDialog}
				onOpenChange={setShowDepsDialog}
			/>
		</>
	)
}
