import {
	latitudeAt,
	longitudeAt,
	mercatorY,
	POINT_FLAGS,
	WORLD_SIZE,
	type MapPoints,
} from '@/features/photos/components/map/points'
import type {MapBounds} from '@/features/photos/components/view-context'

// How photos gather into markers. Every marker is a photograph — the best of
// the photos it stands for, its "cover" — sitting where that photo was taken,
// with a count when it stands for more than one.
//
// The world is cut into square cells CELL px across at the clustering zoom;
// a cell's photos are one marker. Cells nest exactly, four to one, from each
// zoom to the next, and a cover is the best photo of its cell — so the best
// of four children is the parent's cover. Zooming in, a marker's own photo is
// always one of the markers it splits into, and stays put while its siblings
// come out from under it; zooming out, they fold back into it. Markers are
// drawn at their cover's place, never a cell's middle, so nothing ever lands
// in the sea between two towns, and markers whose covers land too close
// together are merged after the fact (see separate) — cells are a grid, and
// two photos a pixel apart can sit either side of a line.

// A marker's side, in CSS px
export const MARKER_SIZE = 56
// How close two markers' centres may come before they are one: their side
// and a sliver of map between them
const MERGE_DISTANCE = MARKER_SIZE + 6
// The cell's side, in px at the clustering zoom (a tile is 512)
const CELL = 64

export type Cluster = {
	// The point whose photo the marker shows, and where it stands
	cover: number
	count: number
	// The extent of its points in Mercator units, for flying to fit them
	minX: number
	minY: number
	maxX: number
	maxY: number
}

export type Clustering = {
	// The whole zoom the cells were cut at
	zoom: number
	clusters: Cluster[]
	// Which cluster holds each point (-1: outside the area clustered) — how a
	// marker finds where its photos were a zoom ago
	owner: Int32Array
}

// A stretch of the world in Mercator units, x east and y south, 0–1
export type MercatorBox = {minX: number; minY: number; maxX: number; maxY: number}

export function clusterPoints(points: MapPoints, zoom: number, box: MercatorBox): Clustering {
	const better = coverOrder(points)
	const cellsPerSide = (WORLD_SIZE * 2 ** zoom) / CELL
	// The box, out to the far side of every cell its edge runs through: a cell
	// is gathered whole or not at all, or the marker of one at the edge would
	// change its count and its cover as it is panned in
	const minX = Math.floor(box.minX * cellsPerSide) / cellsPerSide
	const minY = Math.floor(box.minY * cellsPerSide) / cellsPerSide
	const maxX = Math.ceil(box.maxX * cellsPerSide) / cellsPerSide
	const maxY = Math.ceil(box.maxY * cellsPerSide) / cellsPerSide
	const owner = new Int32Array(points.count).fill(-1)
	const clusters: Cluster[] = []
	const byCell = new Map<number, number>()
	for (let index = 0; index < points.count; index++) {
		const x = points.x[index]!
		const y = points.y[index]!
		if (x < minX || x > maxX || y < minY || y > maxY) continue
		const key = Math.floor(y * cellsPerSide) * cellsPerSide + Math.floor(x * cellsPerSide)
		let at = byCell.get(key)
		if (at === undefined) {
			at = clusters.length
			byCell.set(key, at)
			clusters.push({cover: index, count: 1, minX: x, minY: y, maxX: x, maxY: y})
		} else {
			const cluster = clusters[at]!
			cluster.count++
			if (better(index, cluster.cover)) cluster.cover = index
			if (x < cluster.minX) cluster.minX = x
			if (x > cluster.maxX) cluster.maxX = x
			if (y < cluster.minY) cluster.minY = y
			if (y > cluster.maxY) cluster.maxY = y
		}
		owner[index] = at
	}
	return separate(points, {zoom, clusters, owner}, better)
}

