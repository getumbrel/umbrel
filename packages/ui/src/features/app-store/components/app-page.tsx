import {useQuery} from '@tanstack/react-query'
import {useRef} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {useTranslation} from 'react-i18next'
import {useNavigate, useParams} from 'react-router-dom'

import {InstallButton} from '@/components/install-button'
import {
	InstallButtonConnectedController,
	InstallButtonConnectedView,
	type InstallButtonConnectedHandle,
} from '@/components/install-button-connected'
import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {Loading} from '@/components/ui/loading'
import {registryAppPath} from '@/constants/app-store'
import {AppGrid} from '@/features/app-store/components/app-grid'
import {SectionHeading} from '@/features/app-store/components/section-heading'
import {storeRevealClass, storeRevealDelay} from '@/features/app-store/constants'
import {getRelatedApps} from '@/features/app-store/data/catalog'
import {appReleasesQueryOptions, reconcileReleases} from '@/features/app-store/data/releases'
import {useAppStatusMap} from '@/features/app-store/hooks/use-app-status'
import {StoreActionsProvider} from '@/features/app-store/providers/store-actions'
import {cn} from '@/lib/utils'
import {isAppUpdateAvailable} from '@/modules/app-store/update-availability'
import {useApps} from '@/providers/apps'
import {useAllAvailableApps, useAvailableApp, useAvailableApps} from '@/providers/available-apps'
import {useLinkToDialog} from '@/utils/dialog'

import {AppPageHero} from './app-page/app-hero'
import {AppPageContent} from './app-page/app-page-content'
import {appPageWrapperClass} from './app-page/shared'

export default function AppPage() {
	const {t} = useTranslation()
	const {appId} = useParams()
	const {app, isLoading} = useAvailableApp(appId)
	const linkToDialog = useLinkToDialog()
	const navigate = useNavigate()

	const {apps, isLoading: isLoadingApps} = useAvailableApps()
	const {resolvedAppsKeyed, isLoading: isLoadingResolvedApps} = useAllAvailableApps()
	const {userAppsKeyed, isLoading: isLoadingUserApps} = useApps()
	const statuses = useAppStatusMap()

	// Optional release history; any failure just falls back to local notes
	const releasesQ = useQuery({...appReleasesQueryOptions(appId ?? ''), enabled: Boolean(appId)})

	const installButtonRef = useRef<InstallButtonConnectedHandle>(null)

	if (isLoading || isLoadingApps || isLoadingUserApps || isLoadingResolvedApps) return <Loading />
	if (!app) throw new Error('App not found')

	const userApp = userAppsKeyed?.[app.id]
	const relatedApps = getRelatedApps(apps ?? [], app.id, 6)
	const resolvedApp = resolvedAppsKeyed?.[app.id] ?? app
	const releaseTimeline = reconcileReleases(userApp ? resolvedApp : app, releasesQ.data)
	const highlightLatestRelease = Boolean(userApp && isAppUpdateAvailable(userApp.version, resolvedApp))

	const showDependencies = (dependencyId?: string) => {
		if (userApp) {
			// Installed app: dependencies are managed from the app settings dialog
			const params = {for: app.id} as Record<string, string>
			if (dependencyId) params.dependency = dependencyId
			navigate(linkToDialog('app-settings', params))
		} else {
			// Otherwise surface the choice inside the install flow
			installButtonRef.current?.triggerInstall(dependencyId)
		}
	}

	return (
		<StoreActionsProvider>
			{/* Keyed by app so navigating between app pages (same route, new
			    params — e.g. via related apps) remounts and replays the reveal */}
			<div key={app.id} className={appPageWrapperClass}>
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
					<InstallButtonConnectedController ref={installButtonRef} app={app}>
						<AppPageHero app={app} renderActions={() => <InstallButtonConnectedView />} />
					</InstallButtonConnectedController>
				</ErrorBoundary>
				<div className='flex flex-col gap-6 md:gap-8'>
					<ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>
						<AppPageContent
							app={app}
							userApp={userApp}
							releaseTimeline={releaseTimeline}
							highlightLatestRelease={highlightLatestRelease}
							showDependencies={showDependencies}
							registryId={app.appStoreId}
							makeAppPath={registryAppPath}
						/>
						{relatedApps.length > 0 && (
							<section
								className={cn('flex flex-col gap-4 px-2.5 md:px-0', storeRevealClass)}
								style={storeRevealDelay(380)}
							>
								<SectionHeading title={t('app-page.section.recommendations.title')} />
								<AppGrid apps={relatedApps} statuses={statuses} />
							</section>
						)}
					</ErrorBoundary>
				</div>
			</div>
		</StoreActionsProvider>
	)
}
