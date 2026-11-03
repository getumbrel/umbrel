import 'maplibre-gl/dist/maplibre-gl.css'

import {LngLat, Map as MapLibreMap, type LngLatBoundsLike, type LngLatLike, type PaddingOptions} from 'maplibre-gl'
import {useReducedMotion} from 'motion/react'
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate, useSearchParams} from 'react-router-dom'

import {PillButton} from '@/components/ui/edge-controls'
import {useRouteFilter} from '@/features/photos/components/listing/route-filter'
import {ListingSurface, type Frame} from '@/features/photos/components/listing/surface'
import {AreaPanel, AreaSheet} from '@/features/photos/components/map/area-panel'
import {locationName} from '@/features/photos/components/map/atlas'
import {Attribution} from '@/features/photos/components/map/attribution'
import {MARKER_SIZE, padBounds, type Clustering, type MercatorBox} from '@/features/photos/components/map/cluster'
import {attachMapGestures, holdWithinWorld} from '@/features/photos/components/map/gestures'
import {globeness, globeZoom, horizon, locate, mapCamera, viewSize} from '@/features/photos/components/map/globe'
import {GlobeLight} from '@/features/photos/components/map/globe-light'
import {fadeInLand, FLAT_ZOOM, mapLanguage, settlementNear, SPACE} from '@/features/photos/components/map/map-style'
import {MapMarkers, SETTLE_RECLUSTER_MS, type MarkerTarget} from '@/features/photos/components/map/markers'
import {
	latitudeAt,
	longitudeAt,
	mercatorX,
	mercatorY,
	within,
	WORLD_SIZE,
	type MapPoints,
} from '@/features/photos/components/map/points'
import {StarField} from '@/features/photos/components/map/stars'
import {useMapStyle} from '@/features/photos/components/map/use-map-style'
import {usePhotosView, type MapArea, type MapBounds, type PhotosSearch} from '@/features/photos/components/view-context'
import {useMapPoints} from '@/features/photos/hooks/use-map-points'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useDockClearance} from '@/modules/desktop/dock'
import {useLinkToDialog} from '@/utils/dialog'

// The list's card on desktop, floating at the map's right edge
const PANEL_WIDTH = 360
const PANEL_GAP = 12
// The sidebar's glass card on desktop, which the map runs beneath: inset
// from the sheet's edges as the list's card is, and reaching this far past
// the sidebar's column so its items have room on that side too
// (the bar's map title clears it: see ActionsBar)
const SIDEBAR_OVERHANG = 8
// Closest the map goes: street level, a little past the detail the basemap has
const MAX_ZOOM = 18
// Where a single place is looked at from: close enough to see the street
const SPOT_ZOOM = 15
// How much of the map the list's sheet takes at rest, on phones; drawn up,
// it takes all the room under the bar
const LIST_SHEET = 0.55
const SHEET_DETENTS = [LIST_SHEET, 'full'] as const
// Where the camera was when the map was last left, so coming back to it —
// from a photo, from another section — finds it as it was
let lastCamera: {center: [number, number]; zoom: number} | undefined
// Whether the list was out, the same way. The map comes first: the list is
// asked for
let listOpen = false
// The globe, as the map opens: this much of the room the map has, across
const GLOBE_FILL = 0.8
// … and as far away as it goes: this much of the least room it is ever left,
// with the list out, so the globe as it opens is never past the limit
const GLOBE_AFAR = 0.42
// It comes into sight a little way off and round, and turns — the way the
// Earth does — to face the photos, which land on it as it settles. Seen once
// a visit, so it can take its time.
const ARRIVAL = {duration: 1400, easing: (progress: number) => 1 - (1 - progress) ** 5}
const ARRIVAL_TURN = 50
const ARRIVAL_APPROACH = 0.3
// If the photos are slow to say where to turn to, the globe shows without them
const ARRIVAL_PATIENCE_MS = 1200

// Photos on a map: every photo that knows where it was taken, gathered into
// markers that are photographs themselves, over a quiet night-time map
// served by the device: the browser asks nothing else for a tile or a place's
// name (the device fetches the basemap from a server itself, and the browser
// keeps it: see umbreld's map-tiles.ts), and draws the labels' letters itself.
// The list beside it is always exactly the photos in the stretch of map on
// screen (or in the one spot a marker was tapped for), and is the real
// timeline grid: dates, selection, and the lightbox flying out of it.
export default function PhotosMap() {
	return <ListingSurface>{(frame) => <MapStage frame={frame} />}</ListingSurface>
}

