import {toast} from '@/components/ui/toast'
import {trpcReact} from '@/trpc/trpc'

export function useIsExternalDns({onSuccess}: {onSuccess?: (enabled: boolean) => void} = {}) {
	const externalDnsQ = trpcReact.system.isExternalDns.useQuery()
	const isChecked = externalDnsQ.data === true

	const externalDnsMut = trpcReact.system.setExternalDns.useMutation({
		onSuccess: (enabled) => {
			externalDnsQ.refetch()
			onSuccess?.(enabled)
		},
		onError: (err) => {
			toast.error(err.message)
		},
	})

	const change = (checked: boolean) => {
		externalDnsMut.mutate(checked)
	}

	const isLoading = externalDnsMut.isPending || externalDnsQ.isLoading

	return {isChecked, change, isLoading}
}
