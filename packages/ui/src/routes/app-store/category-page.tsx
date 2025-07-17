import {ErrorBoundary} from 'react-error-boundary'
import {Navigate, useParams} from 'react-router-dom'

import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {ConnectedAppStoreNav} from '@/modules/app-store/app-store-nav'
import {categories} from '@/modules/app-store/constants'
import {AppsGridFaintSection} from '@/modules/app-store/discover/apps-grid-section'
import {getCategoryLabel} from '@/modules/app-store/utils'
import {useAvailableApps} from '@/providers/available-apps'

export default function CategoryPage() {
	return (
		<>
			<ConnectedAppStoreNav />
			<ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>
				<CategoryContent />
			</ErrorBoundary>
		</>
	)
}

function CategoryContent() {
	const {categoryishId} = useParams<{categoryishId: string}>()
	const {appsGroupedByCategory, apps, isLoading} = useAvailableApps()

	// Probably invalid url param
	if (!categoryishId) return null
	if (isLoading) return null

	const categoryId = categoryishId === 'discover' || categoryishId === 'all' ? null : categoryishId

	// Redirect if category is invalid OR if it's valid but has no apps
	// A category may have no apps if it is a hardcoded one in the OS and we have changed the app manifests to no longer include it.
	const isPredefinedCategory = categoryId ? categories.includes(categoryId as any) : false
	const existsInData = categoryId ? !!(appsGroupedByCategory as Record<string, any[]>)[categoryId] : false
	const hasApps = categoryId ? (appsGroupedByCategory as Record<string, any[]>)[categoryId]?.length > 0 : true

	if (categoryId && ((!isPredefinedCategory && !existsInData) || !hasApps)) {
		return <Navigate to='/app-store' replace />
	}

	const filteredApps = categoryId ? (appsGroupedByCategory as Record<string, any[]>)[categoryId] || [] : apps
	const title = getCategoryLabel(categoryishId)

	return (
		<>
			<AppsGridFaintSection title={title} apps={filteredApps} />
		</>
	)
}
