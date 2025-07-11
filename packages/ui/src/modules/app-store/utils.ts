import {RegistryApp, trpcClient} from '@/trpc/trpc'
import {preloadImage} from '@/utils/misc'

import {categoryDescriptionsKeyed, categoryishDescriptions, type Categoryish} from './constants'

const alreadyPreloadedFirstFewGalleryImages = new Set<string>()

export function preloadFirstFewGalleryImages(app: RegistryApp) {
	if (alreadyPreloadedFirstFewGalleryImages.has(app.id)) return
	alreadyPreloadedFirstFewGalleryImages.add(app.id)
	app.gallery.slice(0, 3).map(preloadImage)
}

export async function getAppStoreAppFromInstalledApp(appId: string) {
	const installedApps = await trpcClient.apps.list.query()
	const installedApp = installedApps.find((app) => app.id === appId)

	if (!installedApp) return null

	const availableApps = await trpcClient.appStore.registry.query()
	const availableAppsFlat = availableApps.flatMap((group) =>
		group.apps.map((app) => ({...app, registryId: group.meta.id})),
	)
	const appStoreApp = availableAppsFlat.find((app) => app.id === installedApp.id)

	return appStoreApp
}

export function getCategoryLabel(categoryId: string): string {
	const predefined = categoryDescriptionsKeyed[categoryId as Categoryish]

	// Return the translated label for a category if umbrelOS is aware of it
	if (predefined) return predefined.label()

	// Otherwise we just capitalize the first letter
	return (
		categoryId
			// Support snake_case and kebab-case manifest categories for future compatibility
			.split(/[-_]/)
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(' ')
	)
}

// Returns all app categories (predefined + any others from actual app data)
// keeping the predefined categories in the order given in `categoryishDescriptions`
export function getAllCategories(appsGroupedByCategory: Record<string, any[]>) {
	const predefinedCategories = categoryishDescriptions.map((c) => c.id)
	const dynamicCategories = Object.keys(appsGroupedByCategory).filter(
		(cat) => !predefinedCategories.includes(cat as any),
	)

	return [...predefinedCategories, ...dynamicCategories]
}
