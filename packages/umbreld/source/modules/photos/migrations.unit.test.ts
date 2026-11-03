import BetterSqlite3 from 'better-sqlite3'
import {expect, test} from 'vitest'

import {fileIndexMigrations, migrateFileIndex} from '../files/file-index/migrations.ts'

import {
	migratePhotos,
	PHOTOS_MIGRATION_MODULE,
	PHOTOS_SCHEMA_VERSION,
	UnsupportedPhotosSchemaError,
} from './migrations.ts'

test('creates and idempotently migrates the durable Photos schema', () => {
	const database = new BetterSqlite3(':memory:')
	expect(migratePhotos(database)).toBe(PHOTOS_SCHEMA_VERSION)
	expect(migratePhotos(database)).toBe(PHOTOS_SCHEMA_VERSION)
	expect(
		database
			.prepare('PRAGMA table_info(photos_content_state)')
			.all()
			.map((column: any) => column.name),
	).toStrictEqual([
		'account_id',
		'content_hash',
		'source_id',
		'is_favorite',
		'imported_at',
		'source_created_at',
		'effective_taken_at',
	])
	expect(
		database.prepare("SELECT name FROM sqlite_schema WHERE name = 'photos_deletion_targets'").get(),
	).toBeUndefined()
	expect(
		database.prepare('SELECT module, version FROM schema_migrations ORDER BY module, version').all(),
	).toStrictEqual([
		{module: PHOTOS_MIGRATION_MODULE, version: 1},
		{module: PHOTOS_MIGRATION_MODULE, version: 2},
		{module: PHOTOS_MIGRATION_MODULE, version: 3},
		{module: PHOTOS_MIGRATION_MODULE, version: 4},
		{module: PHOTOS_MIGRATION_MODULE, version: 5},
		{module: PHOTOS_MIGRATION_MODULE, version: 6},
		{module: PHOTOS_MIGRATION_MODULE, version: 7},
		{module: PHOTOS_MIGRATION_MODULE, version: 8},
		{module: PHOTOS_MIGRATION_MODULE, version: 9},
		{module: PHOTOS_MIGRATION_MODULE, version: 10},
		{module: PHOTOS_MIGRATION_MODULE, version: 11},
	])
	expect(
		database
			.prepare("SELECT name FROM sqlite_schema WHERE type IN ('table', 'index') AND name LIKE 'photos_%' ORDER BY name")
			.all(),
	).toStrictEqual([
		{name: 'photos_album_items'},
		{name: 'photos_albums'},
		{name: 'photos_albums_by_account'},
		{name: 'photos_content_state'},
		{name: 'photos_content_state_by_account'},
		{name: 'photos_content_state_by_effective_taken_at'},
		{name: 'photos_projection_state'},
		{name: 'photos_read_model_dirty_accounts'},
		{name: 'photos_read_model_dirty_contents'},
		{name: 'photos_source_resources'},
		{name: 'photos_source_resources_by_cloud_identifier'},
		{name: 'photos_source_resources_by_content'},
		{name: 'photos_sources'},
		{name: 'photos_sources_one_umbrel_per_account'},
	])
	const timelinePlan = database
		.prepare(
			`EXPLAIN QUERY PLAN SELECT content_hash FROM photos_content_state
			INDEXED BY photos_content_state_by_effective_taken_at
			WHERE account_id = ? AND effective_taken_at IS NOT NULL
			ORDER BY effective_taken_at DESC, content_hash LIMIT ?`,
		)
		.all('alice', 201) as Array<{detail: string}>
	expect(timelinePlan.some(({detail}) => detail.includes('photos_content_state_by_effective_taken_at'))).toBe(true)
	expect(timelinePlan.some(({detail}) => detail.includes('USE TEMP B-TREE FOR ORDER BY'))).toBe(false)
	expect(database.prepare("SELECT name FROM sqlite_schema WHERE name = 'items'").get()).toBeUndefined()
	database.close()
})

