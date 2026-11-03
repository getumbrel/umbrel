import {useCallback} from 'react'
import {useTranslation} from 'react-i18next'

import {toast} from '@/components/ui/toast'
import {trpcReact} from '@/trpc/trpc'

export type UpdateState = 'initial' | 'checking' | 'at-latest' | 'update-available' | 'upgrading'

export function useSoftwareUpdate() {
	const {t} = useTranslation()
	const utils = trpcReact.useUtils()
	const latestVersionQ = trpcReact.update.check.useQuery(undefined, {
		retry: false,
		refetchOnReconnect: false,
		refetchOnWindowFocus: false,
	})
	const osVersionQ = trpcReact.system.version.useQuery()

	const currentVersion = osVersionQ.data
	const latestVersion = latestVersionQ.data

	const checkLatest = useCallback(async () => {
		try {
			utils.update.check.invalidate()
			const latestVersion = await utils.update.check.fetch()

			if (!latestVersion) {
				throw new Error(t('software-update.failed-to-check'))
			}
		} catch {
			toast.error(t('software-update.failed-to-check'), {area: 'umbrelos'})
		}
	}, [utils.update.check])

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
