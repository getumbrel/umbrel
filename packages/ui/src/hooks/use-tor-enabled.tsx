import {trpcReact} from '@/trpc/trpc'

export function useTorEnabled() {
	const userQ = trpcReact.user.get.useQuery()
	const ctx = trpcReact.useContext()
	const setMut = trpcReact.user.set.useMutation({
		onSuccess: () => ctx.user.get.invalidate(),
	})

	return {
		enabled: userQ.data?.torEnabled,
		setEnabled: (enabled: boolean) => setMut.mutate({torEnabled: enabled}),
		isLoading: setMut.isLoading,
		isError: setMut.isError,
		error: setMut.error,
	}
}