test('stores durable Photos state and album membership by 32-byte content hash', () => {
	const database = new BetterSqlite3(':memory:')
	migratePhotos(database)
	const hash = Buffer.alloc(32, 0xab)
	database
		.prepare(
			"INSERT INTO photos_sources(id, account_id, type, name, created_at) VALUES ('source', 'alice', 'umbrel', 'Umbrel', 1)",
		)
		.run()
	database
		.prepare(
			`INSERT INTO photos_content_state(account_id, content_hash, source_id, is_favorite, imported_at)
			VALUES ('alice', ?, 'source', 1, 2)`,
		)
		.run(hash)
	database
		.prepare(
			"INSERT INTO photos_albums(id, account_id, name, cover_content_hash, created_at) VALUES ('album', 'alice', 'Kept', ?, 4)",
		)
		.run(hash)
	database.prepare("INSERT INTO photos_album_items(album_id, content_hash, added_at) VALUES ('album', ?, 5)").run(hash)
	expect(migratePhotos(database)).toBe(PHOTOS_SCHEMA_VERSION)
	expect(
		database.prepare('SELECT is_favorite, imported_at FROM photos_content_state WHERE content_hash = ?').get(hash),
	).toStrictEqual({is_favorite: 1, imported_at: 2})
	expect(
		database.prepare('SELECT album_id, hex(content_hash) AS content_hash FROM photos_album_items').all(),
	).toStrictEqual([{album_id: 'album', content_hash: hash.toString('hex').toUpperCase()}])
	database.close()
})

test('adds crash-recovery projection state to an existing v6 database', () => {
	const database = new BetterSqlite3(':memory:')
	migratePhotos(database)
	database.prepare("DELETE FROM schema_migrations WHERE module = 'photos' AND version >= 7").run()
	database.exec('DROP TABLE photos_projection_state')

	expect(migratePhotos(database)).toBe(PHOTOS_SCHEMA_VERSION)
	expect(database.prepare('SELECT id, generation FROM photos_projection_state').get()).toStrictEqual({
		id: 1,
		generation: 0,
	})
	database.close()
})

test('migrates v1 state while discarding obsolete deletion markers', () => {
	const database = new BetterSqlite3(':memory:')
	const hash = Buffer.alloc(32, 0xcd)
	database.exec(`
		PRAGMA foreign_keys = ON;
		CREATE TABLE schema_migrations(
			module TEXT NOT NULL,
			version INTEGER NOT NULL,
			applied_at INTEGER NOT NULL,
			PRIMARY KEY(module, version)
		);
		INSERT INTO schema_migrations VALUES ('photos', 1, 1);
		CREATE TABLE photos_sources(
			id TEXT PRIMARY KEY,
			account_id TEXT NOT NULL,
			type TEXT NOT NULL,
			name TEXT NOT NULL,
			created_at INTEGER NOT NULL
		);
		INSERT INTO photos_sources VALUES ('source', 'alice', 'umbrel', 'Umbrel', 1);
		CREATE TABLE photos_content_state(
			account_id TEXT NOT NULL,
			content_hash BLOB NOT NULL,
			source_id TEXT NOT NULL REFERENCES photos_sources(id),
			is_favorite INTEGER NOT NULL,
			deleted_at INTEGER,
			imported_at INTEGER NOT NULL,
			PRIMARY KEY(account_id, content_hash)
		) WITHOUT ROWID;
		CREATE INDEX photos_content_state_by_account
			ON photos_content_state(account_id, is_favorite, deleted_at, content_hash);
		CREATE TABLE photos_deletion_targets(
			account_id TEXT NOT NULL,
			content_hash BLOB NOT NULL,
			virtual_path TEXT NOT NULL,
			PRIMARY KEY(account_id, content_hash, virtual_path),
			FOREIGN KEY(account_id, content_hash)
				REFERENCES photos_content_state(account_id, content_hash) ON DELETE CASCADE
		) WITHOUT ROWID;
	`)
	database
		.prepare(
			`INSERT INTO photos_content_state(account_id, content_hash, source_id, is_favorite, deleted_at, imported_at)
			VALUES ('alice', ?, 'source', 1, 123, 2)`,
		)
		.run(hash)
	database.prepare("INSERT INTO photos_deletion_targets VALUES ('alice', ?, '/Home/photo.jpg')").run(hash)

	expect(migratePhotos(database)).toBe(PHOTOS_SCHEMA_VERSION)
	expect(database.prepare('PRAGMA table_info(photos_content_state)').all()).not.toEqual(
		expect.arrayContaining([expect.objectContaining({name: 'deleted_at'})]),
	)
	expect(
		database.prepare("SELECT name FROM sqlite_schema WHERE name = 'photos_deletion_targets'").get(),
	).toBeUndefined()
	expect(
		database
			.prepare('SELECT source_id, is_favorite, imported_at FROM photos_content_state WHERE content_hash = ?')
			.get(hash),
	).toStrictEqual({source_id: 'source', is_favorite: 1, imported_at: 2})
	database.close()
})

