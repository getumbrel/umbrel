import {toast} from '@/components/ui/toast'
import {trpcReact} from '@/trpc/trpc'

export function useTorEnabled({onSuccess}: {onSuccess?: (enabled: boolean) => void} = {}) {
	const utils = trpcReact.useUtils()

	const torEnabledQ = trpcReact.apps.getTorEnabled.useQuery()

	const setMut = trpcReact.apps.setTorEnabled.useMutation({
		onSuccess: (enabled) => {
			utils.apps.getTorEnabled.invalidate()
			onSuccess?.(enabled)
		},
		onError: (err) => {
			toast.error(err.message)
		},
	})

	return {
		enabled: torEnabledQ.data,
		setEnabled: (enabled: boolean) => setMut.mutate(enabled),
		isLoading: torEnabledQ.isLoading || setMut.isPending,
		isMutLoading: setMut.isPending,
		isError: setMut.isError,
		error: setMut.error,
	}
}
