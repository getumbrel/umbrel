import {useCallback, useState} from 'react'

import {toast} from '@/components/ui/toast'
import {trpcReact} from '@/trpc/trpc'

export function use2fa(onEnableChange: (enabled: boolean) => void) {
	const ctx = trpcReact.useContext()

	const enableMut = trpcReact.user.enable2fa.useMutation({
		onSuccess: () => {
			ctx.user.is2faEnabled.invalidate()
			setTimeout(() => {
				toast.success('Two-factor authentication enabled')
				onEnableChange(true)
			}, 500)
		},
	})

	const disableMut = trpcReact.user.disable2fa.useMutation({
		onSuccess: () => {
			ctx.user.is2faEnabled.invalidate()
			setTimeout(() => {
				toast.success('Two-factor authentication disabled')
				onEnableChange(false)
			}, 500)
		},
	})

	const is2faEndabledQ = trpcReact.user.is2faEnabled.useQuery()

	// TOTP URI
	const [totpUri, setTotpUri] = useState('')
	const generateTotpUri = useCallback(() => {
		ctx.user.generateTotpUri.fetch().then((res) => setTotpUri(res))
	}, [ctx])

	const enable = useCallback(
		async (totpToken: string) => {
			return enableMut.mutateAsync({totpToken, totpUri})
		},
		[enableMut, totpUri],
	)

	const disable = useCallback(
		async (totpToken: string) => {
			return disableMut.mutateAsync({totpToken})
		},
		[disableMut],
	)

	return {
		isEnabled: is2faEndabledQ.data,
		enable,
		disable,
		totpUri,
		generateTotpUri,
	}
}
