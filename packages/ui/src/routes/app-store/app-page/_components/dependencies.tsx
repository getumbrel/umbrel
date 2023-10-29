import {TbCircleCheckFilled} from 'react-icons/tb'

import {AppIcon} from '@/components/app-icon'
import {useAvailableApps} from '@/hooks/use-available-apps'
import {RegistryApp} from '@/trpc/trpc'

import {cardClass, cardTitleClass} from './shared'

export const DependenciesSection = ({app}: {app: RegistryApp}) => {
	const {appsKeyed, isLoading} = useAvailableApps()

	if (isLoading) return <div>Loading...</div>

	return (
		<div className={cardClass}>
			<h2 className={cardTitleClass}>Requires</h2>
			{app.dependencies?.map((dep) => <Dependency key={dep} app={appsKeyed[dep]} installed={false} />)}
			<Dependency app={{...app, icon: '', name: 'App name'}} installed={true} />
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
			<button className='text-15 font-medium text-brand-lighter'>Install</button>
		)}
	</div>
)
