import {useMemo} from 'react'

import {trpcReact} from '@/trpc/trpc'

// Hook for managing backup ignored paths specifically for files and folders under /Home
// Provides the ignored paths list and helpers to add/remove paths while keeping queries fresh.
// Ignored paths for apps are handled elsewhere
export function useBackupIgnoredPaths(options?: {excludeSystemPaths?: boolean}) {
	const excludeSystemPaths = options?.excludeSystemPaths ?? true
	const utils = trpcReact.useUtils()

	const ignoredPathsQ = trpcReact.backups.getIgnoredPaths.useQuery()

	const ignoredPaths = useMemo(() => ignoredPathsQ.data || [], [ignoredPathsQ.data])
	const filteredIgnoredPaths = useMemo(() => {
		if (!excludeSystemPaths) return ignoredPaths
		return ignoredPaths.filter((p) => p !== '/External' && p !== '/Network')
	}, [ignoredPaths, excludeSystemPaths])

	const addIgnoredPathMut = trpcReact.backups.addIgnoredPath.useMutation({
		onSuccess: async () => {
			await utils.backups.getIgnoredPaths.invalidate()
		},
	})

	const removeIgnoredPathMut = trpcReact.backups.removeIgnoredPath.useMutation({
		onSuccess: async () => {
			await utils.backups.getIgnoredPaths.invalidate()
		},
	})

	const addIgnoredPath = (path: string) => addIgnoredPathMut.mutateAsync({path})
	const removeIgnoredPath = (path: string) => removeIgnoredPathMut.mutateAsync({path})

	return {
		ignoredPaths,
		filteredIgnoredPaths,
		isLoadingIgnoredPaths: ignoredPathsQ.isLoading,
		refetchIgnoredPaths: ignoredPathsQ.refetch,
		addIgnoredPath,
		removeIgnoredPath,
	}
}

export default useBackupIgnoredPaths
