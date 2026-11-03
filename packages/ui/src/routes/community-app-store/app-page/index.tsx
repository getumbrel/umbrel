import {ErrorBoundary} from 'react-error-boundary'
import {useTranslation} from 'react-i18next'
import {useParams} from 'react-router-dom'

import {InstallButton} from '@/components/install-button'
import {InstallButtonConnectedController, InstallButtonConnectedView} from '@/components/install-button-connected'
import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {Loading} from '@/components/ui/loading'
import {registryAppPath} from '@/constants/app-store'
import {AppStoreNotFound} from '@/features/app-store/components/app-grid'
import {AppPageHero} from '@/features/app-store/components/app-page/app-hero'
import {AppPageContent} from '@/features/app-store/components/app-page/app-page-content'
import {appPageWrapperClass} from '@/features/app-store/components/app-page/shared'
import {CommunityBadge} from '@/modules/community-app-store/community-badge'
import {trpcReact} from '@/trpc/trpc'

export default function CommunityAppPage() {
	const {t} = useTranslation()
	const {appStoreId, appId} = useParams<{appStoreId: string; appId: string}>()

	const registryQ = trpcReact.appStore.registry.useQuery()
	const appStore = registryQ.data?.find((appStore) => appStore?.meta.id === appStoreId)

	const app = appStore?.apps.find((app) => app.id === appId)

	if (!appStoreId) throw new Error('App store id expected.') // Before isLoading so we don't show a loading state
	if (registryQ.isLoading) return <Loading />
	if (registryQ.isError) throw registryQ.error
	if (!appStore) {
		return (
			<AppStoreNotFound
				title={t('community-app-store.not-found.title')}
				description={t('community-app-store.not-found.description')}
			/>
		)
	}
	if (!app) {
		return (
			<AppStoreNotFound
				title={t('app-store.app-not-found.title')}
				description={t('app-store.app-not-found.description')}
			/>
		)
	}

	return (
		// Keyed by app so navigating between app pages remounts and replays the reveal
		<div key={app.id} className={appPageWrapperClass}>
			<CommunityBadge className='self-start' />
			<ErrorBoundary
				fallback={
					<AppPageHero
						app={app}
						renderActions={() => (
							<div className='pointer-events-none opacity-50'>
								<InstallButton state='not-installed' />
							</div>
						)}
					/>
				}
			>
				<InstallButtonConnectedController app={app}>
					<AppPageHero app={app} renderActions={() => <InstallButtonConnectedView />} />
				</InstallButtonConnectedController>
			</ErrorBoundary>
			<div className='flex flex-col gap-6 md:gap-8'>
				<ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>
					<AppPageContent app={app} registryId={appStoreId} makeAppPath={registryAppPath} />
				</ErrorBoundary>
			</div>
		</div>
	)
}
