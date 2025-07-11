import {ErrorBoundary} from 'react-error-boundary'
import {Navigate, useParams} from 'react-router-dom'

import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {ConnectedAppStoreNav} from '@/modules/app-store/app-store-nav'
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

	// If user manually navigates to a category that doesn't exist, redirect to main app store instead of showing an error boundary
	if (categoryId && !(appsGroupedByCategory as Record<string, any[]>)[categoryId]) {
		return <Navigate to='/app-store' replace />
	}

	const filteredApps = categoryId ? (appsGroupedByCategory as Record<string, any[]>)[categoryId] : apps
	const title = getCategoryLabel(categoryishId)

	return (
		<>
			<AppsGridFaintSection title={title} apps={filteredApps} />
		</>
	)
}
