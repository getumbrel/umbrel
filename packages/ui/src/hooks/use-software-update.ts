import {useCallback} from 'react'

import {toast} from '@/components/ui/toast'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export type UpdateState = 'initial' | 'checking' | 'at-latest' | 'update-available' | 'upgrading'

export function useSoftwareUpdate() {
	const ctx = trpcReact.useContext()
	const latestVersionQ = trpcReact.system.latestAvailableVersion.useQuery(undefined, {
		retry: false,
		refetchOnReconnect: false,
		refetchOnWindowFocus: false,
	})
	const osVersionQ = trpcReact.system.version.useQuery()

	const currentVersion = osVersionQ.data
	const latestVersion = latestVersionQ.data?.version

	const checkLatest = useCallback(async () => {
		try {
			ctx.system.latestAvailableVersion.invalidate()
			const latestVersion = await ctx.system.latestAvailableVersion.fetch()

			if (!latestVersion) {
				throw new Error(t('software-update.failed-to-check'))
			}
		} catch (error) {
			toast.error(t('software-update.failed-to-check'))
		}
	}, [ctx.system.latestAvailableVersion])

	let state: UpdateState = 'initial'
	if (latestVersionQ.isLoading || osVersionQ.isLoading) {
		state = 'initial'
	} else if (latestVersionQ.isRefetching) {
		state = 'checking'
	} else if (latestVersionQ.error) {
		state = 'initial'
	} else if (currentVersion === latestVersion) {
		state = 'at-latest'
	} else {
		state = 'update-available'
	}

	return {
		state,
		currentVersion,
		latestVersion,
		checkLatest,
	}
}
