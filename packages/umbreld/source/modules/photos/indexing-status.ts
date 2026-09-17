import type DatabaseTypes from 'better-sqlite3'

import {sourceScopeSql} from './library-sql.js'

type Database = DatabaseTypes.Database
type Account = {account_id: string; scope_mode: string | null; scope_paths: string | null; rebuild: number}
const BATCH_SIZE = 200

// Count unique content, not file copies or visible logical items. Unhashed
// entries are separate work until they acquire a shared content identity.
function workSql(predicate: string) {
	return `SELECT index_roots.owner_id,
		COALESCE(entries.content_id, -entries.id) AS work_id,
		COALESCE(MAX(entries.content_id IS NOT NULL AND media_metadata.state = 'ready'
			AND (SELECT COUNT(*) FROM thumbnail_variants
				WHERE thumbnail_variants.content_id = entries.content_id
					AND thumbnail_variants.variant IN ('preview-192-webp-v1', 'preview-512-webp-v2', 'preview-1280-webp-v2')
					AND thumbnail_variants.state = 'ready') = 3), 0),
		COALESCE(MAX(entries.hash_error IS NOT NULL OR media_metadata.state = 'failed'
			OR EXISTS (SELECT 1 FROM thumbnail_variants
				WHERE thumbnail_variants.content_id = entries.content_id
					AND thumbnail_variants.variant IN ('preview-192-webp-v1', 'preview-512-webp-v2', 'preview-1280-webp-v2')
					AND thumbnail_variants.state = 'failed')), 0)
		FROM index_roots
		JOIN entries ON entries.root_id = index_roots.id
		JOIN umbrel.photos_sources AS photos_source ON photos_source.account_id = index_roots.owner_id
			AND photos_source.type = 'umbrel'
		LEFT JOIN media_metadata ON media_metadata.content_id = entries.content_id
		WHERE index_roots.owner_id = ? AND index_roots.kind = 'home'
			AND entries.type = 'file' AND entries.hidden = 0 AND entries.thumbnail_identity_kind = 'content'
			AND (entries.content_id IS NULL OR media_metadata.content_id IS NOT NULL)
			AND ${sourceScopeSql('photos_source')} AND (${predicate})
		GROUP BY work_id`
}

export default class PhotosIndexingStatus {
	// Progress notifications drain this journal in batches. Repeated reads reuse
	// counters; a burst of changes to one content ID is reconciled only once.
	// Scope values are stored with the counts in index.db and compared with the
	// durable source. This also detects scope changes across split WAL commits,
	// without writing to umbrel.db on each thumbnail completion.
	sync(database: Database) {
		const accounts = database
			.prepare(
				`
			SELECT source.account_id, source.scope_mode, source.scope_paths,
				counts.account_id IS NULL OR counts.scope_mode IS NOT source.scope_mode
					OR counts.scope_paths IS NOT source.scope_paths
					OR dirty.account_id IS NOT NULL AS rebuild
			FROM umbrel.photos_sources AS source
			LEFT JOIN photos_indexing_counts AS counts ON counts.account_id = source.account_id
			LEFT JOIN photos_indexing_dirty_accounts AS dirty ON dirty.account_id = source.account_id
			WHERE source.type = 'umbrel'
				AND EXISTS (SELECT 1 FROM index_roots WHERE owner_id = source.account_id AND kind = 'home')
		`,
			)
			.all() as Account[]
		const orphaned = database
			.prepare(
				`SELECT account_id FROM photos_indexing_counts AS counts
			WHERE NOT EXISTS (SELECT 1 FROM index_roots WHERE owner_id = counts.account_id AND kind = 'home')
				OR NOT EXISTS (SELECT 1 FROM umbrel.photos_sources WHERE account_id = counts.account_id AND type = 'umbrel')
		`,
			)
			.all() as Array<{account_id: string}>
		const pending = database
			.prepare(
				`SELECT 1 FROM photos_indexing_dirty_work
			UNION ALL SELECT 1 FROM photos_indexing_dirty_accounts LIMIT 1`,
			)
			.get()
		if (!pending && orphaned.length === 0 && accounts.every(({rebuild}) => !rebuild)) return

		database
			.transaction(() => {
				for (const {account_id} of orphaned)
					database.prepare('DELETE FROM photos_indexing_counts WHERE account_id = ?').run(account_id)
				const dirty = database.prepare('SELECT work_id FROM photos_indexing_dirty_work').all() as Array<{
					work_id: number
				}>
				const batches: number[][] = []
				for (let offset = 0; offset < dirty.length; offset += BATCH_SIZE) {
					const ids = dirty.slice(offset, offset + BATCH_SIZE).map(({work_id}) => work_id)
					batches.push(ids)
					database
						.prepare(`DELETE FROM photos_indexing_work WHERE work_id IN (${ids.map(() => '?').join(',')})`)
						.run(...ids)
				}
				for (const account of accounts) {
					if (account.rebuild) {
						database.prepare('DELETE FROM photos_indexing_work WHERE account_id = ?').run(account.account_id)
						database
							.prepare(
								`INSERT INTO photos_indexing_counts(account_id, scope_mode, scope_paths) VALUES (?, ?, ?)
						ON CONFLICT(account_id) DO UPDATE SET scope_mode = excluded.scope_mode, scope_paths = excluded.scope_paths
					`,
							)
							.run(account.account_id, account.scope_mode, account.scope_paths)
						database.prepare(`INSERT INTO photos_indexing_work ${workSql('1')}`).run(account.account_id)
						continue
					}
					for (const ids of batches) {
						const contents = ids.filter((id) => id >= 0)
						const entries = ids.filter((id) => id < 0).map((id) => -id)
						const predicates = [
							...(contents.length ? [`entries.content_id IN (${contents.map(() => '?').join(',')})`] : []),
							...(entries.length
								? [`(entries.content_id IS NULL AND entries.id IN (${entries.map(() => '?').join(',')}))`]
								: []),
						]
						database
							.prepare(`INSERT INTO photos_indexing_work ${workSql(predicates.join(' OR '))}`)
							.run(account.account_id, ...contents, ...entries)
					}
				}
				database.exec('DELETE FROM photos_indexing_dirty_work; DELETE FROM photos_indexing_dirty_accounts;')
			})
			.immediate()
	}

	counts(database: Database, accountId: string, synchronize = true) {
		if (synchronize) this.sync(database)
		return (
			(database
				.prepare('SELECT total, completed, failures FROM photos_indexing_counts WHERE account_id = ?')
				.get(accountId) as {total: number; completed: number; failures: number} | undefined) ?? {
				total: 0,
				completed: 0,
				failures: 0,
			}
		)
	}
}
