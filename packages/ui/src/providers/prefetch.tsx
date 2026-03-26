import {useIsFetching, useQueryClient} from '@tanstack/react-query'
import {useEffect, useState} from 'react'

import {USE_LIST_DIRECTORY_LOAD_ITEMS} from '@/features/files/constants'
import {toFsPath} from '@/features/files/hooks/use-navigate'
import {trpcReact} from '@/trpc/trpc'

import {getWallpaperThumbUrl, wallpapers} from './wallpaper'

const prefetchStableMs = 500

export function Prefetcher() {
	const utils = trpcReact.useUtils()
	const queryClient = useQueryClient()
	const [triggered, setTriggered] = useState(false)
	const isLoggedInQ = trpcReact.user.isLoggedIn.useQuery()
	const isFetching = useIsFetching()

	// We want to prefetch all data used by major UI components like settings, so
	// that opening the component for the first time doesn't show placeholders or
	// inner UI components such as switches with their default option selected.
	// We don't need to prefetch everything, though. Most user preferences for
	// example, like language and units, are already fetched early otherwise, and
	// anything non-distracting can be skipped in favor of a quicker first load.

	function performPrefetch() {
		const prefetchQueries = [
			// Settings header
			utils.system.device,
			utils.system.version,
			utils.system.getIpAddresses,
			utils.system.uptime,
			utils.user.get,

			// Settings backups
			utils.backups.getRepositories,

			// Settings raid (Pro devices — returns empty on non-Pro)
			utils.hardware.raid.getStatus,
			utils.hardware.internalStorage.getDevices,

			// Settings sidebar
			utils.system.systemDiskUsage,
			utils.system.systemMemoryUsage,
			utils.system.cpuUsage,
			utils.system.cpuTemperature,

			// Settings switches
			utils.wifi.supported,
			utils.wifi.connected,
			utils.user.is2faEnabled,
			utils.apps.getTorEnabled,

			// Advanced settings switches
			utils.system.getReleaseChannel,
			utils.system.isExternalDns,

			// Files
			utils.files.viewPreferences,
			utils.files.favorites,
			utils.files.shares,

			// App Store
			utils.appStore.registry,
		]

		Promise.allSettled(prefetchQueries.map((q) => q.prefetch()))

		// Files directory listing: fetch preferences first so the sort params
		// in the query key match what useListDirectory will request.
		// Falls back to /Home for pseudo-routes that don't use files.list.
		const lastFilesRoute = sessionStorage.getItem('lastFilesPath')
		const isListablePath =
			lastFilesRoute &&
			!lastFilesRoute.startsWith('/files/Search') &&
			!lastFilesRoute.startsWith('/files/Recents') &&
			!lastFilesRoute.startsWith('/files/Trash') &&
			lastFilesRoute !== '/files/Apps'
		const filesListPath = isListablePath ? toFsPath(lastFilesRoute) : '/Home'
		utils.files.viewPreferences
			.fetch()
			.then((preferences) => {
				utils.files.list.prefetch({
					path: filesListPath,
					limit: USE_LIST_DIRECTORY_LOAD_ITEMS.INITIAL,
					sortBy: preferences?.sortBy ?? 'name',
					sortOrder: preferences?.sortOrder ?? 'ascending',
				})
			})
			.catch(() => {})

		// App Store discover page (external API, not tRPC)
		queryClient.prefetchQuery({
			queryKey: ['app-store', 'discover'],
			queryFn: () => fetch('https://apps.umbrel.com/api/v2/umbrelos/app-store/discover').then((res) => res.json()),
		})

		const prefetchThumbnails = wallpapers.map((wallpaper) => getWallpaperThumbUrl(wallpaper))

		prefetchThumbnails.forEach((url) => {
			const link = document.createElement('link')
			link.rel = 'prefetch'
			link.href = url
			document.head.appendChild(link)
		})
	}

	// We want prefetching to happen exactly once
	// - only when the user is logged in
	// - when there are no more pending queries
	// - when conditions are stable for a while
	const conditionsFulfilled = !triggered && !!isLoggedInQ.data && !isFetching

	useEffect(() => {
		if (!conditionsFulfilled) return

		// Schedule prefetch, anticipating stable conditions. Once triggered, this
		// effect goes stale because conditionsFulfilled doesn't change anymore.
		const timeout = setTimeout(() => {
			setTriggered(true)
			performPrefetch()
		}, prefetchStableMs)

		// If conditions are not stable, cancel and try again
		return () => clearTimeout(timeout)
	}, [conditionsFulfilled])

	return null
}
