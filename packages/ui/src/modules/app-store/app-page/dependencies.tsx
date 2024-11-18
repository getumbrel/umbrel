import {Fragment} from 'react'
import {TbCircleCheckFilled} from 'react-icons/tb'
import {Link} from 'react-router-dom'
import {arrayIncludes} from 'ts-extras'

import {AppIcon} from '@/components/app-icon'
import {Loading} from '@/components/ui/loading'
import {useApps} from '@/providers/apps'
import {useAllAvailableApps} from '@/providers/available-apps'
import {cn} from '@/shadcn-lib/utils'
import {installedStates, RegistryApp} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

import {cardClass, cardTitleClass} from './shared'

export const DependenciesSection = ({
	app,
	showDependencies,
}: {
	app: RegistryApp
	showDependencies?: (dependencyId?: string) => void
}) => {
	const {apps, appsKeyed, isLoading: isLoadingAvailableApps} = useAllAvailableApps()
	const {userAppsKeyed, isLoading: isLoadingUserApps} = useApps()

	if (isLoadingAvailableApps || isLoadingUserApps) return <Loading />

	return (
		<div className={cardClass}>
			<h2 className={cardTitleClass}>{t('app-page.section.requires')}</h2>
			{app.dependencies?.map((dependencyId) => {
				const dependencyUserApp = userAppsKeyed?.[dependencyId]
				const numberOfAlternativeApps = apps
					// Filter out community apps that aren't installed
					.filter((registryApp) => {
						const isCommunityApp = registryApp.appStoreId !== 'umbrel-app-store'
						return !isCommunityApp || userAppsKeyed?.[registryApp.id]
					})
					// Prefer installed app's implements over registry app's
					.filter((registryApp) =>
						(userAppsKeyed?.[registryApp.id] ?? registryApp).implements?.includes(dependencyId),
					).length
				return (
					<Fragment key={`${dependencyId}:outer`}>
						<Dependency
							key={dependencyId}
							app={appsKeyed[dependencyId]}
							numberOfAlternativeApps={numberOfAlternativeApps}
							installed={!!dependencyUserApp && arrayIncludes(installedStates, dependencyUserApp.state)}
							showDependencies={showDependencies}
						/>
					</Fragment>
				)
			})}
		</div>
	)
}

const Dependency = ({
	app,
	installed = false,
	numberOfAlternativeApps = 0,
	showDependencies,
}: {
	app: RegistryApp
	installed: boolean
	numberOfAlternativeApps: number
	showDependencies?: (dependencyId?: string) => void
}) => {
	return (
		<div className='flex w-full items-center gap-2.5 pl-2'>
			<Link to={`/app-store/${app.id}`}>
				<AppIcon src={app.icon} size={36} className='rounded-8' />
			</Link>
			<div className='flex-col gap-4'>
				<Link to={`/app-store/${app.id}`} className='flex gap-1.5'>
					<h3 className='truncate text-14 font-semibold leading-tight -tracking-3'>{app.name}</h3>
					{installed && <TbCircleCheckFilled className='h-[16px] w-[16px] text-slate-500' />}
				</Link>
				{numberOfAlternativeApps > 0 && (
					<div
						className={cn(
							'mt-0.5 text-xs',
							showDependencies && 'cursor-pointer text-brand-lightest hover:text-brand-lighter',
						)}
						onClick={() => showDependencies?.(app.id)}
					>
						{t('app-page.section.dependencies.n-alternatives', {count: numberOfAlternativeApps + /* app itself */ 1})}
					</div>
				)}
			</div>
		</div>
	)
}
