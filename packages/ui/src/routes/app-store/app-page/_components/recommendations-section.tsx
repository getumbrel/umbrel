import {ReactNode} from 'react'
import {Link} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'

import {cardClass, cardTitleClass} from './shared'

export const RecommendationsSection = () => (
	<div className={cardClass}>
		<h2 className={cardTitleClass}>You might also like</h2>
		<AppWithDescriptionSmall id={'TEST_ID'} icon='' appName='App name' appDescription='App description' />
		<AppWithDescriptionSmall
			id={'TEST_ID'}
			icon=''
			appName='App name'
			appDescription='Mollit ex anim adipisicing velit quis ullamco reprehenderit fugiat in labore.'
		/>
	</div>
)

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