// Merges markers whose covers stand too close: the bigger keeps its place
// unless what joins it brings a better photo, in which case the marker is
// that photo, where it was taken
function separate(points: MapPoints, clustering: Clustering, better: (a: number, b: number) => boolean): Clustering {
	const {zoom, clusters, owner} = clustering
	const scale = WORLD_SIZE * 2 ** zoom
	const order = clusters.map((_, index) => index).sort((a, b) => clusters[b]!.count - clusters[a]!.count)
	// Kept markers, bucketed by MERGE_DISTANCE-sized squares of the screen so
	// each only checks its neighbours
	const buckets = new Map<string, number[]>()
	const into = new Int32Array(clusters.length).fill(-1)
	const kept: number[] = []
	for (const index of order) {
		const cluster = clusters[index]!
		const px = points.x[cluster.cover]! * scale
		const py = points.y[cluster.cover]! * scale
		const bx = Math.floor(px / MERGE_DISTANCE)
		const by = Math.floor(py / MERGE_DISTANCE)
		let target = -1
		search: for (let dy = -1; dy <= 1; dy++) {
			for (let dx = -1; dx <= 1; dx++) {
				for (const candidate of buckets.get(`${bx + dx},${by + dy}`) ?? []) {
					const other = clusters[candidate]!
					if (
						Math.abs(points.x[other.cover]! * scale - px) < MERGE_DISTANCE &&
						Math.abs(points.y[other.cover]! * scale - py) < MERGE_DISTANCE
					) {
						target = candidate
						break search
					}
				}
			}
		}
		if (target === -1) {
			into[index] = index
			kept.push(index)
			const key = `${bx},${by}`
			buckets.set(key, [...(buckets.get(key) ?? []), index])
			continue
		}
		into[index] = target
		const host = clusters[target]!
		host.count += cluster.count
		if (better(cluster.cover, host.cover)) host.cover = cluster.cover
		host.minX = Math.min(host.minX, cluster.minX)
		host.minY = Math.min(host.minY, cluster.minY)
		host.maxX = Math.max(host.maxX, cluster.maxX)
		host.maxY = Math.max(host.maxY, cluster.maxY)
	}
	if (kept.length === clusters.length) return clustering
	const renumbered = new Int32Array(clusters.length)
	kept.forEach((index, position) => (renumbered[index] = position))
	for (let point = 0; point < owner.length; point++) {
		if (owner[point]! >= 0) owner[point] = renumbered[into[owner[point]!]!]!
	}
	return {zoom, clusters: kept.map((index) => clusters[index]!), owner}
}

// Which of two points makes the better cover: a favourite over the rest, a
// photograph over a video, and anything over a screenshot; the newest
// between equals (points come newest first, so the lower index). Scores are
// worked out once per set of points.
const scores = new WeakMap<MapPoints, Int8Array>()
function coverOrder(points: MapPoints) {
	let score = scores.get(points)
	if (!score) {
		score = new Int8Array(points.count)
		for (let index = 0; index < points.count; index++) {
			const flags = points.flags[index]!
			score[index] =
				(flags & POINT_FLAGS.favorite ? 8 : 0) +
				(flags & POINT_FLAGS.panorama ? 1 : 0) -
				(flags & POINT_FLAGS.video ? 2 : 0) -
				(flags & POINT_FLAGS.screenshot ? 4 : 0)
		}
		scores.set(points, score)
	}
	const scored = score
	return (a: number, b: number) => scored[a]! > scored[b]! || (scored[a] === scored[b] && a < b)
}

// How the markers of one clustering came from another's — for each new
// cluster the old one its cover was in (-1 if it was nowhere), and for each
// old cluster the new one its cover went into. A new cluster whose origin
// had another cover was dealt out of it (a split); an old cluster whose
// cover is no new cluster's folded into its destination (a merge).
export function lineage(previous: Clustering, next: Clustering) {
	return {
		origins: next.clusters.map(({cover}) => previous.owner[cover] ?? -1),
		destinations: previous.clusters.map(({cover}) => next.owner[cover] ?? -1),
	}
}

// A spot's photos, and a little around them: what a float32 rounds away.
// Beside the antimeridian that little would reach past ±180, which no list
// can be asked for, so it stops there. Photos nearer a pole than Mercator
// goes are drawn on its edge: a spot there reaches on to the pole itself
export function padBounds({minX, minY, maxX, maxY}: MercatorBox): MapBounds {
	const pad = 2e-7
	return {
		west: Math.max(-180, longitudeAt(minX - pad)),
		south: maxY >= mercatorY(-90) ? -90 : latitudeAt(maxY + pad),
		east: Math.min(180, longitudeAt(maxX + pad)),
		north: minY <= mercatorY(90) ? 90 : latitudeAt(minY - pad),
	}
}

// The clustering zoom for a map zoom, sticky across whole levels: a zoom in
// splits at the next level, a zoom out merges only a little below the
// current one — so a trackpad hovering over a level can't flicker markers
// in and out. Markers spread as the map zooms in from a level, and may
// close in by the hysteresis before they merge.
const HYSTERESIS = 0.3
export function clusterZoom(mapZoom: number, current: number | undefined, maxZoom: number) {
	const level = Math.min(maxZoom, Math.max(0, Math.floor(mapZoom)))
	if (current === undefined) return level
	if (level > current) return level
	if (mapZoom < current - HYSTERESIS) return Math.min(maxZoom, Math.max(0, Math.floor(mapZoom + HYSTERESIS)))
	return current
}
