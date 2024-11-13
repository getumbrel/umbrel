import {RegistryApp, trpcClient} from '@/trpc/trpc'
import {preloadImage} from '@/utils/misc'

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
