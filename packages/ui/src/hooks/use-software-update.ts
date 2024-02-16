import {useCallback, useState} from 'react'

import {toast} from '@/components/ui/toast'
import {LOADING_DASH, UNKNOWN} from '@/constants'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export type UpdateState = 'initial' | 'checking' | 'at-latest' | 'update-available' | 'upgrading'

export function useSoftwareUpdate() {
	const [state, setState] = useState<UpdateState>('initial')
	const [latestVersion, setLatestVersion] = useState('')

	const ctx = trpcReact.useContext()
	const osVersionQ = trpcReact.system.version.useQuery()
	const updateVersionMut = trpcReact.system.update.useMutation({
		onSuccess: (version) => {
			if (version === latestVersion) {
				ctx.system.version.invalidate()
				setState('at-latest')
				toast.success(t('software-update.success', {version}))
			} else {
				setState('initial')
				toast.error(t('software-update.failed'))
			}
		},
		onError: () => {
			setState('initial')
			toast.error(t('software-update.failed'))
		},
	})

	const currentVersion = osVersionQ.data ?? LOADING_DASH

	const checkLatest = useCallback(async () => {
		setState('checking')
		try {
			const latestVersion = await ctx.system.latestAvailableVersion.fetch()

			if (!latestVersion) {
				throw new Error(t('software-update.failed-to-check'))
			}
			setLatestVersion(latestVersion)
			if (latestVersion !== currentVersion) {
				setState('update-available')
			} else {
				setState('at-latest')
			}
		} catch (error) {
			setState('initial')
			toast.error(t('software-update.failed-to-check'))
		}
	}, [ctx.system.latestAvailableVersion, currentVersion])

	const upgrade = useCallback(async () => {
		setState('upgrading')
		updateVersionMut.mutate()
		// toast.error('Failed to upgrade')
	}, [updateVersionMut])

	return {
		state,
		currentVersion,
		latestVersion,
		checkLatest,
		upgrade,
	}
}
