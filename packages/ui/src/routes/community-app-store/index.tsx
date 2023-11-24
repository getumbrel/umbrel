import {TbArrowLeft} from 'react-icons/tb'
import {useNavigate, useParams} from 'react-router-dom'
import {groupBy} from 'remeda'
import {objectKeys} from 'ts-extras'

import {Loading} from '@/components/ui/loading'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {AppWithDescription} from '@/modules/app-store/discover/apps-grid-section'
import {appsGridClass, AppStoreSheetInner, cardFaintClass, sectionOverlineClass} from '@/modules/app-store/shared'
import {CommunityBadge} from '@/modules/community-app-store/community-badge'
import {cn} from '@/shadcn-lib/utils'
import {trpcReact} from '@/trpc/trpc'

export default function CommunityAppStoreHome() {
	const navigate = useNavigate()
	const {appStoreId} = useParams<{appStoreId: string}>()

	const registryQ = trpcReact.appStore.registry.useQuery()

	const appStore = registryQ.data?.find((appStore) => appStore?.meta.id === appStoreId)
	const appStoreName = appStore?.meta.name
	useUmbrelTitle(appStoreName ? `${appStoreName} Community App Store` : 'Loading... Community App Store')

	if (registryQ.isLoading) {
		return <Loading />
	}

	if (registryQ.isError || !registryQ.data || !appStore) {
		throw new Error('No data')
	}

	const apps = appStore.apps
	const appsGroupedByCategory = groupBy(apps, (a) => a.category)

	return (
		<AppStoreSheetInner
			title={`${appStoreName} app store`}
			description={`Discover and install apps from the ${appStoreName} App Store`}
			beforeHeaderChildren={
				<>
					<CommunityBadge className='self-start' />
					<button
						onClick={() => navigate('/app-store')}
						className='flex items-center gap-1 self-start underline-offset-2 outline-none focus-visible:underline'
					>
						<TbArrowLeft className='h-5 w-5' /> Back to Umbrel App Store
					</button>
				</>
			}
		>
			{objectKeys(appsGroupedByCategory).map((category) => (
				<div key={category} className={cardFaintClass}>
					<h3 className={cn(sectionOverlineClass, 'm-0 p-2.5')}>{category}</h3>
					<div className={appsGridClass}>
						{appsGroupedByCategory[category].map((app) => (
							<AppWithDescription key={app.id} app={app} to={`/community-app-store/${appStoreId}/${app.id}`} />
						))}
					</div>
				</div>
			))}
		</AppStoreSheetInner>
	)
}
