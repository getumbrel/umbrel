import type BetterSqlite3 from 'better-sqlite3'

import {PHOTO_EXTENSIONS, VIDEO_EXTENSIONS} from '../../photos/types.js'

export type FileIndexMigration = {
	version: number
	up: (database: BetterSqlite3.Database) => void
}

export function foldSearchName(value: string) {
	return value.normalize('NFC').toLowerCase()
}

export function filenameStemSql(nameSql: string, extensions: string[]) {
	const extensionsByLength = new Map<number, string[]>()
	for (const extension of new Set(extensions)) {
		extensionsByLength.set(extension.length, [...(extensionsByLength.get(extension.length) ?? []), extension])
	}
	const branches = [...extensionsByLength]
		.toSorted(([left], [right]) => right - left)
		.map(
			([length, values]) =>
				`WHEN substr(lower(${nameSql}), -${length}) IN (${values.map((value) => `'${value}'`).join(', ')}) ` +
				`THEN substr(lower(${nameSql}), 1, length(${nameSql}) - ${length})`,
		)
		.join('\n\t\t\t')
	return `CASE ${branches} ELSE lower(${nameSql}) END`
}

export const fileIndexMigrations: FileIndexMigration[] = [
	{
		version: 1,
		up: (database) => {
			database.exec(`
				CREATE TABLE index_roots (
					id INTEGER PRIMARY KEY,
					virtual_path TEXT NOT NULL UNIQUE,
					system_path TEXT NOT NULL UNIQUE,
					owner_id TEXT NOT NULL,
					kind TEXT NOT NULL CHECK (kind IN ('home', 'trash', 'apps', 'machines')),
					search_enabled INTEGER NOT NULL CHECK (search_enabled IN (0, 1)),
					state TEXT NOT NULL DEFAULT 'warming' CHECK (state IN ('warming', 'ready', 'degraded')),
					scan_generation INTEGER NOT NULL DEFAULT 0,
					last_successful_scan_at INTEGER,
					last_error TEXT,
					created_at INTEGER NOT NULL,
					updated_at INTEGER NOT NULL
				);

				CREATE TABLE entries (
					id INTEGER PRIMARY KEY,
					root_id INTEGER NOT NULL REFERENCES index_roots(id) ON DELETE CASCADE,
					relative_path TEXT NOT NULL,
					parent_relative_path TEXT NOT NULL,
					name TEXT NOT NULL,
					type TEXT NOT NULL CHECK (type IN (
						'directory',
						'symbolic-link',
						'socket',
						'block-device',
						'character-device',
						'fifo',
						'file'
					)),
					mime_type TEXT,
					size INTEGER NOT NULL,
					modified_ms INTEGER NOT NULL,
					changed_ms INTEGER NOT NULL,
					birth_ms INTEGER NOT NULL,
					device INTEGER NOT NULL,
					inode INTEGER NOT NULL,
					mode INTEGER NOT NULL,
					uid INTEGER NOT NULL,
					gid INTEGER NOT NULL,
					nlink INTEGER NOT NULL,
					hidden INTEGER NOT NULL CHECK (hidden IN (0, 1)),
					last_seen_generation INTEGER NOT NULL,
					indexed_at INTEGER NOT NULL,
					updated_at INTEGER NOT NULL,
					UNIQUE(root_id, relative_path)
				);

				CREATE INDEX entries_by_parent ON entries(root_id, parent_relative_path);
				CREATE INDEX entries_by_name ON entries(root_id, name);
				CREATE INDEX entries_by_inode ON entries(root_id, device, inode);
				CREATE INDEX entries_by_generation ON entries(root_id, last_seen_generation);
			`)
		},
	},
	{
		version: 2,
		up: (database) => {
			database.exec(`
				CREATE TABLE entries_v2 (
					id INTEGER PRIMARY KEY,
					root_id INTEGER NOT NULL REFERENCES index_roots(id) ON DELETE CASCADE,
					relative_path TEXT NOT NULL,
					name TEXT NOT NULL,
					type TEXT NOT NULL CHECK (type IN (
						'directory',
						'symbolic-link',
						'socket',
						'block-device',
						'character-device',
						'fifo',
						'file'
					)),
					size INTEGER NOT NULL,
					modified_ms INTEGER NOT NULL,
					hidden INTEGER NOT NULL CHECK (hidden IN (0, 1)),
					UNIQUE(root_id, relative_path)
				);

				INSERT INTO entries_v2(id, root_id, relative_path, name, type, size, modified_ms, hidden)
				SELECT id, root_id, relative_path, name, type, size, modified_ms, hidden
				FROM entries;

				DROP TABLE entries;
				ALTER TABLE entries_v2 RENAME TO entries;

				CREATE INDEX entries_by_name ON entries(root_id, name);
				CREATE INDEX entries_by_root_visibility ON entries(root_id, hidden, id);
			`)
		},
	},
	{
		version: 3,
		up: (database) => {
			database.exec(`
				DROP INDEX entries_by_name;

				CREATE VIRTUAL TABLE entry_names_fts USING fts5(
					name,
					content = 'entries',
					content_rowid = 'id',
					tokenize = 'trigram',
					detail = 'none'
				);
				CREATE TRIGGER entries_fts_insert AFTER INSERT ON entries BEGIN
					INSERT INTO entry_names_fts(rowid, name) VALUES (new.id, new.name);
				END;

				CREATE TRIGGER entries_fts_delete AFTER DELETE ON entries BEGIN
					INSERT INTO entry_names_fts(entry_names_fts, rowid, name)
					VALUES ('delete', old.id, old.name);
				END;

				CREATE TRIGGER entries_fts_update AFTER UPDATE OF name ON entries
				WHEN old.name IS NOT new.name BEGIN
					INSERT INTO entry_names_fts(entry_names_fts, rowid, name)
					VALUES ('delete', old.id, old.name);
					INSERT INTO entry_names_fts(rowid, name) VALUES (new.id, new.name);
				END;

				INSERT INTO entry_names_fts(entry_names_fts) VALUES ('rebuild');
			`)
		},
	},
	{
		version: 4,
		up: (database) => {
			database.exec("CREATE VIRTUAL TABLE entry_names_fts_vocab USING fts5vocab(entry_names_fts, 'row')")
		},
	},
	{
		version: 5,
		up: (database) => {
			database.function('normalize_nfc', {deterministic: true}, (value: unknown) => {
				if (typeof value !== 'string') throw new TypeError('normalize_nfc expects text')
				return value.normalize('NFC')
			})
			database.exec(`
				DROP TABLE entry_names_fts_vocab;
				DROP TRIGGER entries_fts_insert;
				DROP TRIGGER entries_fts_delete;
				DROP TRIGGER entries_fts_update;
				DROP TABLE entry_names_fts;

				ALTER TABLE entries ADD COLUMN search_name TEXT NOT NULL DEFAULT '';
				UPDATE entries SET search_name = normalize_nfc(name);
				CREATE INDEX entries_by_search_name ON entries(root_id, search_name COLLATE NOCASE);

				CREATE VIRTUAL TABLE entry_names_fts USING fts5(
					search_name,
					content = 'entries',
					content_rowid = 'id',
					tokenize = 'trigram',
					detail = 'none'
				);
				CREATE TRIGGER entries_fts_insert AFTER INSERT ON entries BEGIN
					INSERT INTO entry_names_fts(rowid, search_name) VALUES (new.id, new.search_name);
				END;

				CREATE TRIGGER entries_fts_delete AFTER DELETE ON entries BEGIN
					INSERT INTO entry_names_fts(entry_names_fts, rowid, search_name)
					VALUES ('delete', old.id, old.search_name);
				END;

				CREATE TRIGGER entries_fts_update AFTER UPDATE OF search_name ON entries
				WHEN old.search_name IS NOT new.search_name BEGIN
					INSERT INTO entry_names_fts(entry_names_fts, rowid, search_name)
					VALUES ('delete', old.id, old.search_name);
					INSERT INTO entry_names_fts(rowid, search_name) VALUES (new.id, new.search_name);
				END;

				INSERT INTO entry_names_fts(entry_names_fts) VALUES ('rebuild');
				CREATE VIRTUAL TABLE entry_names_fts_vocab USING fts5vocab(entry_names_fts, 'row');
			`)
		},
	},
	{
		version: 6,
		up: (database) => {
			database.function('fold_search_name', {deterministic: true}, (value: unknown) => {
				if (typeof value !== 'string') throw new TypeError('fold_search_name expects text')
				return foldSearchName(value)
			})
			database.exec(`
				DROP INDEX entries_by_search_name;
				ALTER TABLE entries ADD COLUMN search_name_folded TEXT NOT NULL DEFAULT '';
				UPDATE entries SET search_name_folded = fold_search_name(name);
				CREATE INDEX entries_by_folded_search_name ON entries(root_id, search_name_folded);
			`)
		},
	},
	{
		version: 7,
		up: (database) => {
			database.exec(`
				CREATE TABLE contents (
					id INTEGER PRIMARY KEY,
					blake3 BLOB NOT NULL UNIQUE CHECK (length(blake3) = 32),
					size INTEGER NOT NULL,
					created_at INTEGER NOT NULL
				);

				ALTER TABLE entries ADD COLUMN device TEXT NOT NULL DEFAULT '';
				ALTER TABLE entries ADD COLUMN inode TEXT NOT NULL DEFAULT '';
				ALTER TABLE entries ADD COLUMN modified_ns TEXT NOT NULL DEFAULT '';
				ALTER TABLE entries ADD COLUMN ctime_ns TEXT NOT NULL DEFAULT '';
				ALTER TABLE entries ADD COLUMN thumbnail_identity_kind TEXT
					CHECK (thumbnail_identity_kind IN ('content', 'transient'));
				ALTER TABLE entries ADD COLUMN content_id INTEGER REFERENCES contents(id);
				ALTER TABLE entries ADD COLUMN hash_failure_count INTEGER NOT NULL DEFAULT 0;
				ALTER TABLE entries ADD COLUMN hash_retry_at INTEGER;
				ALTER TABLE entries ADD COLUMN hash_error TEXT;
				ALTER TABLE entries ADD COLUMN observed_at INTEGER;

				CREATE INDEX entries_by_content ON entries(content_id);
				CREATE INDEX entries_pending_content_hash
					ON entries(hash_retry_at, id)
					WHERE thumbnail_identity_kind = 'content' AND content_id IS NULL;

				CREATE TABLE thumbnail_variants (
					content_id INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
					variant TEXT NOT NULL,
					state TEXT NOT NULL CHECK (state IN ('pending', 'ready', 'failed')),
					failure_count INTEGER NOT NULL DEFAULT 0,
					retry_at INTEGER,
					last_error TEXT,
					created_at INTEGER,
					updated_at INTEGER NOT NULL,
					PRIMARY KEY(content_id, variant)
				) WITHOUT ROWID;

				CREATE INDEX thumbnail_variants_pending_work
					ON thumbnail_variants(variant, content_id)
					WHERE state = 'pending';
				CREATE INDEX thumbnail_variants_failed_work
					ON thumbnail_variants(variant, retry_at, content_id)
					WHERE state = 'failed';

				CREATE TABLE transient_thumbnail_variants (
					entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
					variant TEXT NOT NULL,
					artifact_key TEXT NOT NULL CHECK (
						length(artifact_key) = 64 AND artifact_key = lower(artifact_key)
					),
					state TEXT NOT NULL CHECK (state IN ('pending', 'ready', 'failed')),
					failure_count INTEGER NOT NULL DEFAULT 0,
					last_error TEXT,
					created_at INTEGER,
					updated_at INTEGER NOT NULL,
					PRIMARY KEY(entry_id, variant)
				) WITHOUT ROWID;

				CREATE INDEX transient_thumbnail_variants_by_artifact
					ON transient_thumbnail_variants(variant, artifact_key);

				CREATE TRIGGER entries_transient_thumbnail_revision_update
				AFTER UPDATE OF thumbnail_identity_kind, device, inode, size, modified_ns ON entries
				WHEN old.thumbnail_identity_kind = 'transient' AND (
					new.thumbnail_identity_kind IS NOT old.thumbnail_identity_kind
					OR new.device IS NOT old.device
					OR new.inode IS NOT old.inode
					OR new.size IS NOT old.size
					OR new.modified_ns IS NOT old.modified_ns
				) BEGIN
					DELETE FROM transient_thumbnail_variants
					WHERE entry_id = new.id;
				END;
			`)
		},
	},
	{
		version: 8,
		up: (database) => {
			database.exec(`
				DELETE FROM thumbnail_variants WHERE variant = 'preview-112-webp-v1';
				DELETE FROM transient_thumbnail_variants WHERE variant = 'preview-112-webp-v1';

				CREATE TABLE media_metadata (
					content_id INTEGER PRIMARY KEY REFERENCES contents(id) ON DELETE CASCADE,
					state TEXT NOT NULL CHECK (state IN ('pending', 'ready', 'failed')),
					kind TEXT CHECK (kind IN ('photo', 'video')),
					sub_kind TEXT CHECK (sub_kind IN ('live', 'panorama', 'screenshot', 'spherical')),
					taken_at INTEGER,
					taken_at_offset_minutes INTEGER,
					created_at INTEGER,
					width INTEGER,
					height INTEGER,
					duration_ms INTEGER,
					tint INTEGER,
					camera_make TEXT,
					camera_model TEXT,
					lens TEXT,
					focal_length TEXT,
					aperture TEXT,
					exposure TEXT,
					iso INTEGER,
					latitude REAL,
					longitude REAL,
					live_identifier TEXT,
					search_text TEXT NOT NULL DEFAULT '',
					failure_count INTEGER NOT NULL DEFAULT 0,
					retry_at INTEGER,
					last_error TEXT,
					updated_at INTEGER NOT NULL
				);
				CREATE INDEX media_metadata_pending_work
					ON media_metadata(content_id) WHERE state = 'pending';
				CREATE INDEX media_metadata_failed_work
					ON media_metadata(retry_at, content_id) WHERE state = 'failed';
				CREATE INDEX media_metadata_by_live_identifier
					ON media_metadata(live_identifier, kind) WHERE live_identifier IS NOT NULL;

				CREATE VIRTUAL TABLE media_metadata_fts USING fts5(
					search_text,
					content = 'media_metadata',
					content_rowid = 'content_id',
					tokenize = 'trigram',
					detail = 'none'
				);
				CREATE TRIGGER media_metadata_fts_insert AFTER INSERT ON media_metadata BEGIN
					INSERT INTO media_metadata_fts(rowid, search_text) VALUES (new.content_id, new.search_text);
				END;
				CREATE TRIGGER media_metadata_fts_delete AFTER DELETE ON media_metadata BEGIN
					INSERT INTO media_metadata_fts(media_metadata_fts, rowid, search_text)
					VALUES ('delete', old.content_id, old.search_text);
				END;
				CREATE TRIGGER media_metadata_fts_update AFTER UPDATE OF search_text ON media_metadata
				WHEN old.search_text IS NOT new.search_text BEGIN
					INSERT INTO media_metadata_fts(media_metadata_fts, rowid, search_text)
					VALUES ('delete', old.content_id, old.search_text);
					INSERT INTO media_metadata_fts(rowid, search_text) VALUES (new.content_id, new.search_text);
				END;
			`)
		},
	},
	{
		version: 9,
		up: (database) => {
			database.exec(`
				ALTER TABLE entries ADD COLUMN birthtime_ms INTEGER;
				ALTER TABLE media_metadata ADD COLUMN altitude REAL;
				ALTER TABLE media_metadata ADD COLUMN user_comment TEXT;
				UPDATE media_metadata SET state = 'pending', retry_at = NULL, last_error = NULL, updated_at = 0;
			`)
		},
	},
	{
		version: 10,
		up: (database) => {
			database.exec(`
				DELETE FROM thumbnail_variants
				WHERE variant IN ('preview-512-webp-v1', 'preview-1280-webp-v1');
				DELETE FROM transient_thumbnail_variants
				WHERE variant IN ('preview-512-webp-v1', 'preview-1280-webp-v1');
			`)
		},
	},
	{
		version: 11,
		up: (database) => {
			database.exec(`
				DROP INDEX entries_pending_content_hash;
				CREATE INDEX entries_pending_content_hash
					ON entries(root_id, hash_retry_at, id)
					WHERE thumbnail_identity_kind = 'content' AND content_id IS NULL;
			`)
		},
	},
	{
		version: 12,
		up: (database) => {
			database.exec(`
				UPDATE media_metadata SET
					state = 'pending', failure_count = 0, retry_at = NULL,
					last_error = NULL, updated_at = 0
				WHERE kind = 'video';
			`)
		},
	},
	{
		version: 13,
		up: (database) => {
			database.exec(`
				CREATE INDEX entries_by_recent_modification
					ON entries(root_id, modified_ms DESC, id DESC)
					WHERE type = 'file' AND hidden = 0;
			`)
		},
	},
	{
		version: 14,
		up: (database) => {
			// TODO(photos-live-fallback-index): This expression is part of the
			// targeted Photos resolver's Live Photo fallback lookup. Changes to
			// supported media extensions or pairing rules require a new migration
			// that rebuilds this index as well as updating the resolver.
			const fallbackStem = filenameStemSql('name', [...PHOTO_EXTENSIONS, ...VIDEO_EXTENSIONS])
			database.exec(`
				CREATE INDEX entries_by_photos_live_fallback ON entries(
					root_id,
					substr(relative_path, 1, length(relative_path) - length(name)),
					${fallbackStem}
				) WHERE type = 'file' AND hidden = 0 AND thumbnail_identity_kind = 'content';
			`)
		},
	},
	{
		version: 15,
		up: (database) => {
			database.exec(`
				CREATE TABLE photos_projection_state (
					id INTEGER PRIMARY KEY CHECK (id = 1),
					generation INTEGER NOT NULL
				);
				INSERT INTO photos_projection_state(id, generation) VALUES (1, 0);
			`)
		},
	},
	{
		version: 16,
		up: (database) => {
			database.exec(`
				UPDATE media_metadata SET
					state = 'pending', failure_count = 0, retry_at = NULL,
					last_error = NULL, updated_at = 0;
			`)
		},
	},
	{
		version: 17,
		up: (database) => {
			// Retire the recursively crawled app tree once. Foreign keys and FTS
			// triggers remove its entries and per-entry thumbnail records. Normal
			// asset maintenance reclaims content no longer referenced by any root.
			// Files registers /Apps again for on-demand thumbnails only.
			database.exec("DELETE FROM index_roots WHERE virtual_path = '/Apps'")
		},
	},
]

export const FILE_INDEX_SCHEMA_VERSION = fileIndexMigrations.at(-1)?.version ?? 0

export async function migrateFileIndex(
	database: BetterSqlite3.Database,
	migrations: FileIndexMigration[] = fileIndexMigrations,
): Promise<number> {
	database.exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at INTEGER NOT NULL
		)
	`)

	const appliedRows = database.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
		version: number
	}>
	const applied = new Set(appliedRows.map(({version}) => Number(version)))

	for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
		if (applied.has(migration.version)) continue

		const runMigration = database.transaction(() => {
			migration.up(database)
			database
				.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
				.run(migration.version, Date.now())
		})
		runMigration.immediate()
	}

	const row = database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as {
		version: number
	}
	return Number(row.version)
}