function MapStage({frame: listingFrame}: {frame: Frame}) {
	const {t, i18n} = useTranslation()
	const isMobile = useIsMobile()
	// The map reaches out of the listing's box to the sheet's edges: above it
	// (where a grid's fade hides the gap) under the title row, and beside it —
	// on desktop under the sidebar, which floats over it on a glass card — so
	// everything measured from those edges moves with it
	const stageRef = useRef<HTMLDivElement>(null)
	const reach = useSheetReach(stageRef, isMobile)
	const frame = {inset: listingFrame.inset + reach.top}
	const sidebarCard = isMobile ? 0 : reach.left + SIDEBAR_OVERHANG
	const navigate = useNavigate()
	const linkToDialog = useLinkToDialog()
	const reduceMotion = useReducedMotion() ?? false
	const [searchParams, setSearchParams] = useSearchParams()
	const dockClearance = useDockClearance()
	const {mapArea, setMapArea, setMapControls, search} = usePhotosView()

	// The map shows what the rest of the page would — a search narrows it —
	// in every place at once; the list narrows that to the map's area
	const routeFilter = useRouteFilter()
	const {data: points, isLoadingError: pointsFailed} = useMapPoints({...routeFilter, bounds: undefined})
	const {style, basemap, atlas} = useMapStyle()
	const empty = points !== undefined && points.count === 0

	// The map itself, made once its style can be. A browser without WebGL2
	// can't draw one, and says so instead
	const containerRef = useRef<HTMLDivElement>(null)
	const [map, setMap] = useState<MapLibreMap>()
	const [unsupported, setUnsupported] = useState(false)
	const styleReady = style !== undefined
	useEffect(() => {
		if (!style || !containerRef.current) return
		const {clientWidth: width, clientHeight: height} = containerRef.current
		const room = Math.min(width, height)
		const leastRoom = Math.min(
			width - sidebarCard - (isMobile ? 0 : PANEL_WIDTH + PANEL_GAP * 2),
			height - frame.inset - dockClearance,
		)
		let instance: MapLibreMap
		try {
			instance = new MapLibreMap({
				container: containerRef.current,
				style,
				// First, the globe from a little way off: the photos turn it to them
				center: lastCamera?.center ?? [-30, 15],
				zoom: lastCamera?.zoom ?? globeZoom(GLOBE_FILL * 0.6 * room, 15, height),
				// (No zoom at all, in a window too small to leave it any room)
				minZoom: Math.max(0, globeZoom(GLOBE_AFAR * leastRoom, 0, height)) || 0,
				maxZoom: MAX_ZOOM,
				renderWorldCopies: false,
				dragRotate: false,
				pitchWithRotate: false,
				touchPitch: false,
				maxPitch: 0,
				attributionControl: false,
				fadeDuration: 200,
				// What a screen reader calls the canvas
				locale: {'Map.Title': t('photos-sidebar.map')},
			})
		} catch {
			setUnsupported(true)
			return
		}
		// North stays up: everything laid over the map counts on it
		instance.touchZoomRotate.disableRotation()
		instance.keyboard.disableRotation()
		holdWithinWorld(instance)
		const detachGestures = attachMapGestures(instance)
		// Handed on once its style is in, not at 'load', which waits for every
		// tile of the first view: the globe comes in without them
		let stopLandFade = () => {}
		instance.once('style.load', () => {
			stopLandFade = fadeInLand(instance)
			setMap(instance)
		})
		return () => {
			stopLandFade()
			// Left before it had arrived, it is found afresh next time
			if (arrival.current.landed) {
				const center = instance.getCenter()
				lastCamera = {center: [center.lng, center.lat], zoom: instance.getZoom()}
			}
			detachGestures()
			instance.remove()
			setMap(undefined)
		}
		// Made once: a style that changes later (the atlas arriving) adds
		// nothing the map drawn from the first one lacks
	}, [styleReady])

	// A spot opened from its marker: one whose photos all stand in one place
	// — home, say — so zooming can't split it. Its photos come up in the list,
	// counted from the points as they are now: a search narrows a spot too
	const [scope, setScope] = useState<{key: string; bounds: MapBounds; center: [number, number]}>()
	const spot = useMemo(
		() => scope && {...scope, count: points ? countWithin(points, scope.bounds) : 0},
		[scope, points],
	)
	// The list: a card at the right on desktop — on phones a sheet over the
	// map's foot — which can be put away, and which a spot brings out for as
	// long as it is open. With no photos on the map at all, there is no list
	// to make room for
	const [panelOpen, setPanelOpenState] = useState(listOpen)
	const setPanelOpen = useCallback((open: boolean) => setPanelOpenState((listOpen = open)), [])
	const listShown = !isMobile && !empty && (panelOpen || scope !== undefined)
	const sheetShown = isMobile && !empty && (panelOpen || scope !== undefined)
	// Putting the list away lets go of a spot it was showing
	const closeList = useCallback(() => {
		setPanelOpen(false)
		setScope(undefined)
	}, [setPanelOpen])
	const padding = useMemo(
		() => ({
			top: frame.inset,
			right: listShown ? PANEL_WIDTH + PANEL_GAP * 2 : 0,
			bottom: dockClearance,
			left: sidebarCard,
		}),
		[frame.inset, listShown, dockClearance, sidebarCard],
	)
	// A new map takes it at once, so its first framing allows for the list;
	// after that it eases, unless the camera is already on its way somewhere
	// — an ease would stop that flight, and the flight the ease. A spot just
	// opened is kept in sight of the list or sheet coming up over it. The
	// sheet drawn up all the way covers the map, so the camera keeps to its
	// resting height: it is where the map is looked at from again on the way down
	const padded = useRef<MapLibreMap>(undefined)
	const focused = useRef<string>(undefined)
	useEffect(() => {
		if (!map) return
		const target = sheetShown ? {...padding, bottom: Math.round(viewSize(map).height * LIST_SHEET)} : padding
		const focus =
			scope && focused.current !== scope.key && !inSight(map, scope.center, target) ? scope.center : undefined
		focused.current = scope?.key
		if (padded.current !== map || (map.isMoving() && !focus)) {
			map.setPadding(target)
			if (focus) map.setCenter(focus)
		} else map.easeTo({padding: target, center: focus, duration: 300})
		padded.current = map
	}, [map, padding, sheetShown, scope])

	// First sight. The map waits out of sight until it is made and knows
	// where the photos are, then arrives all at once: the globe and its stars
	// fading up as it turns to the photos, and the photos landing on it as it
	// settles. It doesn't wait for the basemap's tiles, which the land fades
	// in from as they come (see fadeInLand). Come back to, it is simply as it
	// was left.
	const [phase, setPhase] = useState<'waiting' | 'shown' | 'settled'>('waiting')
	// What has become of the arrival: begun, once, and landed when the photos
	// are on the map — as they are from the start on one come back to
	const arrival = useRef({
		begun: lastCamera !== undefined,
		landed: lastCamera !== undefined,
		frame: 0,
		settling: undefined as ReturnType<typeof setTimeout> | undefined,
	})

	// A photo handed over from the lightbox's "Show on map": fly to where it
	// was taken, close enough to see the street. It takes the place of an
	// arrival still to come
	useEffect(() => {
		const spot = spotIn(searchParams)
		if (!map || !spot) return
		const next = new URLSearchParams(searchParams)
		next.delete('lat')
		next.delete('lng')
		setSearchParams(next, {replace: true})
		arrival.current.begun = true
		arrival.current.landed = true
		setPhase('settled')
		map.flyTo(flight(map, {center: spot, zoom: SPOT_ZOOM}))
	}, [map, searchParams, setSearchParams])

	useEffect(() => {
		if (!map) return
		const state = arrival.current
		if (state.landed) return setPhase('settled')
		if (!points || state.begun) return
		state.begun = true
		const camera = home(map, points)
		const land = () => {
			state.landed = true
			setPhase('settled')
		}
		// With less motion asked for, it is simply there
		if (reduceMotion) {
			map.jumpTo(camera)
			return land()
		}
		const arrive = () => {
			// (A photo handed over in the meantime has the map now)
			if (state.landed) return
			setPhase('shown')
			map.easeTo({...camera, ...ARRIVAL})
			// Eased like this, it is all but there by half way
			state.settling = setTimeout(land, ARRIVAL.duration / 2)
		}
		// Already in sight, having waited long enough: it turns from where it is
		if (phase === 'shown') return arrive()
		// Out of sight, it is put where it comes in from — no further off than
		// the zoom of the tiles it lands on, so the tiles it is drawn from on the
		// way are the ones it ends on, not a level of them each — and once that
		// is drawn, and this busy moment is past, it comes in, with every frame
		// to itself
		const zoom = Math.max(camera.zoom - ARRIVAL_APPROACH, Math.floor(camera.zoom))
		map.jumpTo({center: [camera.center[0] + ARRIVAL_TURN, camera.center[1]], zoom})
		state.frame = requestAnimationFrame(() => (state.frame = requestAnimationFrame(arrive)))
	}, [map, points])
	useEffect(() => {
		if (!map || points || phase !== 'waiting') return
		const timer = setTimeout(() => setPhase('shown'), ARRIVAL_PATIENCE_MS)
		return () => clearTimeout(timer)
	}, [map, points, phase])
	useEffect(
		() => () => {
			cancelAnimationFrame(arrival.current.frame)
			clearTimeout(arrival.current.settling)
		},
		[],
	)

	// The marker the lightbox flies to and from, while it is up
	const [flightSource, setFlightSource] = useState<string>()
	// The photo the pointer rests on in the list, which its marker shows
	const [peekId, setPeekId] = useState<string>()
	const lightboxOpen = searchParams.get('dialog') === 'photos-item'
	useEffect(() => {
		if (!lightboxOpen) setFlightSource(undefined)
	}, [lightboxOpen])

	// What the area is called, from the photos rather than the map: the
	// place of the biggest marker in it, as finely as the zoom suggests
	const clustered = useRef<Clustering>(undefined)
	const onClustering = useCallback((clustering: Clustering) => void (clustered.current = clustering), [])

	// Publish the area as the map settles: the list, the lightbox and the
	// bar all read it — what it shows, how many photos that is (counted here,
	// from the points the map already holds) and what the place is called.
	// Close in, the name waits for the map to draw what it settled on, when the
	// street detail can say which village it is
	useEffect(() => {
		if (!map || !points) return
		const lang = mapLanguage(i18n.language)
		let published: MapArea | undefined
		const name = (bounds: MapBounds) => {
			// A marker under the list or the sidebar's card is on the map, but
			// not in the area
			let [cover, most] = [-1, 0]
			for (const cluster of clustered.current?.clusters ?? []) {
				const inArea = within(bounds, points.lat[cluster.cover]!, points.lng[cluster.cover]!)
				if (inArea && cluster.count > most) [cover, most] = [cluster.cover, cluster.count]
			}
			const zoom = map.getZoom()
			if (!atlas || cover < 0 || zoom < 2.5) return undefined
			const [lat, lng] = [points.lat[cover]!, points.lng[cover]!]
			if (zoom < 6) return locationName(atlas, lat, lng, i18n.language, 'country') || undefined
			const town = zoom >= 9 ? settlementNear(map, lng, lat, lang) : undefined
			if (!town && zoom >= 9 && !map.areTilesLoaded()) return published?.place
			if (!town) return locationName(atlas, lat, lng, i18n.language, 'city') || undefined
			return [town, locationName(atlas, lat, lng, i18n.language, 'country')].filter(Boolean).join(', ')
		}
		let timer: ReturnType<typeof setTimeout> | undefined
		const publish = () => {
			clearTimeout(timer)
			timer = setTimeout(() => {
				const bounds = scope?.bounds ?? visibleBounds(map)
				published = {bounds, count: countWithin(points, bounds), place: name(bounds)}
				setMapArea(published)
				// Just after the markers have settled: the biggest of them names it
			}, SETTLE_RECLUSTER_MS + 20)
		}
		const rename = () => {
			const place = published && name(published.bounds)
			if (published && place !== published.place) setMapArea((published = {...published, place}))
		}
		map.on('moveend', publish)
		map.on('idle', rename)
		publish()
		return () => {
			clearTimeout(timer)
			map.off('moveend', publish)
			map.off('idle', rename)
		}
	}, [map, points, atlas, scope, setMapArea, i18n.language])
	// Leaving the map leaves no area behind for the other pages' lists
	useEffect(() => () => setMapArea(null), [setMapArea])

	// Escape (or a click on the bare map) lets go of a narrowed spot
	useEffect(() => {
		if (!scope) return
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Escape' || lightboxOpen) return
			// Not the Escape that closes a menu or dialog over the map (by what
			// the key was pressed in: the sheet's own layer prevents every Escape)
			const layer = (event.target as Element).closest?.('[role="dialog"], [role="alertdialog"], [role="menu"]')
			if (layer && !layer.contains(containerRef.current)) return
			setScope(undefined)
		}
		// The map hears clicks on markers too (they live in its event surface)
		const onClick = (event: {originalEvent: MouseEvent}) => {
			if (!(event.originalEvent.target as Element | null)?.closest('[data-cover]')) setScope(undefined)
		}
		window.addEventListener('keydown', onKey)
		map?.on('click', onClick)
		return () => {
			window.removeEventListener('keydown', onKey)
			map?.off('click', onClick)
		}
	}, [scope, map, lightboxOpen])

	// A tap on a marker: one photo opens; a cluster that can still split is
	// flown into until it does; one that can't — every photo on one spot — is
	// flown to, and tapped again from there opens the spot, its photos in the
	// list (or on phones, a sheet)
	const activate = useCallback(
		({cluster, points}: MarkerTarget) => {
			if (!map) return
			const key = points.id(cluster.cover)
			if (cluster.count === 1) {
				setFlightSource(key)
				navigate(linkToDialog('photos-item', {id: key}))
				return
			}
			const bounds: LngLatBoundsLike = [
				[longitudeAt(cluster.minX), latitudeAt(cluster.maxY)],
				[longitudeAt(cluster.maxX), latitudeAt(cluster.minY)],
			]
			const spanAtMax = Math.max(cluster.maxX - cluster.minX, cluster.maxY - cluster.minY) * WORLD_SIZE * 2 ** MAX_ZOOM
			if (spanAtMax < MARKER_SIZE || map.getZoom() >= MAX_ZOOM - 0.5) {
				const center: [number, number] = [points.lng[cluster.cover]!, points.lat[cluster.cover]!]
				if (map.getZoom() < SPOT_ZOOM - 0.5) {
					map.flyTo(flight(map, {center, zoom: SPOT_ZOOM}))
					return
				}
				setScope({key, bounds: padBounds(cluster), center})
				return
			}
			const camera = map.cameraForBounds(bounds, {padding: MARKER_SIZE})
			if (!camera) return
			const zoom = Math.min(MAX_ZOOM, Math.max(camera.zoom ?? 0, map.getZoom() + 1))
			map.flyTo(flight(map, {center: camera.center, zoom}))
		},
		[map, navigate, linkToDialog],
	)

	// Where markers are looked for: the canvas and a marker's width around it
	const box = useCallback(() => (map ? visibleBox(map) : WHOLE_WORLD_BOX), [map])

	// The zoom, back to everything, and the list, for the bar to lay out
	useEffect(() => {
		if (!map) return
		setMapControls({
			map,
			showAll: () => {
				const camera = points && framing(map, points)
				if (camera?.center) map.flyTo(flight(map, camera))
			},
			listOpen: listShown || sheetShown,
			setListOpen: (open) => (open ? setPanelOpen(true) : closeList()),
		})
	}, [map, points, listShown, sheetShown, setPanelOpen, closeList, setMapControls])
	useEffect(() => () => setMapControls(null), [setMapControls])

	const hasArea = mapArea !== null
	const unlocated = points?.unlocated ?? 0

	return (
		<div
			ref={stageRef}
			// .umbrel-photos-map (index.css): what floats over the map isn't glass
			className='umbrel-photos-map relative overflow-hidden'
			style={{
				margin: `-${reach.top}px -${reach.right}px 0 -${reach.left}px`,
				height: `calc(100% + ${reach.top}px)`,
			}}
		>
			{/* The map, under the bar. Sized by a wrapper: MapLibre's stylesheet
			    makes its container position: relative, over any class of ours */}
			<div className='absolute inset-0' style={{background: SPACE}}>
				<div
					className='relative size-full transition-opacity duration-700 ease-out motion-reduce:transition-none'
					style={{opacity: phase === 'waiting' ? 0 : 1}}
				>
					<StarField map={map} />
					<div ref={containerRef} className='size-full' />
					<GlobeLight map={map} atlas={atlas} />
				</div>
			</div>
			<div
				aria-hidden
				className='pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/55 via-black/20 to-transparent'
				style={{height: frame.inset + 24}}
			/>
			{map && points && !empty && phase === 'settled' && (
				<MapMarkers
					map={map}
					points={points}
					box={box}
					selected={spot}
					flightSource={flightSource}
					peekId={peekId}
					onActivate={activate}
					onClustering={onClustering}
				/>
			)}

			{/* The sidebar's card: glass over the map, which carries on beneath it */}
			{!isMobile && (
				<div
					aria-hidden
					className='umbrel-material absolute bg-black/35'
					style={{
						top: PANEL_GAP,
						bottom: PANEL_GAP,
						left: PANEL_GAP,
						width: sidebarCard - PANEL_GAP,
						// Concentric with the sheet's corner it sits in
						borderRadius: `calc(var(--window-radius) - ${PANEL_GAP}px)`,
					}}
				/>
			)}

			{/* The credit, in the map's far corner — beside the list when it is out —
			    once the map is in sight: its first seconds out are for being seen */}
			{map && basemap?.available && phase !== 'waiting' && (
				<div
					className='absolute'
					style={
						isMobile
							? {right: 12, bottom: dockClearance}
							: {right: listShown ? PANEL_WIDTH + PANEL_GAP * 2 : 8, bottom: 8}
					}
				>
					<Attribution map={map} />
				</div>
			)}

			{unsupported ? (
				<Notice
					area={padding}
					title={t('photos-map.unsupported-title')}
					description={t('photos-map.unsupported-description')}
				/>
			) : pointsFailed ? (
				<Notice area={padding} title={t('photos-map.load-error')} />
			) : (
				empty && <NoLocations area={padding} unlocated={unlocated} search={search} />
			)}

			{hasArea && !empty && listShown && (
				<div className='absolute' style={{top: frame.inset, right: PANEL_GAP, bottom: PANEL_GAP, width: PANEL_WIDTH}}>
					<AreaPanel scope={spot} onClearScope={() => setScope(undefined)} unlocated={unlocated} onPeek={setPeekId} />
				</div>
			)}
			{isMobile && (
				<AreaSheet
					open={hasArea && sheetShown}
					onClose={closeList}
					detents={SHEET_DETENTS}
					topInset={frame.inset}
					scope={spot}
					onClearScope={() => setScope(undefined)}
					unlocated={unlocated}
				/>
			)}
		</div>
	)
}

