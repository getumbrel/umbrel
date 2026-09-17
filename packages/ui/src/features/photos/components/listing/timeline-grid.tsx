import {useReducedMotion} from 'motion/react'
import {
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
	type ReactNode,
} from 'react'
import {useTranslation} from 'react-i18next'
import {TbLoader} from 'react-icons/tb'

import {FadedScroller} from '@/features/photos/components/listing/faded-scroller'
import {TileCanvas, useDevicePixelRatio, type TileCanvasHandle} from '@/features/photos/components/listing/gpu'
import {
	atlasPlan,
	bandFor,
	cellForBand,
	GPU_OVERSCAN,
	noteContextLoss,
	webgl2Limits,
} from '@/features/photos/components/listing/gpu/capability'
import {thumbSizeForTile} from '@/features/photos/components/listing/item-thumbnail'
import {ItemTile} from '@/features/photos/components/listing/item-tile'
import {LIVE_MIN_TILE, useLiveHover} from '@/features/photos/components/listing/live-hover'
import {useMarquee} from '@/features/photos/components/listing/marquee'
import {attachPinch} from '@/features/photos/components/listing/pinch'
import {ReflowMotion} from '@/features/photos/components/listing/reflow-motion'
import {isWholeLibrary} from '@/features/photos/components/listing/route-filter'
import type {Frame} from '@/features/photos/components/listing/surface'
import {ThumbnailQueue} from '@/features/photos/components/listing/thumbnail-queue'
import {TileLayer} from '@/features/photos/components/listing/tile-layer'
import {createTileLift} from '@/features/photos/components/listing/tile-lift'
import {monthsFromItems, railDomain} from '@/features/photos/components/listing/time-rail/rail-scale'
import {
	RAIL_HIDE_VIEWPORTS,
	RAIL_SHOW_VIEWPORTS,
	TimeRail,
} from '@/features/photos/components/listing/time-rail/time-rail'
import {useSeek} from '@/features/photos/components/listing/time-rail/use-seek'
import {
	anchoredScrollTop,
	blend,
	columnRange,
	columnValue,
	defaultFocalY,
	findAnchor,
	FOOTER_HEIGHT,
	gridLayout,
	groupItems,
	HEADER_HEIGHT,
	headersIn,
	itemAt,
	layoutAt,
	LOADER_HEIGHT,
	rectOf,
	sectionAt,
	tileBounds,
	tileGap,
	tileRadius,
	tileRect,
	tileSizeFor,
	visibleItems,
	type Anchor,
	type Header,
	type Layout,
	type Zoom,
} from '@/features/photos/components/listing/timeline-rows'
import {ZoomGesture} from '@/features/photos/components/listing/zoom-gesture'
import {usePhotosSelection} from '@/features/photos/components/selection-context'
import {usePhotosView} from '@/features/photos/components/view-context'
import type {Item, ItemFilter, ThumbSize} from '@/features/photos/hooks/use-items'
import {useLibrarySummary} from '@/features/photos/hooks/use-library'
import {useContainerSize} from '@/hooks/use-container-size'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useDockClearance} from '@/modules/desktop/dock'
import {formatNumberI18n} from '@/utils/number'

const NONE: ReadonlySet<string> = new Set()

// Rendered beyond the viewport on each side: a few rows, up to a viewport's
// worth. Rows of big tiles get the pixels; at the small end a row holds
// dozens of tiles, and a few rows are plenty of slack against pop-in without
// mounting hundreds of tiles nobody sees.
// The canvas draws a band instead, and a generous one, because between
// redraws the band scrolls with the content on the compositor for nothing.
const OVERSCAN_ROWS = 4
const OVERSCAN_MAX_PX = 600
const overscanFor = ({layout, height, gpu}: {layout: Layout; height: number; gpu: boolean}) =>
	gpu ? height * GPU_OVERSCAN : Math.min(OVERSCAN_MAX_PX, OVERSCAN_ROWS * (layout.tile + layout.gap))
// Ask for the next page while the render window is within this many viewports of the end
const LOAD_AHEAD_VIEWPORTS = 2
// Reflows closer together than this are one gesture (a drag, a pinch, a run
// of clicks): the same tile stays anchored through all of them
const GESTURE_MS = 600
// … and within a gesture they come no closer together than this
const REFLOW_MIN_MS = 90
// A tile entering the window flies in from its previous place unless that is
// further away than this many viewports — then it just appears
const MAX_FLIGHT_VIEWPORTS = 1.5
// For this long after the commit that carries the grid up over the GPU seam,
// tiles show their photographs the moment they load instead of fading in from
// tint: the canvas was just drawing the same 192s, so the loads are cache
// hits, and pixels that were on screen a breath ago must not flash back
// through their colour on the way in. Long enough for a bandful of cache
// reads on a slow disk; a load past it is a genuine arrival and fades.
const SEAM_WARM_MS = 1500

// What the DOM shows: a layout, the rows mounted from it and the scroll
// position it was committed at. Adopted whole (see below), never piecemeal.
type View = {
	layout: Layout
	width: number
	height: number
	// The run of items mounted from it — items are ordered and a section's
	// rows are uniform, so a window is always an index range
	items: {start: number; end: number}
	scrollTop: number
	// Whether adopting this view over the previous one should be animated
	animate: boolean
	// Whether the tiles are drawn by the canvas rather than by elements
	gpu: boolean
	// Until when a tile's photograph is shown without its fade-in (see
	// SEAM_WARM_MS): set by the commit that crosses up over the seam, zero
	// everywhere else. An absolute time, so it expires on its own however
	// long the view is scrolled without a reflow.
	warmUntil: number
}

type Slot = {index: number; item: Item; x: number; y: number; size: number}

