import nodePath from 'node:path'

import BetterSqlite3 from 'better-sqlite3'
import {expect, test} from 'vitest'

import {migrateFileIndex} from '../files/file-index/migrations.ts'
import temporaryDirectory from '../utilities/temporary-directory.ts'
import {migratePhotos} from './migrations.ts'
import PhotosRepository from './repository.ts'

test('single-photo reads use stored items without projecting the library as it grows', async () => {
	const temporary = temporaryDirectory()
	const directory = await temporary.create()
	const database = new BetterSqlite3(':memory:')
	const durablePath = nodePath.join(directory, 'umbrel.db')
	const durable = new BetterSqlite3(durablePath)
	try {
		migratePhotos(durable)
		await migrateFileIndex(database)
		database.prepare('ATTACH DATABASE ? AS umbrel').run(durablePath)
		database.exec(`
			INSERT INTO index_roots(id, virtual_path, system_path, owner_id, kind, search_enabled, created_at, updated_at)
			VALUES (1, '/Home', '/home', 'owner', 'home', 1, 1, 1);
		`)
		const content = database.prepare('INSERT INTO contents(id, blake3, size, created_at) VALUES (?, ?, 100, 1)')
		const entry = database.prepare(`
			INSERT INTO entries(root_id, relative_path, name, type, size, modified_ms, hidden, thumbnail_identity_kind, content_id)
			VALUES (1, ?, ?, 'file', 100, 1, 0, 'content', ?)
		`)
		const metadata = database.prepare(`
			INSERT INTO media_metadata(content_id, state, kind, taken_at, width, height, duration_ms, live_identifier, updated_at)
			VALUES (?, 'ready', ?, 1000, 100, 50, ?, ?, 1)
		`)
		const hash = (id: number) => {
			const value = Buffer.alloc(32)
			value.writeUInt32BE(id)
			return value
		}
		const insert = database.transaction((from: number, to: number) => {
			for (let id = from; id <= to; id++) {
				const video = id === 2
				const name = `${id}.${video ? 'mov' : 'jpg'}`
				content.run(id, hash(id))
				entry.run(name, name, id)
				metadata.run(id, video ? 'video' : 'photo', video ? 3000 : null, id <= 2 ? 'live-pair' : null)
			}
		})
		insert(1, 2)
		const repository = new PhotosRepository()
		const stillId = hash(1).toString('hex')
		const motionId = hash(2).toString('hex')

		// Drain indexing changes before measuring reads. The stored read model
		// must avoid reconstructing items after either initial or incremental sync.
		const projected = new Set<string>()
		database.function('hex', {deterministic: true}, (value: Buffer) => {
			projected.add(value.toString('hex'))
			return value.toString('hex').toUpperCase()
		})
		const assertReads = () => {
			projected.clear()
			expect(repository.getItem(database, 'owner', stillId)).toMatchObject({
				id: stillId,
				subKind: 'live',
				path: '/Home/1.jpg',
			})
			expect([...projected].every((id) => id === stillId || id === motionId)).toBe(true)
			projected.clear()
			expect(repository.resolveLiveCompanion(database, 'owner', stillId)).toEqual({
				id: motionId,
				path: '/Home/2.mov',
			})
			expect([...projected].every((id) => id === stillId || id === motionId)).toBe(true)
			expect(repository.getItem(database, 'owner', motionId)).toBeUndefined()
			expect(repository.getItem(database, 'member', stillId)).toBeUndefined()
			expect(repository.resolveLiveCompanion(database, 'member', stillId)).toBeUndefined()
		}
		repository.syncAll(database)
		assertReads()
		insert(3, 10_000)
		repository.syncAll(database)
		assertReads()
		repository.upsertBackupSource(database, 'owner', 'small-phone', 'Small phone', 1)
		for (const value of [3, 7]) {
			database
				.prepare(
					`INSERT INTO umbrel.photos_source_resources(account_id, source_id, resource_key, content_hash)
				VALUES ('owner', 'small-phone', ?, ?)`,
				)
				.run(hash(value).toString('hex'), hash(value))
		}
		const sourcePage = repository.listItems(database, 'owner', {sourceIds: ['small-phone']}, undefined, 1)
		const sourceNext = repository.listItems(database, 'owner', {sourceIds: ['small-phone']}, sourcePage.nextCursor, 1)
		expect(sourcePage.total).toBe(2)
		expect(sourceNext.total).toBeUndefined()
		expect([...sourcePage.items, ...sourceNext.items].map(({id}) => id)).toEqual(
			[3, 7].map((value) => hash(value).toString('hex')),
		)
		expect(sourceNext.nextCursor).toBeUndefined()
		expect(repository.listItems(database, 'member', {sourceIds: ['small-phone']}, undefined, 10)).toEqual({
			items: [],
			total: 0,
		})
		const builtinSource = repository.listSources(database, 'owner').find(({type}) => type === 'umbrel')!
		const largeSource = repository.listItems(database, 'owner', {sourceIds: [builtinSource.id]}, undefined, 2)
		expect(largeSource.total).toBe(9997)
		expect(
			repository.listItems(database, 'owner', {sourceIds: [builtinSource.id]}, largeSource.nextCursor, 2).items,
		).toHaveLength(2)
		repository.syncAll(database)
		projected.clear()
		expect(repository.listItems(database, 'owner', {favorite: true}, undefined, 2)).toEqual({items: [], total: 0})
		expect(projected.size).toBe(0)
		repository.setFavorite(database, 'owner', [stillId], true)
		const favorite = repository.listItems(database, 'owner', {favorite: true}, undefined, 2)
		expect(favorite).toMatchObject({total: 1, items: [{id: stillId, subKind: 'live'}]})
		expect([...projected].every((value) => value === stillId || value === motionId)).toBe(true)
		// A large candidate set must retain every match when it falls back to
		// the broad projection, including the count and subsequent pages.
		database
			.prepare('UPDATE umbrel.photos_content_state SET is_favorite = (content_hash >= ? AND content_hash <= ?)')
			.run(hash(3), hash(1003))
		repository.syncAll(database)
		const first = repository.listItems(database, 'owner', {favorite: true}, undefined, 2)
		const second = repository.listItems(database, 'owner', {favorite: true}, first.nextCursor, 2)
		expect(first.total).toBe(1001)
		expect(second.total).toBeUndefined()
		expect([...first.items, ...second.items].map(({id}) => id)).toEqual(
			[3, 4, 5, 6].map((value) => hash(value).toString('hex')),
		)
	} finally {
		database.close()
		durable.close()
		await temporary.destroyRoot()
	}
})