test('migrates v3 by discarding derived Live Photo pairs without touching backup identity', () => {
	const database = new BetterSqlite3(':memory:')
	const hash = Buffer.alloc(32, 1)
	database.exec(`
		CREATE TABLE schema_migrations(
			module TEXT NOT NULL,
			version INTEGER NOT NULL,
			applied_at INTEGER NOT NULL,
			PRIMARY KEY(module, version)
		);
		INSERT INTO schema_migrations VALUES ('photos', 1, 1), ('photos', 2, 2), ('photos', 3, 3);
		CREATE TABLE photos_sources(
			id TEXT PRIMARY KEY,
			account_id TEXT NOT NULL,
			type TEXT NOT NULL,
			name TEXT NOT NULL,
			created_at INTEGER NOT NULL
		);
		INSERT INTO photos_sources VALUES ('source', 'alice', 'iphone', 'Phone', 1);
		CREATE TABLE photos_content_state(
			account_id TEXT NOT NULL,
			content_hash BLOB NOT NULL,
			source_id TEXT NOT NULL REFERENCES photos_sources(id),
			is_favorite INTEGER NOT NULL,
			imported_at INTEGER NOT NULL,
			PRIMARY KEY(account_id, content_hash)
		) WITHOUT ROWID;
		CREATE TABLE photos_source_resources(
			account_id TEXT NOT NULL,
			source_id TEXT NOT NULL REFERENCES photos_sources(id) ON DELETE CASCADE,
			resource_key TEXT NOT NULL,
			content_hash BLOB NOT NULL,
			PRIMARY KEY(account_id, source_id, resource_key)
		) WITHOUT ROWID;
		CREATE TABLE photos_live_pairs(
			account_id TEXT NOT NULL,
			still_hash BLOB NOT NULL,
			motion_hash BLOB NOT NULL,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY(account_id, still_hash)
		) WITHOUT ROWID;
		CREATE INDEX photos_live_pairs_by_motion ON photos_live_pairs(account_id, motion_hash);
	`)
	database.prepare("INSERT INTO photos_source_resources VALUES ('alice', 'source', ?, ?)").run('a'.repeat(64), hash)
	database.prepare("INSERT INTO photos_live_pairs VALUES ('alice', ?, ?, 3)").run(hash, Buffer.alloc(32, 2))

	expect(migratePhotos(database)).toBe(PHOTOS_SCHEMA_VERSION)
	expect(database.prepare("SELECT name FROM sqlite_schema WHERE name = 'photos_live_pairs'").get()).toBeUndefined()
	expect(database.prepare("SELECT id, account_id, name FROM photos_sources WHERE id = 'source'").get()).toStrictEqual({
		id: 'source',
		account_id: 'alice',
		name: 'Phone',
	})
	expect(
		database.prepare('SELECT source_id, resource_key, content_hash FROM photos_source_resources').get(),
	).toStrictEqual({source_id: 'source', resource_key: 'a'.repeat(64), content_hash: hash})
	expect(
		database.prepare("SELECT version FROM schema_migrations WHERE module = 'photos' ORDER BY version").all(),
	).toStrictEqual([
		{version: 1},
		{version: 2},
		{version: 3},
		{version: 4},
		{version: 5},
		{version: 6},
		{version: 7},
		{version: 8},
		{version: 9},
		{version: 10},
		{version: 11},
	])
	expect(
		database
			.prepare('PRAGMA table_info(photos_source_resources)')
			.all()
			.map((column: any) => column.name),
	).toStrictEqual([
		'account_id',
		'source_id',
		'resource_key',
		'content_hash',
		'original_filename',
		'cloud_identifier',
		'resource_role',
	])
	database.close()
})