// Virtualized, date-grouped grid with spring-animated reflows. Fills its
// surface edge to edge; the top `frame.inset` px are under the actions bar
// floating over it, which tiles start below and, scrolling up, dissolve
// into from `frame.fadeFrom` on.
//
// Every group opens with a header row. The group at the top of the grid is
// the "current" section: its title is shown by the actions bar (see
// PhotosView.section) — in the row the grid scrolls under, where a sticky
// header would pin if the fade didn't hide it — and its own header row is
// left empty, sitting in the faded band just under the bar. Tiles live in
// one flat layer keyed by item, so a tile keeps its element (and its decoded
// image) when it moves to another row or group. Only what intersects the
// viewport (plus overscan) is mounted; the rest is arithmetic over the row
// offsets, so libraries of any size cost the same to scroll.
//
// When the layout changes — zoom slider, timeline grouping, a deleted item, a
// resize — the tile under the eye is kept where it is by adjusting scrollTop,
// and every mounted tile and header springs from where it was to where it
// now belongs (`ReflowMotion`). Positions are pure functions of the layout,
// so this never measures the DOM.
//
// Below the smallest tile elements can sensibly draw — a range the app has
// never offered, because ten thousand `<button>`s is not a tuning problem —
// the tiles become one WebGL2 canvas instead (see gpu/), and the zoom becomes
// continuous: the grid draws the blend of the layouts either side of a
// fractional column count on every frame, so a photo slides from the end of
// one row to the start of the next under your fingers. Headers, the loader
// and the marquee stay elements over it, hit testing stays arithmetic over
// the layout, and if the device has no WebGL2 the seam is simply the floor
// and this is the grid that has always shipped.
//
// Selection (see PhotosSelectionProvider) is picked here: a click on a
// tile's circle, or on any tile while selecting, toggles it; shift extends
// from the last one toggled; a mouse drag over the grid draws a box
// (useMarquee); ⌘A takes every loaded item and Escape leaves.
export function TimelineGrid({
	items,
	total,
	filter,
	hasMore,
	loadMore,
	frame,
	inDeleted,
	footer,
}: {
	items: Item[]
	// The filter's full match count, beyond the pages loaded so far — what
	// decides whether the listing is long enough to earn the time rail
	total?: number
	// The filter this list was asked with: the rail's seek pages the same
	// query, and the whole-library filter is the one the calendar describes
	filter: ItemFilter
	hasMore: boolean
	loadMore: () => void
	frame: Frame
	inDeleted: boolean
	// A quiet status line after the last row, once every page is loaded —
	// the layout reserves its band (see FOOTER_HEIGHT)
	footer?: ReactNode
}) {
	const {inset, handoff} = frame
	const {t, i18n} = useTranslation()
	const isMobile = useIsMobile()
	const reduceMotion = useReducedMotion() ?? false
	const {zoom, tileSize, setTileSize, setGrid, setSection, pageSize} = usePhotosView()
	const selection = usePhotosSelection()
	const scrollerRef = useRef<HTMLDivElement>(null)
	const contentRef = useRef<HTMLDivElement>(null)
	const layerRef = useRef<HTMLDivElement>(null)
	const canvasRef = useRef<TileCanvasHandle>(null)
	// The canvas has no :hover of its own
	const hoveredRef = useRef<string | undefined>(undefined)
	const {width, height} = useContainerSize(scrollerRef)
	// Trailing room for the last row to scroll clear of the dock the grid runs beneath
	const endSpacer = useDockClearance()
	// `columns` is the only zoom state and it is a float; see the Zoom section
	const [gesture] = useState(() => new ZoomGesture())
	// Who follows it live — the zoom slider's thumb — notified from the frame
	// loop, since a gesture is a run of frames rather than renders (see
	// GridHandle.liveColumns)
	const [zoomListeners] = useState(() => new Set<() => void>())

	// How far out this device can draw. Above `bounds.min` the grid is elements
	// and is exactly what has always shipped; below it — territory the app has
	// never offered — a single WebGL2 canvas takes over, and how far below is
	// a property of the atlas that device can hold, not a constant.
	const dpr = useDevicePixelRatio()
	const bounds = tileBounds(isMobile)
	const limits = webgl2Limits()
	const [gpuFailed, setGpuFailed] = useState(false)
	// The layers the atlas asks for follow the viewport, and a window being
	// dragged crosses their thresholds; rebuilding the canvas at each — a new
	// context, and every thumbnail in the band fetched again — is not worth
	// the texture memory, so a layer once given is kept
	const layersRef = useRef(0)
	const plan = useMemo(() => {
		const planned = limits && !gpuFailed ? atlasPlan({width, height}, dpr, limits, bounds) : null
		if (!planned) return null
		layersRef.current = Math.max(layersRef.current, planned.layers)
		return layersRef.current === planned.layers ? planned : {...planned, layers: layersRef.current}
	}, [limits, gpuFailed, width, height, dpr, bounds])
	const floor = plan?.floor ?? bounds.min

	const {columns, tile, gap} = useMemo(
		() => gridLayout(width, tileSize, isMobile, floor),
		[width, tileSize, isMobile, floor],
	)
	const gpu = plan !== null && tile < bounds.min
	// Below the seam a day header is taller than two rows of tiles and there
	// are tens of thousands of them: the grouping is years, full stop. It is
	// derived rather than stored, so the user's own choice is untouched and
	// comes back the moment they come back up.
	const grouping: Zoom = gpu ? 'years' : zoom
	// Grouping depends on the list and not on the column count, so it survives
	// every zoom stop; the layout below is a running sum over its sections
	const hasFooter = footer !== undefined
	const timeline = useMemo(
		() => groupItems({items, zoom: grouping, hasMore, language: i18n.language, footer: hasFooter}),
		[items, grouping, hasMore, i18n.language, hasFooter],
	)
	// The first row is the current section's (empty) header: it sits in the
	// faded band under the bar, so tiles start at the inset itself
	const layout = useMemo(
		() => layoutAt(timeline, columns, tile, gap, Math.max(0, inset - HEADER_HEIGHT)),
		[timeline, columns, tile, gap, inset],
	)

	// ── The time rail ──
	//
	// Only listings long enough that scrolling is work get one (measured in
	// viewports, below), and it replaces the scrollbar on that edge rather
	// than fighting it for the pixels. Its domain is the library calendar when
	// this listing is the whole library — exact to the month before a single
	// page beyond the first has loaded — and otherwise the loaded months plus
	// a tail estimated from what remains, refining as pages land.
	const {data: librarySummary, isError: summaryFailed} = useLibrarySummary()
	const wholeLibrary = useMemo(() => isWholeLibrary(filter), [filter])
	const seek = useSeek({filter, pageSize})
	const loadedMonths = useMemo(() => monthsFromItems(items), [items])
	const railBuckets = useMemo(
		() =>
			railDomain({
				loaded: loadedMonths,
				calendar: wholeLibrary ? librarySummary?.months : undefined,
				shape: librarySummary?.months,
				total,
			}),
		[loadedMonths, wholeLibrary, librarySummary, total],
	)
	// How long the whole timeline is, in viewports of scrolling: the loaded
	// layout's height extrapolated over the filter's total — rows are uniform,
	// so height scales with the item count. This is what the rail's threshold
	// actually means (see RAIL_SHOW_VIEWPORTS), and it makes the gate follow
	// the zoom and the window on its own.
	const railViewports = useMemo(() => {
		if (height === 0 || items.length === 0) return 0
		return (layout.total * ((total ?? items.length) / items.length)) / height
	}, [layout, total, items.length, height])
	const [showRail, setShowRail] = useState(false)
	useEffect(() => {
		// No span floor: a short domain changes what the rail labels (months,
		// days in the pill), never whether a long scroll gets an index. The
		// rail does hold off until the summary has answered: its first frame
		// should carry the real domain, not a density guess that reformats a
		// beat later — a slightly later fade-in over a visible snap.
		const domainReady = librarySummary !== undefined || summaryFailed
		const eligible = !isMobile && domainReady && railBuckets.length > 0
		setShowRail((on) =>
			on ? eligible && railViewports > RAIL_HIDE_VIEWPORTS : eligible && railViewports >= RAIL_SHOW_VIEWPORTS,
		)
	}, [isMobile, librarySummary, summaryFailed, railBuckets, railViewports])

	// The committed view. A new layout is adopted here, before paint, together
	// with the scroll position that keeps the focal tile still and the row
	// window for that position — so a single commit takes the DOM from the old
	// view to the new one. The render in between shows the old view unchanged.
	const [view, setView] = useState<View | null>(null)
	// … and the latest one, for the scroll listener
	const viewRef = useRef(view)
	useLayoutEffect(() => {
		viewRef.current = view
	}, [view])
	// The section at the top of the grid: the last one whose header has
	// reached the hand-off — where its title sits exactly where the bar's
	// does, so the title seems to arrive and stay — or the first until any has
	const [current, setCurrent] = useState<Header | null>(null)
	const handoffRef = useRef(handoff)
	useLayoutEffect(() => {
		handoffRef.current = handoff
	}, [handoff])
	const trackSection = (layout: Layout, scrollTop: number) => {
		const next = sectionAt(layout, scrollTop + handoffRef.current) ?? null
		setCurrent((prev) => (prev?.key === next?.key && prev?.title === next?.title ? prev : next))
	}
	// Published before paint, so the bar shows the title in the same frame the grid appears
	useLayoutEffect(() => {
		setSection(current?.title ?? null)
	}, [current, setSection])
	useEffect(() => () => setSection(null), [setSection])
	// Where to zoom about, in viewport px, when the pointer set it (wheel/pinch)
	const focalRef = useRef<{x: number; y: number} | null>(null)
	// … and where the eye last was, which is what pixels fill outward from.
	// Unlike the focal point above it is not consumed by a reflow: after a
	// pinch settles, the wave of arriving photographs should still start where
	// the fingers were.
	const eyeRef = useRef<{x: number; y: number} | null>(null)
	const [thumbnailQueue] = useState(() => new ThumbnailQueue())
	useLayoutEffect(() => {
		thumbnailQueue.priority = (index) => {
			const current = viewRef.current
			const scrollTop = scrollerRef.current?.scrollTop ?? 0
			if (!current) return {tier: 0, distance: index}
			const visible = visibleItems(current.layout, scrollTop, current.height, 0)
			const middle = (visible.start + visible.end) / 2
			return {
				tier: index < visible.start || index > visible.end ? 1 : 0,
				distance: Math.abs(index - middle),
			}
		}
	}, [thumbnailQueue])
	// The tile the last reflow kept still, reused while reflows keep coming so
	// one tile stays put through a whole gesture instead of drifting stop by stop
	const anchorRef = useRef<Anchor | null>(null)
	const adoptedAt = useRef(0)
	// Reflows are paced: a flick across the slider crosses many stops in a few
	// frames, and every stop re-rasterizes each tile at its new size. Adopting
	// the latest layout after a short beat instead lets the springs blend two
	// or three reflows into one continuous motion — and keeps the frames.
	// A deferred adoption re-runs the effect below through `attempt`: its other
	// inputs are unchanged by then, so without it the layout would be dropped
	// (the grid stayed one gutter narrower than its scroller at startup)
	const [attempt, retry] = useReducer((n: number) => n + 1, 0)
	useLayoutEffect(() => {
		if (width === 0 || height === 0) return
		if (view && view.layout === layout && view.height === height) return
		// While a gesture owns the canvas its frame loop is writing the
		// geometry; a layout arriving now (a page landing) waits for the frame
		// the gesture rests on, which always commits and so runs this again.
		// Unless the layout has left canvas territory: a gesture climbing past
		// the seam hands over to the DOM mid-flight, seeded from the last blend
		// the canvas drew — holding that commit back left the grid frozen on a
		// stale frame for the rest of the drag.
		if (view?.gpu && gesture.live && gpu) return
		const now = performance.now()
		const sinceLast = now - adoptedAt.current
		// Pacing exists because a DOM reflow re-rasterizes every <img>; the
		// canvas has nothing to re-rasterize, so a zoom below the seam commits
		// as fast as it comes. A window being dragged is different: it is a
		// storm of resizes whatever the renderer, and adopting every one of
		// them the moment it arrives puts React tens of commits deep before the
		// drag is over — which it eventually refuses to do.
		const resized = view !== null && (view.width !== width || view.height !== height)
		if (view && (!gpu || resized) && sinceLast < REFLOW_MIN_MS) {
			const timer = setTimeout(retry, REFLOW_MIN_MS - sinceLast)
			return () => clearTimeout(timer)
		}
		const current = scrollerRef.current?.scrollTop ?? 0
		const focal = focalRef.current ?? {y: defaultFocalY(current, height)}
		focalRef.current = null
		const last = anchorRef.current
		const inGesture = last !== null && sinceLast < GESTURE_MS && view?.width === width && layout.indexOf.has(last.id)
		const anchor = inGesture ? last : view ? findAnchor(view.layout, current, focal) : undefined
		const anchored = anchor && anchoredScrollTop(layout, anchor)
		const scrollTop = Math.max(0, Math.min(anchored ?? current, layout.total + endSpacer - height))
		// Remember where the anchor actually ended up: the clamp may have moved it
		anchorRef.current =
			anchor && anchored !== undefined ? {id: anchor.id, top: anchored + anchor.top - scrollTop} : null
		adoptedAt.current = now
		trackSection(layout, scrollTop)
		setView({
			layout,
			width,
			height,
			items: visibleItems(layout, scrollTop, height, overscanFor({layout, height, gpu})),
			scrollTop,
			animate: view !== null && view.width === width && !reduceMotion,
			gpu,
			warmUntil: view?.gpu && !gpu ? now + SEAM_WARM_MS : 0,
		})
	}, [layout, width, height, endSpacer, view, reduceMotion, gpu, attempt])

	// Scrolling only moves the row window (and the current section); the
	// geometry is untouched
	const onScroll = useCallback(() => {
		// A live gesture on the canvas writes scrollTop itself, in the same
		// frame it draws: the committed view must not chase it. Above the seam
		// the gesture only ever asks React for a stop, and a scroll under its
		// settle is a scroll like any other.
		if (gesture.live && viewRef.current?.gpu) return
		const scrollTop = scrollerRef.current?.scrollTop ?? 0
		if (viewRef.current) trackSection(viewRef.current.layout, scrollTop)
		setView((current) => {
			if (!current) return current
			const items = visibleItems(current.layout, scrollTop, current.height, overscanFor(current))
			return items.start === current.items.start && items.end === current.items.end ? current : {...current, items}
		})
	}, [gesture])

	const slots = useMemo(() => (view && !view.gpu ? slotsFor(view) : []), [view])
	// The rendition the mounted tiles want, from the device pixels each covers.
	// Near the seam that is the 192 the canvas draws its cells from, so a
	// crossing in either direction finds every visible thumbnail already in
	// the browser's cache and refetches nothing.
	const thumbSize: ThumbSize = view ? thumbSizeForTile(view.layout.tile * dpr) : 512
	const itemById = useMemo(() => new Map(slots.map((slot) => [slot.item.id, slot.item])), [slots])
	// A rested-on live tile plays its clip (mouse hover, DOM tiles only — the
	// canvas's tiles are below LIVE_MIN_TILE by definition): see useLiveHover
	const liveHover = useLiveHover({
		enabled: !reduceMotion && view !== null && !view.gpu && view.layout.tile >= LIVE_MIN_TILE,
		isLive: (id) => itemById.get(id)?.subKind === 'live',
	})
	// Headers in the window, less the current section's — its title is in the bar
	const headers = useMemo(
		() => (view ? headersFor(view).filter((header) => header.key !== current?.key) : []),
		[view, current],
	)

	// Reflow motion: elements register themselves by key; after every commit the
	// previous rect of each mounted element is compared with its new one
	const [tileEls] = useState(() => new Map<string, HTMLElement>())
	const [headerEls] = useState(() => new Map<string, HTMLElement>())
	const [motion] = useState(
		() =>
			new ReflowMotion((active) => {
				// Nothing is clickable (or hovers) while it's flying past
				if (layerRef.current) layerRef.current.style.pointerEvents = active ? 'none' : ''
			}),
	)
	useEffect(() => () => motion.stop(), [motion])
	const rects = useRef<{tiles: Map<string, Slot>; headers: Map<string, Header>} | null>(null)
	const appliedLayout = useRef<Layout | null>(null)
	// The last blend the canvas drew, so tiles coming back to the DOM at the
	// seam fly from where the pixels actually were rather than from the stop
	// the gesture started at, several column counts away
	const drawnLayout = useRef<Layout | null>(null)
	useLayoutEffect(() => {
		if (!view) return
		const scroller = scrollerRef.current!
		const previousLayout = appliedLayout.current
		const changed = previousLayout !== view.layout
		appliedLayout.current = view.layout
		const before = scroller.scrollTop
		if (changed) scroller.scrollTop = view.scrollTop
		const after = scroller.scrollTop
		const previous = rects.current
		// What to animate from: the previous view, when this commit replaced it
		// — or, where the canvas was moving, the last blend it drew, which is
		// what is on screen
		const was = drawnLayout.current ?? previousLayout
		drawnLayout.current = null
		const from = changed && view.animate && previous && was ? {...previous, layout: was} : null
		const tiles = new Map<string, Slot>()
		for (const slot of slots) {
			tiles.set(slot.item.id, slot)
			if (!from) continue
			const el = tileEls.get(slot.item.id)
			// Where the tile was: its last rendered rect, or its place in the
			// previous layout if it only now entered the window
			const old = from.tiles.get(slot.item.id) ?? tileRect(from.layout, slot.item.id)
			if (!el || !old) continue
			const dy = old.y - slot.y + (after - before)
			if (Math.abs(dy) < MAX_FLIGHT_VIEWPORTS * view.height) motion.seed(el, old.x - slot.x, dy, old.size / slot.size)
		}
		const placed = new Map<string, Header>()
		for (const header of headers) {
			placed.set(header.key, header)
			const old = from?.headers.get(header.key)
			const el = headerEls.get(header.key)
			if (old && el) motion.seed(el, 0, old.top - before - (header.top - after))
		}
		rects.current = {tiles, headers: placed}
	})

	// Fetch ahead of the render window. `loadMore` is idempotent while a page is
	// in flight, so re-running on every window change is harmless. This also
	// tops up a first page too short to scroll, which would never ask for more.
	// While the rail's seek is paging it stands down: both would chain a fetch
	// from the same tail cursor, and the same page would splice in twice.
	useEffect(() => {
		if (!view || !hasMore || seek.busy) return
		const {start, end} = view.items
		const bottom = end < start ? 0 : rectOf(view.layout, end).y + view.layout.tile
		if (bottom >= view.layout.total - LOAD_AHEAD_VIEWPORTS * view.height) loadMore()
	}, [view, hasMore, loadMore, seek.busy])

	// ── Selection ──
	const selectedIds = selection.ids
	const selectionRef = useRef(selectedIds)
	useLayoutEffect(() => {
		selectionRef.current = selectedIds
	}, [selectedIds])
	const itemIds = useMemo(() => new Set(items.map((item) => item.id)), [items])
	// Items that left the list (deleted, or the list refetched) leave the
	// selection — except while picking for an album, when the selection
	// spans every view and this list is only part of it
	const picking = selection.pickingFor !== undefined
	useEffect(() => {
		if (!picking) selection.retain(itemIds)
	}, [itemIds, selection.retain, picking])
	// … and for the same reason a marquee drag or ⌘A then replaces only this
	// list's part of it: what was picked elsewhere is held
	const heldRef = useRef<ReadonlySet<string>>(NONE)
	useLayoutEffect(() => {
		heldRef.current = picking ? new Set([...selectedIds].filter((id) => !itemIds.has(id))) : NONE
	}, [selectedIds, itemIds, picking])
	// The tile last toggled by a click: where a shift-click's range starts
	const rangeAnchor = useRef<string | null>(null)
	const select = (item: Item, range: boolean) => {
		const anchor = rangeAnchor.current
		if (range && anchor && anchor !== item.id) {
			const from = items.findIndex((candidate) => candidate.id === anchor)
			const to = items.findIndex((candidate) => candidate.id === item.id)
			if (from !== -1 && to !== -1) {
				const next = new Set(selectedIds)
				for (let index = Math.min(from, to); index <= Math.max(from, to); index++) next.add(items[index]!.id)
				selection.set(next)
				return
			}
		}
		selection.toggle(item.id)
		rangeAnchor.current = item.id
	}
	const marquee = useMarquee({scrollerRef, viewRef, selectionRef, heldRef, onSelect: selection.set})

	// ── Zoom ──
	//
	// `columns` is the only zoom state and it is a float. A two-finger pinch,
	// Safari's trackpad gestures, ctrl/⌘ + wheel and the slider all move it,
	// and the grid follows it from one frame loop rather than from React — so
	// a gesture is a run of frames, not a run of renders. Above the seam each
	// frame hands the DOM a whole column count and the paced reflow above
	// turns that into springs; below it the frames are drawn as they come, at
	// fractional counts, and tiles slide between rows under your fingers.
	//
	// What the handlers below need from this render: they are created once, so
	// they read the newest of these rather than a stale closure — the
	// discipline the reflow springs already follow.
	const latest = useRef({reduceMotion})
	// How far the pinch's midpoint had travelled when the grid last followed it
	const panned = useRef(0)
	const frameRef = useRef(0)
	const drawnAt = useRef(0)
	const tickRef = useRef<(now: number) => void>(undefined!)
	// The layouts either side of the fractional column count a live gesture
	// sits at. Two per frame, each a running sum over the sections, and only
	// rebuilt when the gesture crosses a whole count.
	const cacheRef = useRef<{timeline: typeof timeline; width: number; inset: number; at: Map<number, Layout>} | null>(
		null,
	)
	const layoutOf = (count: number) => {
		const cache = cacheRef.current
		if (!cache || cache.timeline !== timeline || cache.width !== width || cache.inset !== inset) {
			cacheRef.current = {timeline, width, inset, at: new Map()}
		}
		const at = cacheRef.current!.at
		const known = at.get(count)
		if (known) return known
		const size = tileSizeFor(width, count)
		const built = layoutAt(timeline, count, size, tileGap(size), Math.max(0, inset - HEADER_HEIGHT))
		if (at.size > 4) at.clear()
		at.set(count, built)
		return built
	}
	// Hand the canvas a frame. At rest that is the committed view; during a
	// gesture it is whatever the blend has just been moved to.
	const paint = (
		live: {layout: Layout; items: {start: number; end: number}; scrollTop: number} | null,
		racing = false,
	) => {
		const handle = canvasRef.current
		const committed = viewRef.current
		if (!handle || !committed?.gpu) return
		// While a gesture owns the canvas its own frames are what is drawn: a
		// hover or a commit painting the resting layout in between would flash
		// it under the fingers, and re-tier the atlas mid-gesture
		if (live === null && gesture.live) return
		handle.draw(
			{
				layout: live?.layout ?? committed.layout,
				items: live?.items ?? committed.items,
				scrollTop: live?.scrollTop ?? scrollerRef.current?.scrollTop ?? committed.scrollTop,
				viewport: {width: committed.width, height: committed.height},
				selected: selectionRef.current,
				hovered: hoveredRef.current,
				lifted: liftedRef.current,
				focal: eyeRef.current,
				settled: live === null,
				animate: !reduceMotion,
			},
			racing,
		)
	}
	// The tile the lightbox has lifted (see tile-lift.ts): a rule for the tiles
	// that are elements, a cell left out of the frame for the ones that are not
	const liftedRef = useRef<string | undefined>(undefined)
	const [tileLift] = useState(createTileLift)
	useEffect(
		() => () => {
			liftedRef.current = undefined
			tileLift.dispose()
		},
		[tileLift],
	)
	const paintRef = useRef(paint)
	useLayoutEffect(() => {
		paintRef.current = paint
	})
	const liftTileOf = useCallback(
		(id: string | undefined) => {
			if (id === liftedRef.current) return
			liftedRef.current = id
			tileLift.set(id)
			paintRef.current(null)
		},
		[tileLift],
	)
	// The stops the gesture may reach, and the count the grid is at when it did
	// not put it there itself: a change of preference, or of width. Only then —
	// a step taken without a spring to run has told the gesture where it is
	// going but not yet the grid, and a render in between must not hand the
	// gesture back the count the grid still has.
	useLayoutEffect(() => {
		gesture.range = columnRange(width, isMobile, floor)
		gesture.adopt(columnValue(width, tileSize, isMobile, floor))
	}, [gesture, width, isMobile, floor, tileSize])
	useLayoutEffect(() => {
		latest.current = {reduceMotion}
		// One frame of the gesture: advance the zoom, pan with the pinch, and
		// either hand the DOM the whole column count it has reached, or — on
		// the canvas, where a layout costs microseconds — draw the fractional
		// one, so tiles slide from the end of one row to the start of the next
		// under your fingers instead of stepping there.
		tickRef.current = (now) => {
			frameRef.current = 0
			const seconds = Math.max(0, (now - drawnAt.current) / 1000)
			drawnAt.current = now
			const moved = gesture.advance(seconds, now)
			const scroller = scrollerRef.current
			// A pinch pans as well as zooms; one that only zoomed would feel
			// nailed down. The anchor travels with the pan, so the reflow that
			// follows puts the tile back where the fingers left it rather than
			// where they picked it up.
			const panBy = moved.pan.y - panned.current
			if (scroller && panBy !== 0) {
				panned.current = moved.pan.y
				scroller.scrollTop -= panBy
				const held = anchorRef.current
				if (held) anchorRef.current = {id: held.id, top: held.top + panBy}
			}
			focalRef.current = moved.focal
			if (moved.focal) eyeRef.current = moved.focal
			// The stop this frame may commit: a lean past either end is drawn
			// (below), never committed
			const whole = Math.round(Math.min(gesture.range.max, Math.max(gesture.range.min, moved.columns)))
			const committed = viewRef.current
			if (committed?.gpu && scroller && moved.live && tileSizeFor(width, whole) < bounds.min) {
				const low = Math.floor(moved.columns)
				const blended = blend(layoutOf(low), layoutOf(low + 1), moved.columns - low)
				const anchor = anchorRef.current
				const anchored = anchor && anchoredScrollTop(blended, anchor)
				const scrollTop = Math.max(0, Math.min(anchored ?? scroller.scrollTop, blended.total + endSpacer - height))
				if (contentRef.current) contentRef.current.style.height = `${blended.total + endSpacer}px`
				scroller.scrollTop = scrollTop
				const items = visibleItems(blended, scrollTop, height, overscanFor({layout: blended, height, gpu: true}))
				paint({layout: blended, items, scrollTop}, moved.racing)
				slideHeaders(blended, scrollTop)
				drawnLayout.current = blended
				// Keep the settle inside the same gesture, so the anchor holds
				adoptedAt.current = now
			} else if (whole !== columns) {
				setTileSize(tileSizeFor(width, whole))
			} else if (committed?.gpu && scroller && !moved.live && committed.layout === layout) {
				// Let go at the stop it started from: the live frames moved the
				// geometry and no new layout is coming, so put the committed one
				// back by hand. When one IS pending (a paced adoption after
				// crossing the seam), restoring here would snap the grid back to
				// the mosaic and poison the flight the commit springs from.
				restore(committed, scroller)
			}
			// Past the last stop the mosaic leans as layout — the blend above
			// simply draws beyond the end — but the DOM commits whole stops
			// only, so it leans as a scale about the fingers instead: the grid
			// tries to grow past the limit and can't quite, and the release
			// spring carries it home. Visual only — no reflow and no scroll
			// geometry — so a frame of it costs a compositor transform.
			const content = contentRef.current
			if (content && !committed?.gpu) {
				if (moved.overshoot !== 1 && scroller) {
					const focal = moved.focal ?? {x: width / 2, y: height / 2}
					content.style.transformOrigin = `${focal.x}px ${scroller.scrollTop + focal.y}px`
					content.style.transform = `scale(${moved.overshoot})`
				} else if (content.style.transform) {
					content.style.transform = ''
					content.style.transformOrigin = ''
				}
			}
			for (const listener of zoomListeners) listener()
			if (moved.live) pump()
		}
	})
	// Headers stay real elements over the canvas; while the grid is moving
	// they are transformed from where the last commit put them, and the map
	// the settle springs from is kept in step so frame N+1 paints exactly
	// where frame N did.
	const slideHeaders = (layout: Layout, scrollTop: number) => {
		const committed = viewRef.current
		const placed = rects.current
		// Both layouts come from the same grouping, so a section is the same
		// section in each and its geometry is one index away
		if (!committed || !placed || committed.layout.sections !== layout.sections) return
		const overscan = overscanFor({layout, height, gpu: true})
		const live = new Map<string, Header>()
		layout.sections.forEach((section, index) => {
			const top = layout.tops[index]!
			if (top + HEADER_HEIGHT < scrollTop - overscan || top > scrollTop + height + overscan) return
			live.set(section.key, {key: section.key, title: section.title, top})
			const el = headerEls.get(section.key)
			if (el) el.style.transform = `translateY(${top - committed.layout.tops[index]!}px)`
		})
		for (const [key, el] of headerEls) if (!live.has(key)) el.style.transform = ''
		rects.current = {tiles: placed.tiles, headers: live}
	}

	// Back where it started: no layout changed, so nothing commits on its own
	// and the geometry the live frames wrote has to be put back by hand
	const restore = (committed: View, scroller: HTMLDivElement) => {
		const anchor = anchorRef.current
		const anchored = anchor && anchoredScrollTop(committed.layout, anchor)
		const total = committed.layout.total + endSpacer
		const scrollTop = Math.max(0, Math.min(anchored ?? scroller.scrollTop, total - height))
		if (contentRef.current) contentRef.current.style.height = `${total}px`
		scroller.scrollTop = scrollTop
		for (const el of headerEls.values()) el.style.transform = ''
		trackSection(committed.layout, scrollTop)
		setView({
			...committed,
			scrollTop,
			items: visibleItems(committed.layout, scrollTop, height, overscanFor(committed)),
		})
	}
	// The loop runs only while something is moving and stops the moment it
	// rests: nothing here is ever on a timer.
	const pump = useCallback(() => {
		if (frameRef.current) return
		drawnAt.current = performance.now()
		frameRef.current = requestAnimationFrame((now) => tickRef.current(now))
	}, [])
	// The tile a gesture holds still, taken once when it starts: every frame
	// of it puts that tile back where it was rather than drifting stop by stop
	const takeAnchor = useCallback((focal: {x?: number; y: number} | null) => {
		const committed = viewRef.current
		const scroller = scrollerRef.current
		if (!committed || !scroller) return
		const at = focal ?? {y: defaultFocalY(scroller.scrollTop, committed.height)}
		anchorRef.current = findAnchor(committed.layout, scroller.scrollTop, at) ?? null
	}, [])
	const marqueeEnd = marquee.end
	useEffect(() => {
		const scroller = scrollerRef.current
		if (!scroller) return
		const detach = attachPinch(scroller, {
			start: (focal) => {
				// A zoom and a box drag cannot both own the pointer
				marqueeEnd()
				panned.current = 0
				takeAnchor(focal)
				gesture.begin(focal)
				pump()
			},
			move: (factor, pan) => {
				gesture.scale(factor, pan)
				pump()
			},
			end: () => {
				gesture.release(!latest.current.reduceMotion)
				pump()
			},
		})
		return () => {
			detach()
			cancelAnimationFrame(frameRef.current)
			frameRef.current = 0
			gesture.cancel()
		}
	}, [gesture, pump, marqueeEnd, takeAnchor])

	// Every committed view, and every change of selection, reaches the canvas
	// here; a hover reaches it from the pointer handler below, and a live
	// gesture from its own frame loop.
	// After every commit: the view, the selection, a resize that reshaped the
	// atlas, or the canvas simply being new. A draw is a fifth of a
	// millisecond, so the cheap thing is to do it and the expensive thing
	// would be working out whether it was needed.
	useLayoutEffect(() => {
		if (view?.gpu) paint(null)
	})

	// Which tile a pointer is over, in the scroller's own coordinates. Below
	// the seam this is how a click, a context menu and the hover wash find
	// their tile, since there is no element to hit.
	const pointIn = (event: {clientX: number; clientY: number}) => {
		const scroller = scrollerRef.current
		if (!scroller) return undefined
		const bounds = scroller.getBoundingClientRect()
		return {x: event.clientX - bounds.left, y: event.clientY - bounds.top + scroller.scrollTop}
	}
	const itemAtPoint = (event: {clientX: number; clientY: number}) => {
		const committed = viewRef.current
		if (!committed?.gpu) return undefined
		const point = pointIn(event)
		const index = point && itemAt(committed.layout, point.x, point.y)
		return index === undefined ? undefined : committed.layout.items[index]
	}
	const trackHover = (event: {clientX: number; clientY: number}) => {
		const committed = viewRef.current
		const scroller = scrollerRef.current
		if (!committed?.gpu || !scroller) return
		const bounds = scroller.getBoundingClientRect()
		eyeRef.current = {x: event.clientX - bounds.left, y: event.clientY - bounds.top}
		const id = itemAtPoint(event)?.id
		if (id === hoveredRef.current) return
		hoveredRef.current = id
		paint(null)
	}
	const leaveHover = () => {
		if (hoveredRef.current === undefined) return
		hoveredRef.current = undefined
		paint(null)
	}

	// The context died (see noteContextLoss for what a second one costs). The
	// tiles spring up to the seam rather than leaving anyone looking at a blank
	// page.
	const onContextLost = () => {
		noteContextLoss()
		setGpuFailed(true)
		setTileSize(bounds.min)
	}

	// What the actions bar drives and the lightbox measures. Republished only
	// when the width, the floor or the seam changes, so the bar does not
	// re-render for every frame of a gesture.
	const setColumns = useCallback(
		(columns: number, live: boolean) => {
			if (!gesture.live) takeAnchor(null)
			if (live) gesture.to(columns)
			else gesture.settle(columns, !latest.current.reduceMotion)
			pump()
		},
		[gesture, pump, takeAnchor],
	)
	const liveColumns = useCallback(() => (gesture.live ? gesture.columns : null), [gesture])
	const onLiveColumns = useCallback(
		(listener: () => void) => {
			zoomListeners.add(listener)
			return () => void zoomListeners.delete(listener)
		},
		[zoomListeners],
	)
	// Picking Days or Months while the grid is a mosaic means "show me those",
	// which is a zoom: come back up to where headers make sense. The same
	// thought as tapping Years in iOS Photos, the other way about. Told by the
	// bar rather than watched for, because the pick is often no change of
	// state at all: Months is the default, and the mosaic shows years
	// whatever is picked.
	// The seam is the most columns elements can draw, not the nearest whole
	// count to the smallest tile they can: rounding up lands a hair below it.
	const regroup = useCallback(
		(picked: Zoom) => {
			if (!gpu || picked === 'years') return
			setColumns(columnRange(width, isMobile).max, false)
		},
		[gpu, setColumns, width, isMobile],
	)
	const tileRectOf = useCallback((id: string) => {
		const scroller = scrollerRef.current
		const current = viewRef.current
		if (!scroller || !current) return null
		const rect = tileRect(current.layout, id)
		if (!rect) return null
		const bounds = scroller.getBoundingClientRect()
		return {
			left: bounds.left + rect.x,
			top: bounds.top + rect.y - scroller.scrollTop,
			width: rect.size,
			height: rect.size,
			radius: tileRadius(rect.size),
		}
	}, [])
	// If the item's tile isn't fully in the band the eye can see — below the
	// bar floating over the top — jump the scroll to centre it there. The
	// caller is the lightbox mid-close, whose backdrop hides the jump; the
	// picture then flies back to a tile that is really on screen.
	const revealTileOf = useCallback(
		(id: string) => {
			const scroller = scrollerRef.current
			const current = viewRef.current
			if (!scroller || !current) return
			const rect = tileRect(current.layout, id)
			if (!rect) return
			const top = rect.y - scroller.scrollTop
			if (top >= inset && top + rect.size <= current.height) return
			const centred = rect.y + rect.size / 2 - (inset + current.height) / 2
			scroller.scrollTop = Math.max(0, Math.min(centred, current.layout.total + endSpacer - current.height))
		},
		[inset, endSpacer],
	)
	useEffect(() => {
		if (width === 0) return
		setGrid({
			width,
			floor,
			grouping,
			setColumns,
			liveColumns,
			onLiveColumns,
			regroup,
			tileRect: tileRectOf,
			revealTile: revealTileOf,
			liftTile: liftTileOf,
		})
		return () => setGrid(null)
	}, [
		width,
		floor,
		grouping,
		setGrid,
		setColumns,
		liveColumns,
		onLiveColumns,
		regroup,
		tileRectOf,
		revealTileOf,
		liftTileOf,
	])

	// ⌘A selects everything loaded — the keyboard's way in — and Escape
	// leaves; not while picking for an album, when a selection gathered
	// across views is too much to lose to a stray key (Cancel is in the bar)
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as Element
			if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
			// Only while the grid is the top layer: a lightbox, dialog or menu
			// over it gets its own Escape
			const layer = target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')
			if (layer && !layer.contains(scrollerRef.current)) return
			if (event.key === 'Escape' && selection.selecting && !picking) selection.done()
			else if (event.key === 'a' && (event.metaKey || event.ctrlKey)) selection.set([...heldRef.current, ...itemIds])
			else return
			// … and the sheet, which would otherwise take the Escape, doesn't get it
			event.preventDefault()
			event.stopPropagation()
		}
		// Captured at the window, ahead of the sheet's own listener on the document
		window.addEventListener('keydown', onKey, {capture: true})
		return () => window.removeEventListener('keydown', onKey, {capture: true})
	}, [selection.selecting, selection.done, selection.set, itemIds, picking])

	const formattedCount = formatNumberI18n({n: items.length, showDecimals: false, locale: i18n.language})
	const loaderTop = view?.layout.loaderTop
	const showLoader = view !== null && loaderTop !== undefined && view.items.end >= view.layout.items.length - 1
	const footerTop = view?.layout.footerTop
	const showFooter =
		footer !== undefined && view !== null && footerTop !== undefined && view.items.end >= view.layout.items.length - 1

	return (
		// The scroller is the grid's box: rows are laid out for its client size
		// (a classic scrollbar excluded — FadedScroller reserves its gutter where one takes space, so it
		// can't come and go with the content and resize the grid). The time rail
		// sits over it as a sibling, so its pointer never starts a marquee, and
		// while it shows it owns the right edge alone: the scrollbar is hidden
		// (scrollbar-width inline; the WebKit rule rides the data attribute).
		<div className='relative h-full w-full'>
			<FadedScroller
				ref={scrollerRef}
				className='touch-pan-y'
				frame={frame}
				style={showRail ? {scrollbarWidth: 'none'} : undefined}
				data-umbrel-time-rail={showRail ? '' : undefined}
				onScroll={onScroll}
				{...marquee.handlers}
				// While a cover is being chosen a drag has nothing to select — the
				// mode takes single clicks only — so no marquee session starts
				onPointerDown={(event) => {
					if (!selection.coveringFor) marquee.handlers.onPointerDown(event)
				}}
				onPointerMove={(event) => {
					marquee.handlers.onPointerMove(event)
					trackHover(event)
				}}
				onPointerLeave={leaveHover}
			>
				{view && (
					<div
						ref={contentRef}
						className='relative select-none'
						{...liveHover.handlers}
						// Corner radius follows the tile size, like the gap (see tileRadius)
						style={{
							height: view.layout.total + endSpacer,
							['--umbrel-photos-tile-radius' as string]: `${tileRadius(view.layout.tile)}px`,
						}}
					>
						{headers.map((header) => (
							<GroupHeader key={header.key} header={header} registry={headerEls} />
						))}
						<TileLayer
							ref={layerRef}
							items={itemById}
							inDeleted={inDeleted}
							selecting={selection.selecting}
							selected={selectedIds}
							itemAtPoint={itemAtPoint}
							onSelect={select}
						>
							{view.gpu && plan ? (
								// One image, and it says so: a screen reader announcing
								// ten thousand buttons would be worse than useless, and
								// the zoom control — which is keyboard operable and
								// announces "N per row" — is always one control away
								<div
									role='img'
									aria-label={t('photos-listing.zoomed-out-label', {count: items.length, formattedCount})}
								>
									<TileCanvas
										ref={canvasRef}
										plan={plan}
										cell={cellForBand(view.layout.tile, dpr, plan, bandFor({width, height}))}
										onLost={onContextLost}
									/>
								</div>
							) : (
								slots.map(({index, item, x, y, size}) => (
									<TileSlot
										key={item.id}
										index={index}
										item={item}
										x={x}
										y={y}
										size={size}
										thumbSize={thumbSize}
										warmUntil={view.warmUntil}
										live={liveHover.clip?.id === item.id ? (liveHover.clip.active ? 'playing' : 'ending') : undefined}
										registry={tileEls}
										selected={selectedIds.has(item.id)}
										selectable={selection.selecting}
										thumbnailQueue={thumbnailQueue}
									/>
								))
							)}
						</TileLayer>
						{/* The marquee, in the grid's coordinates so it scrolls with it; useMarquee shows and sizes it */}
						<div
							ref={marquee.boxRef}
							aria-hidden
							className='pointer-events-none absolute top-0 left-0 z-10 hidden rounded-sm border border-white/40 bg-white/10'
						/>
						{showLoader && (
							<div
								className='absolute inset-x-0 flex items-center justify-center'
								style={{top: loaderTop, height: LOADER_HEIGHT}}
							>
								<TbLoader className='size-4 animate-spin opacity-50 shadow-xs' />
							</div>
						)}
						{showFooter && (
							<div
								className='absolute inset-x-0 flex items-center justify-center'
								style={{top: footerTop, height: FOOTER_HEIGHT}}
							>
								{footer}
							</div>
						)}
					</div>
				)}
			</FadedScroller>
			{showRail && (
				<TimeRail
					buckets={railBuckets}
					scrollerRef={scrollerRef}
					contentRef={contentRef}
					viewRef={viewRef}
					frame={frame}
					height={height}
					endSpacer={endSpacer}
					hasMore={hasMore}
					seek={seek}
				/>
			)}
		</div>
	)
}

