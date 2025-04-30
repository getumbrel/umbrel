import {useMemo, useRef} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {useNavigate, useParams} from 'react-router-dom'

import {InstallButtonConnected} from '@/components/install-button-connected'
import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {ErrorBoundaryComponentFallback} from '@/components/ui/error-boundary-component-fallback'
import {Loading} from '@/components/ui/loading'
import {AppContent} from '@/modules/app-store/app-page/app-content'
import {getRecommendationsFor} from '@/modules/app-store/app-page/get-recommendations'
import {appPageWrapperClass} from '@/modules/app-store/app-page/shared'
import {TopHeader} from '@/modules/app-store/app-page/top-header'
import {useApps} from '@/providers/apps'
import {useAvailableApp, useAvailableApps} from '@/providers/available-apps'
import {useLinkToDialog} from '@/utils/dialog'

export default function AppPage() {
	const {appId} = useParams()
	const {app, isLoading} = useAvailableApp(appId)
	const linkToDialog = useLinkToDialog()
	const navigate = useNavigate()

	const {apps, isLoading: isLoadingApps} = useAvailableApps()
	const {userAppsKeyed, isLoading: isLoadingUserApps} = useApps()

	const installButtonRef = useRef<{triggerInstall: (highlightDependency?: string) => void}>(null)

	const recommendedApps = useMemo(() => {
		if (!apps || !app) return []
		return getRecommendationsFor(apps, app.id)
	}, [apps, app])

	if (isLoading || isLoadingApps || isLoadingUserApps) return <Loading />

	if (!app) throw new Error('App not found')

	const userApp = userAppsKeyed?.[app.id]

	const showDependencies = (dependencyId?: string) => {
		if (!app) return
		const userApp = userAppsKeyed?.[app.id]
		if (userApp) {
			// Show app settings dialog when app is installed
			const params = {for: app.id} as Record<string, string>
			if (dependencyId) params.dependency = dependencyId
			navigate(linkToDialog('app-settings', params))
		} else if (installButtonRef.current) {
			// Otherwise show app install dialog
			installButtonRef.current.triggerInstall(dependencyId)
		}
	}

	if (isLoading || isLoadingApps || isLoadingUserApps) return <Loading />
	if (!app) throw new Error('App not found')

	return (
		<div className={appPageWrapperClass}>
			<TopHeader
				app={app}
				childrenRight={
					<div className='flex items-center gap-5'>
						<ErrorBoundary FallbackComponent={ErrorBoundaryComponentFallback}>
							<InstallButtonConnected ref={installButtonRef} app={app} />
						</ErrorBoundary>
					</div>
				}
			/>
			<ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>
				<AppContent app={app} userApp={userApp} recommendedApps={recommendedApps} showDependencies={showDependencies} />
			</ErrorBoundary>
		</div>
	)
}
