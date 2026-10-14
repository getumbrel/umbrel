import type {Map as MapLibreMap} from 'maplibre-gl'
import {useReducedMotion} from 'motion/react'
import {memo, useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {useTranslation} from 'react-i18next'
import {useSearchParams} from 'react-router-dom'

import {ItemThumbnail} from '@/features/photos/components/listing/item-thumbnail'
import {
	clusterPoints,
	clusterZoom,
	lineage,
	MARKER_SIZE,
	type Cluster,
	type Clustering,
	type MercatorBox,
} from '@/features/photos/components/map/cluster'
import {locate, mapCamera, viewSize} from '@/features/photos/components/map/globe'
import {POINT_FLAGS, within, type MapPoints} from '@/features/photos/components/map/points'
import type {MapBounds} from '@/features/photos/components/view-context'
import {cn} from '@/lib/utils'

// Splits are dealt like cards: a little overshoot, settled in ~420ms.
// Merges fold back without one — settling, not bouncing — and a touch quicker.
const DEAL = {duration: 420, easing: 'cubic-bezier(0.25, 1.3, 0.5, 1)'}
const FOLD = {duration: 280, easing: 'cubic-bezier(0.4, 0, 0.2, 1)'}
// Siblings leave the deck one after another, nearest first, the whole deal
// over within this long
const DEAL_STAGGER_MS = 14
const DEAL_SPREAD_MS = 120
// New markers that come from nowhere — a pan revealing them, a backup
// arriving — simply fade up
const ARRIVE = {duration: 220, easing: 'ease-out'}
// The first ones, as the map opens, land one after another, the biggest first
const LAND = {duration: 320, easing: 'cubic-bezier(0.23, 1, 0.32, 1)'}
const LAND_STAGGER_MS = 28
const LAND_SPREAD_MS = 280
// Clusters are cut finer than this zoom only where the map itself can go
const MAX_CLUSTER_ZOOM = 17
// The map reclusters this often while a pan reveals new ground
const PAN_RECLUSTER_MS = 200
// … and once more when it has been still this long (the map publishes its
// area, which is named after the biggest marker, just after)
export const SETTLE_RECLUSTER_MS = 100

export type MarkerTarget = {cluster: Cluster; points: MapPoints; element: HTMLElement}

type Marker = {
	key: string
	// The points it was clustered from, which its cover is one of: a marker
	// is drawn from these, never from points that have since been fetched
	// afresh, in which the same index is another photo
	points: MapPoints
	cover: number
	count: number
	// Where a dealt marker comes from: its deck's place, and when to leave it
	from?: {lng: number; lat: number; delay: number}
	// One of the first markers of all: how long it waits its turn to land
	landing?: number
	// A folding marker: where it goes, after which it is gone
	to?: {lng: number; lat: number} | null
	cluster: Cluster
}

// The photographs on the map: one marker per cluster, laid over the map's
// canvas as elements — a few hundred at most on any screen, and as elements
// they get real images, focus, labels, and the lightbox's flight from them.
// Every one is placed in the frame the map moves in, from its cover's place.
export function MapMarkers({
	map,
	points,
	box,
	selected,
	flightSource,
	peekId,
	onActivate,
	onClustering,
}: {
	map: MapLibreMap
	points: MapPoints
	// Where to look for markers: the screen and a margin, in Mercator units
	box: () => MercatorBox
	// The spot the list is scoped to, if any: its marker comes forward and
	// the rest step back
	selected?: {key: string; bounds: MapBounds}
	// The marker the lightbox was opened from, while it is up: the map, not
	// the list, is then where its picture flies from and home to (see `aloft`)
	flightSource?: string
	// A photo the pointer is resting on in the list: the marker it is
	// gathered into lifts and, for as long as it rests, shows that photo
	peekId?: string
	onActivate: (target: MarkerTarget) => void
	onClustering?: (clustering: Clustering) => void
}) {
	const reduceMotion = useReducedMotion() ?? false
	const [markers, setMarkers] = useState<Marker[]>([])
	const clustering = useRef<Clustering & {points: MapPoints}>(undefined)
	const elements = useRef(new Map<string, {element: HTMLElement; marker: Marker}>())
	const onClusteringRef = useRef(onClustering)
	onClusteringRef.current = onClustering
	// The photo the lightbox has up, when it was opened from a marker. The
	// marker standing for it — the one tapped, or the one stepped to — alone
	// answers to its id (see the marker's data-item-id): the picture flies home
	// to the photo being looked at, as the grid's does.
	const [searchParams] = useSearchParams()
	const aloft =
		(searchParams.get('dialog') === 'photos-item' && flightSource && searchParams.get('photos-item-id')) || undefined
	// Which marker holds the peeked photo: its point, then the cluster that
	// owns it now (among the points that were clustered)
	let peek: {key: string; id: string; tint?: number} | undefined
	if (peekId && clustering.current) {
		const {points: clustered, owner, clusters} = clustering.current
		const index = clustered.indexOf(peekId)
		const cluster = clusters[owner[index] ?? -1]
		const tint = clustered.tint[index]!
		if (cluster) peek = {key: clustered.id(cluster.cover), id: peekId, tint: tint >= 0 ? tint : undefined}
	}

	// The spot's marker: the one it was tapped as, or — once a search has
	// given the spot another cover, and so another key — the one standing
	// in it. Out of sight, the rest still step back.
	const selectedKey =
		selected &&
		(markers.some((marker) => marker.key === selected.key)
			? selected.key
			: (markers.find(
					(marker) =>
						!marker.to && within(selected.bounds, marker.points.lat[marker.cover]!, marker.points.lng[marker.cover]!),
				)?.key ?? selected.key))

	// Places every marker over its cover, in one pass per frame the map moves.
	// On the globe one comes round the edge growing and brightening, and
	// round the back of it is out of sight
	const place = useCallback(() => {
		const camera = mapCamera(map)
		const {width, height} = viewSize(map)
		const half = MARKER_SIZE / 2
		for (const {element, marker} of elements.current.values()) {
			const {points, cover} = marker
			const {x, y, shown} = locate(camera, points.lng[cover]!, points.lat[cover]!)
			element.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${0.8 + 0.2 * shown})`
			element.style.opacity = shown === 1 ? '' : String(shown)
			element.style.visibility = shown === 0 ? 'hidden' : ''
			// Wholly off the canvas, out of Tab's way too: focus would only
			// find a marker nobody can see
			const away = x < -half || y < -half || x > width + half || y > height + half
			if (element.inert !== away) element.inert = away
		}
	}, [map])

	const recluster = useCallback(() => {
		const previous = clustering.current
		const zoom = clusterZoom(map.getZoom(), previous?.zoom, MAX_CLUSTER_ZOOM)
		const next = clusterPoints(points, zoom, box())
		clustering.current = {...next, points}
		onClusteringRef.current?.(next)
		const keyOf = (cover: number) => points.id(cover)
		// Deals and folds follow points from one clustering to the next: only
		// among the same points, not across a fetch that renumbered them
		const zoomed =
			previous !== undefined && previous.points === points && previous.zoom !== zoom && previous.clusters.length > 0
		const {origins, destinations} = zoomed ? lineage(previous, next) : {origins: [], destinations: []}

		const covers = new Set(next.clusters.map(({cover}) => cover))
		const fresh: Marker[] = next.clusters.map((cluster, index) => {
			const origin = origins[index] ?? -1
			const deck = origin >= 0 ? previous!.clusters[origin]! : undefined
			if (!deck || deck.cover === cluster.cover)
				return {key: keyOf(cluster.cover), points, cover: cluster.cover, count: cluster.count, cluster}
			const distance = Math.hypot(
				points.x[cluster.cover]! - points.x[deck.cover]!,
				points.y[cluster.cover]! - points.y[deck.cover]!,
			)
			return {
				key: keyOf(cluster.cover),
				points,
				cover: cluster.cover,
				count: cluster.count,
				cluster,
				from: {lng: points.lng[deck.cover]!, lat: points.lat[deck.cover]!, delay: distance},
			}
		})
		if (!previous) {
			const biggestFirst = [...fresh].sort((a, b) => b.count - a.count)
			biggestFirst.forEach((marker, order) => (marker.landing = Math.min(LAND_SPREAD_MS, order * LAND_STAGGER_MS)))
		}
		// Stagger the deal: nearest siblings first
		const dealt = fresh.filter((marker) => marker.from).sort((a, b) => a.from!.delay - b.from!.delay)
		dealt.forEach((marker, order) => (marker.from!.delay = Math.min(DEAL_SPREAD_MS, order * DEAL_STAGGER_MS)))

		const folding: Marker[] = zoomed
			? previous.clusters.flatMap((cluster, index) => {
					if (covers.has(cluster.cover)) return []
					const destination = next.clusters[destinations[index]!]
					return [
						{
							key: `fold:${keyOf(cluster.cover)}`,
							points,
							cover: cluster.cover,
							count: cluster.count,
							cluster,
							to: destination ? {lng: points.lng[destination.cover]!, lat: points.lat[destination.cover]!} : null,
						},
					]
				})
			: []
		// Markers still folding from an earlier zoom finish where they were going
		const keys = new Set(fresh.map(({key}) => key))
		setMarkers((current) => [
			...current.filter((marker) => marker.to !== undefined && !keys.has(marker.key.slice(5))),
			...folding,
			...fresh,
		])
	}, [map, points, box])

	// Recluster on every change of the clustering zoom (immediately, so a
	// pinch deals and folds under the fingers), and as a pan settles — and
	// now and then during a long one, so new ground fills in as it arrives
	useEffect(() => {
		let lastPan = 0
		let settling: ReturnType<typeof setTimeout> | undefined
		const onMove = () => {
			// With the map, in the frame it draws: a frame later they would trail it
			place()
			const level = clusterZoom(map.getZoom(), clustering.current?.zoom, MAX_CLUSTER_ZOOM)
			const now = performance.now()
			if (level !== clustering.current?.zoom) {
				recluster()
				lastPan = now
			} else if (now - lastPan > PAN_RECLUSTER_MS) {
				lastPan = now
				recluster()
			}
		}
		// A trackpad's pan and a drag of the zoom slider are a whole move to each
		// event, every one with an end of its own: the settle waits for the last
		const onMoveEnd = () => {
			clearTimeout(settling)
			settling = setTimeout(recluster, SETTLE_RECLUSTER_MS)
		}
		map.on('move', onMove)
		map.on('moveend', onMoveEnd)
		map.on('resize', place)
		recluster()
		return () => {
			clearTimeout(settling)
			map.off('move', onMove)
			map.off('moveend', onMoveEnd)
			map.off('resize', place)
		}
	}, [map, place, recluster])

	// New markers are placed in the commit they mount in, before paint
	useLayoutEffect(place, [markers, place])

	const register = useCallback((marker: Marker, element: HTMLElement | null) => {
		if (element) elements.current.set(marker.key, {element, marker})
		else elements.current.delete(marker.key)
	}, [])
	const removeFolded = useCallback(
		(key: string) => setMarkers((current) => current.filter((marker) => marker.key !== key)),
		[],
	)

	// Inside the map's own event surface, so a drag that starts on a marker
	// still pans and a pinch over one still zooms; isolated, so the markers'
	// stacking stays among themselves, beneath the list floating over the map
	return createPortal(
		// Clipped, not hidden: a hidden box still scrolls, and focus on a marker
		// past its edge would scroll every marker off its place
		<div className='pointer-events-none absolute inset-0 isolate overflow-clip'>
			{markers.map((marker) => (
				<MapMarker
					key={marker.key}
					marker={marker}
					map={map}
					reduceMotion={reduceMotion}
					selected={selectedKey === marker.key || peek?.key === marker.key}
					dimmed={selectedKey !== undefined && selectedKey !== marker.key && peek?.key !== marker.key}
					peek={peek?.key === marker.key && !marker.to ? peek : undefined}
					isFlightSource={aloft === marker.key}
					register={register}
					onActivate={onActivate}
					onFolded={removeFolded}
				/>
			))}
		</div>,
		map.getCanvasContainer(),
	)
}

const MapMarker = memo(function MapMarker({
	marker,
	map,
	reduceMotion,
	selected,
	dimmed,
	peek,
	isFlightSource,
	register,
	onActivate,
	onFolded,
}: {
	marker: Marker
	map: MapLibreMap
	reduceMotion: boolean
	selected: boolean
	dimmed: boolean
	peek?: {id: string; tint?: number}
	isFlightSource: boolean
	register: (marker: Marker, element: HTMLElement | null) => void
	onActivate: (target: MarkerTarget) => void
	onFolded: (key: string) => void
}) {
	const {t, i18n} = useTranslation()
	const {key, points, cover, count, from, to, landing} = marker
	const motionRef = useRef<HTMLDivElement>(null)
	const photoRef = useRef<HTMLDivElement>(null)
	const id = points.id(cover)
	const flags = points.flags[cover]!
	const tint = points.tint[cover]! >= 0 ? points.tint[cover]! : undefined
	const folding = to !== undefined

	// Dealt out of its deck, or folded into its destination, from where the
	// two stand on screen as it starts
	useLayoutEffect(() => {
		const element = motionRef.current
		if (!element) return
		const camera = mapCamera(map)
		const here = locate(camera, points.lng[cover]!, points.lat[cover]!)
		if (folding) {
			const there = to ? locate(camera, to.lng, to.lat) : here
			const animation = reduceMotion
				? element.animate([{opacity: 1}, {opacity: 0}], {duration: 150, fill: 'forwards'})
				: element.animate(
						[
							{transform: 'none', opacity: 1},
							{transform: `translate(${there.x - here.x}px, ${there.y - here.y}px) scale(0.7)`, opacity: 0},
						],
						{...FOLD, fill: 'forwards'},
					)
			// Gone once folded, and not when cancelled: that is the marker being
			// taken down, or StrictMode about to run this again
			animation.onfinish = () => onFolded(key)
			return () => animation.cancel()
		}
		if (from && !reduceMotion) {
			const deck = locate(camera, from.lng, from.lat)
			const animation = element.animate(
				[
					{transform: `translate(${deck.x - here.x}px, ${deck.y - here.y}px) scale(0.6) rotate(-6deg)`, opacity: 0},
					{opacity: 1, offset: 0.25},
					{transform: 'none', opacity: 1},
				],
				{...DEAL, delay: from.delay, fill: 'backwards'},
			)
			return () => animation.cancel()
		}
		const animation =
			landing !== undefined && !reduceMotion
				? element.animate(
						[
							{opacity: 0, transform: 'translateY(-10px) scale(0.82)'},
							{opacity: 1, transform: 'none'},
						],
						{...LAND, delay: landing, fill: 'backwards'},
					)
				: element.animate(
						[
							{opacity: 0, transform: 'scale(0.9)'},
							{opacity: 1, transform: 'none'},
						],
						{...ARRIVE, duration: reduceMotion ? 0 : ARRIVE.duration},
					)
		return () => animation.cancel()
		// Once per marker: a marker's arrival is its mount
	}, [])

	const label =
		count === 1
			? t(flags & POINT_FLAGS.video ? 'photos-map.marker-one-video' : 'photos-map.marker-one', {
					date: formatDate(points.takenAt[cover]!, i18n.language),
				})
			: t('photos-map.marker-many', {count, formattedCount: formatCount(count, i18n.language)})

	return (
		<div
			ref={(element) => register(marker, element)}
			data-cover={cover}
			className='absolute top-0 left-0 will-change-transform'
			// Folding markers sink beneath the rest; otherwise the bigger the
			// cluster, the higher — and a scoped one above them all
			style={{zIndex: folding ? 0 : selected ? 100_000 : 1 + Math.min(count, 99_999)}}
		>
			<div ref={motionRef}>
				<button
					type='button'
					tabIndex={folding ? -1 : 0}
					aria-label={label}
					disabled={folding}
					onClick={(event) => {
						// A pointer leaves no focus behind: the lightbox would hand it
						// back on closing, ring and all. The keyboard's stays, to return to
						if (event.detail > 0) event.currentTarget.blur()
						if (photoRef.current) onActivate({cluster: marker.cluster, points, element: photoRef.current})
					}}
					className={cn(
						'group pointer-events-auto absolute block cursor-pointer rounded-[14px] outline-none',
						'transition-[scale,opacity] duration-200 ease-out',
						'hover:scale-[1.07] active:scale-[0.96]',
						selected && 'scale-[1.12] hover:scale-[1.14]',
						dimmed && 'opacity-45 hover:opacity-100',
						folding && 'pointer-events-none',
					)}
					style={{width: MARKER_SIZE, height: MARKER_SIZE, left: -MARKER_SIZE / 2, top: -MARKER_SIZE / 2}}
				>
					{/* The stack: one card peeking out behind the photo for a few,
					    two for many, cut from its colour */}
					{count > 1 && <StackCard tint={tint} className='translate-x-[-2px] translate-y-[1px] -rotate-[7deg]' />}
					{count >= 10 && <StackCard tint={tint} className='translate-x-[2px] translate-y-[-1px] rotate-[5deg]' />}
					<div
						ref={photoRef}
						// Only the marker the lightbox flies from and to answers to the
						// id: the list beside the map has the same photo, and the flight
						// takes the first element it finds. Any marker showing the
						// photo empties while its picture is up, though, wherever that
						// flew from (tile-lift.ts) — the whole marker, for one photo; a
						// stack keeps its cards beneath. The focus ring is the photo's
						// for that: the keyboard's focus stays on the marker under the
						// lightbox, and a ring round a hole would be all that was left
						data-item-id={isFlightSource ? id : undefined}
						data-item-copy={id}
						className='absolute inset-0 overflow-hidden rounded-[12px] bg-[#2a2f35] shadow-[0_1px_2px_rgb(0_0_0/0.4),0_8px_20px_-6px_rgb(0_0_0/0.6)] ring-2 ring-white group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-white/80'
					>
						<ItemThumbnail item={{id, tint}} size={192} className='size-full' />
						{/* The photo being pointed at in the list, laid over the cover */}
						{peek !== undefined && peek.id !== id && (
							<div key={peek.id} data-item-copy={peek.id} className='absolute inset-0'>
								<ItemThumbnail
									item={peek}
									size={192}
									className='size-full motion-safe:animate-in motion-safe:duration-150 motion-safe:fade-in'
								/>
							</div>
						)}
						{flags & POINT_FLAGS.video ? <PlayGlyph /> : null}
					</div>
					{count > 1 && (
						<span className='absolute -top-2 -right-2 flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-white px-[5px] text-[11px] leading-none font-semibold text-[#111] tabular-nums shadow-[0_1px_3px_rgb(0_0_0/0.45)]'>
							{formatCount(count, i18n.language)}
						</span>
					)}
				</button>
			</div>
		</div>
	)
})

function StackCard({tint, className}: {tint?: number; className: string}) {
	return (
		<div
			aria-hidden
			className={cn('absolute inset-0 rounded-[12px] ring-2 ring-white/85 brightness-[0.55]', className)}
			style={{backgroundColor: tint === undefined ? '#3a4047' : `#${tint.toString(16).padStart(6, '0')}`}}
		/>
	)
}

function PlayGlyph() {
	return (
		<svg
			aria-hidden
			viewBox='0 0 12 12'
			className='absolute bottom-1 left-1 size-3 fill-white drop-shadow-[0_1px_1px_rgb(0_0_0/0.6)]'
		>
			<path d='M3 1.8v8.4c0 .5.5.8.9.5l6.6-4.2c.4-.2.4-.8 0-1L3.9 1.3c-.4-.3-.9 0-.9.5Z' />
		</svg>
	)
}

// "248", "1.2K", "12K" — a badge has room for four characters
function formatCount(count: number, locale: string) {
	return new Intl.NumberFormat(locale, {
		notation: count >= 1000 ? 'compact' : 'standard',
		maximumFractionDigits: 1,
	}).format(count)
}

// In UTC, as all of Photos reads a taken-at: a wall clock with no offset is
// kept as if it were UTC
function formatDate(takenAt: number, locale: string) {
	return new Intl.DateTimeFormat(locale, {month: 'long', year: 'numeric', timeZone: 'UTC'}).format(takenAt)
}
