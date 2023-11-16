import {useParams} from 'react-router-dom'

import {Loading} from '@/components/ui/loading'
import {useAvailableApp, useAvailableApps} from '@/hooks/use-available-apps'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {AppContent} from '@/modules/app-store/app-page/app-content'
import {getRecommendationsFor} from '@/modules/app-store/app-page/get-recommendations'
import {appPageWrapperClass} from '@/modules/app-store/app-page/shared'
import {TopHeaderWithDummyInstall} from '@/modules/app-store/app-page/top-header'

export default function AppPage() {
	const {appId} = useParams()
	const {apps, isLoading: isLoadingApps} = useAvailableApps()
	const {app, isLoading} = useAvailableApp(appId)
	useUmbrelTitle(app?.name || 'Unknown App')

	if (isLoading || isLoadingApps) return <Loading />
	if (!app) return <div>App not found</div>

	const recommendedApps = getRecommendationsFor(apps, app.id)

	return (
		<div className={appPageWrapperClass}>
			<TopHeaderWithDummyInstall app={app} />
			<AppContent app={app} recommendedApps={recommendedApps} />
		</div>
	)
}
