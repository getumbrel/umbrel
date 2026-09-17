import nodePath from 'node:path'

import BetterSqlite3 from 'better-sqlite3'
import PQueue from 'p-queue'
import {afterEach, expect, test} from 'vitest'

import {migrateFileIndex} from './migrations.js'
import temporaryDirectory from '../../utilities/temporary-directory.js'
import {migratePhotos} from '../../photos/migrations.js'
import FileIndexReader, {type FileIndexReadArgs, type PhotosReadMethod} from './reader.js'
import FileIndexReaderPool from './reader-pool.js'
import PhotosRepository from '../../photos/repository.js'

const temporary = temporaryDirectory()
const cleanup: Array<() => void | Promise<void>> = []
const hash = (value: number) => Buffer.from(value.toString(16).padStart(64, '0'), 'hex')
const id = (value: number) => hash(value).toString('hex')

afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close()
	await temporary.destroyRoot()
})

async function fixture() {
	const directory = await temporary.create()
	const paths = {
		databasePath: nodePath.join(directory, 'index.db'),
		umbrelDatabasePath: nodePath.join(directory, 'umbrel.db'),
	}
	const durable = new BetterSqlite3(paths.umbrelDatabasePath)
	migratePhotos(durable)
	durable.close()
	const database = new BetterSqlite3(paths.databasePath)
	cleanup.push(() => {
		database.close()
	})
	database.pragma('journal_mode = WAL')
	await migrateFileIndex(database)
	database.prepare('ATTACH DATABASE ? AS umbrel').run(paths.umbrelDatabasePath)
	database.exec(`INSERT INTO index_roots(id,virtual_path,system_path,owner_id,kind,search_enabled,state,created_at,updated_at) VALUES
		(1,'/Home','/home','owner','home',1,'ready',1,1),
		(2,'/Trash','/trash','owner','trash',1,'ready',1,1),
		(3,'/Other/Home','/other','member','home',1,'ready',1,1);`)
	for (const value of [1, 2, 3, 4]) {
		const name = `${value}.${value === 2 ? 'mov' : 'jpg'}`
		database.prepare('INSERT INTO contents(id,blake3,size,created_at) VALUES (?,?,100,1)').run(value, hash(value))
		database
			.prepare(
				`INSERT INTO entries(root_id,relative_path,name,type,size,modified_ms,hidden,thumbnail_identity_kind,content_id)
			VALUES (?,?,?,'file',100,1,0,'content',?)`,
			)
			.run(value === 4 ? 2 : 1, name, name, value)
		database
			.prepare(
				`INSERT INTO media_metadata(content_id,state,kind,taken_at,width,height,duration_ms,live_identifier,updated_at)
			VALUES (?,'ready',?,1000,100,50,?,?,1)`,
			)
			.run(value, value === 2 ? 'video' : 'photo', value === 2 ? 3000 : null, value <= 2 ? 'live' : null)
	}
	database.exec(`INSERT INTO entries(root_id,relative_path,name,type,size,modified_ms,hidden,thumbnail_identity_kind,content_id)
		VALUES (3,'shared.jpg','shared.jpg','file',100,1,0,'content',1)`)
	const repository = new PhotosRepository()
	repository.syncAll(database)
	const reader = new FileIndexReader(paths)
	cleanup.push(() => reader.close())
	return {paths, database, repository, reader}
}

test('reader connections preserve all Photos results and account isolation', async () => {
	const {database, repository, reader} = await fixture()
	const cases: Array<[PhotosReadMethod, unknown[]]> = [
		['summary', []],
		['indexingState', []],
		['listItems', [{}, undefined, 1]],
		['listItems', [{deleted: true}, undefined, 10]],
		['getItem', [id(3), false]],
		['getItem', [id(4), true]],
		['neighbors', [id(3), {}]],
		['resolveItems', [[id(1), id(3)]]],
		['resolveItemFiles', [[id(1)], 'home']],
		['resolveLiveCompanion', [id(1)]],
		['listAlbums', []],
		['listSources', []],
	]
	for (const account of ['owner', 'member']) {
		for (const [method, rest] of cases) {
			repository.prepareRead(database, account, method === 'indexingState')
			const args = [account, ...rest] as FileIndexReadArgs<PhotosReadMethod>
			const expected = (repository[method] as Function).call(repository, database, ...args)
			reader.beginSnapshot()
			try {
				expect(reader.read(method, args), `${account}: ${method}`).toEqual(expected)
			} finally {
				reader.endSnapshot()
			}
		}
	}
})

test('a pinned reader sees matching old snapshots while writes commit, and the next read sees the updates', async () => {
	const {database, repository, reader} = await fixture()
	const album = repository.createAlbum(database, 'owner', 'Before', [id(3)])
	repository.prepareRead(database, 'owner')
	reader.beginSnapshot()
	// These commits must succeed while the reader still holds both snapshots.
	repository.setFavorite(database, 'owner', [id(3)], true)
	repository.renameAlbum(database, 'owner', album.id, 'After')
	expect(reader.read('getItem', ['owner', id(3), false])).toMatchObject({isFavorite: false})
	expect(reader.read('listAlbums', ['owner'])).toContainEqual(expect.objectContaining({name: 'Before'}))
	reader.endSnapshot()
	reader.beginSnapshot()
	expect(reader.read('getItem', ['owner', id(3), false])).toMatchObject({isFavorite: true})
	expect(reader.read('listAlbums', ['owner'])).toContainEqual(expect.objectContaining({name: 'After'}))
	expect(reader.read('getItem', ['member', id(3), false])).toBeUndefined()
	reader.endSnapshot()
})

