import {arrayIncludes} from 'ts-extras'

import {UMBREL_APP_STORE_ID} from '@/constants/app-store'
import {buildAppStatusMap, type AppStoreStatus} from '@/features/app-store/data/catalog'
import {useStoreActions} from '@/features/app-store/providers/store-actions'
import {pollStates} from '@/hooks/use-app-install'
import {usePendingAppUpdateIds} from '@/hooks/use-update-app'
import {useApps} from '@/providers/apps'
import {useAvailableApps} from '@/providers/available-apps'
import {AppStateOrLoading, RegistryApp, trpcReact} from '@/trpc/trpc'

/**
 * Presentation-friendly status for every locally available app, derived in one
 * pass from queries that are already cached — mounting this on a page with
 * hundreds of cards adds zero requests.
 */
export function useAppStatusMap(registryId: string = UMBREL_APP_STORE_ID): Map<string, AppStoreStatus> {
	const {userAppsKeyed, isLoading} = useApps()
	const availableApps = useAvailableApps(registryId)

	if (isLoading || availableApps.isLoading) return new Map()
	return buildAppStatusMap(availableApps.apps, userAppsKeyed)
}

export type AppCardState = {state: AppStateOrLoading; progress?: number}

/**
 * Live state for a grid in one pass. Idle apps add no per-app query observers;
 * only the handful of currently transitioning IDs poll for progress.
 */
export function useAppCardStateMap(apps: readonly RegistryApp[]): Map<string, AppCardState> {
	const {userAppsKeyed} = useApps()
	const pendingStates = useStoreActions()?.pendingStates
	const pendingUpdateIds = usePendingAppUpdateIds()

	const states = new Map<string, AppCardState>()
	for (const app of apps) {
		states.set(app.id, {
			state: pendingUpdateIds.includes(app.id)
				? 'updating'
				: (pendingStates?.get(app.id) ?? userAppsKeyed?.[app.id]?.state ?? 'not-installed'),
		})
	}

	const transitioning = apps.filter((app) => {
		const state = states.get(app.id)?.state
		return state !== undefined && arrayIncludes(pollStates, state)
	})
	const progressQueries = trpcReact.useQueries((t) =>
		transitioning.map((app) => t.apps.state({appId: app.id}, {refetchInterval: 2000})),
	)

	transitioning.forEach((app, index) => {
		const state = states.get(app.id)
		if (state) state.progress = progressQueries[index]?.data?.progress
	})
	return states
}
