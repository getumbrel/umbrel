// Disposable Photos read tables live in index.db. Keep durable user state in
// umbrel.db; this entire projection can be rebuilt from the indexed files.
export const photosReadModelSchema = `
CREATE TABLE photos_library_active_pairs(
  account_id TEXT,
  still_hash BLOB,
  motion_hash BLOB,
  root_kind TEXT
);

CREATE TABLE photos_library_items(
  account_id TEXT,
  root_kind TEXT,
  content_hash BLOB,
  id TEXT,
  content_created_at INT,
  entry_id INT,
  content_id INT,
  name TEXT,
  search_name_folded TEXT,
  size INT,
  modified_ms INT,
  birthtime_ms INT,
  relative_path TEXT,
  root_virtual_path TEXT,
  kind TEXT,
  sub_kind TEXT,
  live_identifier TEXT,
  taken_at INT,
  taken_at_offset_minutes INT,
  created_at INT,
  width INT,
  height INT,
  duration_ms INT,
  tint INT,
  live_fallback_parent TEXT,
  live_fallback_stem TEXT,
  source_id TEXT,
  source_name TEXT,
  source_type TEXT,
  location_rank INTEGER,
  is_favorite INTEGER,
  imported_at INTEGER,
  logical_taken_at INTEGER,
  logical_created_at INTEGER,
  logical_sub_kind TEXT
);

CREATE TABLE photos_library_locations(
  account_id TEXT,
  root_kind TEXT,
  content_hash BLOB,
  id TEXT,
  entry_id INT,
  content_id INT,
  source_id TEXT,
  root_virtual_path TEXT,
  relative_path TEXT,
  search_name_folded TEXT,
  search_text TEXT
);

CREATE TABLE photos_library_pairs(
  account_id TEXT,
  still_hash BLOB,
  motion_hash BLOB
);

CREATE UNIQUE INDEX photos_library_active_pairs_key ON photos_library_active_pairs(account_id, root_kind, still_hash);

CREATE INDEX photos_library_active_pairs_motion ON photos_library_active_pairs(account_id, root_kind, motion_hash, still_hash);

CREATE INDEX photos_library_items_favorite ON photos_library_items(account_id, root_kind, is_favorite, logical_taken_at DESC, id);

CREATE UNIQUE INDEX photos_library_items_key ON photos_library_items(account_id, content_hash, root_kind);

CREATE INDEX photos_library_items_kind ON photos_library_items(account_id, root_kind, kind, logical_taken_at DESC, id);

CREATE INDEX photos_library_items_subkind ON photos_library_items(account_id, root_kind, logical_sub_kind, logical_taken_at DESC, id);

CREATE INDEX photos_library_items_summary ON photos_library_items(account_id, root_kind, logical_sub_kind, kind, is_favorite, size, logical_taken_at, content_hash);

CREATE INDEX photos_library_items_timeline ON photos_library_items(account_id, root_kind, logical_taken_at DESC, id);

CREATE UNIQUE INDEX photos_library_locations_key ON photos_library_locations(account_id, content_hash, root_kind, entry_id, source_id);

CREATE INDEX photos_library_locations_source ON photos_library_locations(account_id, source_id, root_kind, content_hash);

CREATE UNIQUE INDEX photos_library_pairs_key ON photos_library_pairs(account_id, still_hash);

CREATE INDEX photos_library_pairs_motion ON photos_library_pairs(account_id, motion_hash, still_hash);
CREATE TABLE photos_read_model_state (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 initialized INTEGER NOT NULL DEFAULT 0
);
INSERT INTO photos_read_model_state(id) VALUES (1);
`

// Persistent journals cover writes while Photos is unavailable and survive a
// restart between indexing and the Photos callback. Each journal is committed
// in the same database file as its authoritative mutation.
export const photosReadModelDirtySchema = `
CREATE TABLE IF NOT EXISTS photos_read_model_dirty_contents (
 account_id TEXT NOT NULL, content_hash BLOB NOT NULL,
 PRIMARY KEY(account_id, content_hash)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS photos_read_model_dirty_accounts (
 account_id TEXT PRIMARY KEY NOT NULL
) WITHOUT ROWID;
`

