import {trpcReact} from '@/trpc/trpc'

export function useTorEnabled() {
	const ctx = trpcReact.useContext()

	const torEnabledQ = trpcReact.apps.getTorEnabled.useQuery()

	const setMut = trpcReact.apps.setTorEnabled.useMutation({
		onSuccess: () => ctx.apps.getTorEnabled.invalidate(),
	})

	return {
		enabled: torEnabledQ.data,
		setEnabled: (enabled: boolean) => setMut.mutate(enabled),
		isLoading: torEnabledQ.isLoading || setMut.isLoading,
		isError: setMut.isError,
		error: setMut.error,
	}
}
