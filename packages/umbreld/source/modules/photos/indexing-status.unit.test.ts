import nodePath from 'node:path'

import BetterSqlite3 from 'better-sqlite3'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {fileIndexMigrations, migrateFileIndex} from '../files/file-index/migrations.js'
import temporaryDirectory from '../utilities/temporary-directory.js'
import {migratePhotos} from './migrations.js'
import PhotosRepository from './repository.js'

let database: BetterSqlite3.Database
let directory: string
let temporary: ReturnType<typeof temporaryDirectory>
let repository: PhotosRepository
const variants = ['preview-192-webp-v1', 'preview-512-webp-v2', 'preview-1280-webp-v2']
const hash = (id: number) => Buffer.from(id.toString(16).padStart(64, '0'), 'hex')
const open = () => {
	const db = new BetterSqlite3(nodePath.join(directory, 'index.db'))
	db.pragma('journal_mode = WAL')
	db.pragma('foreign_keys = ON')
	db.prepare('ATTACH DATABASE ? AS umbrel').run(nodePath.join(directory, 'umbrel.db'))
	return db
}
const restart = () => {
	database.close()
	database = open()
	repository = new PhotosRepository()
}
const entry = (name: string, contentId: number | null, root = 1) =>
	Number(
		database
			.prepare(
				`
	INSERT INTO entries(root_id, relative_path, name, type, size, modified_ms, hidden, thumbnail_identity_kind, content_id)
	VALUES (?, ?, ?, 'file', 100, 1, 0, 'content', ?)`,
			)
			.run(root, name, name, contentId).lastInsertRowid,
	)
const media = (id: number, name = `${id}.jpg`, root = 1) => {
	database.prepare('INSERT INTO contents(id, blake3, size, created_at) VALUES (?, ?, 100, 1)').run(id, hash(id))
	const entryId = entry(name, id, root)
	database
		.prepare(`INSERT INTO media_metadata(content_id, state, kind, updated_at) VALUES (?, 'ready', 'photo', 1)`)
		.run(id)
	for (const variant of variants) thumbnail(id, variant, 'ready')
	return entryId
}
const thumbnail = (id: number, variant: string, state: string) => {
	database
		.prepare(
			`INSERT INTO thumbnail_variants(content_id, variant, state, created_at, updated_at) VALUES (?, ?, ?, 1, 1)
		ON CONFLICT(content_id, variant) DO UPDATE SET state = excluded.state`,
		)
		.run(id, variant, state)
}
const status = (account = 'owner') => repository.indexingState(database, account)
const ready = (total: number) => ({phase: 'ready', total, completed: total, percentage: 100})

beforeEach(async () => {
	temporary = temporaryDirectory()
	directory = await temporary.create()
	const durable = new BetterSqlite3(nodePath.join(directory, 'umbrel.db'))
	migratePhotos(durable)
	durable.close()
	database = open()
	await migrateFileIndex(database)
	database.exec(`INSERT INTO index_roots(id, virtual_path, system_path, owner_id, kind, search_enabled, state, created_at, updated_at) VALUES
		(1, '/Home', '/home', 'owner', 'home', 1, 'ready', 1, 1),
		(2, '/Trash', '/trash', 'owner', 'trash', 1, 'ready', 1, 1),
		(3, '/Users/member/Home', '/member', 'member', 'home', 1, 'ready', 1, 1),
		(4, '/Apps', '/apps', 'owner', 'apps', 0, 'ready', 1, 1)`)
	repository = new PhotosRepository()
})
afterEach(async () => {
	vi.restoreAllMocks()
	database.close()
	await temporary.destroyRoot()
})

test('tracks pending hashes, metadata, all required thumbnails, failures and recovery', () => {
	expect(status()).toEqual(ready(0))
	const pending = entry('pending.jpg', null)
	expect(status()).toEqual({phase: 'enriching', total: 1, completed: 0, percentage: 0})
	database.prepare("UPDATE entries SET hash_error = 'read failed' WHERE id = ?").run(pending)
	expect(status()).toEqual({
		phase: 'degraded',
		total: 1,
		completed: 0,
		percentage: 0,
		error: 'Some media could not be prepared',
	})
	database.prepare('INSERT INTO contents(id, blake3, size, created_at) VALUES (1, ?, 100, 1)').run(hash(1))
	database.prepare('UPDATE entries SET content_id = 1, hash_error = NULL WHERE id = ?').run(pending)
	// Hashed non-media entries have no metadata and do not count as Photos work.
	expect(status()).toEqual(ready(0))
	database.exec("INSERT INTO media_metadata(content_id, state, updated_at) VALUES (1, 'pending', 1)")
	expect(status()).toMatchObject({phase: 'enriching', total: 1, completed: 0})
	database.exec("UPDATE media_metadata SET state = 'ready'")
	thumbnail(1, variants[0], 'ready')
	thumbnail(1, variants[1], 'ready')
	expect(status()).toMatchObject({phase: 'enriching', completed: 0})
	thumbnail(1, variants[2], 'failed')
	expect(status()).toMatchObject({phase: 'degraded', completed: 0})
	thumbnail(1, variants[2], 'ready')
	expect(status()).toEqual(ready(1))
	database.exec("UPDATE media_metadata SET state = 'failed'")
	expect(status()).toMatchObject({phase: 'degraded', completed: 0})
	database.exec("UPDATE media_metadata SET state = 'ready'")
	expect(status()).toEqual(ready(1))
	database.prepare('DELETE FROM thumbnail_variants WHERE variant = ?').run(variants[0])
	expect(status()).toMatchObject({phase: 'enriching', completed: 0})
})