test('optimized Photos reads preserve counts, source membership, filters and neighboring-item order', async () => {
	const temporary = temporaryDirectory()
	const directory = await temporary.create()
	const database = new BetterSqlite3(':memory:')
	const durablePath = nodePath.join(directory, 'umbrel.db')
	const durable = new BetterSqlite3(durablePath)
	const hash = (value: number) => {
		const buffer = Buffer.alloc(32)
		buffer.writeUInt32BE(value)
		return buffer
	}
	const id = (value: number) => hash(value).toString('hex')
	try {
		migratePhotos(durable)
		await migrateFileIndex(database)
		database.prepare('ATTACH DATABASE ? AS umbrel').run(durablePath)
		database.exec(`INSERT INTO index_roots(id, virtual_path, system_path, owner_id, kind, search_enabled, created_at, updated_at)
			VALUES (1, '/Home', '/home', 'owner', 'home', 1, 1, 1),
				(2, '/Trash', '/trash', 'owner', 'trash', 1, 1, 1),
				(3, '/Users/member/Home', '/member', 'member', 'home', 1, 1, 1)`)
		const entry = database.prepare(`INSERT INTO entries(root_id, relative_path, name, type, size, modified_ms,
			hidden, thumbnail_identity_kind, content_id) VALUES (?, ?, ?, 'file', 100, 1, 0, 'content', ?)`)
		for (let value = 1; value <= 8; value++) {
			const video = value === 2 || value === 4
			const name = `${value}.${video ? 'mov' : value === 5 ? 'png' : 'jpg'}`
			database
				.prepare('INSERT INTO contents(id, blake3, size, created_at) VALUES (?, ?, 100, 1)')
				.run(value, hash(value))
			entry.run(value === 7 ? 2 : value === 8 ? 3 : 1, name, name, value)
			database
				.prepare(
					`INSERT INTO media_metadata(content_id, state, kind, sub_kind, taken_at, width, height,
				duration_ms, live_identifier, updated_at) VALUES (?, 'ready', ?, ?, ?, 100, 50, ?, ?, 1)`,
				)
				.run(
					value,
					video ? 'video' : 'photo',
					value === 6 ? 'panorama' : null,
					value <= 3 ? 1000 : (value - 2) * 1000,
					video ? 3000 : null,
					value <= 2 ? 'live-pair' : null,
				)
		}
		entry.run(1, 'coastal-copy.jpg', 'coastal-copy.jpg', 3)
		database.exec('UPDATE entries SET search_name = name, search_name_folded = lower(name)')
		const repository = new PhotosRepository()
		repository.upsertBackupSource(database, 'owner', 'phone-a', 'Phone A', 1)
		repository.upsertBackupSource(database, 'owner', 'phone-b', 'Phone B', 2)
		const resource =
			database.prepare(`INSERT INTO umbrel.photos_source_resources(account_id, source_id, resource_key, content_hash)
			VALUES ('owner', ?, ?, ?)`)
		resource.run('phone-a', id(11), hash(3))
		resource.run('phone-a', id(12), hash(3))
		resource.run('phone-b', id(13), hash(3))
		repository.syncAll(database)
		repository.setFavorite(database, 'owner', [id(3), id(6)], true)
		const album = repository.createAlbum(database, 'owner', 'Selected', [id(3), id(6)])
		const memberAlbum = repository.createAlbum(database, 'member', 'Private', [id(8)])
		const builtin = repository.listSources(database, 'owner').find(({type}) => type === 'umbrel')!
		expect(repository.listItems(database, 'owner', {sourceIds: ['phone-a', 'phone-b']}, undefined, 10)).toMatchObject({
			total: 1,
			items: [{id: id(3)}],
		})
		expect(repository.listItems(database, 'owner', {sourceIds: ['phone-a'], kind: 'video'}, undefined, 10)).toEqual({
			items: [],
			total: 0,
		})
		expect(
			repository.listItems(database, 'owner', {sourceIds: [builtin.id], deleted: true}, undefined, 10),
		).toMatchObject({
			total: 1,
			items: [{id: id(7)}],
		})
		expect(repository.summary(database, 'owner')).toEqual({
			counts: {items: 5, favorites: 2, photos: 4, videos: 1, deleted: 1},
			sizeBytes: 500,
			bySubKind: {live: 1, panorama: 1, screenshot: 1, spherical: 0},
			bySource: {[builtin.id]: 4, 'phone-a': 1, 'phone-b': 1},
			months: [{year: 1970, month: 1, count: 5}],
		})
		expect(repository.listSources(database, 'owner')).toEqual(
			expect.arrayContaining([
				expect.objectContaining({id: builtin.id, stats: {photos: 3, videos: 1, sizeBytes: 400}}),
				expect.objectContaining({id: 'phone-a', stats: {photos: 1, videos: 0, sizeBytes: 100}}),
				expect.objectContaining({id: 'phone-b', stats: {photos: 1, videos: 0, sizeBytes: 100}}),
			]),
		)
		const first = repository.listItems(database, 'owner', {kind: 'photo'}, undefined, 2)
		const second = repository.listItems(database, 'owner', {kind: 'photo'}, first.nextCursor, 2)
		expect(first.total).toBe(4)
		expect(second.total).toBeUndefined()
		expect([...first.items, ...second.items].map(({id}) => id)).toEqual([id(6), id(5), id(1), id(3)])
		for (const filter of [{favorite: true}, {albumIds: [album.id]}]) {
			expect(repository.listItems(database, 'owner', filter, undefined, 10).items.map(({id}) => id)).toEqual([
				id(6),
				id(3),
			])
		}
		expect(
			repository.listItems(
				database,
				'owner',
				{favorite: true, albumIds: [album.id], kind: 'photo', dates: [{from: 1000, to: 2000}]},
				undefined,
				10,
			),
		).toMatchObject({total: 1, items: [{id: id(3)}]})
		expect(repository.listItems(database, 'owner', {query: 'coastal'}, undefined, 10)).toMatchObject({
			total: 1,
			items: [{id: id(3)}],
		})
		expect(repository.listItems(database, 'owner', {query: '8.jpg'}, undefined, 10)).toEqual({items: [], total: 0})
		expect(() => repository.listItems(database, 'owner', {albumIds: ['missing']}, 'invalid', 10)).toThrow()
		expect(repository.listItems(database, 'owner', {albumIds: [memberAlbum.id]}, undefined, 10)).toEqual({
			total: 0,
			items: [],
		})
		expect(repository.listItems(database, 'owner', {subKind: 'spherical'}, undefined, 10)).toEqual({
			total: 0,
			items: [],
		})
		expect(repository.listItems(database, 'owner', {deleted: true}, undefined, 10)).toMatchObject({
			total: 1,
			items: [{id: id(7)}],
		})
		expect(repository.neighbors(database, 'owner', id(5), {})).toEqual({prevId: id(6), nextId: id(4)})
		expect(repository.neighbors(database, 'owner', id(5), {kind: 'photo'})).toEqual({prevId: id(6), nextId: id(1)})
		expect(repository.neighbors(database, 'owner', id(1), {kind: 'photo'})).toEqual({prevId: id(5), nextId: id(3)})
		expect(repository.neighbors(database, 'owner', id(6), {favorite: true})).toEqual({nextId: id(3)})
		expect(repository.neighbors(database, 'owner', id(3), {favorite: true})).toEqual({prevId: id(6)})
		expect(repository.neighbors(database, 'owner', id(6), {})).toEqual({nextId: id(5)})
		expect(repository.neighbors(database, 'owner', id(3), {})).toEqual({prevId: id(1)})
		expect(repository.neighbors(database, 'owner', id(4), {kind: 'photo'})).toBeUndefined()
		expect(repository.neighbors(database, 'member', id(1), {})).toBeUndefined()
	} finally {
		database.close()
		durable.close()
		await temporary.destroyRoot()
	}
})

