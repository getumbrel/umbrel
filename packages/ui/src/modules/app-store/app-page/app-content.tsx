import {isEmpty} from 'remeda'

import {AboutSection} from '@/modules/app-store/app-page/about-section'
import {DependenciesSection} from '@/modules/app-store/app-page/dependencies'
import {InfoSection} from '@/modules/app-store/app-page/info-section'
import {RecommendationsSection} from '@/modules/app-store/app-page/recommendations-section'
import {ReleaseNotesSection} from '@/modules/app-store/app-page/release-notes-section'
import {AppGallerySection} from '@/modules/app-store/gallery-section'
import {slideInFromBottomDelayedClass} from '@/modules/app-store/shared'
import {cn} from '@/shadcn-lib/utils'
import {InstalledApp, RegistryApp} from '@/trpc/trpc'

import {SettingsSection} from './settings-section'

export function AppContent({
	app,
	installedApp,
	recommendedApps = [],
}: {
	app: RegistryApp
	installedApp?: InstalledApp
	recommendedApps?: RegistryApp[]
}) {
	return (
		<>
			<AppGallerySection galleryId={'gallery-' + app.id} gallery={app.gallery} />
			{/* NOTE: consider conditionally rendering */}
			{/* Desktop */}
			<div className={cn(slideInFromBottomDelayedClass, 'hidden flex-row gap-5 lg:flex')}>
				<div className='flex flex-1 flex-col gap-2.5'>
					<AboutSection app={app} />
					<ReleaseNotesSection app={app} />
				</div>
				<div className='flex w-80 flex-col gap-2.5'>
					{installedApp && <SettingsSection installedApp={installedApp} />}
					<InfoSection app={app} />
					<DependenciesSection app={app} />
					{!isEmpty(recommendedApps) && <RecommendationsSection apps={recommendedApps} />}
				</div>
			</div>
			{/* Mobile */}
			<div className='space-y-2.5 lg:hidden'>
				{installedApp && <SettingsSection installedApp={installedApp} />}
				<AboutSection app={app} />
				<InfoSection app={app} />
				<DependenciesSection app={app} />
				<ReleaseNotesSection app={app} />
				{!isEmpty(recommendedApps) && <RecommendationsSection apps={recommendedApps} />}
			</div>
		</>
	)
}
