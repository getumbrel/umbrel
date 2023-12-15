import {TbCircleCheckFilled} from 'react-icons/tb'
import {Link} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'
import {Loading} from '@/components/ui/loading'
import {useAvailableApps} from '@/hooks/use-available-apps'
import {useUserApps} from '@/hooks/use-user-apps'
import {RegistryApp} from '@/trpc/trpc'

import {cardClass, cardTitleClass} from './shared'

export const DependenciesSection = ({app}: {app: RegistryApp}) => {
	const {appsKeyed, isLoading: isLoadingAvailableApps} = useAvailableApps()
	const {userApps, isLoading: isLoadingUserApps} = useUserApps()

	if (isLoadingAvailableApps || isLoadingUserApps) return <Loading />

	return (
		<div className={cardClass}>
			<h2 className={cardTitleClass}>Requires</h2>
			{app.dependencies?.map((dep) => (
				<Dependency key={dep} app={appsKeyed[dep]} installed={!!userApps?.find((app) => app.id === dep)} />
			))}
			<a href={app.support} target='_blank' className='self-start font-medium text-brand-lighter'>
				Get support
			</a>
		</div>
	)
}

const Dependency = ({app, installed = false}: {app: RegistryApp; installed: boolean}) => (
	<div className='flex items-center gap-2.5'>
		<AppIcon src={app.icon} size={36} className='rounded-8' />
		<div className='flex-1 text-15 font-medium'>{app.name}</div>
		{installed ? (
			<TbCircleCheckFilled className='h-[18px] w-[18px] text-success-light' />
		) : (
			<Link to={`/app-store/${app.id}`} className='text-15 font-medium text-brand-lighter'>
				Install
			</Link>
		)}
	</div>
)