// Whether a place will be on screen clear of what covers the map's edges
// once the camera has taken the padding given: a change of padding keeps
// the centre in the middle of what is left, which moves everything else
function inSight(map: MapLibreMap, center: [number, number], padding: Required<PaddingOptions>) {
	const {x, y} = map.project(center)
	const {top = 0, right = 0, bottom = 0, left = 0} = map.getPadding()
	const at = {
		x: x + (padding.left - left - (padding.right - right)) / 2,
		y: y + (padding.top - top - (padding.bottom - bottom)) / 2,
	}
	const {width, height} = viewSize(map)
	return at.x > padding.left && at.x < width - padding.right && at.y > padding.top && at.y < height - padding.bottom
}

// How far the listing's box sits inside the sheet that clips it, for the
// map to reach past to the sheet's edges. Measured, as the sheet's padding,
// title row and sidebar set it, and again whenever the window changes size
function useSheetReach(stageRef: React.RefObject<HTMLElement | null>, isMobile: boolean) {
	const [reach, setReach] = useState({top: 0, right: 0, left: 0})
	useLayoutEffect(() => {
		const box = stageRef.current?.parentElement
		const sheet = box?.closest<HTMLElement>('.umbrel-window-surface-top')
		if (!box || !sheet) return
		const measure = () => {
			const inner = box.getBoundingClientRect()
			const outer = sheet.getBoundingClientRect()
			// In CSS pixels, should the sheet still be scaling in
			const scale = outer.width / sheet.offsetWidth || 1
			const gap = (from: number, to: number) => Math.max(0, Math.round((to - from) / scale))
			setReach({
				top: gap(outer.top, inner.top),
				right: gap(inner.right, outer.right),
				left: gap(outer.left, inner.left),
			})
		}
		measure()
		window.addEventListener('resize', measure)
		return () => window.removeEventListener('resize', measure)
		// Again once a new breakpoint has laid the sheet out afresh
	}, [stageRef, isMobile])
	return reach
}

