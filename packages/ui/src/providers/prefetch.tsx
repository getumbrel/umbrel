import {useIsFetching, useQueryClient} from '@tanstack/react-query'
import {useEffect, useState} from 'react'

import {storefrontQueryOptions} from '@/features/app-store/data/storefront-query'
import {USE_LIST_DIRECTORY_LOAD_ITEMS} from '@/features/files/constants'
import {toFsPath} from '@/features/files/hooks/use-navigate'
import {getLastFilesPath} from '@/features/files/utils/last-files-path'
import {trpcReact} from '@/trpc/trpc'
import {MS_PER_MINUTE} from '@/utils/date-time'

import {getWallpaperAvifUrl, wallpapers} from './wallpaper'

const prefetchStableMs = 500

// Keep prefetched entries cached well past react-query's 5 minute default so
// they're still warm when a sheet or dialog is first opened later in the
// session. Scoped here rather than set globally so heavy transient payloads
// like directory listings and logs aren't retained for an hour too.
const prefetchGcTime = 60 * MS_PER_MINUTE

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
			utils.systemNg.device.getIdentity,
			utils.system.deviceName,
			utils.system.version,
			utils.system.getIpAddresses,
			utils.system.uptime,
			utils.user.get,

			// Settings backups
			utils.backups.getRepositories,

			// Settings raid
			utils.hardware.raid.getStatus,
			utils.hardware.internalStorage.getDevices,

			// Settings device info, and Live Usage's early "is there a GPU" hint
			// so the GPU card doesn't pop in after the first telemetry sample
			utils.systemNg.device.getSpecs,
			utils.hardware.gpu.getInfo,

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
			utils.update.getReleaseChannel,
			utils.system.isExternalDns,

			// Files
			utils.files.viewPreferences,
			utils.files.favorites,
			utils.files.shares,

			// App Store
			utils.appStore.registry,

			// Cmd+K frequent apps
			utils.apps.recentlyOpened,

			// Machines OS catalog metadata
			utils.machines.osImages,
		]

		Promise.allSettled(prefetchQueries.map((q) => q.prefetch(undefined, {gcTime: prefetchGcTime})))

		// Files directory listing: fetch the user (the last visited path is keyed
		// by account id) and preferences first so the sort params in the query key
		// match what useListDirectory will request.
		// Falls back to /Home for pseudo-routes that don't use files.list.
		Promise.all([utils.user.get.fetch(), utils.files.viewPreferences.fetch()])
			.then(([user, preferences]) => {
				const lastFilesRoute = getLastFilesPath(user?.userId)
				const isListablePath =
					lastFilesRoute &&
					!lastFilesRoute.startsWith('/files/Search') &&
					!lastFilesRoute.startsWith('/files/Recents') &&
					!lastFilesRoute.startsWith('/files/Trash') &&
					!lastFilesRoute.startsWith('/files/Cloud') &&
					lastFilesRoute !== '/files/Apps'
				const filesListPath = isListablePath ? toFsPath(lastFilesRoute) : '/Home'
				utils.files.list.prefetch(
					{
						path: filesListPath,
						limit: USE_LIST_DIRECTORY_LOAD_ITEMS.INITIAL,
						sortBy: preferences?.sortBy ?? 'name',
						sortOrder: preferences?.sortOrder ?? 'ascending',
					},
					{gcTime: prefetchGcTime},
				)
			})
			.catch(() => {})

		// App Store storefront feed (external API, not tRPC) — same query options
		// as the store itself so the fetch is defined exactly once
		queryClient.prefetchQuery(storefrontQueryOptions())

		const prefetchThumbnails = wallpapers.map((wallpaper) => getWallpaperAvifUrl(wallpaper, 'thumbnails'))

		prefetchThumbnails.forEach((url) => {
			const link = document.createElement('link')
			link.rel = 'prefetch'
			link.type = 'image/avif'
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
