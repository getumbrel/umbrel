import {useTranslation} from 'react-i18next'

import {toast} from '@/components/ui/toast'
import {trpcReact} from '@/trpc/trpc'

export function useIsExternalDns({onSuccess}: {onSuccess?: (enabled: boolean) => void} = {}) {
	const {t} = useTranslation()
	const utils = trpcReact.useUtils()
	const externalDnsQ = trpcReact.system.isExternalDns.useQuery()
	const isChecked = externalDnsQ.data === true

	const externalDnsMut = trpcReact.system.setExternalDns.useMutation({
		// Optimistic update: apply the new value to the cache immediately so the UI
		// reflects the user's selection without waiting for the server round-trip.
		onMutate: async (newValue) => {
			await utils.system.isExternalDns.cancel()
			const previous = utils.system.isExternalDns.getData()
			utils.system.isExternalDns.setData(undefined, newValue)
			return {previous}
		},
		onError: (err, _newValue, context) => {
			// Roll back to the previous cached value if the mutation fails
			if (context?.previous !== undefined) utils.system.isExternalDns.setData(undefined, context.previous)
			toast.error(t('external-dns-error', {message: err.message}))
		},
		onSettled: () => utils.system.isExternalDns.invalidate(),
		onSuccess: (enabled) => onSuccess?.(enabled),
	})

	const change = (checked: boolean) => {
		externalDnsMut.mutate(checked)
	}

	const isLoading = externalDnsMut.isPending || externalDnsQ.isLoading

	return {isChecked, change, isLoading}
}