// The part of the stage the map is seen in: clear of the sidebar's card, the
// bar, the dock and the list (the camera's padding)
type SeenArea = {top: number; right: number; bottom: number; left: number}

// What the map has to say in place of what it can't show, centred where the
// map is seen rather than on the whole stage, which runs under the sidebar
function Notice({
	area,
	title,
	description,
	children,
}: {
	area: SeenArea
	title: string
	description?: string
	children?: ReactNode
}) {
	return (
		<div className='pointer-events-none absolute flex items-center justify-center p-6' style={area}>
			<div className='umbrel-material umbrel-material-popover max-w-sm px-6 py-5 text-center'>
				<p className='text-15 font-medium text-white/85'>{title}</p>
				{description && <p className='mt-1 text-13 text-white/50'>{description}</p>}
				{children}
			</div>
		</div>
	)
}

// Nothing with a location (yet): say what makes a photo land on the map —
// or, when it is a search that found none, offer the way out of it
function NoLocations({area, unlocated, search}: {area: SeenArea; unlocated: number; search: PhotosSearch}) {
	const {t, i18n} = useTranslation()
	return (
		<Notice
			area={area}
			title={search.active ? t('photos-search.no-results-title') : t('photos-map.empty-title')}
			description={search.active ? undefined : t('photos-map.empty-description')}
		>
			{unlocated > 0 && (
				<p className='mt-3 text-12 text-white/40'>
					{t('photos-map.unlocated', {
						count: unlocated,
						formattedCount: new Intl.NumberFormat(i18n.language).format(unlocated),
					})}
				</p>
			)}
			{search.active && (
				<PillButton className='pointer-events-auto mt-4' onClick={search.clear}>
					{t('photos-search.clear')}
				</PillButton>
			)}
		</Notice>
	)
}

