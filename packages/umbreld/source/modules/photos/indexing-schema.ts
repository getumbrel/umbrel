// These counters and their journal are disposable. Mutations record dirty work
// in index.db, so an interrupted callback cannot lose an indexing-status update.
export function photosIndexingSchema() {
	const recordEntry = (row: string) => `
		INSERT INTO photos_indexing_dirty_work
		SELECT COALESCE(${row}.content_id, -${row}.id)
		WHERE ${row}.type = 'file' AND ${row}.hidden = 0 AND ${row}.thumbnail_identity_kind = 'content'
			AND EXISTS (SELECT 1 FROM index_roots WHERE id = ${row}.root_id AND kind = 'home') ON CONFLICT DO NOTHING;`
	const entryColumns = [
		'id',
		'root_id',
		'content_id',
		'type',
		'hidden',
		'thumbnail_identity_kind',
		'relative_path',
		'hash_error',
	]
	return `
	CREATE TABLE photos_indexing_counts (
		account_id TEXT PRIMARY KEY NOT NULL,
		scope_mode TEXT,
		scope_paths TEXT,
		total INTEGER NOT NULL DEFAULT 0,
		completed INTEGER NOT NULL DEFAULT 0,
		failures INTEGER NOT NULL DEFAULT 0
	) WITHOUT ROWID;
	CREATE TABLE photos_indexing_work (
		account_id TEXT NOT NULL REFERENCES photos_indexing_counts(account_id) ON DELETE CASCADE,
		work_id INTEGER NOT NULL,
		completed INTEGER NOT NULL,
		failed INTEGER NOT NULL,
		PRIMARY KEY(account_id, work_id)
	) WITHOUT ROWID;
	CREATE INDEX photos_indexing_work_by_id ON photos_indexing_work(work_id, account_id);
	CREATE TABLE photos_indexing_dirty_work (work_id INTEGER PRIMARY KEY);
	CREATE TABLE photos_indexing_dirty_accounts (account_id TEXT PRIMARY KEY NOT NULL) WITHOUT ROWID;
	CREATE TRIGGER photos_indexing_work_insert AFTER INSERT ON photos_indexing_work BEGIN
		UPDATE photos_indexing_counts SET total = total + 1,
			completed = completed + new.completed, failures = failures + new.failed
		WHERE account_id = new.account_id;
	END;
	CREATE TRIGGER photos_indexing_work_delete AFTER DELETE ON photos_indexing_work BEGIN
		UPDATE photos_indexing_counts SET total = total - 1,
			completed = completed - old.completed, failures = failures - old.failed
		WHERE account_id = old.account_id;
	END;
	CREATE TRIGGER photos_indexing_entry_insert AFTER INSERT ON entries BEGIN ${recordEntry('new')} END;
	CREATE TRIGGER photos_indexing_entry_delete BEFORE DELETE ON entries BEGIN ${recordEntry('old')} END;
	CREATE TRIGGER photos_indexing_entry_update BEFORE UPDATE OF ${entryColumns.join(',')} ON entries
	WHEN ${entryColumns.map((column) => `old.${column} IS NOT new.${column}`).join(' OR ')}
	BEGIN ${recordEntry('old')} ${recordEntry('new')} END;
	${['media_metadata', 'thumbnail_variants']
		.flatMap((table) => {
			const columns = table === 'media_metadata' ? ['content_id', 'state'] : ['content_id', 'variant', 'state']
			return ['INSERT', 'UPDATE', 'DELETE'].map(
				(event) => `
		CREATE TRIGGER photos_indexing_${table}_${event.toLowerCase()}
		${event === 'DELETE' ? 'BEFORE' : 'AFTER'} ${event === 'UPDATE' ? `UPDATE OF ${columns.join(',')}` : event} ON ${table}
		${event === 'UPDATE' ? `WHEN ${columns.map((column) => `old.${column} IS NOT new.${column}`).join(' OR ')}` : ''}
		BEGIN ${[...(event !== 'INSERT' ? ['old'] : []), ...(event !== 'DELETE' ? ['new'] : [])]
			.map(
				(row) => `
			INSERT INTO photos_indexing_dirty_work SELECT ${row}.content_id
			${table === 'thumbnail_variants' ? `WHERE ${row}.variant IN ('preview-192-webp-v1', 'preview-512-webp-v2', 'preview-1280-webp-v2')` : 'WHERE 1'} ON CONFLICT DO NOTHING;`,
			)
			.join('\n')}
		END;`,
			)
		})
		.join('\n')}
	${['INSERT', 'UPDATE', 'DELETE']
		.map(
			(event) => `
	CREATE TRIGGER photos_indexing_root_${event.toLowerCase()}
	${event === 'INSERT' ? 'AFTER' : 'BEFORE'} ${event === 'UPDATE' ? 'UPDATE OF id, owner_id, kind, virtual_path' : event} ON index_roots
	${event === 'UPDATE' ? 'WHEN old.id IS NOT new.id OR old.owner_id IS NOT new.owner_id OR old.kind IS NOT new.kind OR old.virtual_path IS NOT new.virtual_path' : ''}
	BEGIN ${[...(event !== 'INSERT' ? ['old'] : []), ...(event !== 'DELETE' ? ['new'] : [])]
		.map(
			(row) => `
		INSERT INTO photos_indexing_dirty_accounts SELECT ${row}.owner_id WHERE ${row}.kind = 'home' ON CONFLICT DO NOTHING;`,
		)
		.join('\n')}
	END;`,
		)
		.join('\n')}
	`
}
