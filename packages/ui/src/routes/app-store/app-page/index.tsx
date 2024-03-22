import {useParams} from 'react-router-dom'

import {InstallButtonConnected} from '@/components/install-button-connected'
import {Loading} from '@/components/ui/loading'
import {AppContent} from '@/modules/app-store/app-page/app-content'
import {getRecommendationsFor} from '@/modules/app-store/app-page/get-recommendations'
import {appPageWrapperClass} from '@/modules/app-store/app-page/shared'
import {TopHeader} from '@/modules/app-store/app-page/top-header'
import {useApps} from '@/providers/apps'
import {useAvailableApp, useAvailableApps} from '@/providers/available-apps'

export default function AppPage() {
	const {appId} = useParams()
	const {app, isLoading} = useAvailableApp(appId)

	const {apps, isLoading: isLoadingApps} = useAvailableApps()
	const {userAppsKeyed, isLoading: isLoadingUserApps} = useApps()

	if (isLoading || isLoadingApps || isLoadingUserApps) return <Loading />
	if (!app) throw new Error('App not found')

	const userApp = userAppsKeyed?.[app.id]

	const recommendedApps = getRecommendationsFor(apps, app.id)

	return (
		<div className={appPageWrapperClass}>
			<TopHeader
				app={app}
				childrenRight={
					<div className='flex items-center gap-5'>
						<InstallButtonConnected app={app} />
					</div>
				}
			/>
			<AppContent app={app} userApp={userApp} recommendedApps={recommendedApps} />
		</div>
	)
}
