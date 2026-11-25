import {useQueryClient, type InfiniteData} from '@tanstack/react-query'
import {useEffect, useRef} from 'react'

import {moveActivity} from '@/features/photos/hooks/move-activity'
import {isUniformList, ITEMS_LIST_KEY, type ItemsPage} from '@/features/photos/hooks/use-items'
import {MAP_POINTS_KEY} from '@/features/photos/hooks/use-map-points'
import {SEARCH_QUERY_KEY, type SearchStatus} from '@/features/photos/hooks/use-search'
import {trpcReact, type RouterOutput} from '@/trpc/trpc'

// tRPC's mutation-key prefix for every change to people (rename, merge, hide, …)
const PEOPLE_MUTATION_KEY = [['photos', 'people']] as const

type LibraryStatus = RouterOutput['photos']['library']['status']

// A list with this many pages or fewer is cheap to refresh in place; deeper
// lists are only marked stale, so a scrolled-deep user isn't hit with dozens
// of page refetches because a file changed somewhere. So is one holding the
// larger pages a jump along the rail splices in, however few: refetched, it
// would come back shorter than it was (see "Keeping a list up to date" in
// use-items.ts).
const REFETCH_IN_PLACE_MAX_PAGES = 3

// The map's points are every located item, the heaviest read Photos has. They
// are refreshed at once after a quiet spell, and at most this often while the
// library keeps changing — an import changes it every second for hours.
const MAP_POINTS_REFRESH_MS = 10_000

// A ranked search has Search read its words with a model for every page on
// screen, and is paced the same way: asked again on every change, it was
// answering for the whole of an import or of the library being read.
const SEARCH_REFRESH_MS = 10_000

// A refresh run at once after a quiet spell, and at most every `everyMs`
// while it keeps being asked for
type Paced = {refreshedAt: number; timer?: ReturnType<typeof setTimeout>}
function refreshPaced(paced: Paced, everyMs: number, refresh: () => void) {
	if (paced.timer) return
	const run = () => {
		paced.timer = undefined
		paced.refreshedAt = Date.now()
		refresh()
	}
	const wait = paced.refreshedAt + everyMs - Date.now()
	if (wait > 0) paced.timer = setTimeout(run, wait)
	else run()
}

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
	const mapPointsRef = useRef<Paced>({refreshedAt: 0})
	const searchesRef = useRef<Paced>({refreshedAt: 0})

	const refreshMapPoints = () =>
		refreshPaced(mapPointsRef.current, MAP_POINTS_REFRESH_MS, () => {
			// A read already under way may predate the change: this replaces it
			void queryClient.invalidateQueries({queryKey: MAP_POINTS_KEY})
		})

	// A ranked search is one request a page: the one on screen is asked again,
	// the rest wait stale for whoever shows them next
	const refreshSearches = () =>
		refreshPaced(searchesRef.current, SEARCH_REFRESH_MS, () => {
			// A delete or restore of this session's own began while this waited
			// its turn: the search is asked once it has finished, not for the
			// items it is still taking away
			if (moveActivity.isRunning()) return
			for (const query of queryClient.getQueryCache().findAll({queryKey: SEARCH_QUERY_KEY})) {
				if (query.isActive()) void query.fetch(undefined, {cancelRefetch: false}).catch(() => undefined)
			}
		})

	const schedule = () => {
		const refresh = refreshRef.current
		if (!refresh.mounted) return
		refresh.pending = true
		// A delete or restore of this session's own is still being carried out,
		// and these are its own events: the library is read once it has finished
		// (see move-activity.ts), not from half-way through
		if (moveActivity.isRunning()) return
		if (refresh.running || timerRef.current) return
		timerRef.current = setTimeout(async () => {
			timerRef.current = undefined
			// … including one that began while this refresh was waiting its turn
			if (moveActivity.isRunning()) return
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
				if (moveActivity.isRunning()) {
					refresh.pending = true
					return
				}
				// Queries share the file-index worker with thumbnail resolution. Let
				// in-flight reads finish, and coalesce changes during a slow refresh
				// into one follow-up instead of canceling and enqueueing more reads.
				const options = {cancelRefetch: false}
				refreshMapPoints()
				const requests: Promise<unknown>[] = [
					utils.photos.library.summary.invalidate(undefined, undefined, options),
					utils.photos.sources.invalidate(undefined, undefined, options),
					utils.photos.albums.invalidate(undefined, undefined, options),
					// People are left alone while a change to them of this session's
					// own is on its way: read now, they could come back as they were
					// before it and undo on screen what it has already shown. The
					// change reads them itself once it has settled.
					...(queryClient.isMutating({mutationKey: PEOPLE_MUTATION_KEY}) > 0
						? []
						: [utils.photos.people.invalidate(undefined, undefined, options)]),
					utils.photos.items.get.invalidate(undefined, undefined, options),
					queryClient.invalidateQueries({queryKey: ITEMS_LIST_KEY, refetchType: 'none'}),
					queryClient.invalidateQueries({queryKey: SEARCH_QUERY_KEY, refetchType: 'none'}),
				]
				// Refetch shallow lists that something is showing; leave deep ones
				// stale for their next mount. (Showing, not merely subscribed to: the
				// command palette keeps a list of its own under this key while it is
				// closed, and a change a second for the length of an import was a
				// request a second for results nobody was looking at.)
				for (const query of queryClient.getQueryCache().findAll({queryKey: ITEMS_LIST_KEY})) {
					const pages = (query.state.data as InfiniteData<ItemsPage> | undefined)?.pages.length ?? 0
					if (pages <= REFETCH_IN_PLACE_MAX_PAGES && isUniformList(query) && query.isActive()) {
						requests.push(query.fetch(undefined, options))
					}
				}
				refreshSearches()
				await Promise.allSettled(requests)
			} finally {
				refresh.running = false
				if (refresh.pending) schedule()
			}
		}, 1000)
	}

	useEffect(() => {
		refreshRef.current.mounted = true
		// The refresh held back while a delete or restore ran
		const stopListening = moveActivity.onIdle(() => {
			if (refreshRef.current.pending) schedule()
		})
		return () => {
			stopListening()
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
			// … and a search's is already marked stale
			clearTimeout(searchesRef.current.timer)
			searchesRef.current.timer = undefined
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

	// How far Search has read the library: the People page's progress and the
	// "warming up" note follow it live
	trpcReact.eventBus.listen.useSubscription(
		{event: 'search:indexing-progress'},
		{
			onData: (status) => utils.search.status.setData(undefined, status as SearchStatus),
			onError: (err) => console.error('eventBus.listen(search:indexing-progress)', err),
		},
	)

	// Whether the change subscription has started before: a later start is the
	// socket back after a gap
	const subscribedRef = useRef(false)
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
				// Changes while the socket was down were never heard, and the lists
				// are nobody else's to refresh: the same bounded refresh one change
				// would have brought
				if (subscribedRef.current) schedule()
				subscribedRef.current = true
			},
			onData: schedule,
			onError: (err) => console.error('eventBus.listen(photos:change)', err),
		},
	)
}
