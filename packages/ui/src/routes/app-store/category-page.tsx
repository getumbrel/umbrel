import {useParams} from 'react-router-dom'

import {useAvailableApps} from '@/hooks/use-available-apps'
import {AppStoreNav} from '@/modules/app-store/app-store-nav'
import {categoryDescriptionsKeyed, Categoryish} from '@/modules/app-store/constants'
import {AppsGridFaintSection} from '@/modules/app-store/discover/apps-grid-section'

export function CategoryPage() {
	return (
		<>
			<AppStoreNav />
			<CategoryContent />
		</>
	)
}

function CategoryContent() {
	const {categoryishId} = useParams<{categoryishId: Categoryish}>()
	const {appsGroupedByCategory, apps, isLoading} = useAvailableApps()

	// Probably invalid url param
	if (!categoryishId) return null
	if (isLoading) return null

	const categoryId = categoryishId === 'discover' || categoryishId === 'all' ? null : categoryishId

	const filteredApps = categoryId ? appsGroupedByCategory[categoryId] : apps
	const title = categoryDescriptionsKeyed[categoryishId].label

	return <AppsGridFaintSection title={title} apps={filteredApps} />
}