// The place a "Show on map" link carries, as the map takes one: [lng, lat]
function spotIn(searchParams: URLSearchParams): [number, number] | undefined {
	const [lat, lng] = [Number(searchParams.get('lat')), Number(searchParams.get('lng'))]
	const given = searchParams.has('lat') && searchParams.has('lng')
	return given && Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : undefined
}

const WHOLE_WORLD_BOX: MercatorBox = {minX: 0, minY: 0, maxX: 1, maxY: 1}

// The canvas in Mercator units, a marker wider all round
function visibleBox(map: MapLibreMap): MercatorBox {
	const {width, height} = viewSize(map)
	const {west, south, east, north} = boundsWithin(map, {
		left: -MARKER_SIZE,
		top: -MARKER_SIZE,
		right: width + MARKER_SIZE,
		bottom: height + MARKER_SIZE,
	})
	// Either side of the antimeridian, all the way round
	const wraps = west > east
	return {
		minX: wraps ? 0 : Math.max(0, mercatorX(west)),
		minY: Math.max(0, mercatorY(north)),
		maxX: wraps ? 1 : Math.min(1, mercatorX(east)),
		maxY: Math.min(1, mercatorY(south)),
	}
}

// The part of the map not under the list or the bar, in degrees, rounded so
// tiny settles don't make new list queries
function visibleBounds(map: MapLibreMap): MapBounds {
	const {top = 0, right = 0, bottom = 0, left = 0} = map.getPadding()
	const {width, height} = viewSize(map)
	const bounds = boundsWithin(map, {left, top, right: width - right, bottom: height - bottom})
	const round = (value: number) => Math.round(value * 1e4) / 1e4
	return {west: round(bounds.west), south: round(bounds.south), east: round(bounds.east), north: round(bounds.north)}
}

