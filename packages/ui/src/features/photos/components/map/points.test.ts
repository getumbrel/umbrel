import {describe, expect, test} from 'vitest'

import {decodeMapPoints, POINT_FLAGS} from '@/features/photos/components/map/points'

type Item = {hash: number[]; lat: number; lng: number; takenAt: number; flags: number; tint: number | null}

// Packed the way umbreld packs them (mapPoints in its photos/repository.ts),
// with its numbers rather than this side's: the two are kept alike by hand
function pack(unlocated: number, items: Item[]) {
	const packed = new Uint8Array(4 + items.length * 52)
	const view = new DataView(packed.buffer)
	view.setUint32(0, unlocated, true)
	items.forEach(({hash, lat, lng, takenAt, flags, tint}, index) => {
		const offset = 4 + index * 52
		packed.set(hash, offset)
		view.setFloat32(offset + 32, lat, true)
		view.setFloat32(offset + 36, lng, true)
		view.setFloat64(offset + 40, takenAt, true)
		view.setUint8(offset + 48, flags | (tint === null ? 0 : 64))
		if (tint !== null) {
			view.setUint8(offset + 49, (tint >> 16) & 0xff)
			view.setUint8(offset + 50, (tint >> 8) & 0xff)
			view.setUint8(offset + 51, tint & 0xff)
		}
	})
	return packed.buffer
}

const hash = (first: number, last = 31) => [first, ...Array.from({length: 30}, (_, byte) => byte + 1), last]
const ITEMS: Item[] = [
	{hash: hash(0), lat: 38.7139, lng: -9.1394, takenAt: 1_700_000_000_000, flags: 1, tint: 0x1a2b3c},
	{hash: hash(255), lat: 35.6762, lng: 139.6503, takenAt: 1_600_000_000_000, flags: 2 | 16, tint: null},
	// The first one's hash but for its last byte, and tinted black
	{hash: hash(0, 32), lat: -33.8688, lng: 151.2093, takenAt: 1_500_000_000_000, flags: 8, tint: 0},
]

describe('decodeMapPoints', () => {
	const points = decodeMapPoints(pack(7, ITEMS))

	test('unpacks a record per located item, after the count of the rest', () => {
		expect(points.count).toBe(3)
		expect(points.unlocated).toBe(7)
		expect([...points.lat]).toEqual(ITEMS.map(({lat}) => Math.fround(lat)))
		expect([...points.lng]).toEqual(ITEMS.map(({lng}) => Math.fround(lng)))
		expect([...points.takenAt]).toEqual(ITEMS.map(({takenAt}) => takenAt))
	})

	test('reads the flags, and a tint only where they say there is one', () => {
		expect([...points.flags]).toEqual([
			POINT_FLAGS.favorite | POINT_FLAGS.tint,
			POINT_FLAGS.video | POINT_FLAGS.screenshot,
			POINT_FLAGS.panorama | POINT_FLAGS.tint,
		])
		expect([...points.tint]).toEqual([0x1a2b3c, -1, 0])
	})

	test('makes an id of a hash, and finds its point again', () => {
		expect(points.id(0)).toBe('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f')
		expect(points.id(1)).toMatch(/^ff[0-9a-f]{62}$/)
		expect(ITEMS.map((_, index) => points.indexOf(points.id(index)))).toEqual([0, 1, 2])
	})

	test('finds no point for an id that is none of them, or is no id at all', () => {
		expect(points.indexOf('ab'.repeat(32))).toBe(-1)
		expect(points.indexOf('')).toBe(-1)
		expect(points.indexOf(points.id(0).slice(2))).toBe(-1)
		expect(points.indexOf('zz'.repeat(32))).toBe(-1)
	})
})
