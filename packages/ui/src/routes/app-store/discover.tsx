import {Loading} from '@/components/ui/loading'
import {ConnectedAppStoreNav} from '@/modules/app-store/app-store-nav'
import {Apps3UpSection} from '@/modules/app-store/discover/apps-3-up-section'
import {AppsGridSection} from '@/modules/app-store/discover/apps-grid-section'
import {AppsRowSection} from '@/modules/app-store/discover/apps-row-section'
import {AppsGallerySection} from '@/modules/app-store/gallery-section'
import {useAvailableApps} from '@/providers/available-apps'
import {ButtonLink} from '@/components/ui/button-link'

import {useDiscoverQuery} from './use-discover-query'

export default function Discover() {
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
			<ConnectedAppStoreNav />
			<AppsGallerySection banners={banners} />
			{sections.map((section) => {
				if (section.type === 'grid') {
					return <AppsGridSection
						key={section.heading + section.subheading}
						title={section.heading}
						overline={section.subheading}
						apps={apps.filter((app) => section.apps.includes(app.id))}
					/>
				}

				if (section.type === 'horizontal') {
					return <AppsRowSection 
						key={section.heading + section.subheading}
						overline={section.subheading}
						title={section.heading}
						apps={apps.filter((app) => section.apps.includes(app.id))}
						/>
				}

				if (section.type === 'three-column') {
					return <Apps3UpSection
						key={section.heading + section.subheading}
						apps={apps.filter((app) => section.apps.includes(app.id))}
						overline={section.subheading}
						title={section.heading}
						textLocation={section.textLocation}
						description={section.description || ''}
					>
						<ButtonLink variant='primary' size='dialog' to={`/app-store/category/${section.category}`}>
							Browse {section.category} apps
						</ButtonLink>
					</Apps3UpSection>
				}
			})}
		</>
	)
}