test('migrates staging v4 by adding managed backup presentation metadata', () => {
	const database = new BetterSqlite3(':memory:')
	const hash = Buffer.alloc(32, 2)
	database.exec(`
		CREATE TABLE schema_migrations(
			module TEXT NOT NULL,
			version INTEGER NOT NULL,
			applied_at INTEGER NOT NULL,
			PRIMARY KEY(module, version)
		);
		INSERT INTO schema_migrations VALUES
			('photos', 1, 1), ('photos', 2, 2), ('photos', 3, 3), ('photos', 4, 4);
		CREATE TABLE photos_sources(
			id TEXT PRIMARY KEY,
			account_id TEXT NOT NULL,
			type TEXT NOT NULL,
			name TEXT NOT NULL,
			created_at INTEGER NOT NULL
		);
		INSERT INTO photos_sources VALUES ('source', 'alice', 'iphone', 'Phone', 1);
		CREATE TABLE photos_content_state(
			account_id TEXT NOT NULL,
			content_hash BLOB NOT NULL,
			source_id TEXT NOT NULL REFERENCES photos_sources(id),
			is_favorite INTEGER NOT NULL,
			imported_at INTEGER NOT NULL,
			PRIMARY KEY(account_id, content_hash)
		) WITHOUT ROWID;
		CREATE TABLE photos_source_resources(
			account_id TEXT NOT NULL,
			source_id TEXT NOT NULL REFERENCES photos_sources(id) ON DELETE CASCADE,
			resource_key TEXT NOT NULL,
			content_hash BLOB NOT NULL,
			PRIMARY KEY(account_id, source_id, resource_key)
		) WITHOUT ROWID;
	`)
	database.prepare("INSERT INTO photos_content_state VALUES ('alice', ?, 'source', 1, 2)").run(hash)
	database.prepare("INSERT INTO photos_source_resources VALUES ('alice', 'source', ?, ?)").run('b'.repeat(64), hash)

	expect(migratePhotos(database)).toBe(PHOTOS_SCHEMA_VERSION)
	expect(
		database
			.prepare('PRAGMA table_info(photos_content_state)')
			.all()
			.map((column: any) => column.name),
	).toStrictEqual([
		'account_id',
		'content_hash',
		'source_id',
		'is_favorite',
		'imported_at',
		'source_created_at',
		'effective_taken_at',
	])
	expect(
		database
			.prepare('PRAGMA table_info(photos_source_resources)')
			.all()
			.map((column: any) => column.name),
	).toStrictEqual([
		'account_id',
		'source_id',
		'resource_key',
		'content_hash',
		'original_filename',
		'cloud_identifier',
		'resource_role',
	])
	expect(
		database.prepare('SELECT source_id, imported_at, source_created_at FROM photos_content_state').get(),
	).toStrictEqual({source_id: 'source', imported_at: 2, source_created_at: null})
	expect(
		database.prepare('SELECT source_id, resource_key, original_filename FROM photos_source_resources').get(),
	).toStrictEqual({source_id: 'source', resource_key: 'b'.repeat(64), original_filename: null})
	expect(
		database.prepare("SELECT version FROM schema_migrations WHERE module = 'photos' ORDER BY version").all(),
	).toStrictEqual([
		{version: 1},
		{version: 2},
		{version: 3},
		{version: 4},
		{version: 5},
		{version: 6},
		{version: 7},
		{version: 8},
		{version: 9},
		{version: 10},
		{version: 11},
	])
	database.close()
})

