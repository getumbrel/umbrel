import type BetterSqlite3 from 'better-sqlite3'

import {photosReadModelDirtySchema, photosReadModelDurableTriggers} from './read-model-schema.js'

export const PHOTOS_SCHEMA_VERSION = 9
export const PHOTOS_MIGRATION_MODULE = 'photos'

export class UnsupportedPhotosSchemaError extends Error {}

export function migratePhotos(database: BetterSqlite3.Database) {
	database.pragma('journal_mode = WAL')
	database.pragma('foreign_keys = ON')
	const migrate = database.transaction(() => {
		database.exec(`
			CREATE TABLE IF NOT EXISTS schema_migrations (
				module TEXT NOT NULL,
				version INTEGER NOT NULL,
				applied_at INTEGER NOT NULL,
				PRIMARY KEY(module, version)
			);`)
		const version = Number(
			(
				database
					.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations WHERE module = ?')
					.get(PHOTOS_MIGRATION_MODULE) as {
					version: number
				}
			).version,
		)
		if (version > PHOTOS_SCHEMA_VERSION) {
			throw new UnsupportedPhotosSchemaError(
				`Unsupported Photos schema v${version}; expected at most v${PHOTOS_SCHEMA_VERSION}`,
			)
		}
		if (version === PHOTOS_SCHEMA_VERSION) return
		if (version < 1) {
			database.exec(`
			CREATE TABLE photos_sources (
				id TEXT PRIMARY KEY,
				account_id TEXT NOT NULL,
				type TEXT NOT NULL CHECK (type IN ('umbrel', 'iphone')),
				name TEXT NOT NULL,
				scope_mode TEXT CHECK (scope_mode IN ('everything', 'everything-except', 'only')),
				scope_paths TEXT,
				last_import_at INTEGER,
				created_at INTEGER NOT NULL
			);
			CREATE UNIQUE INDEX photos_sources_one_umbrel_per_account
				ON photos_sources(account_id) WHERE type = 'umbrel';

			CREATE TABLE photos_content_state (
				account_id TEXT NOT NULL,
				content_hash BLOB NOT NULL CHECK (length(content_hash) = 32),
				source_id TEXT NOT NULL REFERENCES photos_sources(id) ON DELETE RESTRICT,
				is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
				imported_at INTEGER NOT NULL,
				source_created_at INTEGER,
				PRIMARY KEY(account_id, content_hash)
			) WITHOUT ROWID;
			CREATE INDEX photos_content_state_by_account
				ON photos_content_state(account_id, is_favorite, content_hash);

			CREATE TABLE photos_albums (
				id TEXT PRIMARY KEY,
				account_id TEXT NOT NULL,
				name TEXT NOT NULL,
				cover_content_hash BLOB CHECK (cover_content_hash IS NULL OR length(cover_content_hash) = 32),
				created_at INTEGER NOT NULL
			);
			CREATE INDEX photos_albums_by_account ON photos_albums(account_id, created_at, id);

			CREATE TABLE photos_album_items (
				album_id TEXT NOT NULL REFERENCES photos_albums(id) ON DELETE CASCADE,
				content_hash BLOB NOT NULL CHECK (length(content_hash) = 32),
				added_at INTEGER NOT NULL,
				PRIMARY KEY(album_id, content_hash)
			) WITHOUT ROWID;
			`)
			database
				.prepare('INSERT INTO schema_migrations(module, version, applied_at) VALUES (?, 1, ?)')
				.run(PHOTOS_MIGRATION_MODULE, Date.now())
		}
		if (
			version < 3 &&
			(database.prepare("PRAGMA table_info('photos_content_state')").all() as Array<{name: string}>).some(
				({name}) => name === 'deleted_at',
			)
		) {
			// v1 represented Photos deletion as durable metadata while leaving the
			// original file in Home. Trash is now the source of truth, so retain the
			// unrelated per-content state and discard the obsolete tombstones.
			database.exec(`
				DROP TABLE IF EXISTS photos_deletion_targets;
				DROP INDEX photos_content_state_by_account;
				CREATE TABLE photos_content_state_v3 (
					account_id TEXT NOT NULL,
					content_hash BLOB NOT NULL CHECK (length(content_hash) = 32),
					source_id TEXT NOT NULL REFERENCES photos_sources(id) ON DELETE RESTRICT,
					is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
					imported_at INTEGER NOT NULL,
					source_created_at INTEGER,
					PRIMARY KEY(account_id, content_hash)
				) WITHOUT ROWID;
				INSERT INTO photos_content_state_v3(
					account_id, content_hash, source_id, is_favorite, imported_at, source_created_at
				)
					SELECT account_id, content_hash, source_id, is_favorite, imported_at, NULL
					FROM photos_content_state;
				DROP TABLE photos_content_state;
				ALTER TABLE photos_content_state_v3 RENAME TO photos_content_state;
				CREATE INDEX photos_content_state_by_account
					ON photos_content_state(account_id, is_favorite, content_hash);
			`)
		}
		if (version < 4) {
			database.exec(`
				CREATE TABLE IF NOT EXISTS photos_source_resources (
					account_id TEXT NOT NULL,
					source_id TEXT NOT NULL REFERENCES photos_sources(id) ON DELETE CASCADE,
					resource_key TEXT NOT NULL CHECK (
						length(resource_key) = 64 AND resource_key = lower(resource_key)
						AND resource_key NOT GLOB '*[^0-9a-f]*'
					),
					content_hash BLOB NOT NULL CHECK (length(content_hash) = 32),
					original_filename TEXT,
					PRIMARY KEY(account_id, source_id, resource_key)
				) WITHOUT ROWID;
				CREATE INDEX IF NOT EXISTS photos_source_resources_by_content
					ON photos_source_resources(account_id, content_hash, source_id);
			`)
		}
		if (version < 2) {
			database
				.prepare('INSERT INTO schema_migrations(module, version, applied_at) VALUES (?, 2, ?)')
				.run(PHOTOS_MIGRATION_MODULE, Date.now())
		}
		if (version < 3) {
			database
				.prepare('INSERT INTO schema_migrations(module, version, applied_at) VALUES (?, 3, ?)')
				.run(PHOTOS_MIGRATION_MODULE, Date.now())
		}
		if (version < 4) {
			// Live Photo pairs are a projection of disposable file-index metadata.
			// Removing the durable cache prevents stale pair rows from surviving an
			// index rebuild; listing and file operations now derive pairs on demand.
			database.exec(`
				DROP INDEX IF EXISTS photos_live_pairs_by_motion;
				DROP TABLE IF EXISTS photos_live_pairs;
			`)
			database
				.prepare('INSERT INTO schema_migrations(module, version, applied_at) VALUES (?, 4, ?)')
				.run(PHOTOS_MIGRATION_MODULE, Date.now())
		}
		if (version < 5) {
			const contentStateColumns = new Set(
				(database.prepare("PRAGMA table_info('photos_content_state')").all() as Array<{name: string}>).map(
					({name}) => name,
				),
			)
			if (!contentStateColumns.has('source_created_at')) {
				database.exec('ALTER TABLE photos_content_state ADD COLUMN source_created_at INTEGER')
			}

			const sourceResourceColumns = new Set(
				(database.prepare("PRAGMA table_info('photos_source_resources')").all() as Array<{name: string}>).map(
					({name}) => name,
				),
			)
			if (!sourceResourceColumns.has('original_filename')) {
				database.exec('ALTER TABLE photos_source_resources ADD COLUMN original_filename TEXT')
			}

			database
				.prepare('INSERT INTO schema_migrations(module, version, applied_at) VALUES (?, 5, ?)')
				.run(PHOTOS_MIGRATION_MODULE, Date.now())
		}
		if (version < 6) {
			const contentStateColumns = new Set(
				(database.prepare("PRAGMA table_info('photos_content_state')").all() as Array<{name: string}>).map(
					({name}) => name,
				),
			)
			if (!contentStateColumns.has('effective_taken_at')) {
				database.exec(`
					ALTER TABLE photos_content_state ADD COLUMN effective_taken_at INTEGER;
					UPDATE photos_content_state SET effective_taken_at = -8640000000000000;
				`)
			}
			database.exec(`
				CREATE INDEX IF NOT EXISTS photos_content_state_by_effective_taken_at
					ON photos_content_state(account_id, effective_taken_at DESC, content_hash)
					WHERE effective_taken_at IS NOT NULL;
			`)
			database
				.prepare('INSERT INTO schema_migrations(module, version, applied_at) VALUES (?, 6, ?)')
				.run(PHOTOS_MIGRATION_MODULE, Date.now())
		}
		if (version < 7) {
			database.exec(`
				CREATE TABLE IF NOT EXISTS photos_projection_state (
					id INTEGER PRIMARY KEY CHECK (id = 1),
					generation INTEGER NOT NULL
				);
				INSERT INTO photos_projection_state(id, generation) VALUES (1, 0)
					ON CONFLICT(id) DO NOTHING;
			`)
			database
				.prepare('INSERT INTO schema_migrations(module, version, applied_at) VALUES (?, 7, ?)')
				.run(PHOTOS_MIGRATION_MODULE, Date.now())
		}
		if (version < 8) {
			database.exec(photosReadModelDirtySchema + photosReadModelDurableTriggers())
			database
				.prepare('INSERT INTO schema_migrations(module, version, applied_at) VALUES (?, 8, ?)')
				.run(PHOTOS_MIGRATION_MODULE, Date.now())
		}
		if (version < 9) {
			// Source names are read from their authoritative row by item details.
			// Renaming a device does not change library membership or Live Photo pairs.
			database.exec('DROP TRIGGER IF EXISTS photos_read_model_photos_sources_update')
			database.exec(photosReadModelDurableTriggers())
			database
				.prepare('INSERT INTO schema_migrations(module, version, applied_at) VALUES (?, 9, ?)')
				.run(PHOTOS_MIGRATION_MODULE, Date.now())
		}
	})
	migrate.immediate()
	return PHOTOS_SCHEMA_VERSION
}
