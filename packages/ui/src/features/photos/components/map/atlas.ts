import {useEffect, useState} from 'react'

// The atlas: Natural Earth's countries and populated places, bundled with
// the UI (built by scripts/build-photos-offline-map.mjs). The map names the
// area it shows from it, the inspector names where a photo was taken, and
// with no basemap on the device, the map draws its countries.

export const OFFLINE_MAP_DATA_URL = '/assets/photos/offline-map-v1.json'

type Point = [lng: number, lat: number]
type Bounds = [west: number, south: number, east: number, north: number]
type Country = [name: string, iso2: string, bounds: Bounds, rings: Point[][]]
type Place = [lng: number, lat: number, name: string, region: string, iso2: string, population: number, rank: number]

export type OfflineMapData = {
	version: 1
	source: string
	c: Country[]
	p: Place[]
}

let atlasPromise: Promise<OfflineMapData> | undefined

// The only runtime resource behind it is a same-origin static asset: no
// geocoder, tile or telemetry URL is involved
export function fetchOfflineMapData(fetcher: typeof fetch = fetch) {
	return fetcher(OFFLINE_MAP_DATA_URL, {credentials: 'same-origin'}).then((response) => {
		if (!response.ok) throw new Error(`Unable to load offline map data (${response.status})`)
		return response.json() as Promise<OfflineMapData>
	})
}

// Once per session. Exported so the lightbox's neighbour prefetch can warm
// it before a step lands on a located item with the inspector open
export function loadAtlas() {
	if (!atlasPromise) {
		atlasPromise = fetchOfflineMapData()
		// A transient failure must not poison the session's cache: the next
		// one to ask retries the fetch
		atlasPromise.catch(() => (atlasPromise = undefined))
	}
	return atlasPromise
}

// The atlas, once it is here: undefined while it is on its way, and null if
// it couldn't be fetched, so what waits on it can stop waiting
export function useAtlas() {
	const [atlas, setAtlas] = useState<OfflineMapData | null>()
	useEffect(() => {
		let current = true
		loadAtlas().then(
			(data) => current && setAtlas(data),
			() => current && setAtlas(null),
		)
		return () => {
			current = false
		}
	}, [])
	return atlas
}

// A place's name, as finely as asked: the nearest town with its region and
// country (the inspector), the town and country (the map, close in), or the
// country alone (the map, further out)
export function locationName(
	atlas: OfflineMapData,
	lat: number,
	lng: number,
	locale: string,
	detail: 'full' | 'city' | 'country' = 'full',
) {
	let nearest: {place: Place; distance: number} | undefined
	for (const place of atlas.p) {
		const distance = haversineKm(lat, lng, place[1], place[0])
		if (!nearest || distance < nearest.distance) nearest = {place, distance}
	}

	const country = atlas.c.find(([, , bounds, rings]) => pointInPolygon([lng, lat], bounds, rings))
	const countryCode =
		country?.[1] || (nearest?.distance !== undefined && nearest.distance <= 250 ? nearest.place[4] : '')
	const countryName = countryDisplayName(countryCode, locale) || country?.[0] || ''
	const parts: string[] = []
	if (detail !== 'country' && nearest && nearest.distance <= 180) {
		parts.push(nearest.place[2])
		if (detail === 'full' && nearest.place[3] && nearest.place[3] !== nearest.place[2]) parts.push(nearest.place[3])
	}
	if (countryName && !parts.includes(countryName)) parts.push(countryName)
	return parts.join(', ')
}

function pointInPolygon([lng, lat]: Point, [, south, , north]: Bounds, rings: Point[][]) {
	if (lat < south || lat > north) return false
	// Each ring laid out unbroken — one that crosses the antimeridian runs on
	// past ±180 rather than jumping back — and the point tried at each of its
	// copies. Measuring the ring from the point instead wraps a country on
	// the far side of the world around it, and finds it inside.
	const inRing = (ring: Point[]) => {
		const lngs: number[] = []
		for (const [ringLng] of ring) {
			const last = lngs.at(-1)
			lngs.push(last === undefined ? ringLng : last + longitudeDelta(ringLng, last))
		}
		return [lng - 360, lng, lng + 360].some((x) => {
			let inside = false
			for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
				const currentLat = ring[current]![1]
				const previousLat = ring[previous]![1]
				const x1 = lngs[current]!
				const x2 = lngs[previous]!
				if (
					currentLat > lat !== previousLat > lat &&
					x < ((x2 - x1) * (lat - currentLat)) / (previousLat - currentLat) + x1
				)
					inside = !inside
			}
			return inside
		})
	}
	return Boolean(rings[0] && inRing(rings[0]) && !rings.slice(1).some(inRing))
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
	const radians = Math.PI / 180
	const dLat = (lat2 - lat1) * radians
	const dLng = longitudeDelta(lng2, lng1) * radians
	const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLng / 2) ** 2
	return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function countryDisplayName(code: string, locale: string) {
	if (!code) return ''
	try {
		return new Intl.DisplayNames([locale], {type: 'region'}).of(code) || ''
	} catch {
		return new Intl.DisplayNames(['en'], {type: 'region'}).of(code) || ''
	}
}

function longitudeDelta(lng: number, center: number) {
	return ((((lng - center + 180) % 360) + 360) % 360) - 180
}
