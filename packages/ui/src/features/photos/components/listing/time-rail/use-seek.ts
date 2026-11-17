import {useQueryClient} from '@tanstack/react-query'
import {getQueryKey} from '@trpc/react-query'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'

import {monthStartUtc, type MonthKey} from '@/features/photos/components/listing/time-rail/rail-scale'
import {usePhotosView} from '@/features/photos/components/view-context'
import {listKey, tailFilter, type ItemFilter, type ItemsPage} from '@/features/photos/hooks/use-items'
import {trpcReact} from '@/trpc/trpc'
import {MS_PER_MINUTE} from '@/utils/date-time'

// Jumping past the loading frontier. Keyset pagination can only walk
// forward, so reaching a month nothing has loaded yet by paging is a run of
// requests as long as the library is deep — on a slow link, most of a minute
// of looking at the wrong year. A jump doesn't wait for that. It asks for the
// month directly: the list's tail from the month on (see tailFilter) is one
// request wherever the month is, and it goes on screen in place of the list
// from the top (PhotosView.tail) the moment it arrives.
//
// Behind it the list from the top is paged down to meet the tail — at the
// contract's ceiling, 1000 a page, however small the session's own page
// size, each page spliced into the infinite-query cache every list shares
// (cursors are opaque positions, not offsets, so pages of different lengths
// chain fine). Those pages are for later, so each waits its turn behind the
// photographs on screen (`idle`): on a slow link they would otherwise take
// the wire from the very thumbnails the jump was for. Once the list holds
// everything the tail does the two are the same photographs, and the grid
// is handed back the whole list the next time it rests: it keeps the tile
// under the eye where it is (see TimelineGrid), so all anyone sees is that
// there is now something to scroll up into.
//
// While those pages land in a list that is itself on screen, the grid's own
// load-ahead must stand down (it gates on `busy`): both would chain a fetch
// from the same tail cursor, and the same page would splice in twice.
//
// The same paging, run to the end of the list, is how everything in a view
// is selected (`loadAll`): the list is then all there, and so are its ids.

const SEEK_LIMIT = 1000
// A tail left in the cache by an earlier jump is good to land on again for
// this long: nothing refreshes one that isn't on screen
const TAIL_FRESH_MS = MS_PER_MINUTE
// However deep the tail, stop somewhere: 500 pages is half a million items
const SEEK_MAX_PAGES = 500
// An in-flight page the grid's load-ahead already started must land before
// the first splice. Wait it out, bounded.
const FETCH_WAIT_MS = 50
const FETCH_WAIT_MAX = 100
// The grid is at rest once it has been still this long with no finger on it
const REST_MS = 200

// What a jump hands the landing once its photographs are in hand: `show`
// puts their list on screen, and `first` is that list's first item — how the
// landing knows the grid has taken it up
export type Arrival = {first: string | undefined; show: () => void}

