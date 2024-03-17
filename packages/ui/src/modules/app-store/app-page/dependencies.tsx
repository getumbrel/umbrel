import {TbCircleCheckFilled} from 'react-icons/tb'
import {Link} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'
import {Loading} from '@/components/ui/loading'
import {useApps} from '@/providers/apps'
import {useAvailableApps} from '@/providers/available-apps'
import {RegistryApp} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

import {cardClass, cardTitleClass} from './shared'

export const DependenciesSection = ({app}: {app: RegistryApp}) => {
	const {appsKeyed, isLoading: isLoadingAvailableApps} = useAvailableApps()
	const {userApps, isLoading: isLoadingUserApps} = useApps()

	if (isLoadingAvailableApps || isLoadingUserApps) return <Loading />

	return (
		<div className={cardClass}>
			<h2 className={cardTitleClass}>{t('app-page.section.requires')}</h2>
			{app.dependencies?.map((dep) => (
				<Dependency key={dep} app={appsKeyed[dep]} installed={!!userApps?.find((app) => app.id === dep)} />
			))}
			<a href={app.support} target='_blank' className='self-start font-medium text-brand-lighter'>
				{t('app-page.section.requires.support')}
			</a>
		</div>
	)
}

const Dependency = ({app, installed = false}: {app: RegistryApp; installed: boolean}) => (
	// TODO: link to community app store if needed
	<Link className='flex items-center gap-2.5' to={`/app-store/${app.id}`}>
		<AppIcon src={app.icon} size={36} className='rounded-8' />
		<div className='flex-1 text-15 font-medium'>{app.name}</div>
		{installed ? (
			<TbCircleCheckFilled className='h-[18px] w-[18px] text-success-light' />
		) : (
			<Link to={`/app-store/${app.id}`} className='text-15 font-medium text-brand-lighter'>
				{t('app.view')}
			</Link>
		)}
	</Link>
)
