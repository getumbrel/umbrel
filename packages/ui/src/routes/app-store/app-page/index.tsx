import {useParams} from 'react-router-dom'

import {ConnectedInstallButton} from '@/components/connected-install-button'
import {Loading} from '@/components/ui/loading'
import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {AppContent} from '@/modules/app-store/app-page/app-content'
import {getRecommendationsFor} from '@/modules/app-store/app-page/get-recommendations'
import {appPageWrapperClass} from '@/modules/app-store/app-page/shared'
import {TopHeader} from '@/modules/app-store/app-page/top-header'
import {useApps} from '@/providers/apps'
import {useAvailableApp, useAvailableApps} from '@/providers/available-apps'
import {t} from '@/utils/i18n'

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
			<UmbrelHeadTitle>{app?.name || t('unknown-app')}</UmbrelHeadTitle>
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
