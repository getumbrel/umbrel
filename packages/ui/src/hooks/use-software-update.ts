import {useCallback} from 'react'

import {toast} from '@/components/ui/toast'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export type UpdateState = 'initial' | 'checking' | 'at-latest' | 'update-available' | 'upgrading'

export function useSoftwareUpdate() {
	const utils = trpcReact.useUtils()
	const latestVersionQ = trpcReact.system.checkUpdate.useQuery(undefined, {
		retry: false,
		refetchOnReconnect: false,
		refetchOnWindowFocus: false,
	})
	const osVersionQ = trpcReact.system.version.useQuery()

	const currentVersion = osVersionQ.data
	const latestVersion = latestVersionQ.data

	const checkLatest = useCallback(async () => {
		try {
			utils.system.checkUpdate.invalidate()
			const latestVersion = await utils.system.checkUpdate.fetch()

			if (!latestVersion) {
				throw new Error(t('software-update.failed-to-check'))
			}
		} catch (error) {
			toast.error(t('software-update.failed-to-check'))
		}
	}, [utils.system.checkUpdate])

	let state: UpdateState = 'initial'
	if (latestVersionQ.isLoading) {
		state = 'initial'
	} else if (latestVersionQ.isRefetching) {
		state = 'checking'
	} else if (latestVersionQ.error) {
		state = 'initial'
	} else if (!latestVersionQ.data?.available) {
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
