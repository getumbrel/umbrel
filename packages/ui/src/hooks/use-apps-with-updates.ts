import {usePendingAppUpdateIds} from '@/hooks/use-update-app'
import {canExecuteUpdate, isAppUpdateAvailable} from '@/modules/app-store/update-availability'
import {useApps} from '@/providers/apps'
import {useAllAvailableApps} from '@/providers/available-apps'
import type {RegistryApp} from '@/trpc/trpc'

const none: RegistryApp[] = []

/**
 * Installed apps with an available or ongoing update, derived from the cached
 * apps list and registry (no requests of its own). Keep updating apps visible
 * even after their versions match: the backend replaces the manifest before
 * pulling images and starting the updated app. Uses resolvedAppsKeyed so the
 * offered version matches what umbreld installs when duplicate app IDs exist.
 */
export function useAppsWithUpdates() {
	const apps = useApps()
	const availableApps = useAllAvailableApps()
	const pendingUpdateIds = usePendingAppUpdateIds()

	if (apps.isLoading || availableApps.isLoading) {
		return {appsWithUpdates: none, updatingApps: none, updatableApps: none, isLoading: true} as const
	}

	const userApps = apps.userApps ?? []
	const getState = (appId: string) =>
		pendingUpdateIds.includes(appId) ? 'updating' : (apps.userAppsKeyed?.[appId]?.state ?? 'not-installed')
	const appsWithUpdates = userApps
		.filter((app) => {
			const availableApp = availableApps.resolvedAppsKeyed?.[app.id] ?? availableApps.appsKeyed[app.id]
			return availableApp && (getState(app.id) === 'updating' || isAppUpdateAvailable(app.version, availableApp))
		})
		.map((app) => availableApps.resolvedAppsKeyed?.[app.id] ?? availableApps.appsKeyed[app.id])

	// Local mutations cover update preparation; the list also tracks updates
	// started elsewhere through the apps:state:change subscription.
	const updatingApps = appsWithUpdates.filter((app) => getState(app.id) === 'updating')
	const updatableApps = appsWithUpdates.filter((app) => canExecuteUpdate(getState(app.id), app.compatible))

	return {appsWithUpdates, updatingApps, updatableApps, isLoading: false} as const
}
