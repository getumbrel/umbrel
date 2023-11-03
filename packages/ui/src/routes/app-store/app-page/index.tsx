import {TbArrowLeft} from 'react-icons/tb'
import {Link, useNavigate, useParams} from 'react-router-dom'

import {Loading} from '@/components/ui/loading'
import {useAvailableApp} from '@/hooks/use-available-apps'
import {AppGallerySection} from '@/modules/app-store/gallery-section'

import {AboutSection} from './_components/about-section'
import {DependenciesSection} from './_components/dependencies'
import {InfoSection} from './_components/info-section'
import {RecommendationsSection} from './_components/recommendations-section'
import {ReleaseNotesSection} from './_components/release-notes-section'
import {TopHeader} from './_components/top-header'

export function AppPage() {
	const navigate = useNavigate()
	const {appId} = useParams()
	const {app, isLoading} = useAvailableApp(appId)

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
			<AppGallerySection gallery={app.gallery} />
			{/* NOTE: consider conditionally rendering */}
			<div className='hidden flex-row gap-5 lg:flex'>
				<div className='flex flex-1 flex-col gap-2.5'>
					<AboutSection app={app} />
					<ReleaseNotesSection app={app} />
				</div>
				<div className='flex w-80 flex-col gap-2.5'>
					<InfoSection app={app} />
					<DependenciesSection app={app} />
					<RecommendationsSection />
				</div>
			</div>
			<div className='space-y-2.5 lg:hidden'>
				<AboutSection app={app} />
				<InfoSection app={app} />
				<DependenciesSection app={app} />
				<ReleaseNotesSection app={app} />
				<RecommendationsSection />
			</div>
		</div>
	)
}