// What a stretch of the screen shows of the world, in degrees — west greater
// than east where that crosses the antimeridian. Flat, it is what its corners
// are over. Round, it is what its edges are over when they are all on the
// globe, and with any sky in sight, all of the globe this side of its edge.
function boundsWithin(map: MapLibreMap, box: {left: number; top: number; right: number; bottom: number}): MapBounds {
	if (globeness(map.getZoom()) === 0) {
		const northWest = map.unproject([box.left, box.top])
		const southEast = map.unproject([box.right, box.bottom])
		// Out to Mercator's edge, it is out to the pole: photos past the edge
		// are drawn on it
		return {
			west: Math.max(-180, northWest.lng),
			south: mercatorY(southEast.lat) >= mercatorY(-90) ? -90 : southEast.lat,
			east: Math.min(180, southEast.lng),
			north: mercatorY(northWest.lat) <= mercatorY(90) ? 90 : northWest.lat,
		}
	}
	const camera = mapCamera(map)
	const {center} = camera
	const [middle, half] = [(box.left + box.right) / 2, (box.top + box.bottom) / 2]
	const edges = [
		[box.left, box.top],
		[middle, box.top],
		[box.right, box.top],
		[box.left, half],
		[box.right, half],
		[box.left, box.bottom],
		[middle, box.bottom],
		[box.right, box.bottom],
	].map(([x, y]) => {
		// A point of the screen off the globe is given its nearest place on it
		const place = map.unproject([x!, y!])
		const back = map.project(place)
		return Math.hypot(back.x - x!, back.y - y!) < 2 ? place : undefined
	})
	const within = (place: {x: number; y: number; shown: number}) =>
		place.shown > 0 && place.x > box.left && place.x < box.right && place.y > box.top && place.y < box.bottom
	let [south, north, turn] = [0, 0, 0]
	if (edges.every((place) => place !== undefined)) {
		south = Math.min(...edges.map((place) => place.lat))
		north = Math.max(...edges.map((place) => place.lat))
		turn = Math.max(...edges.map((place) => Math.abs(((place.lng - center.lng + 540) % 360) - 180)))
	} else {
		const reach = horizon(camera)
		south = center.lat - reach
		north = center.lat + reach
		const widest = Math.sin((reach * Math.PI) / 180) / Math.cos((center.lat * Math.PI) / 180)
		turn = widest >= 1 ? 180 : (Math.asin(widest) * 180) / Math.PI
	}
	// With a pole in it, it is every longitude there is
	if (north >= 90 || within(locate(camera, 0, 90))) [north, turn] = [90, 180]
	if (south <= -90 || within(locate(camera, 0, -90))) [south, turn] = [-90, 180]
	if (turn >= 180) return {west: -180, south, east: 180, north}
	const wrap = (longitude: number) => ((longitude + 540) % 360) - 180
	return {west: wrap(center.lng - turn), south, east: wrap(center.lng + turn), north}
}

