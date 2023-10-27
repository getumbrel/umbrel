import {JSONTree} from 'react-json-tree'
import {useParams} from 'react-router-dom'

import {useAvailableApps} from '@/hooks/use-available-apps'
import {AppStoreNav} from '@/modules/app-store/app-store-nav'
import {categoryDescriptionsKeyed, Categoryish} from '@/modules/app-store/data'

export function CategoryPage() {
	const {categoryId} = useParams<{categoryId: Categoryish}>()
	const {appsKeyedByCategory, apps} = useAvailableApps()

	const filteredApps = categoryId && categoryId !== 'all' ? appsKeyedByCategory[categoryId] : apps

	return (
		<>
			<AppStoreNav />
			<div>Category ID: {categoryId}</div>
			{categoryId && <h2>{categoryDescriptionsKeyed[categoryId].label}</h2>}
			<JSONTree data={filteredApps} />
		</>
	)
}
