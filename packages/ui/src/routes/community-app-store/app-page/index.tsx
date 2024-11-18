import {ErrorBoundary} from 'react-error-boundary'
import {useParams} from 'react-router-dom'

import {InstallButtonConnected} from '@/components/install-button-connected'
import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {ErrorBoundaryComponentFallback} from '@/components/ui/error-boundary-component-fallback'
import {Loading} from '@/components/ui/loading'
import {AppContent} from '@/modules/app-store/app-page/app-content'
import {appPageWrapperClass} from '@/modules/app-store/app-page/shared'
import {TopHeader} from '@/modules/app-store/app-page/top-header'
import {CommunityBadge} from '@/modules/community-app-store/community-badge'
import {trpcReact} from '@/trpc/trpc'

export default function CommunityAppPage() {
	const {appStoreId, appId} = useParams<{appStoreId: string; appId: string}>()

	const registryQ = trpcReact.appStore.registry.useQuery()
	const appStore = registryQ.data?.find((appStore) => appStore?.meta.id === appStoreId)

	const app = appStore?.apps.find((app) => app.id === appId)

	if (!appStoreId) throw new Error('App store id expected.') // Putting before isLoading because we don't want to show the is loading state
	if (registryQ.isLoading) return <Loading />
	if (!app) throw new Error('App not found. It may have been removed from the registry.')

	return (
		<div className={appPageWrapperClass}>
			<CommunityBadge className='self-start' />
			<TopHeader
				app={app}
				childrenRight={
					<ErrorBoundary FallbackComponent={ErrorBoundaryComponentFallback}>
						<InstallButtonConnected app={app} />
					</ErrorBoundary>
				}
			/>
			<ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>
				<AppContent app={app} />
			</ErrorBoundary>
		</div>
	)
}
