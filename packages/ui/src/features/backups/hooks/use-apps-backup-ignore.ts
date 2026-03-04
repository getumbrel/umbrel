import {useMemo} from 'react'

import {useApps} from '@/providers/apps'
import {trpcReact} from '@/trpc/trpc'

// Hook for aggregating ignored status for all user apps and providing helpers to toggle ignore.
// The backupIgnore exclusions that apps define themselves are handled elsewhere
export function useAppsBackupIgnoredSummary() {
	const {userApps = []} = useApps()
	const utils = trpcReact.useUtils()

	const ignoredQs = trpcReact.useQueries((t) => (userApps || []).map((app) => t.apps.isBackupIgnored({appId: app.id})))

	const isLoading = ignoredQs.some((q) => q.isLoading)

	const isIgnoredByAppId = useMemo(() => {
		const map = new Map<string, boolean>()
		userApps.forEach((app, idx) => {
			map.set(app.id, !!ignoredQs[idx]?.data)
		})
		return map
	}, [userApps, ignoredQs])

	const excludedAppsCount = useMemo(() => ignoredQs.reduce((sum, q) => sum + (q.data ? 1 : 0), 0), [ignoredQs])

	const toggleMut = trpcReact.apps.backupIgnore.useMutation({
		onSuccess: async (_data, variables) => {
			if (variables?.appId) {
				await utils.apps.isBackupIgnored.invalidate({appId: variables.appId})
			}
		},
	})

	const ignore = (appId: string) => toggleMut.mutateAsync({appId, value: true})
	const unignore = (appId: string) => toggleMut.mutateAsync({appId, value: false})

	return {isIgnoredByAppId, excludedAppsCount, isLoading, ignore, unignore}
}
