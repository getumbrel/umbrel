import nodePath from 'node:path'

import BetterSqlite3 from 'better-sqlite3'
import {afterAll, afterEach, beforeEach, expect, test} from 'vitest'

import {migrateFileIndex} from '../files/file-index/migrations.ts'
import temporaryDirectory from '../utilities/temporary-directory.ts'
import {migratePhotos} from './migrations.ts'
import PhotosRepository from './repository.ts'
import {MAP_POINT_BYTES, MAP_POINT_FLAGS, MAP_POINTS_HEADER_BYTES} from './types.ts'

// Each item: where it was taken (or nowhere), what it is, and its tint.
// Newer items have higher ids (taken_at is id seconds).
const ITEMS = [
	{id: 1, place: [38.7139, -9.1394], kind: 'photo'},
	{id: 2, place: [38.7223, -9.1393], kind: 'photo', tint: 0x336699},
	{id: 3, place: [35.6762, 139.6503], kind: 'photo'},
	// Fiji, either side of the antimeridian
	{id: 4, place: [-17.7134, 178.065], kind: 'photo'},
	{id: 5, place: [-16.5, -179.9], kind: 'photo', subKind: 'panorama'},
	{id: 6, place: undefined, kind: 'photo'},
	{id: 7, place: [38.7, -9.15], kind: 'video'},
] as const

const LISBON = {west: -9.3, south: 38.6, east: -9.0, north: 38.8}
const FIJI = {west: 170, south: -20, east: -170, north: -10}

const temporary = temporaryDirectory()
let database: BetterSqlite3.Database
let durable: BetterSqlite3.Database
const repository = new PhotosRepository()
const hash = (id: number) => {
	const value = Buffer.alloc(32)
	value.writeUInt32BE(id)
	return value
}
const idOf = (id: number) => hash(id).toString('hex')

beforeEach(async () => {
	const directory = await temporary.create()
	database = new BetterSqlite3(':memory:')
	const durablePath = nodePath.join(directory, 'umbrel.db')
	durable = new BetterSqlite3(durablePath)
	migratePhotos(durable)
	await migrateFileIndex(database)
	database.prepare('ATTACH DATABASE ? AS umbrel').run(durablePath)
	database.exec(`
		INSERT INTO index_roots(id, virtual_path, system_path, owner_id, kind, search_enabled, created_at, updated_at)
		VALUES (1, '/Home', '/home', 'owner', 'home', 1, 1, 1);
	`)
	for (const item of ITEMS) {
		const name = `${item.id}.${item.kind === 'video' ? 'mov' : 'jpg'}`
		database
			.prepare('INSERT INTO contents(id, blake3, size, created_at) VALUES (?, ?, 100, 1)')
			.run(item.id, hash(item.id))
		database
			.prepare(
				`INSERT INTO entries(root_id, relative_path, name, type, size, modified_ms, hidden, thumbnail_identity_kind, content_id)
				VALUES (1, ?, ?, 'file', 100, 1, 0, 'content', ?)`,
			)
			.run(name, name, item.id)
		database
			.prepare(
				`INSERT INTO media_metadata(content_id, state, kind, sub_kind, taken_at, width, height, tint, latitude, longitude, updated_at)
				VALUES (?, 'ready', ?, ?, ?, 100, 50, ?, ?, ?, 1)`,
			)
			.run(
				item.id,
				item.kind,
				'subKind' in item ? item.subKind : null,
				item.id * 1000,
				'tint' in item ? item.tint : null,
				item.place?.[0] ?? null,
				item.place?.[1] ?? null,
			)
	}
	repository.syncAll(database)
})

afterEach(() => {
	database.close()
	durable.close()
})

afterAll(() => temporary.destroyRoot())

function decode(packed: Uint8Array) {
	const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength)
	const count = (packed.byteLength - MAP_POINTS_HEADER_BYTES) / MAP_POINT_BYTES
	return {
		unlocated: view.getUint32(0, true),
		points: Array.from({length: count}, (_, index) => {
			const offset = MAP_POINTS_HEADER_BYTES + index * MAP_POINT_BYTES
			return {
				id: Buffer.from(packed.subarray(offset, offset + 32)).toString('hex'),
				lat: view.getFloat32(offset + 32, true),
				lng: view.getFloat32(offset + 36, true),
				takenAt: view.getFloat64(offset + 40, true),
				flags: view.getUint8(offset + 48),
				tint: (view.getUint8(offset + 49) << 16) | (view.getUint8(offset + 50) << 8) | view.getUint8(offset + 51),
			}
		}),
	}
}

