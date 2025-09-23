import {useMemo} from 'react'

import {useApps} from '@/providers/apps'
import {trpcReact} from '@/trpc/trpc'

// Hook to aggregate auto-excluded paths per app (from app manifests backupIgnore).
export function useAppsAutoExcludedPaths() {
	const {userApps = []} = useApps()

	const pathsQs = trpcReact.useQueries((t) =>
		(userApps || []).map((app) => t.apps.getBackupIgnoredPaths({appId: app.id})),
	)

	const isLoading = pathsQs.some((q) => q.isLoading)

	const pathsByAppId = useMemo(() => {
		const map = new Map<string, string[]>()
		userApps.forEach((app, idx) => {
			map.set(app.id, (pathsQs[idx]?.data as string[] | undefined) || [])
		})
		return map
	}, [userApps, pathsQs])

	const autoExcludedAppsCount = useMemo(
		() => pathsQs.reduce((sum, q) => sum + (((q.data?.length as number | undefined) ?? 0) > 0 ? 1 : 0), 0),
		[pathsQs],
	)

	return {pathsByAppId, autoExcludedAppsCount, isLoading}
}
