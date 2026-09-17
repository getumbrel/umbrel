import {useMutationState} from '@tanstack/react-query'
import {getMutationKey} from '@trpc/react-query'
import {useTranslation} from 'react-i18next'

import {toast} from '@/components/ui/toast'
import {RouterInput, trpcReact} from '@/trpc/trpc'

import {beginAppAction, finishAppAction} from './app-action-guard'

/** Pending updates take precedence over early polls that still report ready. */
export function usePendingAppUpdateIds() {
	return useMutationState({
		filters: {mutationKey: getMutationKey(trpcReact.apps.update), status: 'pending'},
		select: (mutation) => (mutation.state.variables as RouterInput['apps']['update'] | undefined)?.appId,
	})
}

/**
 * The one `apps.update` mutation every update surface shares — the app page
 * button, card actions, the updates dialog rows and Update all — so an update
 * started anywhere reads the same everywhere:
 *
 * - The mutation doesn't return until the update completes, so on mutate both
 *   caches an app's state is read from — the per-app state and the apps list —
 *   are seeded with `updating` immediately. The list seed is what list-derived
 *   UI (card statuses, the updates banner's and dialog's "updating" state)
 *   reacts to without waiting for a refetch; in-flight fetches are cancelled
 *   first so a stale response can't overwrite the seed.
 * - On settle both are invalidated: the list refresh is what drops the app
 *   from "apps with updates" (its version changed), and after a failure it is
 *   what clears the seed again. Failures also toast — the buttons themselves
 *   have no error state.
 */
export function useUpdateAppMutation() {
	const {t} = useTranslation()
	const utils = trpcReact.useUtils()
	const updateMut = trpcReact.apps.update.useMutation({
		onMutate: async ({appId}) => {
			await Promise.all([utils.apps.state.cancel({appId}), utils.apps.list.cancel()])
			utils.apps.state.setData({appId}, {state: 'updating', progress: 0})
			utils.apps.list.setData(undefined, (apps) =>
				apps?.map((app) => (app.id === appId && 'state' in app ? {...app, state: 'updating' as const} : app)),
			)
		},
		onError: (error) => toast.error(t('app.toast.update-failed'), {area: 'app-store', description: error.message}),
		onSettled: (_data, _error, {appId}) => {
			finishAppAction(appId)
			utils.apps.state.invalidate({appId})
			utils.apps.list.invalidate()
		},
	})

	return {
		mutate: ({appId}: {appId: string}) => {
			if (beginAppAction(appId)) updateMut.mutate({appId})
		},
		isPending: updateMut.isPending,
	}
}

/** Update one app (see useUpdateAppMutation for the shared state handling) */
export function useUpdateApp(appId: string) {
	const updateMut = useUpdateAppMutation()

	return {
		update: () => updateMut.mutate({appId}),
		isPending: updateMut.isPending,
	}
}
