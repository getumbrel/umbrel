import {ReactNode} from 'react'
import {Link} from 'react-router-dom'
import {shuffle} from 'remeda'

import {AppIcon} from '@/components/app-icon'
import {useAvailableApps} from '@/hooks/use-available-apps'

import {cardClass, cardTitleClass} from './shared'

export const RecommendationsSection = ({forAppId}: {forAppId: string}) => {
	const {appsGroupedByCategory, appsKeyed, isLoading} = useAvailableApps()

	if (isLoading) return null
	if (!appsGroupedByCategory) return null

	const category = appsKeyed[forAppId].category
	const categoryApps = appsGroupedByCategory[category]

	const recommendedApps = shuffle(categoryApps)
		// exclude the app itself
		.filter((app) => app.id !== forAppId)
		.slice(0, 6)

	return (
		<div className={cardClass}>
			<h2 className={cardTitleClass}>You might also like</h2>
			{recommendedApps.map((app) => (
				<AppWithDescriptionSmall
					key={app.id}
					id={app.id}
					icon={app.icon}
					appName={app.name}
					appDescription={app.tagline}
				/>
			))}
		</div>
	)
}

function AppWithDescriptionSmall({
	id,
	icon,
	appName,
	appDescription,
}: {
	id?: string
	icon: string
	appName: ReactNode
	appDescription: ReactNode
}) {
	return (
		<Link to={`/app-store/${id}`} className='group flex w-full items-center gap-2.5'>
			<AppIcon src={icon} size={50} className='rounded-10' />
			<div className='flex min-w-0 flex-1 flex-col gap-0.5'>
				<h3 className='truncate text-14 font-semibold leading-tight -tracking-3'>{appName}</h3>
				<p className='line-clamp-2 w-full min-w-0 text-12 leading-tight opacity-40'>{appDescription}</p>
			</div>
		</Link>
	)
}
