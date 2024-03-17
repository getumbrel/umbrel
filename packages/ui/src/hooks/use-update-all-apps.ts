import {useAllAvailableApps} from '@/providers/available-apps'
import {trpcReact} from '@/trpc/trpc'

export function useUpdateAllApps() {
	const allAvailableApps = useAllAvailableApps()
	const ctx = trpcReact.useContext()
	const appsQ = trpcReact.apps.list.useQuery()
	const updateMut = trpcReact.apps.update.useMutation({
		onMutate: () => {
			// Optimistic updates because otherwise it's too slow and feels like nothing is happening
			ctx.apps.state.cancel()
			allAvailableApps?.apps?.map((app) => {
				ctx.apps.state.setData({appId: app.id}, {state: 'updating', progress: 0})
			})
		},
		onSuccess: () => ctx.apps.list.invalidate(),
	})

	const updateAll = () => {
		const apps = appsQ.data ?? []
		// @ts-expect-error `version`
		const appsWithUpdates = apps.filter((app) => allAvailableApps.appsKeyed?.[app.id]?.version !== app.version)

		appsWithUpdates.map((app) => updateMut.mutate({appId: app.id}))
	}

	const isLoading = appsQ.isLoading || allAvailableApps.isLoading
	const isUpdating = updateMut.isLoading

	return {updateAll, isLoading, isUpdating}
}
