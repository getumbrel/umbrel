import {useIsFetching} from '@tanstack/react-query'
import {useEffect, useState} from 'react'

import {trpcReact} from '@/trpc/trpc'

import {getWallpaperThumbUrl, wallpapers} from './wallpaper'

const prefetchStableMs = 500

export function Prefetcher() {
	const ctx = trpcReact.useContext()
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
			ctx.system.device,
			ctx.system.version,
			ctx.system.getIpAddresses,
			ctx.system.uptime,

			// Settings sidebar
			ctx.system.systemDiskUsage,
			ctx.system.systemMemoryUsage,
			ctx.system.cpuUsage,
			ctx.system.cpuTemperature,

			// Settings switches
			ctx.wifi.supported,
			ctx.wifi.connected,
			ctx.user.is2faEnabled,
			ctx.apps.getTorEnabled,

			// Advanced settings switches
			ctx.system.getReleaseChannel,
			ctx.system.isExternalDns,

			// Files
			ctx.files.preferences,
			ctx.files.favorites,
			ctx.files.shares,
		]

		Promise.allSettled(prefetchQueries.map((q) => q.prefetch()))

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
