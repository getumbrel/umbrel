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
import {preloadFirstFewGalleryImages} from '@/modules/app-store/utils'
import {cn} from '@/shadcn-lib/utils'
import {RegistryApp} from '@/trpc/trpc'

export function AppsGridSection({overline, title, apps}: {overline: string; title: ReactNode; apps?: RegistryApp[]}) {
	return (
		<div className={cardClass}>
			<SectionTitle overline={overline} title={title} />
			<div className={appsGridClass}>{apps?.map((app) => <AppWithDescription key={app.id} app={app} />)}</div>
		</div>
	)
}

export function AppsGridFaintSection({title, apps}: {title?: ReactNode; apps?: RegistryApp[]}) {
	return (
		<div className={cn(cardFaintClass, slideInFromBottomClass)}>
			{title && <h3 className={sectionTitleClass}>{title}</h3>}
			<div className={appsGridClass}>{apps?.map((app) => <AppWithDescription key={app.id} app={app} />)}</div>
		</div>
	)
}

export function AppWithDescription({app, to}: {app: RegistryApp; to?: string}) {
	const linkClass = useCss({
		'&:hover': {
			img: {
				viewTransitionName: 'app-icon-' + app.id,
			},
			h3: {
				viewTransitionName: 'app-name-' + app.id,
			},
			p: {
				viewTransitionName: 'app-tagline-' + app.id,
			},
		},
	})

	return (
		<Link
			to={to ? to : `/app-store/${app.id}`}
			className={cn('group flex w-full items-center gap-2.5', linkClass)}
			unstable_viewTransition
			onMouseEnter={() => preloadFirstFewGalleryImages(app)}
		>
			<AppIcon src={app.icon} size={55} className='rounded-10' />
			<div className='flex min-w-0 flex-1 flex-col'>
				<h3 className='truncate text-15 font-bold -tracking-3'>{app.name}</h3>
				<p className='line-clamp-2 w-full min-w-0 text-13 leading-tight opacity-40'>{app.tagline}</p>
			</div>
		</Link>
	)
}
