import {useAllAvailableApps} from '@/providers/available-apps'
import {trpcReact} from '@/trpc/trpc'

export function useUpdateAllApps() {
	const allAvailableApps = useAllAvailableApps()
	const utils = trpcReact.useUtils()
	const appsQ = trpcReact.apps.list.useQuery()
	const updateMut = trpcReact.apps.update.useMutation({
		onMutate: () => {
			// Optimistic updates because otherwise it's too slow and feels like nothing is happening
			utils.apps.state.cancel()
			allAvailableApps?.apps?.map((app) => {
				utils.apps.state.setData({appId: app.id}, {state: 'updating', progress: 0})
			})
		},
		onSuccess: () => utils.apps.list.invalidate(),
	})

	const updateAll = () => {
		const apps = appsQ.data ?? []
		// @ts-expect-error `version`
		const appsWithUpdates = apps.filter((app) => allAvailableApps.appsKeyed?.[app.id]?.version !== app.version)

		appsWithUpdates.map((app) => updateMut.mutate({appId: app.id}))
	}

	const isLoading = appsQ.isLoading || allAvailableApps.isLoading
	const isUpdating = updateMut.isPending

	return {updateAll, isLoading, isUpdating}
}
