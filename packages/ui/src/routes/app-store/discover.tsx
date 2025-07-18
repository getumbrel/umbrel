import {ErrorBoundary} from 'react-error-boundary'

import {ButtonLink} from '@/components/ui/button-link'
import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {Loading} from '@/components/ui/loading'
import {ConnectedAppStoreNav} from '@/modules/app-store/app-store-nav'
import {AppsGridSection} from '@/modules/app-store/discover/apps-grid-section'
import {AppsRowSection} from '@/modules/app-store/discover/apps-row-section'
import {AppsThreeColumnSection} from '@/modules/app-store/discover/apps-three-column-section'
import {AppsGallerySection} from '@/modules/app-store/gallery-section'
import {cardFaintClass} from '@/modules/app-store/shared'
import {getCategoryLabel} from '@/modules/app-store/utils'
import {useAvailableApps} from '@/providers/available-apps'
import {cn} from '@/shadcn-lib/utils'
import {RegistryApp} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

import {useDiscoverQuery} from './use-discover-query'

const getAppById = (appId: string, apps: RegistryApp[]): RegistryApp | undefined => {
	const app = apps.find((app) => app.id === appId)
	// Return undefined instead of throwing to allow graceful filtering of missing apps
	// This can happen if a new app is added to the app store and the discover endpoint, but umbrelOS hasn't pulled down the app store repo changes yet
	if (!app) return undefined
	return app
}

// Fallback component when discover API fails
function DiscoverUnavailable() {
	return (
		<div className={cn(cardFaintClass, 'flex h-40 flex-col items-center justify-center p-8 text-center')}>
			<p className='text-15 font-medium text-white/80'>{t('app-store.discover.temporarily-unavailable-title')}</p>
			<p className='mt-2 text-12 text-white/50'>{t('app-store.discover.temporarily-unavailable-description')}</p>
		</div>
	)
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

	// Check for error state and show graceful fallback
	if (discoverQ.isError || !discoverQ.data) {
		return <DiscoverUnavailable />
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
										category: getCategoryLabel(section.category),
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
