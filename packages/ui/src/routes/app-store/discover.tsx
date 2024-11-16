import {ErrorBoundary} from 'react-error-boundary'

import {ButtonLink} from '@/components/ui/button-link'
import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {Loading} from '@/components/ui/loading'
import {ConnectedAppStoreNav} from '@/modules/app-store/app-store-nav'
import {categoryDescriptionsKeyed} from '@/modules/app-store/constants'
import {AppsGridSection} from '@/modules/app-store/discover/apps-grid-section'
import {AppsRowSection} from '@/modules/app-store/discover/apps-row-section'
import {AppsThreeColumnSection} from '@/modules/app-store/discover/apps-three-column-section'
import {AppsGallerySection} from '@/modules/app-store/gallery-section'
import {useAvailableApps} from '@/providers/available-apps'
import {t} from '@/utils/i18n'

import {useDiscoverQuery} from './use-discover-query'

const getAppById = (appId: string, apps: NonNullable<ReturnType<typeof useAvailableApps>['apps']>) => {
	const app = apps.find((app) => app.id === appId)
	if (!app) throw new Error(`No such app: ${appId}`)
	return app
}

export default function Discover() {
	return (
		<>
			<ConnectedAppStoreNav />
			<ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>
				<DiscoverContent />
			</ErrorBoundary>
		</>
	)
}

function DiscoverContent() {
	const availableApps = useAvailableApps()

	const discoverQ = useDiscoverQuery()

	if (availableApps.isLoading || discoverQ.isLoading) {
		return <Loading />
	}

	const {apps} = availableApps

	if (!discoverQ.data) {
		throw new Error('No data')
	}

	const {banners, sections} = discoverQ.data
	return (
		<>
			<AppsGallerySection banners={banners} />
			{sections.map((section) => {
				if (section.type === 'grid') {
					return (
						<AppsGridSection
							key={section.heading + section.subheading}
							title={section.heading}
							overline={section.subheading}
							apps={section.apps.map((appId) => getAppById(appId, apps)).filter((app) => app !== undefined)}
						/>
					)
				}

				if (section.type === 'horizontal') {
					return (
						<AppsRowSection
							key={section.heading + section.subheading}
							overline={section.subheading}
							title={section.heading}
							apps={section.apps.map((appId) => getAppById(appId, apps)).filter((app) => app !== undefined)}
						/>
					)
				}

				if (section.type === 'three-column') {
					return (
						<AppsThreeColumnSection
							key={section.heading + section.subheading}
							apps={section.apps.map((appId) => getAppById(appId, apps)).filter((app) => app !== undefined)}
							overline={section.subheading}
							title={section.heading}
							textLocation={section.textLocation}
							description={section.description || ''}
						>
							{section.category && (
								<ButtonLink variant='primary' size='dialog' to={`/app-store/category/${section.category}`}>
									{t('app-store.browse-category-apps', {
										category: t(categoryDescriptionsKeyed[section.category].label()),
									})}
								</ButtonLink>
							)}
						</AppsThreeColumnSection>
					)
				}
			})}
		</>
	)
}