export type Seek = {
	// While true the grid must not page on its own (see the load-ahead effect)
	busy: boolean
	// The month a jump is waiting on — what the rail's pill names; null at rest
	target: MonthKey | null
	// `before`: the moment the stretch runs back from, when it is not the end
	// of the month — for landing on one photograph rather than on its month
	start: (key: MonthKey, arrive: (arrival: Arrival) => void, options?: {before?: number}) => void
	// Never mind the jump being waited on
	cancel: () => void
	// Pages the list from the top to its end, and resolves with the id of
	// everything in it — or with null if it could not be had whole (a page
	// failed, or the listing was left meanwhile)
	loadAll: () => Promise<string[] | null>
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// The oldest loaded item across pages (a trailing page can be empty)
function oldestLoaded(pages: ItemsPage[]) {
	for (let index = pages.length - 1; index >= 0; index--) {
		const {items} = pages[index]!
		if (items.length > 0) return items[items.length - 1]
	}
	return undefined
}

// The next time the scroller has been still for a beat with no finger on it.
// What is about to happen moves the scroll position (content arrives above
// the viewport), and a scroll in flight would carry that away: iOS keeps a
// fling on the course it was thrown at, whatever is written under it.
function atRest(scroller: HTMLElement) {
	return new Promise<void>((resolve) => {
		let touches = 0
		let timer: ReturnType<typeof setTimeout>
		const moving = ['scroll', 'wheel'] as const
		const settle = () => {
			clearTimeout(timer)
			timer = setTimeout(() => {
				if (touches > 0) return
				for (const type of moving) scroller.removeEventListener(type, settle)
				scroller.removeEventListener('touchstart', onTouch)
				scroller.removeEventListener('touchend', onTouch)
				scroller.removeEventListener('touchcancel', onTouch)
				resolve()
			}, REST_MS)
		}
		const onTouch = (event: TouchEvent) => {
			touches = event.touches.length
			settle()
		}
		for (const type of moving) scroller.addEventListener(type, settle, {passive: true})
		scroller.addEventListener('touchstart', onTouch, {passive: true})
		scroller.addEventListener('touchend', onTouch, {passive: true})
		scroller.addEventListener('touchcancel', onTouch, {passive: true})
		settle()
	})
}

export function useSeek({
	filter,
	pageSize,
	scrollerRef,
	idle,
}: {
	filter: ItemFilter
	pageSize: number
	scrollerRef: {readonly current: HTMLElement | null}
	// Resolves once what is on screen has its photographs
	idle: () => Promise<void>
}): Seek {
	const queryClient = useQueryClient()
	const utils = trpcReact.useUtils()
	const {setTail} = usePhotosView()
	const [target, setTarget] = useState<MonthKey | null>(null)
	// True while pages are being spliced into the list from the top
	const [paging, setPaging] = useState(false)
	// Whether the list on screen is the tail this hook opened
	const [tailed, setTailed] = useState(false)
	const state = useRef({
		// The jump being waited on
		pending: null as {key: MonthKey; before: number; cancelled: boolean; arrive: (arrival: Arrival) => void} | null,
		// Where the tail on screen runs back from
		tail: null as number | null,
		// The paging under way, and whether the list is being brought to a tail
		paged: null as Promise<void> | null,
		joining: false,
		disposed: false,
	})

	const lists = useMemo(() => {
		const input = {filter, limit: pageSize}
		const tailInput = (before: number) => ({filter: tailFilter(filter, before), limit: pageSize})
		return {
			input,
			tailInput,
			whole: () => utils.photos.items.list.getInfiniteData(input),
			tail: (before: number) => utils.photos.items.list.getInfiniteData(tailInput(before)),
		}
	}, [filter, pageSize, utils])

	const cancel = useCallback(() => {
		const {pending} = state.current
		if (!pending) return
		pending.cancelled = true
		state.current.pending = null
		setTarget(null)
	}, [])

	const open = useCallback(
		(before: number | null) => {
			state.current.tail = before
			setTailed(before !== null)
			setTail(before === null ? null : {list: listKey(filter), before})
		},
		[filter, setTail],
	)

	// Leaving the listing abandons the jump and the tail (the grid remounts per filter)
	useEffect(() => {
		const current = state.current
		current.disposed = false
		return () => {
			current.disposed = true
			cancel()
			if (current.tail !== null) setTail(null)
			current.tail = null
		}
	}, [cancel, setTail])

	// Pages the list from the top until `done`, or until it runs out, each
	// page after `turn`. One run at a time: a second waits for the first,
	// then looks for itself.
	const pageDown = useCallback(
		(done: (pages: ItemsPage[]) => boolean, turn?: () => Promise<void>) => {
			const current = state.current
			const run = async () => {
				const {input} = lists
				const infiniteKey = getQueryKey(trpcReact.photos.items.list, input, 'infinite')
				// A fetch of the list itself under way (bounded): the grid's own next
				// page, or a refresh of the list in place after a change somewhere
				const settled = async () => {
					for (
						let waited = 0;
						queryClient.isFetching({queryKey: infiniteKey}) > 0 && waited < FETCH_WAIT_MAX;
						waited++
					) {
						await sleep(FETCH_WAIT_MS)
					}
				}
				await settled()
				for (let page = 0; page < SEEK_MAX_PAGES && !current.disposed; page++) {
					await turn?.()
					const data = lists.whole()
					if (current.disposed || !data || data.pages.length === 0 || done(data.pages)) return
					const cursor = data.pages[data.pages.length - 1]!.nextCursor
					if (cursor === undefined) return
					const fetched = await utils.client.photos.items.list.query({filter, cursor, limit: SEEK_LIMIT})
					// … and one that went out while this page was on its way lands
					// first: its answer is the list as it asked for it, without this
					// page, and arriving after the splice it would take the page (and
					// every one spliced since) back out. On a slow link a change
					// event's refresh did exactly that to a Select all, which ended
					// with the first page selected and nothing to say so.
					await settled()
					utils.photos.items.list.setInfiniteData(input, (latest) => {
						// Splice only onto the tail this page was fetched from —
						// if anything moved it (it shouldn't, the grid is gated),
						// drop the page and let the next lap re-read
						if (!latest || latest.pages[latest.pages.length - 1]?.nextCursor !== cursor) return latest
						return {pages: [...latest.pages, fetched], pageParams: [...latest.pageParams, cursor]}
					})
				}
			}
			const paged = (current.paged ?? Promise.resolve()).then(async () => {
				setPaging(true)
				// A page that fails leaves the list where it got to
				await run().catch(() => undefined)
				if (current.paged !== paged) return
				current.paged = null
				if (!current.disposed) setPaging(false)
			})
			current.paged = paged
			return paged
		},
		[filter, lists, queryClient, utils],
	)

	// Behind a tail: bring the list from the top down to it, and hand the grid
	// the whole list once it rests. The tail keeps paging while this runs, and
	// a later jump can replace it, so every lap looks at both again.
	const join = useCallback(async () => {
		const current = state.current
		if (current.joining) return
		current.joining = true
		// Whether the list from the top holds everything the tail on screen does
		const met = (pages: ItemsPage[]) => {
			const reached = current.tail === null ? undefined : oldestLoaded(lists.tail(current.tail)?.pages ?? [])
			const oldest = oldestLoaded(pages)
			return !reached || (oldest !== undefined && oldest.takenAt < reached.takenAt)
		}
		try {
			while (current.tail !== null && !current.disposed) {
				await pageDown(met, idle)
				const scroller = scrollerRef.current
				if (scroller) await atRest(scroller)
				if (current.disposed || current.tail === null) return
				const pages = lists.whole()?.pages
				// Nothing to join it to (the list from the top was dropped, or
				// can't be paged): the tail stays
				if (!pages || pages.length === 0) return
				if (met(pages) || pages[pages.length - 1]!.nextCursor === undefined) return open(null)
			}
		} finally {
			current.joining = false
		}
	}, [lists, pageDown, open, scrollerRef, idle])

	const start = useCallback(
		(key: MonthKey, arrive: (arrival: Arrival) => void, options?: {before?: number}) => {
			const current = state.current
			const before = options?.before ?? monthStartUtc(key + 1)
			// Already on its way (a scrub that rested on the month, then let go there)
			if (current.pending?.key === key && current.pending.before === before) {
				current.pending.arrive = arrive
				return
			}
			cancel()
			const pending = {key, before, cancelled: false, arrive}
			current.pending = pending
			setTarget(key)
			const settle = (arrival?: Arrival) => {
				if (pending.cancelled || current.disposed) return
				current.pending = null
				setTarget(null)
				if (arrival) pending.arrive(arrival)
			}
			const showWhole = (): Arrival => ({first: lists.whole()?.pages[0]?.items[0]?.id, show: () => open(null)})

			// The list from the top already holds the month (the jump came from a
			// tail further down), or holds everything there is
			const pages = lists.whole()?.pages ?? []
			const oldest = oldestLoaded(pages)
			if ((oldest && oldest.takenAt < before) || pages[pages.length - 1]?.nextCursor === undefined) {
				return settle(showWhole())
			}

			// A tail from this moment that is already here is landed on as it is —
			// the one on screen, or one an earlier jump left that is still fresh.
			// An older one is let go and asked for again: lists are never
			// refetched behind Photos' back (see use-items.ts), so nothing else
			// would bring it up to date.
			const tailKey = getQueryKey(trpcReact.photos.items.list, lists.tailInput(before), 'infinite')
			const cached = queryClient.getQueryCache().find({queryKey: tailKey, exact: true})
			const usable =
				cached?.state.data !== undefined &&
				(cached.getObserversCount() > 0 ||
					(!cached.state.isInvalidated && Date.now() - cached.state.dataUpdatedAt < TAIL_FRESH_MS))
			if (cached && !usable) queryClient.removeQueries({queryKey: tailKey, exact: true})
			const held = usable ? lists.tail(before) : undefined
			const ready = held
				? Promise.resolve(held)
				: utils.photos.items.list.fetchInfinite(lists.tailInput(before), {initialCursor: undefined})
			ready.then(
				async (tail) => {
					const first = tail.pages[0]?.items[0]
					if (first) {
						return settle({
							first: first.id,
							show: () => {
								open(before)
								void join()
							},
						})
					}
					// Nothing as old as the month (the rail's far end was an estimate):
					// the end of the listing is its neighbour, and reaching that is
					// paging to it
					await pageDown(() => false)
					settle(showWhole())
				},
				() => settle(),
			)
		},
		[lists, utils, queryClient, cancel, open, join, pageDown],
	)

	const loadAll = useCallback(async () => {
		await pageDown(() => false)
		const pages = lists.whole()?.pages
		if (state.current.disposed || !pages || pages.length === 0) return null
		if (pages[pages.length - 1]!.nextCursor !== undefined) return null
		return pages.flatMap((page) => page.items.map((item) => item.id))
	}, [pageDown, lists])

	return useMemo(
		() => ({busy: paging && !tailed, target, start, cancel, loadAll}),
		[paging, tailed, target, start, cancel, loadAll],
	)
}
