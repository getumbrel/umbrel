import BetterSqlite3 from 'better-sqlite3'
import {expect, test} from 'vitest'

import {fileIndexMigrations, migrateFileIndex} from './migrations.js'

test('removes previously crawled app entries once while preserving other roots and shared content', async () => {
	const database = new BetterSqlite3(':memory:')
	try {
		database.pragma('foreign_keys = ON')
		await migrateFileIndex(
			database,
			fileIndexMigrations.filter(({version}) => version < 17),
		)
		database.exec(`
			INSERT INTO index_roots(id, virtual_path, system_path, owner_id, kind, search_enabled, created_at, updated_at)
			VALUES (1, '/Home', '/home', 'owner', 'home', 1, 0, 0),
				(2, '/Apps', '/apps', 'owner', 'apps', 0, 0, 0),
				(3, '/External', '/external', 'owner', 'apps', 0, 0, 0);
			INSERT INTO contents(id, blake3, size, created_at) VALUES (1, zeroblob(32), 42, 0);
			INSERT INTO entries(id, root_id, relative_path, name, search_name, search_name_folded, type, size, modified_ms, hidden, content_id)
			VALUES (1, 1, 'home.jpg', 'home.jpg', 'home.jpg', 'home.jpg', 'file', 42, 0, 0, 1),
				(2, 2, 'app.jpg', 'app.jpg', 'app.jpg', 'app.jpg', 'file', 42, 0, 0, 1),
				(3, 3, 'external.jpg', 'external.jpg', 'external.jpg', 'external.jpg', 'file', 42, 0, 0, NULL);
			INSERT INTO transient_thumbnail_variants(entry_id, variant, artifact_key, state, updated_at)
			VALUES (2, 'test', '${'a'.repeat(64)}', 'ready', 0);
		`)
		await migrateFileIndex(database)
		expect(database.prepare('SELECT virtual_path FROM index_roots ORDER BY id').all()).toEqual([
			{virtual_path: '/Home'},
			{virtual_path: '/External'},
		])
		expect(database.prepare('SELECT id FROM entries ORDER BY id').all()).toEqual([{id: 1}, {id: 3}])
		expect(database.prepare('SELECT id FROM contents').all()).toEqual([{id: 1}])
		expect(database.prepare('SELECT * FROM transient_thumbnail_variants').all()).toEqual([])
		expect(database.pragma('foreign_key_check')).toEqual([])
		database.exec("INSERT INTO entry_names_fts(entry_names_fts, rank) VALUES ('integrity-check', 1)")

		// Files may cache a thumbnail explicitly requested after the migration.
		// A later boot must not repeat the cleanup and discard this new entry.
		database.exec(`
			INSERT INTO index_roots(id, virtual_path, system_path, owner_id, kind, search_enabled, created_at, updated_at)
			VALUES (4, '/Apps', '/apps', 'owner', 'apps', 0, 0, 0);
			INSERT INTO entries(root_id, relative_path, name, type, size, modified_ms, hidden)
			VALUES (4, 'requested.jpg', 'requested.jpg', 'file', 42, 0, 0);
		`)
		await migrateFileIndex(database)
		expect(database.prepare('SELECT COUNT(*) AS count FROM entries WHERE root_id = 4').get()).toEqual({count: 1})
		expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 17').get()).toEqual({
			count: 1,
		})
	} finally {
		database.close()
	}
})
