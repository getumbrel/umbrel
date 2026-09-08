import {canExecuteUpdate} from '@/modules/app-store/update-availability'
import {useApps} from '@/providers/apps'
import {useAllAvailableApps} from '@/providers/available-apps'
import type {RegistryApp} from '@/trpc/trpc'
import {trpcReact} from '@/trpc/trpc'

const none: RegistryApp[] = []

/**
 * Installed apps whose registry version differs from the installed one.
 * Uses the server-side apps.updates query so the offered version matches
 * what umbreld will install when duplicate app IDs exist across stores.
 */
export function useAppsWithUpdates() {
	const apps = useApps()
	const availableApps = useAllAvailableApps()
	const updatesQ = trpcReact.apps.updates.useQuery(undefined, {
		enabled: !availableApps.isLoading,
		staleTime: 3 * 60 * 1000,
	})

	if (apps.isLoading || availableApps.isLoading || updatesQ.isLoading) {
		return {appsWithUpdates: none, updatingApps: none, updatableApps: none, isLoading: true} as const
	}

	const appsWithUpdates = (updatesQ.data ?? [])
		.map(({id}) => availableApps.resolvedAppsKeyed[id])
		.filter((app): app is RegistryApp => app !== undefined)

	const updatingApps = appsWithUpdates.filter((app) => apps.userAppsKeyed?.[app.id]?.state === 'updating')
	const updatableApps = appsWithUpdates.filter((app) =>
		canExecuteUpdate(apps.userAppsKeyed?.[app.id]?.state ?? 'not-installed', app.compatible),
	)

	return {appsWithUpdates, updatingApps, updatableApps, isLoading: false} as const
}