test('migrates an upstream v2 database by adding the durable backup resource identity relation', () => {
	const database = new BetterSqlite3(':memory:')
	migratePhotos(database)
	database.prepare("DELETE FROM schema_migrations WHERE module = 'photos' AND version >= 3").run()
	database.exec('DROP TABLE photos_source_resources')

	expect(migratePhotos(database)).toBe(PHOTOS_SCHEMA_VERSION)
	expect(
		database
			.prepare('PRAGMA table_info(photos_source_resources)')
			.all()
			.map((column: any) => column.name),
	).toStrictEqual([
		'account_id',
		'source_id',
		'resource_key',
		'content_hash',
		'original_filename',
		'cloud_identifier',
		'resource_role',
	])
	database.close()
})

test('migrates the backup-source v2 lineage while preserving its durable resource relations', () => {
	const database = new BetterSqlite3(':memory:')
	const hash = Buffer.alloc(32, 0xef)
	migratePhotos(database)
	database.prepare("DELETE FROM schema_migrations WHERE module = 'photos' AND version >= 3").run()
	database.exec(`
		ALTER TABLE photos_content_state ADD COLUMN deleted_at INTEGER;
		CREATE TABLE photos_deletion_targets(
			account_id TEXT NOT NULL,
			content_hash BLOB NOT NULL,
			virtual_path TEXT NOT NULL,
			PRIMARY KEY(account_id, content_hash, virtual_path),
			FOREIGN KEY(account_id, content_hash)
				REFERENCES photos_content_state(account_id, content_hash) ON DELETE CASCADE
		) WITHOUT ROWID;
		INSERT INTO photos_sources(id, account_id, type, name, created_at)
			VALUES ('iphone:source', 'alice', 'iphone', 'Phone', 1);
	`)
	database
		.prepare(
			`INSERT INTO photos_content_state(account_id, content_hash, source_id, is_favorite, imported_at, deleted_at)
			VALUES ('alice', ?, 'iphone:source', 1, 2, 123)`,
		)
		.run(hash)
	database
		.prepare(
			`INSERT INTO photos_source_resources(account_id, source_id, resource_key, content_hash)
			VALUES ('alice', 'iphone:source', ?, ?)`,
		)
		.run('a'.repeat(64), hash)
	database.prepare("INSERT INTO photos_deletion_targets VALUES ('alice', ?, '/Home/photo.heic')").run(hash)

	expect(migratePhotos(database)).toBe(PHOTOS_SCHEMA_VERSION)
	expect(
		database
			.prepare('SELECT source_id, resource_key, lower(hex(content_hash)) AS content_hash FROM photos_source_resources')
			.all(),
	).toStrictEqual([{source_id: 'iphone:source', resource_key: 'a'.repeat(64), content_hash: hash.toString('hex')}])
	expect(database.prepare('SELECT source_id, is_favorite, imported_at FROM photos_content_state').all()).toStrictEqual([
		{source_id: 'iphone:source', is_favorite: 1, imported_at: 2},
	])
	expect(
		database.prepare("SELECT name FROM sqlite_schema WHERE name = 'photos_deletion_targets'").get(),
	).toBeUndefined()
	database.close()
})

test('keeps Photos migration versions independent from other umbrel.db modules', () => {
	const database = new BetterSqlite3(':memory:')
	database.exec(`
		CREATE TABLE schema_migrations(
			module TEXT NOT NULL,
			version INTEGER NOT NULL,
			applied_at INTEGER NOT NULL,
			PRIMARY KEY(module, version)
		);
		INSERT INTO schema_migrations VALUES ('future-module', 999, 1);
	`)
	expect(migratePhotos(database)).toBe(PHOTOS_SCHEMA_VERSION)
	expect(
		database.prepare('SELECT module, version FROM schema_migrations ORDER BY module, version').all(),
	).toStrictEqual([
		{module: 'future-module', version: 999},
		{module: PHOTOS_MIGRATION_MODULE, version: 1},
		{module: PHOTOS_MIGRATION_MODULE, version: 2},
		{module: PHOTOS_MIGRATION_MODULE, version: 3},
		{module: PHOTOS_MIGRATION_MODULE, version: 4},
		{module: PHOTOS_MIGRATION_MODULE, version: 5},
		{module: PHOTOS_MIGRATION_MODULE, version: 6},
		{module: PHOTOS_MIGRATION_MODULE, version: 7},
		{module: PHOTOS_MIGRATION_MODULE, version: 8},
		{module: PHOTOS_MIGRATION_MODULE, version: 9},
		{module: PHOTOS_MIGRATION_MODULE, version: 10},
		{module: PHOTOS_MIGRATION_MODULE, version: 11},
	])
	database.close()
})

