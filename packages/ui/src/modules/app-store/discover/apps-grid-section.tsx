import {ReactNode} from 'react'
import {Link} from 'react-router-dom'
import {useCss} from 'react-use'

import {AppIcon} from '@/components/app-icon'
import {
	appsGridClass,
	cardClass,
	cardFaintClass,
	SectionTitle,
	sectionTitleClass,
	slideInFromBottomClass,
} from '@/modules/app-store/shared'
import {cn} from '@/shadcn-lib/utils'
import {RegistryApp} from '@/trpc/trpc'

export function AppsGridSection({overline, title, apps}: {overline: string; title: ReactNode; apps?: RegistryApp[]}) {
	return (
		<div className={cardClass}>
			<SectionTitle overline={overline} title={title} />
			<div className={appsGridClass}>
				{apps?.map((app) => (
					<AppWithDescription
						key={app.id}
						id={app.id}
						icon={app.icon}
						appName={app.name}
						appDescription={app.tagline}
					/>
				))}
			</div>
		</div>
	)
}

export function AppsGridFaintSection({title, apps}: {title: ReactNode; apps?: RegistryApp[]}) {
	return (
		<div className={cn(cardFaintClass, slideInFromBottomClass)}>
			<h3 className={sectionTitleClass}>{title}</h3>
			<div className={appsGridClass}>
				{apps?.map((app) => (
					<AppWithDescription
						key={app.id}
						id={app.id}
						icon={app.icon}
						appName={app.name}
						appDescription={app.tagline}
					/>
				))}
			</div>
		</div>
	)
}

export function AppWithDescription({
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
	const linkClass = useCss({
		'&:hover': {
			img: {
				viewTransitionName: 'app-icon-' + id,
			},
			h3: {
				viewTransitionName: 'app-name-' + id,
			},
			p: {
				viewTransitionName: 'app-tagline-' + id,
			},
		},
	})

	return (
		<Link
			to={`/app-store/${id}`}
			className={cn('group flex w-full items-center gap-2.5', linkClass)}
			unstable_viewTransition
		>
			<AppIcon src={icon} size={55} className='rounded-10' />
			<div className='flex min-w-0 flex-1 flex-col'>
				<h3 className='truncate text-15 font-bold -tracking-3'>{appName}</h3>
				<p className='line-clamp-2 w-full min-w-0 text-13 leading-tight opacity-40'>{appDescription}</p>
			</div>
		</Link>
	)
}