// The tiles mounted for a view, in item order — the order never changes
// across reflows, so React never has to move a tile's element
function slotsFor({layout, items}: View): Slot[] {
	const slots: Slot[] = []
	for (let index = items.start; index <= items.end; index++) {
		slots.push({index, item: layout.items[index]!, ...rectOf(layout, index)})
	}
	return slots
}

// … and the headers over them: the band the mounted tiles themselves span,
// which is the one thing scrolling keeps up to date. `view.scrollTop` is
// where the view was *committed*, and the page scrolls out from under it
// (see onScroll), so a header asked for by scroll position would be the set
// that was right at the last reflow and would only be corrected by the next.
function headersFor({layout, items}: View): Header[] {
	if (items.end < items.start) return []
	return headersIn(layout, rectOf(layout, items.start).y, rectOf(layout, items.end).y + layout.tile)
}

// A callback ref that registers the element under `key`. The cleanup only
// removes its own registration: React detaches and re-attaches refs for
// reasons other than unmounting (Strict Mode, a changed callback), and an
// element in flight must survive that — the motion loop keeps its body until
// it rests, whatever happens to the registration.
function useRegistration(key: string, registry: Map<string, HTMLElement>) {
	return useCallback(
		(el: HTMLElement | null) => {
			if (!el) return
			registry.set(key, el)
			return () => {
				if (registry.get(key) === el) registry.delete(key)
			}
		},
		[key, registry],
	)
}

