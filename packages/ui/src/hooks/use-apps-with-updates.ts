import {useApps} from '@/providers/apps'
import {useAllAvailableApps} from '@/providers/available-apps'

export function useAppsWithUpdates() {
	const apps = useApps()
	const availableApps = useAllAvailableApps()

	// NOTE: a parent should have the apps loaded before we get here, but don't wanna assume
	if (apps.isLoading || availableApps.isLoading) {
		return {
			appsWithUpdates: [],
			isLoading: true,
		} as const
	}

	const appsWithUpdates = (apps.userApps ?? [])
		.filter((app) => {
			const availableApp = availableApps.appsKeyed[app.id]
			return availableApp && availableApp.version !== app.version
		})
		.map((app) => availableApps.appsKeyed[app.id])

	return {appsWithUpdates, isLoading: apps.isLoading || availableApps.isLoading} as const
}
