import {TbArrowLeft} from 'react-icons/tb'
import {useNavigate, useParams} from 'react-router-dom'

import {Loading} from '@/components/ui/loading'
import {useAvailableApp} from '@/hooks/use-available-apps'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {AboutSection} from '@/modules/app-store/app-page/about-section'
import {DependenciesSection} from '@/modules/app-store/app-page/dependencies'
import {InfoSection} from '@/modules/app-store/app-page/info-section'
import {RecommendationsSection} from '@/modules/app-store/app-page/recommendations-section'
import {ReleaseNotesSection} from '@/modules/app-store/app-page/release-notes-section'
import {TopHeader} from '@/modules/app-store/app-page/top-header'
import {AppGallerySection} from '@/modules/app-store/gallery-section'

export function AppPage() {
	const navigate = useNavigate()
	const {appId} = useParams()
	const {app, isLoading} = useAvailableApp(appId)
	useUmbrelTitle(app?.name || 'Unknown App')

	if (isLoading) return <Loading />
	if (!app) return <div>App not found</div>

	return (
		<div className='flex flex-col gap-[40px]'>
			<div className='space-y-5'>
				<button onClick={() => navigate(-1)} className='inline-block'>
					<TbArrowLeft className='h-5 w-5' />
				</button>
				<TopHeader app={app} />
			</div>
			<AppGallerySection galleryId={'gallery-' + app.id} gallery={app.gallery} />
			{/* NOTE: consider conditionally rendering */}
			<div className='hidden flex-row gap-5 delay-200 animate-in fade-in slide-in-from-bottom-10 fill-mode-both lg:flex'>
				<div className='flex flex-1 flex-col gap-2.5'>
					<AboutSection app={app} />
					<ReleaseNotesSection app={app} />
				</div>
				<div className='flex w-80 flex-col gap-2.5'>
					<InfoSection app={app} />
					<DependenciesSection app={app} />
					<RecommendationsSection forAppId={app.id} />
				</div>
			</div>
			<div className='space-y-2.5 lg:hidden'>
				<AboutSection app={app} />
				<InfoSection app={app} />
				<DependenciesSection app={app} />
				<ReleaseNotesSection app={app} />
				<RecommendationsSection forAppId={app.id} />
			</div>
		</div>
	)
}
