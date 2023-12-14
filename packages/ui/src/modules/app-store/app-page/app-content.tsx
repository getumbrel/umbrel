import {isEmpty} from 'remeda'

import {AboutSection} from '@/modules/app-store/app-page/about-section'
import {DependenciesSection} from '@/modules/app-store/app-page/dependencies'
import {InfoSection} from '@/modules/app-store/app-page/info-section'
import {RecommendationsSection} from '@/modules/app-store/app-page/recommendations-section'
import {ReleaseNotesSection} from '@/modules/app-store/app-page/release-notes-section'
import {AppGallerySection} from '@/modules/app-store/gallery-section'
import {slideInFromBottomDelayedClass} from '@/modules/app-store/shared'
import {cn} from '@/shadcn-lib/utils'
import {RegistryApp, UserApp} from '@/trpc/trpc'

import {SettingsSection} from './settings-section'

export function AppContent({
	app,
	userApp,
	recommendedApps = [],
}: {
	app: RegistryApp
	/** When the user initiates an install, we now have a user app, even before install */
	userApp?: UserApp
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
					{userApp && <SettingsSection userApp={userApp} />}
					<InfoSection app={app} />
					<DependenciesSection app={app} />
					{!isEmpty(recommendedApps) && <RecommendationsSection apps={recommendedApps} />}
				</div>
			</div>
			{/* Mobile */}
			<div className='space-y-2.5 lg:hidden'>
				{userApp && <SettingsSection userApp={userApp} />}
				<AboutSection app={app} />
				<InfoSection app={app} />
				<DependenciesSection app={app} />
				<ReleaseNotesSection app={app} />
				{!isEmpty(recommendedApps) && <RecommendationsSection apps={recommendedApps} />}
			</div>
		</>
	)
}