// How many of the photos are in a stretch of the map, edges included: what a
// list asked for the same stretch would say (see the server's bounds filter)
function countWithin(points: MapPoints, bounds: MapBounds) {
	let count = 0
	for (let index = 0; index < points.count; index++) {
		if (within(bounds, points.lat[index]!, points.lng[index]!)) count++
	}
	return count
}

// A flight to somewhere, taking as long as it has far to go: by how much it
// zooms, and how far across the screen it is — up to a limit. (MapLibre's own
// maxDuration is no limit: a flight that would take longer isn't flown at all.)
const FLIGHT = {base: 420, perZoom: 230, perScreen: 380, longest: 1900}
function flight(map: MapLibreMap, to: {center?: LngLatLike; zoom?: number}) {
	const center = LngLat.convert(to.center ?? map.getCenter())
	const zoom = to.zoom ?? map.getZoom()
	const camera = mapCamera(map)
	const there = locate(camera, center.lng, center.lat)
	const {width, height} = viewSize(map)
	const screens = Math.min(
		2,
		Math.hypot(there.x - camera.origin.x, there.y - camera.origin.y) / Math.min(width, height),
	)
	const duration = FLIGHT.base + FLIGHT.perZoom * Math.abs(zoom - camera.zoom) + FLIGHT.perScreen * screens
	return {center, zoom, curve: 1.42, duration: Math.min(FLIGHT.longest, duration)}
}