test('deduplicates copies per account, includes both Live Photo resources, and excludes Trash and Apps', () => {
	media(1)
	entry('duplicate.jpg', 1)
	entry('shared.jpg', 1, 3)
	media(2, '2.mov')
	database.exec(
		"UPDATE media_metadata SET live_identifier = 'pair'; UPDATE media_metadata SET kind = 'video' WHERE content_id = 2",
	)
	media(3, 'trash.jpg', 2)
	media(4, 'app.jpg', 4)
	const hidden = media(5)
	database.prepare('UPDATE entries SET hidden = 1 WHERE id = ?').run(hidden)
	expect(status()).toEqual(ready(2))
	expect(status('member')).toEqual(ready(1))
	thumbnail(1, variants[1], 'failed')
	expect(status()).toMatchObject({phase: 'degraded', completed: 1, total: 2, percentage: 50})
	expect(status('member')).toMatchObject({phase: 'degraded', completed: 0, total: 1})
	database.exec("DELETE FROM entries WHERE relative_path = 'duplicate.jpg'")
	expect(status()).toMatchObject({total: 2})
	database.exec('UPDATE entries SET content_id = NULL WHERE content_id = 1; DELETE FROM contents WHERE id = 1')
	// Detaching the content turns each remaining copy back into unhashed work.
	expect(status()).toMatchObject({phase: 'enriching', total: 2, completed: 1})
	expect(status('member')).toMatchObject({phase: 'enriching', total: 1, completed: 0})
})

test('reconciles old and new identities, visibility, moves and deletions', () => {
	const first = media(1)
	media(2)
	expect(status()).toEqual(ready(2))
	database.prepare('UPDATE entries SET content_id = 2 WHERE id = ?').run(first)
	expect(status()).toEqual(ready(1))
	database.exec('UPDATE entries SET root_id = 2')
	expect(status()).toEqual(ready(0))
	database.prepare('UPDATE entries SET root_id = 1 WHERE id = ?').run(first)
	expect(status()).toEqual(ready(1))
	database.prepare('UPDATE entries SET hidden = 1 WHERE id = ?').run(first)
	expect(status()).toEqual(ready(0))
	database.prepare("UPDATE entries SET hidden = 0, thumbnail_identity_kind = 'transient' WHERE id = ?").run(first)
	expect(status()).toEqual(ready(0))
	database.prepare("UPDATE entries SET thumbnail_identity_kind = 'content' WHERE id = ?").run(first)
	expect(status()).toEqual(ready(1))
	database.prepare('DELETE FROM entries WHERE id = ?').run(first)
	expect(status()).toEqual(ready(0))
})

test('detects durable scope changes and rebuilds only the affected account, including after restart', () => {
	media(1, 'selected/one.jpg')
	const second = media(2, 'other/two.jpg')
	media(3, 'member.jpg', 3)
	expect(status()).toEqual(ready(2))
	expect(status('member')).toEqual(ready(1))
	database.exec(`CREATE TEMP TRIGGER protect_member BEFORE DELETE ON photos_indexing_work
		WHEN old.account_id = 'member' BEGIN SELECT RAISE(ABORT, 'unrelated account rebuild'); END`)
	database.exec(
		`UPDATE umbrel.photos_sources SET scope_mode = 'only', scope_paths = '["/Home/selected"]' WHERE account_id = 'owner'`,
	)
	expect(status()).toEqual(ready(1))
	database.prepare("UPDATE entries SET relative_path = 'selected/two.jpg' WHERE id = ?").run(second)
	expect(status()).toEqual(ready(2))
	database.exec(
		`UPDATE umbrel.photos_sources SET scope_mode = 'everything-except', scope_paths = '["/Home/selected"]' WHERE account_id = 'owner'`,
	)
	restart()
	expect(status()).toEqual(ready(0))
	// Simulate durable scope returning to an earlier committed value while the
	// disposable counters survived. No dirty callback or generation is needed.
	database.exec(
		"UPDATE umbrel.photos_sources SET scope_mode = 'everything', scope_paths = '[]' WHERE account_id = 'owner'",
	)
	restart()
	expect(status()).toEqual(ready(2))
	expect(status('member')).toEqual(ready(1))
})