export function photosReadModelIndexTriggers() {
	const recordEntry = (row: string) => `
		INSERT INTO photos_read_model_dirty_contents
		SELECT root.owner_id, contents.blake3 FROM index_roots AS root, contents
		WHERE root.id = ${row}.root_id AND root.kind IN ('home', 'trash') AND contents.id = ${row}.content_id ON CONFLICT DO NOTHING;`
	const entryColumns = [
		'root_id',
		'content_id',
		'thumbnail_identity_kind',
		'relative_path',
		'name',
		'type',
		'hidden',
		'size',
		'modified_ms',
		'birthtime_ms',
		'search_name_folded',
	]
	return `
	-- Existing entries do not fire their own triggers when root ownership or
	-- kind changes. Seed the new owner's durable state before the full rebuild.
	CREATE TRIGGER photos_read_model_root_contents AFTER UPDATE OF owner_id, kind ON index_roots
	WHEN (old.owner_id IS NOT new.owner_id OR old.kind IS NOT new.kind) AND new.kind IN ('home', 'trash')
	BEGIN
		INSERT INTO photos_read_model_dirty_contents
		SELECT new.owner_id, contents.blake3 FROM entries JOIN contents ON contents.id = entries.content_id
		WHERE entries.root_id = new.id ON CONFLICT DO NOTHING;
	END;
	CREATE TRIGGER photos_read_model_entry_insert AFTER INSERT ON entries
	WHEN new.content_id IS NOT NULL BEGIN ${recordEntry('new')} END;
	CREATE TRIGGER photos_read_model_entry_delete BEFORE DELETE ON entries
	WHEN old.content_id IS NOT NULL BEGIN ${recordEntry('old')} END;
	CREATE TRIGGER photos_read_model_entry_update BEFORE UPDATE OF ${entryColumns.join(',')} ON entries
	WHEN ${entryColumns.map((column) => `old.${column} IS NOT new.${column}`).join(' OR ')}
	BEGIN ${recordEntry('old')} ${recordEntry('new')} END;
	${['INSERT', 'UPDATE', 'DELETE']
		.map(
			(event) => `
	CREATE TRIGGER photos_read_model_metadata_${event.toLowerCase()} ${event === 'DELETE' ? 'BEFORE' : 'AFTER'} ${event} ON media_metadata
	BEGIN
		INSERT INTO photos_read_model_dirty_contents
		SELECT root.owner_id, contents.blake3 FROM entries
		JOIN index_roots AS root ON root.id = entries.root_id
		JOIN contents ON contents.id = entries.content_id
		WHERE entries.content_id = ${event === 'DELETE' ? 'old' : 'new'}.content_id AND root.kind IN ('home', 'trash') ON CONFLICT DO NOTHING;
	END;`,
		)
		.join('\n')}
	${['INSERT', 'UPDATE', 'DELETE']
		.map(
			(event) => `
	CREATE TRIGGER photos_read_model_root_${event.toLowerCase()} ${event === 'INSERT' ? 'AFTER' : 'BEFORE'} ${event === 'UPDATE' ? 'UPDATE OF owner_id, kind, virtual_path' : event} ON index_roots
	${event === 'UPDATE' ? 'WHEN old.owner_id IS NOT new.owner_id OR old.kind IS NOT new.kind OR old.virtual_path IS NOT new.virtual_path' : ''}
	BEGIN ${[...(event !== 'INSERT' ? ['old'] : []), ...(event !== 'DELETE' ? ['new'] : [])]
		.map(
			(row) => `
		INSERT INTO photos_read_model_dirty_accounts SELECT ${row}.owner_id WHERE ${row}.kind IN ('home', 'trash') ON CONFLICT DO NOTHING;`,
		)
		.join('\n')}
	END;`,
		)
		.join('\n')}`
}

export function photosReadModelDurableTriggers() {
	return ['photos_content_state', 'photos_source_resources', 'photos_sources']
		.flatMap((table) =>
			['INSERT', 'UPDATE', 'DELETE'].map((event) => {
				const columns =
					table === 'photos_content_state'
						? 'account_id, content_hash, is_favorite, imported_at, source_created_at, source_id'
						: table === 'photos_sources'
							? 'account_id, type, scope_mode, scope_paths'
							: 'account_id, source_id, resource_key, content_hash, original_filename'
				const target = table === 'photos_sources' ? 'accounts' : 'contents'
				return `CREATE TRIGGER IF NOT EXISTS photos_read_model_${table}_${event.toLowerCase()}
			AFTER ${event === 'UPDATE' ? `UPDATE OF ${columns}` : event} ON ${table}
			${
				event === 'UPDATE'
					? `WHEN ${columns
							.split(', ')
							.map((column) => `old.${column} IS NOT new.${column}`)
							.join(' OR ')}`
					: ''
			}
			BEGIN ${[...(event !== 'INSERT' ? ['old'] : []), ...(event !== 'DELETE' ? ['new'] : [])]
				.map(
					(row) => `
				INSERT INTO photos_read_model_dirty_${target} VALUES (${row}.account_id ${target === 'contents' ? `, ${row}.content_hash` : ''}) ON CONFLICT DO NOTHING;`,
				)
				.join('\n')}
			END;`
			}),
		)
		.join('\n')
}
