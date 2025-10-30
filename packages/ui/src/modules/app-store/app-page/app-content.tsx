import {JSONTree} from 'react-json-tree'
import {isEmpty} from 'remeda'

import {DebugOnly} from '@/components/ui/debug-only'
import {AboutSection} from '@/modules/app-store/app-page/about-section'
import {DependenciesSection} from '@/modules/app-store/app-page/dependencies'
import {InfoSection} from '@/modules/app-store/app-page/info-section'
import {RecommendationsSection} from '@/modules/app-store/app-page/recommendations-section'
import {ReleaseNotesSection} from '@/modules/app-store/app-page/release-notes-section'
import {AppGallerySection} from '@/modules/app-store/gallery-section'
import {cn} from '@/shadcn-lib/utils'
import {RegistryApp, UserApp} from '@/trpc/trpc'

import {SettingsSection} from './settings-section'

export function AppContent({
	app,
	userApp,
	recommendedApps = [],
	showDependencies,
}: {
	app: RegistryApp
	/** When the user initiates an install, we now have a user app, even before install */
	userApp?: UserApp
	recommendedApps?: RegistryApp[]
	showDependencies?: (dependencyId?: string) => void
}) {
	const hasDependencies = app.dependencies && app.dependencies.length > 0
	return (
		<>
			<AppGallerySection galleryId={'gallery-' + app.id} gallery={app.gallery} />
			{/* NOTE: consider conditionally rendering */}
			{/* Desktop */}
			<div className={cn('hidden flex-row gap-5 lg:flex')}>
				<div className='flex flex-1 flex-col gap-5'>
					<AboutSection app={app} />
					<ReleaseNotesSection app={app} />
				</div>
				{/* Since contents can be arbitrarily wide, we wanna limit */}
				<div className='flex flex-col gap-5 md:max-w-sm'>
					{userApp && <SettingsSection userApp={userApp} />}
					<InfoSection app={app} />
					{hasDependencies && <DependenciesSection app={app} showDependencies={showDependencies} />}
					{!isEmpty(recommendedApps) && <RecommendationsSection apps={recommendedApps} />}
				</div>
			</div>
			{/* Mobile */}
			<div className='space-y-5 lg:hidden'>
				{userApp && <SettingsSection userApp={userApp} />}
				<AboutSection app={app} />
				<InfoSection app={app} />
				{hasDependencies && <DependenciesSection app={app} showDependencies={showDependencies} />}
				<ReleaseNotesSection app={app} />
				{!isEmpty(recommendedApps) && <RecommendationsSection apps={recommendedApps} />}
			</div>
			<DebugOnly>
				<JSONTree data={app} />
			</DebugOnly>
		</>
	)
}