test('handles root ownership, path, removal, and live root progress independently of counts', () => {
	media(1)
	expect(status()).toEqual(ready(1))
	expect(status('member')).toEqual(ready(0))
	database.exec("UPDATE index_roots SET owner_id = 'member' WHERE id = 1")
	expect(status('member')).toEqual(ready(1))
	expect(status()).toEqual({phase: 'indexing'})
	expect(database.prepare("SELECT * FROM photos_indexing_counts WHERE account_id = 'owner'").all()).toEqual([])
	database.exec(
		`UPDATE umbrel.photos_sources SET scope_mode = 'only', scope_paths = '["/Home"]' WHERE account_id = 'member'`,
	)
	expect(status('member')).toEqual(ready(1))
	database.exec("UPDATE index_roots SET virtual_path = '/Moved' WHERE id = 1")
	expect(status('member')).toEqual(ready(0))
	database.exec("UPDATE index_roots SET state = 'degraded', last_error = 'scan failed' WHERE owner_id = 'member'")
	expect(status('member')).toEqual({...ready(0), phase: 'degraded', error: 'scan failed'})
	database.exec("UPDATE index_roots SET state = 'warming' WHERE owner_id = 'member'")
	expect(status('member')).toEqual({phase: 'indexing'})
	database.exec('DELETE FROM index_roots WHERE id = 1')
	database.exec("UPDATE index_roots SET state = 'ready' WHERE id = 3")
	expect(status('member')).toEqual(ready(0))
})

test('recovers persisted work after restart and rolls back counters and journal together on failure', () => {
	media(1)
	expect(status()).toEqual(ready(1))
	thumbnail(1, variants[0], 'failed')
	restart()
	database.exec(`CREATE TEMP TRIGGER reject_status BEFORE INSERT ON photos_indexing_work
		BEGIN SELECT RAISE(ABORT, 'interrupted reconciliation'); END`)
	expect(() => status()).toThrow('interrupted reconciliation')
	expect(database.prepare('SELECT work_id FROM photos_indexing_dirty_work').all()).toEqual([{work_id: 1}])
	expect(database.prepare('SELECT total, completed FROM photos_indexing_counts').get()).toEqual({
		total: 1,
		completed: 1,
	})
	database.exec('DROP TRIGGER reject_status')
	expect(status()).toMatchObject({phase: 'degraded', total: 1, completed: 0})
	expect(database.prepare('SELECT * FROM photos_indexing_dirty_work').all()).toEqual([])
})

test('fresh progress checks perform no maintenance, and unrelated metadata changes do not dirty counters', () => {
	media(1)
	expect(status()).toEqual(ready(1))
	database.exec(
		'UPDATE media_metadata SET tint = 123, width = 100; UPDATE thumbnail_variants SET updated_at = 2; UPDATE entries SET modified_ms = 2',
	)
	expect(database.prepare('SELECT * FROM photos_indexing_dirty_work').all()).toEqual([])
	const prepare = vi.spyOn(database, 'prepare')
	expect(status()).toEqual(ready(1))
	const sql = prepare.mock.calls.map(([sql]) => sql).join('\n')
	expect(sql).not.toMatch(/JOIN entries|FROM entries|FROM thumbnail_variants|INSERT INTO photos_indexing_work/)
})

test('backfills counters when upgrading the existing v18 index', async () => {
	media(1)
	expect(status()).toEqual(ready(1))
	const triggers = database
		.prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger' AND name LIKE 'photos_indexing_%'")
		.all() as Array<{name: string}>
	for (const {name} of triggers) database.exec(`DROP TRIGGER ${name}`)
	database.exec(`DROP TABLE photos_indexing_work; DROP TABLE photos_indexing_counts;
		DROP TABLE photos_indexing_dirty_work; DROP TABLE photos_indexing_dirty_accounts;
		DELETE FROM schema_migrations WHERE version = 19`)
	await migrateFileIndex(database, fileIndexMigrations)
	expect(status()).toEqual(ready(1))
	expect(database.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 19').get()).toEqual({n: 1})
})
