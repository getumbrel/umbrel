import {ReactNode} from 'react'
import {Link} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'
import {RegistryApp} from '@/trpc/trpc'

import {cardClass, SectionTitle} from './shared'

export type AppsSectionProps = {
	overline: string
	title: string
	apps: RegistryApp[]
}
export const AppsGridSection: React.FC<AppsSectionProps> = ({overline, title, apps}) => {
	return (
		<div className={cardClass}>
			<SectionTitle overline={overline} title={title} />
			<div className='mt-[40px] grid gap-x-5 gap-y-[40px] sm:grid-cols-2 lg:grid-cols-3'>
				{apps.map((app) => (
					<App key={app.id} id={app.id} icon={app.icon} appName={app.name} appDescription={app.tagline} />
				))}
			</div>
		</div>
	)
}

function App({
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
		<Link to={`/app-store/${id}`} className='group flex w-full items-center gap-2.5 duration-300'>
			<AppIcon src={icon} size={55} className='rounded-10' />
			<div className='flex min-w-0 flex-1 flex-col'>
				<h3 className='truncate text-15 font-bold -tracking-3'>{appName}</h3>
				<p className='line-clamp-2 w-full min-w-0 text-13 opacity-40'>{appDescription}</p>
			</div>
		</Link>
	)
}
