import {useApps} from '@/hooks/use-apps'
import {useAvailableApps} from '@/hooks/use-available-apps'

export function useAppsWithUpdates() {
	// TODO: determine if we want community apps here
	const apps = useApps()
	const availableApps = useAvailableApps()

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