test('readers reject stale projections and cannot write either database', async () => {
	const {database, repository, reader} = await fixture()
	const album = repository.createAlbum(database, 'owner', 'Album')
	reader.beginSnapshot()
	// Exercise the SQLite guard even if a mutation is accidentally dispatched.
	expect(() => reader.read('renameAlbum' as PhotosReadMethod, ['owner', album.id, 'No'] as never)).toThrow(/readonly/)
	expect(() => reader.read('setFavorite' as PhotosReadMethod, ['owner', [id(3)], true] as never)).toThrow(/readonly/)
	reader.endSnapshot()
	database.prepare('UPDATE media_metadata SET taken_at = 2000 WHERE content_id = 3').run()
	expect(() => reader.beginSnapshot()).toThrow('requires writer maintenance')
	repository.prepareRead(database, 'owner')
	reader.beginSnapshot()
	expect(reader.read('getItem', ['owner', id(3), false])).toMatchObject({takenAt: 2000, isFavorite: false})
	reader.endSnapshot()
})

test('real reader workers reuse connections and see subsequent commits with identical results', async () => {
	const {database, repository, paths} = await fixture()
	const pool = new FileIndexReaderPool(paths, {size: 2, reservedReaders: 0})
	cleanup.push(() => pool.stop())
	const writes = new PQueue({concurrency: 1})
	const prepare = (account: string) => async (begin: () => Promise<void>) => {
		await writes.add(async () => {
			repository.prepareRead(database, account)
			await begin()
		})
	}
	const [owner, member] = await Promise.all([
		pool.read('summary', ['owner'], prepare('owner')),
		pool.read('summary', ['member'], prepare('member')),
	])
	expect(owner).toEqual(repository.summary(database, 'owner'))
	expect(member).toEqual(repository.summary(database, 'member'))
	expect(new Set(pool.status().threadIds).size).toBe(2)
	await writes.add(() => repository.setFavorite(database, 'owner', [id(3)], true))
	expect(await pool.read('getItem', ['owner', id(3), false], prepare('owner'))).toMatchObject({isFavorite: true})
	expect(await pool.read('getItem', ['member', id(3), false], prepare('member'))).toBeUndefined()
	await expect(pool.read('listItems', ['owner', {}, 'invalid', 10], prepare('owner'))).rejects.toThrow()
	expect(await pool.read('summary', ['owner'], prepare('owner'))).toEqual(repository.summary(database, 'owner'))
})

test('reader failures preserve SQLite errors instead of hiding them at the worker boundary', async () => {
	const {paths} = await fixture()
	const pool = new FileIndexReaderPool({
		...paths,
		umbrelDatabasePath: nodePath.join(await temporary.create(), 'missing.db'),
	})
	cleanup.push(() => pool.stop())
	await expect(pool.read('summary', ['owner'], (begin) => begin())).rejects.toMatchObject({code: 'SQLITE_CANTOPEN'})
})

test('Files reads work without Photos and reject SQL writes on reader connections', async () => {
	const {paths} = await fixture()
	const pool = new FileIndexReaderPool({
		...paths,
		umbrelDatabasePath: nodePath.join(await temporary.create(), 'missing.db'),
	})
	cleanup.push(() => pool.stop())
	const directly = (begin: () => Promise<void>) => begin()
	await expect(
		pool.read('sql', [{sql: 'SELECT name FROM entries WHERE id = ?', parameters: [1]}], directly),
	).resolves.toHaveProperty('name')
	await expect(pool.read('sql', [{sql: 'DELETE FROM entries', parameters: []}], directly)).rejects.toThrow('read-only')
	// Buffer parameters cross the worker boundary as Uint8Arrays; SQLite must still bind them as blobs.
	await expect(
		pool.read('sql', [{sql: 'SELECT id FROM contents WHERE blake3 = ?', parameters: [hash(1)]}], directly),
	).resolves.toEqual({id: 1})
})

test('Files reads do not require Photos projection maintenance', async () => {
	const {database, paths} = await fixture()
	database.prepare('UPDATE media_metadata SET taken_at = 2000 WHERE content_id = 3').run()
	const pool = new FileIndexReaderPool(paths)
	cleanup.push(() => pool.stop())
	await expect(
		pool.read('sql', [{sql: 'SELECT taken_at FROM media_metadata WHERE content_id = 3', parameters: []}], (begin) =>
			begin(),
		),
	).resolves.toEqual({taken_at: 2000})
	await expect(pool.read('summary', ['owner'], (begin) => begin())).rejects.toMatchObject({code: 'PHOTOS_READ_RETRY'})
})
