import {useCallback, useState} from 'react'

import {toast} from '@/components/ui/toast'
import {trpcClient, trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export type UpdateState = 'initial' | 'checking' | 'at-latest' | 'update-available' | 'upgrading'

export function useSoftwareUpdate() {
	const [state, setState] = useState<UpdateState>('initial')

	const ctx = trpcReact.useContext()
	const latestVersionQ = trpcReact.system.latestAvailableVersion.useQuery(undefined, {
		retry: false,
	})
	const osVersionQ = trpcReact.system.version.useQuery()

	const updateVersionMut = trpcReact.system.update.useMutation({
		onSuccess: (onLatest) => {
			if (onLatest) {
				ctx.system.version.invalidate()
				trpcClient.system.version.query().then((version) => {
					// TODO: put this in global state
					setState('at-latest')
					toast.success(t('software-update.success', {version}))
				})
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

	const currentVersion = osVersionQ.data
	const latestVersion = latestVersionQ.data

	const checkLatest = useCallback(async () => {
		setState('checking')
		try {
			await ctx.system.latestAvailableVersion.invalidate()
			const latestVersion = await ctx.system.latestAvailableVersion.fetch()

			if (!latestVersion) {
				throw new Error(t('software-update.failed-to-check'))
			}
			if (latestVersion.version !== currentVersion) {
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