test('upgrades the v8 source trigger so renames are cheap while scope changes still invalidate', () => {
	const database = new BetterSqlite3(':memory:')
	try {
		migratePhotos(database)
		database.exec(`DELETE FROM schema_migrations WHERE module='photos' AND version>=9;
			DROP TRIGGER photos_read_model_photos_sources_update;
			CREATE TRIGGER photos_read_model_photos_sources_update AFTER UPDATE OF name ON photos_sources
			WHEN old.name IS NOT new.name BEGIN
				INSERT INTO photos_read_model_dirty_accounts VALUES(new.account_id) ON CONFLICT DO NOTHING;
			END;
			INSERT INTO photos_sources(id,account_id,type,name,scope_mode,scope_paths,created_at)
			VALUES('owner-source','owner','umbrel','Before','everything','[]',1);
			DELETE FROM photos_read_model_dirty_accounts;`)
		migratePhotos(database)
		database.exec("UPDATE photos_sources SET name='After' WHERE id='owner-source'")
		expect(database.prepare('SELECT * FROM photos_read_model_dirty_accounts').all()).toEqual([])
		database.exec(
			"UPDATE photos_sources SET scope_mode='only',scope_paths='[\"/Home/Camera\"]' WHERE id='owner-source'",
		)
		expect(database.prepare('SELECT * FROM photos_read_model_dirty_accounts').all()).toEqual([{account_id: 'owner'}])
		migratePhotos(database)
		expect(database.prepare('SELECT name FROM photos_sources').get()).toEqual({name: 'After'})
	} finally {
		database.close()
	}
})

test('adds a platform to phone sources without rebuilding them or their backups', () => {
	const database = new BetterSqlite3(':memory:')
	try {
		migratePhotos(database)
		// Back to v9: no platform column, and the source trigger v9 installed.
		database.exec(`DELETE FROM schema_migrations WHERE module='photos' AND version>=10;
			DROP TRIGGER photos_read_model_photos_sources_update;
			ALTER TABLE photos_sources DROP COLUMN platform;
			CREATE TRIGGER photos_read_model_photos_sources_update
			AFTER UPDATE OF account_id, type, scope_mode, scope_paths ON photos_sources
			WHEN old.account_id IS NOT new.account_id OR old.type IS NOT new.type
				OR old.scope_mode IS NOT new.scope_mode OR old.scope_paths IS NOT new.scope_paths BEGIN
				INSERT INTO photos_read_model_dirty_accounts VALUES(new.account_id) ON CONFLICT DO NOTHING;
			END;
			INSERT INTO photos_sources(id,account_id,type,name,created_at) VALUES('iphone:phone','alice','iphone','Pixel',1);`)
		const hash = Buffer.alloc(32, 1)
		database
			.prepare(
				"INSERT INTO photos_content_state(account_id, content_hash, source_id, imported_at) VALUES ('alice', ?, 'iphone:phone', 2)",
			)
			.run(hash)
		database
			.prepare(
				"INSERT INTO photos_source_resources(account_id, source_id, resource_key, content_hash) VALUES ('alice', 'iphone:phone', ?, ?)",
			)
			.run('a'.repeat(64), hash)
		database.exec('DELETE FROM photos_read_model_dirty_accounts; DELETE FROM photos_read_model_dirty_contents;')

		expect(migratePhotos(database)).toBe(PHOTOS_SCHEMA_VERSION)
		expect(database.prepare('SELECT id, type, name, platform FROM photos_sources').all()).toEqual([
			{id: 'iphone:phone', type: 'iphone', name: 'Pixel', platform: null},
		])
		expect(database.prepare('SELECT source_id FROM photos_content_state').all()).toEqual([{source_id: 'iphone:phone'}])
		expect(database.prepare('SELECT source_id FROM photos_source_resources').all()).toEqual([
			{source_id: 'iphone:phone'},
		])
		expect(database.prepare('SELECT * FROM photos_read_model_dirty_accounts').all()).toEqual([])

		// A rename stays cheap; learning the phone runs Android changes how its items show.
		database.exec("UPDATE photos_sources SET name='Pixel 8a' WHERE id='iphone:phone'")
		expect(database.prepare('SELECT * FROM photos_read_model_dirty_accounts').all()).toEqual([])
		database.exec("UPDATE photos_sources SET platform='android' WHERE id='iphone:phone'")
		expect(database.prepare('SELECT * FROM photos_read_model_dirty_accounts').all()).toEqual([{account_id: 'alice'}])
	} finally {
		database.close()
	}
})

