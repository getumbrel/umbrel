import type {MapBounds} from '@/features/photos/components/view-context'

// Every located item a filter selects, as the map draws them: one record per
// item in the timeline's order (newest first), unpacked from the wire format
// (see MAP_POINT_BYTES in umbreld's photos/types.ts) into columns, after the
// count of the ones with no location that leads it. Positions
// are kept in Web Mercator's unit square too — x east from the antimeridian,
// y south from the top — the space the clustering works in.
export type MapPoints = {
	count: number
	lat: Float32Array
	lng: Float32Array
	x: Float64Array
	y: Float64Array
	takenAt: Float64Array
	flags: Uint8Array
	// 0xRRGGBB, or -1 where the item has no tint yet
	tint: Int32Array
	// How many items the filter selects that have no location
	unlocated: number
	id: (index: number) => string
	// Which point an id is, or -1 when it is none of them
	indexOf: (id: string) => number
}

const HEADER_BYTES = 4
const RECORD_BYTES = 52
export const POINT_FLAGS = {
	favorite: 1,
	video: 2,
	live: 4,
	panorama: 8,
	screenshot: 16,
	spherical: 32,
	tint: 64,
} as const

export function decodeMapPoints(buffer: ArrayBuffer): MapPoints {
	const count = Math.floor((buffer.byteLength - HEADER_BYTES) / RECORD_BYTES)
	const view = new DataView(buffer)
	const bytes = new Uint8Array(buffer)
	// Ids are made only for the items that are asked about — covers, mostly
	const ids: Array<string | undefined> = new Array(count)
	const points: MapPoints = {
		count,
		lat: new Float32Array(count),
		lng: new Float32Array(count),
		x: new Float64Array(count),
		y: new Float64Array(count),
		takenAt: new Float64Array(count),
		flags: new Uint8Array(count),
		tint: new Int32Array(count),
		unlocated: view.getUint32(0, true),
		id: (index) => {
			let id = ids[index]
			if (id === undefined) {
				id = ''
				for (let byte = HEADER_BYTES + index * RECORD_BYTES, end = byte + 32; byte < end; byte++)
					id += HEX[bytes[byte]!]
				ids[index] = id
			}
			return id
		},
		// Found by its bytes among the records: no id is made to look for one
		indexOf: (id) => {
			if (!/^[0-9a-f]{64}$/.test(id)) return -1
			const wanted = Uint8Array.from({length: 32}, (_, byte) => parseInt(id.slice(byte * 2, byte * 2 + 2), 16))
			search: for (let index = 0; index < count; index++) {
				const offset = HEADER_BYTES + index * RECORD_BYTES
				for (let byte = 0; byte < 32; byte++) if (bytes[offset + byte] !== wanted[byte]) continue search
				return index
			}
			return -1
		},
	}
	for (let index = 0; index < count; index++) {
		const offset = HEADER_BYTES + index * RECORD_BYTES
		const lat = view.getFloat32(offset + 32, true)
		const lng = view.getFloat32(offset + 36, true)
		const flags = view.getUint8(offset + 48)
		points.lat[index] = lat
		points.lng[index] = lng
		points.x[index] = mercatorX(lng)
		points.y[index] = mercatorY(lat)
		points.takenAt[index] = view.getFloat64(offset + 40, true)
		points.flags[index] = flags
		points.tint[index] =
			flags & POINT_FLAGS.tint ? (bytes[offset + 49]! << 16) | (bytes[offset + 50]! << 8) | bytes[offset + 51]! : -1
	}
	return points
}

const HEX = Array.from({length: 256}, (_, byte) => byte.toString(16).padStart(2, '0'))

// MapLibre's world at zoom 0, in px: it doubles with every zoom
export const WORLD_SIZE = 512

// Web Mercator, as a fraction of the world: what MapLibre's own coordinates
// are, before multiplying by the world's size in pixels at a zoom
export const mercatorX = (lng: number) => (lng + 180) / 360
export function mercatorY(lat: number) {
	const clamped = Math.max(-85.0511, Math.min(85.0511, lat))
	const sin = Math.sin((clamped * Math.PI) / 180)
	return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)
}
// Whether a place is in a stretch of the map, edges included, as the server's
// bounds filter has it: across the antimeridian when west is east of east
export function within({west, south, east, north}: MapBounds, lat: number, lng: number) {
	const across = west <= east ? lng >= west && lng <= east : lng >= west || lng <= east
	return across && lat >= south && lat <= north
}

export const longitudeAt = (x: number) => x * 360 - 180
export const latitudeAt = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI
