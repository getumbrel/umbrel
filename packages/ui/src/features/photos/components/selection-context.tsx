import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from 'react'
import {useLocation, useNavigate} from 'react-router-dom'

import {BASE_ROUTE_PATH} from '@/features/photos/constants'

type PhotosSelection = {
	// The selected items. A new set on every change, so a consumer can compare
	// by identity; never mutated.
	ids: ReadonlySet<string>
	// Selection mode: something is selected, or the user entered it themselves
	// (the Select button) and hasn't pressed Done. Tiles show their circles,
	// a click toggles instead of opening, and the actions bar shows the
	// selection's actions.
	selecting: boolean
	// Enter selection mode with nothing selected yet
	start: () => void
	// Leave it, dropping the selection
	done: () => void
	toggle: (id: string) => void
	// Replace the selection
	set: (ids: Iterable<string>) => void
	// Drop what has left a list: what it held (`was`) and no longer does
	// (`now`). What was selected somewhere else is not the list's to drop.
	retain: (was: Pick<ReadonlySet<string>, 'has'>, now: ReadonlySet<string>) => void
	// The album items are being picked for, while they are: selection mode
	// that follows the user from view to view — the library, Videos, a
	// person, another album — gathering one selection for the album, until
	// it is added (or picking is cancelled) with `done`. Picking starts in
	// the whole library.
	pickingFor: string | undefined
	pickFor: (albumId: string) => void
	// The album a cover is being chosen for, while one is: selection mode on
	// the album's own page where the first item chosen becomes the cover (a
	// cover must be one of the album's items, so leaving the page cancels).
	// While it's on, the selection itself is inert — nothing accumulates.
	coveringFor: string | undefined
	coverFor: (albumId: string) => void
	// Ends cover mode after a choice. When `coverFor` navigated to the album's
	// page (the albums grid, another view's sidebar card), the choice returns
	// the user where they came from; choosing from the album's own page stays.
	coverChosen: () => void
}

const EMPTY: ReadonlySet<string> = new Set()
const PhotosSelectionContext = createContext<PhotosSelection | undefined>(undefined)

// Which items are selected, shared between the listing (where they are
// picked) and the actions bar (which acts on them). Its own context, apart
// from the view state: selection changes on every click and marquee frame,
// and only these two need to hear about it.
//
// Mode is derived, not stored: it holds as long as anything is selected, so
// on desktop unchecking the last item leaves it, while the Select button
// (touch, where nothing can be hovered) holds it open until Done.
export function PhotosSelectionProvider({children}: {children: ReactNode}) {
	const [ids, setIds] = useState(EMPTY)
	const [explicit, setExplicit] = useState(false)
	const [pickingFor, setPickingFor] = useState<string>()
	const [coveringFor, setCoveringFor] = useState<string>()
	// Where `coverFor` navigated from, when it did: a chosen cover returns
	// there. Cancelling stays put, and leaving the page cancels instead.
	const coveringFrom = useRef<string>(undefined)
	// Read by the otherwise-stable callbacks, so entering cover mode doesn't
	// change their identity for every consumer that lists them as deps
	const covering = useRef<string>(undefined)
	useLayoutEffect(() => {
		covering.current = coveringFor
	}, [coveringFor])

	// A new route is a new list: nothing from the old one stays selected —
	// unless the selection is being gathered for an album, when it is the
	// point that it carries across
	const {pathname} = useLocation()
	const navigate = useNavigate()
	useEffect(() => {
		if (pickingFor) return
		setIds(EMPTY)
		setExplicit(false)
	}, [pathname, pickingFor])
	// Covering is the album page's own mode: anywhere else there is nothing
	// valid to choose (the backend only accepts one of the album's items).
	// Cancelled on leaving the page — but only once the mode has arrived
	// there: `coverFor` sets the mode and navigates together, and this effect
	// can run between the two, when the pathname is still the old page's.
	// Which album arrived, not whether: an arrival for album A must not count
	// against a covering just switched to album B mid-navigation.
	const coveringArrived = useRef<string>(undefined)
	useEffect(() => {
		if (!coveringFor) {
			coveringArrived.current = undefined
			return
		}
		if (pathname === `${BASE_ROUTE_PATH}/albums/${coveringFor}`) coveringArrived.current = coveringFor
		else if (coveringArrived.current === coveringFor) {
			coveringArrived.current = undefined
			coveringFrom.current = undefined
			setCoveringFor(undefined)
		}
	}, [pathname, coveringFor])

	const start = useCallback(() => setExplicit(true), [])
	const done = useCallback(() => {
		setIds(EMPTY)
		setExplicit(false)
		setPickingFor(undefined)
		setCoveringFor(undefined)
		coveringFrom.current = undefined
	}, [])
	const pickFor = useCallback(
		(albumId: string) => {
			setIds(EMPTY)
			setCoveringFor(undefined)
			coveringFrom.current = undefined
			setPickingFor(albumId)
			navigate(BASE_ROUTE_PATH)
		},
		[navigate],
	)
	const coverFor = useCallback(
		(albumId: string) => {
			setIds(EMPTY)
			setExplicit(false)
			setPickingFor(undefined)
			setCoveringFor(albumId)
			// Already on the album's page (its own sidebar card): navigating
			// again would only push a dead history entry
			const path = `${BASE_ROUTE_PATH}/albums/${albumId}`
			coveringFrom.current = pathname !== path ? pathname : undefined
			if (pathname !== path) navigate(path)
		},
		[navigate, pathname],
	)
	const coverChosen = useCallback(() => {
		const returnTo = coveringFrom.current
		done()
		if (returnTo) navigate(returnTo)
	}, [done, navigate])
	const toggle = useCallback(
		(id: string) =>
			setIds((prev) => {
				if (covering.current) return prev
				const next = new Set(prev)
				if (!next.delete(id)) next.add(id)
				return next
			}),
		[],
	)
	const set = useCallback((next: Iterable<string>) => setIds((prev) => (covering.current ? prev : new Set(next))), [])
	const retain = useCallback(
		(was: Pick<ReadonlySet<string>, 'has'>, now: ReadonlySet<string>) =>
			setIds((prev) => {
				if (prev.size === 0) return prev
				const next = new Set([...prev].filter((id) => now.has(id) || !was.has(id)))
				return next.size === prev.size ? prev : next
			}),
		[],
	)

	const value = useMemo<PhotosSelection>(
		() => ({
			ids,
			selecting: explicit || ids.size > 0 || pickingFor !== undefined || coveringFor !== undefined,
			start,
			done,
			toggle,
			set,
			retain,
			pickingFor,
			pickFor,
			coveringFor,
			coverFor,
			coverChosen,
		}),
		[ids, explicit, start, done, toggle, set, retain, pickingFor, pickFor, coveringFor, coverFor, coverChosen],
	)
	return <PhotosSelectionContext value={value}>{children}</PhotosSelectionContext>
}

export function usePhotosSelection() {
	const ctx = useContext(PhotosSelectionContext)
	if (!ctx) throw new Error('usePhotosSelection must be used within <PhotosSelectionProvider />')
	return ctx
}
