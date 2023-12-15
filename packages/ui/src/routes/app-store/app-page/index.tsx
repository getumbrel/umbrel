import prettyBytes from 'pretty-bytes'
import {useState} from 'react'
import {useParams} from 'react-router-dom'

import {InstallButton, installButtonClass} from '@/components/install-button'
import {Loading} from '@/components/ui/loading'
import {useAppInstall} from '@/hooks/use-app-install'
import {useAvailableApp, useAvailableApps} from '@/hooks/use-available-apps'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {useUserApps} from '@/hooks/use-user-apps'
import {AppContent} from '@/modules/app-store/app-page/app-content'
import {getRecommendationsFor} from '@/modules/app-store/app-page/get-recommendations'
import {appPageWrapperClass} from '@/modules/app-store/app-page/shared'
import {TopHeader} from '@/modules/app-store/app-page/top-header'
import {InstallTheseFirstDialog} from '@/modules/app-store/install-these-first-dialog'
import {RegistryApp, UserApp} from '@/trpc/trpc'
import {portToUrl} from '@/utils/misc'
import {trackAppOpen} from '@/utils/track-app-open'

export default function AppPage() {
	const {appId} = useParams()
	const {app, isLoading} = useAvailableApp(appId)
	useUmbrelTitle(app?.name || 'Unknown App')

	const {apps, isLoading: isLoadingApps} = useAvailableApps()
	const {userAppsKeyed, isLoading: isLoadingUserApps} = useUserApps()

	if (isLoading || isLoadingApps || isLoadingUserApps) return <Loading />
	if (!app) throw new Error('App not found')

	const userApp = userAppsKeyed?.[app.id]

	const recommendedApps = getRecommendationsFor(apps, app.id)

	return <InnerAppPage app={app} userApp={userApp} recommendedApps={recommendedApps} />
}

function InnerAppPage({
	app,
	userApp,
	recommendedApps,
}: {
	app: RegistryApp
	userApp?: UserApp
	recommendedApps: RegistryApp[]
}) {
	const appInstall = useAppInstall(app.id)
	const state = appInstall.state
	const [showDepsDialog, setShowDepsDialog] = useState(false)
	const {userAppsKeyed, isLoading} = useUserApps()

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
			<div className={appPageWrapperClass}>
				<TopHeader
					app={app}
					childrenRight={
						<button disabled className={installButtonClass}>
							{appInstall.state === 'offline' && 'Offline'}
							{appInstall.state === 'uninstalling' && 'Uninstalling'}
						</button>
					}
				/>
				<AppContent app={app} userApp={userApp} recommendedApps={recommendedApps} />
			</div>
		)
	}

	return (
		<div className={appPageWrapperClass}>
			<TopHeader
				app={app}
				childrenRight={
					<div className='flex items-center gap-5'>
						<InstallButton
							key={app.id}
							installSize={app.installSize ? prettyBytes(app.installSize) : undefined}
							// progress={userApp?.installProgress}
							// state={userApp?.state || 'initial'}
							progress={appInstall.progress}
							state={appInstall.state}
							onInstallClick={install}
							onOpenClick={() => {
								trackAppOpen(app.id)
								window.open(portToUrl(app.port), '_blank')?.focus()
							}}
						/>
					</div>
				}
			/>
			<AppContent app={app} userApp={userApp} recommendedApps={recommendedApps} />
			<InstallTheseFirstDialog
				appId={app.id}
				toInstallFirstIds={deps}
				open={showDepsDialog}
				onOpenChange={setShowDepsDialog}
			/>
		</div>
	)
}
