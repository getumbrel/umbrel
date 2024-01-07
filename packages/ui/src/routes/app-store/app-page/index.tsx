import {useParams} from 'react-router-dom'

import {ConnectedInstallButton} from '@/components/connected-install-button'
import {Loading} from '@/components/ui/loading'
import {useApps} from '@/hooks/use-apps'
import {useAvailableApp, useAvailableApps} from '@/hooks/use-available-apps'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {AppContent} from '@/modules/app-store/app-page/app-content'
import {getRecommendationsFor} from '@/modules/app-store/app-page/get-recommendations'
import {appPageWrapperClass} from '@/modules/app-store/app-page/shared'
import {TopHeader} from '@/modules/app-store/app-page/top-header'

export default function AppPage() {
	const {appId} = useParams()
	const {app, isLoading} = useAvailableApp(appId)
	useUmbrelTitle(app?.name || 'Unknown App')

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
						<ConnectedInstallButton app={app} />
					</div>
				}
			/>
			<AppContent app={app} userApp={userApp} recommendedApps={recommendedApps} />
		</div>
	)
}
