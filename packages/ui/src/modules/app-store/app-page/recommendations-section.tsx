import {ReactNode} from 'react'
import {Link, useLocation} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'
import {RegistryApp} from '@/trpc/trpc'

import {cardClass, cardTitleClass} from './shared'

export const RecommendationsSection = ({apps}: {apps: RegistryApp[]}) => {
	const location = useLocation()

	if (location.pathname.startsWith('/community-app-store')) return null

	return (
		<div className={cardClass}>
			<h2 className={cardTitleClass}>You might also like</h2>
			{apps.map((app) => (
				<AppWithDescriptionSmall
					to={`/app-store/${app.id}`}
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
	to,
	icon,
	appName,
	appDescription,
}: {
	id?: string
	to?: string
	icon: string
	appName: ReactNode
	appDescription: ReactNode
}) {
	return (
		<Link to={to ? to : `/app-store/${id}`} className='group flex w-full items-center gap-2.5'>
			<AppIcon src={icon} size={50} className='rounded-10' />
			<div className='flex min-w-0 flex-1 flex-col gap-0.5'>
				<h3 className='truncate text-14 font-semibold leading-tight -tracking-3'>{appName}</h3>
				<p className='line-clamp-2 w-full min-w-0 text-12 leading-tight opacity-40'>{appDescription}</p>
			</div>
		</Link>
	)
}
