import {useQueryClient, type InfiniteData} from '@tanstack/react-query'
import {useEffect, useRef} from 'react'

import {ITEMS_LIST_KEY, type ItemsPage} from '@/features/photos/hooks/use-items'
import {MAP_POINTS_KEY} from '@/features/photos/hooks/use-map-points'
import {trpcReact, type RouterOutput} from '@/trpc/trpc'

type LibraryStatus = RouterOutput['photos']['library']['status']

// A list with this many pages or fewer is cheap to refresh in place; deeper
// lists are only marked stale, so a scrolled-deep user isn't hit with dozens
// of page refetches because a file changed somewhere.
const REFETCH_IN_PLACE_MAX_PAGES = 3

// The map's points are every located item, the heaviest read Photos has. They
// are refreshed at once after a quiet spell, and at most this often while the
// library keeps changing — an import changes it every second for hours.
const MAP_POINTS_REFRESH_MS = 10_000

// One subscription group for the whole Photos surface. Indexing snapshots go
// straight into the status cache; `photos:change` covers library mutations,
// indexed filesystem changes, and enrichment. Raw Files events also include
// constant app activity, which must not trigger expensive Photos queries.
export function usePhotosEvents() {
	const utils = trpcReact.useUtils()
	const queryClient = useQueryClient()
	const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
	const indexingVersionRef = useRef(0)
	const refreshRef = useRef({running: false, pending: false, mounted: true})
	const mapPointsRef = useRef<{refreshedAt: number; timer?: ReturnType<typeof setTimeout>}>({refreshedAt: 0})

	const refreshMapPoints = () => {
		const points = mapPointsRef.current
		if (points.timer) return
		const refresh = () => {
			points.timer = undefined
			points.refreshedAt = Date.now()
			// A read already under way may predate the change: this replaces it
			void queryClient.invalidateQueries({queryKey: MAP_POINTS_KEY})
		}
		const wait = points.refreshedAt + MAP_POINTS_REFRESH_MS - Date.now()
		if (wait > 0) points.timer = setTimeout(refresh, wait)
		else refresh()
	}

	const schedule = () => {
		const refresh = refreshRef.current
		if (!refresh.mounted) return
		refresh.pending = true
		if (refresh.running || timerRef.current) return
		timerRef.current = setTimeout(async () => {
			timerRef.current = undefined
			refresh.running = true
			// Consume only events already scheduled. Changes received while waiting
			// must survive: a newly mounted filter can start a read outside the snapshot.
			refresh.pending = false
			try {
				// A read started before this event can still return older data. Wait
				// for it before invalidating, so the change gets a fresh request.
				const inFlight = queryClient
					.getQueryCache()
					.findAll({queryKey: [['photos']]})
					.filter((query) => query.state.fetchStatus === 'fetching')
					.flatMap((query) => (query.promise ? [query.promise] : []))
				if (inFlight.length > 0) await Promise.allSettled(inFlight)
				if (!refresh.mounted) return
				// Queries share the file-index worker with thumbnail resolution. Let
				// in-flight reads finish, and coalesce changes during a slow refresh
				// into one follow-up instead of canceling and enqueueing more reads.
				const options = {cancelRefetch: false}
				refreshMapPoints()
				const requests: Promise<unknown>[] = [
					utils.photos.library.summary.invalidate(undefined, undefined, options),
					utils.photos.sources.invalidate(undefined, undefined, options),
					utils.photos.albums.invalidate(undefined, undefined, options),
					utils.photos.items.get.invalidate(undefined, undefined, options),
					queryClient.invalidateQueries({queryKey: ITEMS_LIST_KEY, refetchType: 'none'}),
				]
				// Refetch shallow lists; leave deep ones stale for their next mount.
				for (const query of queryClient.getQueryCache().findAll({queryKey: ITEMS_LIST_KEY})) {
					const pages = (query.state.data as InfiniteData<ItemsPage> | undefined)?.pages.length ?? 0
					if (pages <= REFETCH_IN_PLACE_MAX_PAGES && query.getObserversCount() > 0) {
						requests.push(query.fetch(undefined, options))
					}
				}
				await Promise.allSettled(requests)
			} finally {
				refresh.running = false
				if (refresh.pending) schedule()
			}
		}, 1000)
	}

	useEffect(() => {
		refreshRef.current.mounted = true
		return () => {
			refreshRef.current.mounted = false
			refreshRef.current.pending = false
			clearTimeout(timerRef.current)
			timerRef.current = undefined
			// A refresh of the map's points still to come is owed: they are only
			// marked stale, for the map to fetch when it is next opened
			if (mapPointsRef.current.timer) {
				clearTimeout(mapPointsRef.current.timer)
				mapPointsRef.current.timer = undefined
				void queryClient.invalidateQueries({queryKey: MAP_POINTS_KEY, refetchType: 'none'})
			}
		}
	}, [])

	trpcReact.eventBus.listen.useSubscription(
		{event: 'photos:indexing-progress'},
		{
			onData: (state) => {
				const version = ++indexingVersionRef.current
				const nextState = state as LibraryStatus
				// An event can overtake the initial status query. Cancel that older
				// response before publishing the authoritative streamed snapshot.
				void utils.photos.library.status.cancel().then(() => {
					if (version === indexingVersionRef.current) {
						const previousState = utils.photos.library.status.getData()
						utils.photos.library.status.setData(undefined, nextState)
						// A reconnect can seed ready after its matching photos:change was
						// missed. Reuse the bounded list refresh instead of refetching every
						// page of a deep timeline.
						if (nextState.phase === 'ready' && previousState && previousState.phase !== 'ready') schedule()
					}
				})
			},
			onError: (err) => console.error('eventBus.listen(photos:indexing-progress)', err),
		},
	)

	trpcReact.eventBus.listen.useSubscription(
		{event: 'photos:change'},
		{
			onStarted: () => {
				// Refresh details after subscribing to catch changes missed while Photos was closed.
				// Cancel older reads first so late responses cannot restore stale cached details.
				void utils.photos.items.get.cancel().then(() => utils.photos.items.get.invalidate())
				// The map's points too, which wait for change events rather than going
				// stale: refetched if the map is up (a read it has just begun is new
				// enough), otherwise left stale for when it is
				void queryClient.invalidateQueries({queryKey: MAP_POINTS_KEY}, {cancelRefetch: false})
			},
			onData: schedule,
			onError: (err) => console.error('eventBus.listen(photos:change)', err),
		},
	)
}