test('a search of Photos finds a photo by its name where nothing the models made is there to look in', async () => {
	const temporary = temporaryDirectory()
	const directory = await temporary.create()
	const database = new BetterSqlite3(':memory:')
	const durablePath = nodePath.join(directory, 'umbrel.db')
	const durable = new BetterSqlite3(durablePath)
	try {
		migratePhotos(durable)
		await migrateFileIndex(database)
		// As on a device the models do not run on: no database of what they made is attached
		database.prepare('ATTACH DATABASE ? AS umbrel').run(durablePath)
		database.exec(`
			INSERT INTO index_roots(id, virtual_path, system_path, owner_id, kind, search_enabled, created_at, updated_at)
			VALUES (1, '/Home', '/home', 'owner', 'home', 1, 1, 1);
			INSERT INTO contents(id, blake3, size, created_at) VALUES (1, x'${'01'.repeat(32)}', 100, 1), (2, x'${'02'.repeat(32)}', 100, 1);
			INSERT INTO entries(root_id, relative_path, name, search_name, search_name_folded, type, size, modified_ms,
				hidden, thumbnail_identity_kind, content_id)
			VALUES (1, 'beach.jpg', 'beach.jpg', 'beach.jpg', 'beach.jpg', 'file', 100, 1, 0, 'content', 1),
				(1, 'forest.jpg', 'forest.jpg', 'forest.jpg', 'forest.jpg', 'file', 100, 1, 0, 'content', 2);
			INSERT INTO media_metadata(content_id, state, kind, taken_at, width, height, updated_at)
			VALUES (1, 'ready', 'photo', 1000, 100, 50, 1), (2, 'ready', 'photo', 2000, 100, 50, 1);
		`)
		const repository = new PhotosRepository()

		const found = repository.search(database, 'owner', {type: 'query', text: 'beach', scope: 'photos', limit: 10})
		expect(found.map(({path}) => path)).toEqual(['/Home/beach.jpg'])
		expect(repository.search(database, 'owner', {type: 'insights', path: '/Home/beach.jpg'})).toEqual({})
	} finally {
		durable.close()
		database.close()
		await temporary.destroyRoot()
	}
})