const GroupHeader = memo(function GroupHeader({
	header,
	registry,
}: {
	header: Header
	registry: Map<string, HTMLElement>
}) {
	const ref = useRegistration(header.key, registry)
	return (
		<h2
			ref={ref}
			className='pointer-events-none absolute inset-x-0 flex items-end pb-2 text-17 leading-none font-semibold text-white/90'
			style={{top: header.top, height: HEADER_HEIGHT}}
		>
			{header.title}
		</h2>
	)
})

const TileSlot = memo(function TileSlot({
	index,
	item,
	x,
	y,
	size,
	thumbSize,
	warmUntil,
	live,
	registry,
	selected,
	selectable,
	thumbnailQueue,
}: {
	index: number
	item: Item
	x: number
	y: number
	size: number
	thumbSize: ThumbSize
	warmUntil: number
	live?: 'playing' | 'ending'
	registry: Map<string, HTMLElement>
	selected: boolean
	selectable: boolean
	thumbnailQueue: ThumbnailQueue
}) {
	const ref = useRegistration(item.id, registry)
	return (
		// A container, so the tile can drop its badges when it gets too small
		// for them without being told its size. Compositing is the motion
		// loop's business, and only while the tile is in flight.
		<div ref={ref} className='@container absolute origin-top-left' style={{left: x, top: y, width: size, height: size}}>
			<ItemTile
				item={item}
				thumbSize={thumbSize}
				warmUntil={warmUntil}
				live={live}
				selected={selected}
				selectable={selectable}
				thumbnailQueue={thumbnailQueue}
				thumbnailIndex={index}
			/>
		</div>
	)
})