test('upgrades v19 stored items without rebuilding their rows', async () => {
	const database = new BetterSqlite3(':memory:')
	try {
		await migrateFileIndex(
			database,
			fileIndexMigrations.filter(({version}) => version <= 19),
		)
		database.exec("INSERT INTO photos_library_items(account_id,id,source_name) VALUES('owner','kept','Before')")
		await migrateFileIndex(database)
		await migrateFileIndex(database)
		expect(database.prepare('SELECT account_id,id FROM photos_library_items').all()).toEqual([
			{account_id: 'owner', id: 'kept'},
		])
		expect(
			(database.pragma('table_info(photos_library_items)') as Array<{name: string}>).map(({name}) => name),
		).not.toContain('source_name')
	} finally {
		database.close()
	}
})

test('rejects a database created by a newer Photos version before changing it', () => {
	const database = new BetterSqlite3(':memory:')
	database.exec(`
		CREATE TABLE schema_migrations(
			module TEXT NOT NULL,
			version INTEGER NOT NULL,
			applied_at INTEGER NOT NULL,
			PRIMARY KEY(module, version)
		);
		INSERT INTO schema_migrations VALUES ('photos', 999, 1);
	`)
	expect(() => migratePhotos(database)).toThrow(UnsupportedPhotosSchemaError)
	expect(database.prepare("SELECT name FROM sqlite_schema WHERE name = 'items'").get()).toBeUndefined()
	database.close()
})

test('upgrades v10 backup receipts with no cloud identity', () => {
	const database = new BetterSqlite3(':memory:')
	try {
		migratePhotos(database)
		database.exec(`DELETE FROM schema_migrations WHERE module='photos' AND version=11;
			DROP INDEX photos_source_resources_by_cloud_identifier;
			ALTER TABLE photos_source_resources DROP COLUMN resource_role;
			ALTER TABLE photos_source_resources DROP COLUMN cloud_identifier;
			INSERT INTO photos_sources(id,account_id,type,name,created_at) VALUES('phone','owner','iphone','iPhone',1);`)
		database
			.prepare(
				`INSERT INTO photos_source_resources(account_id,source_id,resource_key,content_hash,original_filename)
				VALUES('owner','phone',?,?,'IMG_0001.HEIC')`,
			)
			.run('a'.repeat(64), Buffer.alloc(32, 1))

		expect(migratePhotos(database)).toBe(PHOTOS_SCHEMA_VERSION)
		expect(
			database
				.prepare('SELECT resource_key, original_filename, cloud_identifier, resource_role FROM photos_source_resources')
				.all(),
		).toStrictEqual([
			{
				resource_key: 'a'.repeat(64),
				original_filename: 'IMG_0001.HEIC',
				cloud_identifier: null,
				resource_role: null,
			},
		])
		const plan = database
			.prepare(
				`EXPLAIN QUERY PLAN SELECT content_hash FROM photos_source_resources
					INDEXED BY photos_source_resources_by_cloud_identifier
				WHERE account_id = ? AND cloud_identifier = ? AND resource_role = ?`,
			)
			.all('owner', 'asset', 'photo') as Array<{detail: string}>
		expect(plan.map(({detail}) => detail)).toStrictEqual([
			'SEARCH photos_source_resources USING INDEX photos_source_resources_by_cloud_identifier (account_id=? AND cloud_identifier=? AND resource_role=?)',
		])
	} finally {
		database.close()
	}
})