test('map points carry every located item, newest first, and count the rest', () => {
	const {points: decoded, unlocated} = decode(repository.mapPoints(database, 'owner', {}))
	expect(unlocated).toBe(1)
	expect(decoded.map(({id}) => id)).toEqual([7, 5, 4, 3, 2, 1].map(idOf))
	expect(decoded.find(({id}) => id === idOf(2))).toMatchObject({takenAt: 2000, tint: 0x336699})
	expect(decoded.find(({id}) => id === idOf(2))!.flags & MAP_POINT_FLAGS.tint).toBeTruthy()
	expect(decoded.find(({id}) => id === idOf(2))!.lat).toBeCloseTo(38.7223, 4)
	expect(decoded.find(({id}) => id === idOf(2))!.lng).toBeCloseTo(-9.1393, 4)
	expect(decoded.find(({id}) => id === idOf(7))!.flags & MAP_POINT_FLAGS.video).toBeTruthy()
	expect(decoded.find(({id}) => id === idOf(5))!.flags & MAP_POINT_FLAGS.panorama).toBeTruthy()
	expect(decoded.find(({id}) => id === idOf(1))!.flags).toBe(0)
})

test('map points follow the filter and the account', () => {
	repository.setFavorite(database, 'owner', [idOf(3)], true)
	expect(
		decode(repository.mapPoints(database, 'owner', {favorite: true})).points.map(({id, flags}) => [id, flags]),
	).toEqual([[idOf(3), MAP_POINT_FLAGS.favorite]])
	expect(decode(repository.mapPoints(database, 'owner', {kind: 'video'})).points.map(({id}) => id)).toEqual([idOf(7)])
	expect(decode(repository.mapPoints(database, 'member', {}))).toEqual({unlocated: 0, points: []})
})

test('a list narrowed to a stretch of map has exactly the items taken there', () => {
	const lisbon = repository.listItems(database, 'owner', {bounds: LISBON}, undefined, 10)
	expect(lisbon.total).toBe(3)
	expect(lisbon.items.map(({id}) => id)).toEqual([7, 2, 1].map(idOf))
	expect(repository.listItems(database, 'owner', {bounds: LISBON, kind: 'photo'}, undefined, 10).items).toHaveLength(2)
	expect(decode(repository.mapPoints(database, 'owner', {bounds: LISBON})).points).toHaveLength(3)
	// … paging through it
	const first = repository.listItems(database, 'owner', {bounds: LISBON}, undefined, 2)
	const next = repository.listItems(database, 'owner', {bounds: LISBON}, first.nextCursor, 2)
	expect([...first.items, ...next.items].map(({id}) => id)).toEqual([7, 2, 1].map(idOf))
	// … stepping through it in the lightbox
	expect(repository.neighbors(database, 'owner', idOf(2), {bounds: LISBON})).toEqual({prevId: idOf(7), nextId: idOf(1)})
})

test('a stretch across the antimeridian is the two sides of it', () => {
	const fiji = repository.listItems(database, 'owner', {bounds: FIJI}, undefined, 10)
	expect(fiji.items.map(({id}) => id)).toEqual([5, 4].map(idOf))
	expect(repository.listItems(database, 'owner', {bounds: {...FIJI, west: -180, east: 180}}, undefined, 10).total).toBe(
		2,
	)
})

test('a crowded stretch, too big to list by candidates, is still counted, paged and stepped through whole', () => {
	const crowd = Array.from({length: 1200}, (_, index) => 100 + index)
	database.transaction(() => {
		for (const id of crowd) {
			database.prepare('INSERT INTO contents(id, blake3, size, created_at) VALUES (?, ?, 100, 1)').run(id, hash(id))
			database
				.prepare(
					`INSERT INTO entries(root_id, relative_path, name, type, size, modified_ms, hidden, thumbnail_identity_kind, content_id)
					VALUES (1, ?, ?, 'file', 100, 1, 0, 'content', ?)`,
				)
				.run(`${id}.jpg`, `${id}.jpg`, id)
			database
				.prepare(
					`INSERT INTO media_metadata(content_id, state, kind, taken_at, width, height, latitude, longitude, updated_at)
					VALUES (?, 'ready', 'photo', ?, 100, 50, 38.7, -9.14, 1)`,
				)
				.run(id, id * 1000)
		}
	})()
	repository.syncAll(database)
	const first = repository.listItems(database, 'owner', {bounds: LISBON}, undefined, 2)
	expect(first.total).toBe(1203)
	expect(first.items.map(({id}) => id)).toEqual([1299, 1298].map(idOf))
	expect(
		repository.listItems(database, 'owner', {bounds: LISBON}, first.nextCursor, 2).items.map(({id}) => id),
	).toEqual([1297, 1296].map(idOf))
	expect(repository.listItems(database, 'owner', {bounds: FIJI}, undefined, 10).total).toBe(2)
	expect(repository.neighbors(database, 'owner', idOf(100), {bounds: LISBON})).toEqual({
		prevId: idOf(101),
		nextId: idOf(7),
	})
})