// The camera that shows all the photos: most of them framed, where they fit
// on the flat map, and the globe where they don't
const FRAMING_PADDING = 48
function framing(map: MapLibreMap, points: MapPoints) {
	const bounds = coreBounds(points)
	const camera = bounds && map.cameraForBounds(bounds, {padding: FRAMING_PADDING, maxZoom: 14})
	return camera?.center && (camera.zoom ?? 0) >= FLAT_ZOOM ? camera : home(map, points)
}

// The globe whole, turned to the photos: the third of the way round it that
// holds the most of them, and the middle of those
const HEART_SPAN = 120
function home(map: MapLibreMap, points: MapPoints) {
	const {top = 0, right = 0, bottom = 0, left = 0} = map.getPadding()
	const {width, height} = viewSize(map)
	const room = Math.min(width - left - right, height - top - bottom)
	const center = heart(points)
	return {center, zoom: globeZoom(GLOBE_FILL * room, center[1], height)}
}

function heart(points: MapPoints): [number, number] {
	if (points.count === 0) return [10, 25]
	const order = Array.from({length: points.count}, (_, index) => index).sort((a, b) => points.lng[a]! - points.lng[b]!)
	// Longitudes in order, and round again, so a stretch can cross the antimeridian
	const longitude = (at: number) => points.lng[order[at % points.count]!]! + (at >= points.count ? 360 : 0)
	let [best, most] = [0, 0]
	for (let first = 0, last = 0; first < points.count; first++) {
		while (last < first + points.count && longitude(last) <= longitude(first) + HEART_SPAN) last++
		if (last - first > most) [best, most] = [first, last - first]
	}
	const middle = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1]!
	const held = Array.from({length: most}, (_, offset) => best + offset)
	const lng = middle(held.map(longitude))
	// Not from over a pole: the globe is turned, more than tipped
	const lat = Math.max(-50, Math.min(50, middle(held.map((at) => points.lat[order[at % points.count]!]!))))
	return [((lng + 540) % 360) - 180, lat]
}

// Where most of the photos are: the middle 95% in each direction
function coreBounds(points: MapPoints): LngLatBoundsLike | undefined {
	if (points.count === 0) return
	const quantiles = (values: Float32Array) => {
		const sorted = Float32Array.from(values).sort()
		const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]!
		return [at(0.025), at(0.975)] as const
	}
	const [south, north] = quantiles(points.lat)
	const [west, east] = quantiles(points.lng)
	return [
		[west, south],
		[east, north],
	]
}
