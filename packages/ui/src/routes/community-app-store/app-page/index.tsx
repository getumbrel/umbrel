import {useParams} from 'react-router-dom'

import {ConnectedInstallButton} from '@/components/connected-install-button'
import {Loading} from '@/components/ui/loading'
import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {AppContent} from '@/modules/app-store/app-page/app-content'
import {appPageWrapperClass} from '@/modules/app-store/app-page/shared'
import {TopHeader} from '@/modules/app-store/app-page/top-header'
import {CommunityBadge} from '@/modules/community-app-store/community-badge'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export default function CommunityAppPage() {
	const {appStoreId, appId} = useParams<{appStoreId: string; appId: string}>()

	const registryQ = trpcReact.appStore.registry.useQuery()
	const appStore = registryQ.data?.find((appStore) => appStore?.meta.id === appStoreId)

	const app = appStore?.apps.find((app) => app.id === appId)

	if (!appStoreId) throw new Error('App store id expected.') // Putting before isLoading because we don't want to show the is loading state
	if (registryQ.isLoading) return <Loading />
	if (!app) throw new Error('App not found. It may have been removed from the registry.')

	const title = app?.name || t('unknown-app')

	return (
		<div className={appPageWrapperClass}>
			<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
			<CommunityBadge className='self-start' />
			<TopHeader app={app} childrenRight={<ConnectedInstallButton app={app} registryId={appStoreId} />} />
			<AppContent app={app} />
		</div>
	)
}