test('counts how far along the work is on the files of the account asking', async () => {
	const temporary = temporaryDirectory()
	const directory = await temporary.create()
	const database = new BetterSqlite3(':memory:')
	const durablePath = nodePath.join(directory, 'umbrel.db')
	const durable = new BetterSqlite3(durablePath)
	try {
		migratePhotos(durable)
		await migrateFileIndex(database)
		database.prepare('ATTACH DATABASE ? AS umbrel').run(durablePath)
		// The owner has three files and a member two, one of them a copy of one of the owner's
		database.exec(`
			INSERT INTO index_roots(id, virtual_path, system_path, owner_id, kind, search_enabled, created_at, updated_at)
			VALUES (1, '/Home', '/home', 'owner', 'home', 1, 1, 1), (2, '/Users/member', '/member', 'member', 'home', 1, 1, 1);
			INSERT INTO contents(id, blake3, size, created_at)
			VALUES (1, x'${'01'.repeat(32)}', 1, 1), (2, x'${'02'.repeat(32)}', 1, 1), (3, x'${'03'.repeat(32)}', 1, 1), (4, x'${'04'.repeat(32)}', 1, 1);
			INSERT INTO entries(root_id, relative_path, name, type, size, modified_ms, hidden, thumbnail_identity_kind, content_id)
			VALUES (1, 'a.jpg', 'a.jpg', 'file', 1, 1, 0, 'content', 1), (1, 'b.jpg', 'b.jpg', 'file', 1, 1, 0, 'content', 2),
				(1, 'c.jpg', 'c.jpg', 'file', 1, 1, 0, 'content', 3), (2, 'c.jpg', 'c.jpg', 'file', 1, 1, 0, 'content', 3),
				(2, 'd.txt', 'd.txt', 'file', 1, 1, 0, 'content', 4);
			INSERT INTO model_work(content_id, model, state)
			VALUES (1, 'embedding', 'ready'), (2, 'embedding', 'pending'), (3, 'embedding', 'ready'), (4, 'text', 'pending');
			INSERT INTO thumbnail_variants(content_id, variant, state, updated_at)
			VALUES (1, 'preview-192-webp-v1', 'ready', 1), (3, 'preview-192-webp-v1', 'pending', 1);
		`)
		const repository = new PhotosRepository()
		const status = (accountId: string) => repository.search(database, accountId, {type: 'status'})
		const progress = (accountId: string) => repository.search(database, accountId, {type: 'progress'})

		expect(status('owner')).toEqual({total: 3, completed: 2})
		expect(status('member')).toEqual({total: 2, completed: 1})
		expect(progress('owner')).toMatchObject({
			embedding: {completed: 2, total: 3},
			text: {total: 0},
			previews: {completed: 1, total: 2},
		})
		expect(progress('member')).toMatchObject({
			embedding: {completed: 1, total: 1},
			text: {completed: 0, total: 1},
			previews: {completed: 0, total: 1},
		})

		// With no other account on the device, all the work there is is the owner's
		database.exec(`DELETE FROM entries WHERE root_id = 2; DELETE FROM index_roots WHERE id = 2`)
		expect(status('owner')).toEqual({total: 4, completed: 2})
		expect(progress('owner')).toMatchObject({embedding: {completed: 2, total: 3}, text: {completed: 0, total: 1}})
	} finally {
		durable.close()
		database.close()
		await temporary.destroyRoot()
	}
})
