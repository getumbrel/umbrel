import type BetterSqlite3 from 'better-sqlite3'

type Database = BetterSqlite3.Database
type Entry = {entry_id: number; root_id: number; relative_path: string; device: string; inode: string; size: number}
type DirtyEntry = Omit<Entry, 'size'> & {identity: string}
type Root = {id: number; kind: string; owner_id: string; virtual_path: string}

const identitySql = (row: string) => `CASE WHEN ${row}.device = '' OR ${row}.inode = ''
	THEN 'entry:' || ${row}.id ELSE 'inode:' || ${row}.device || ':' || ${row}.inode END`

// SQL triggers collect changed identities for batched maintenance. The engine
// drains them before committing each mutation, so entries and totals are atomic.
// Startup drains journals left by older builds before starting reader workers.
export function createDirectorySizes(database: Database) {
	const record = (row: string) => `INSERT INTO directory_sizes_dirty_entries
		SELECT ${row}.root_id, ${row}.relative_path, ${identitySql(row)}, ${row}.id, ${row}.device, ${row}.inode
		WHERE ${row}.type = 'file' AND EXISTS (SELECT 1 FROM index_roots WHERE id = ${row}.root_id) ON CONFLICT DO NOTHING;`
	const columns = ['id', 'root_id', 'relative_path', 'type', 'size', 'device', 'inode']
	database.exec(`
		CREATE TABLE directory_sizes (
			id INTEGER PRIMARY KEY,
			root_id INTEGER NOT NULL REFERENCES index_roots(id) ON DELETE CASCADE,
			relative_path TEXT NOT NULL,
			size INTEGER NOT NULL DEFAULT 0,
			UNIQUE(root_id, relative_path)
		);
		CREATE TABLE directory_size_identities (
			directory_id INTEGER NOT NULL REFERENCES directory_sizes(id) ON DELETE CASCADE,
			identity TEXT NOT NULL,
			size INTEGER NOT NULL,
			PRIMARY KEY(directory_id, identity)
		) WITHOUT ROWID;
		CREATE INDEX entries_by_size_identity ON entries(root_id, device, inode, relative_path, size) WHERE type = 'file';
		CREATE TABLE directory_sizes_dirty_entries (
			root_id INTEGER NOT NULL REFERENCES index_roots(id) ON DELETE CASCADE,
			relative_path TEXT NOT NULL,
			identity TEXT NOT NULL,
			entry_id INTEGER NOT NULL,
			device TEXT NOT NULL,
			inode TEXT NOT NULL,
			PRIMARY KEY(root_id, relative_path, identity)
		) WITHOUT ROWID;
		CREATE TABLE directory_sizes_dirty_roots (
			root_id INTEGER PRIMARY KEY REFERENCES index_roots(id) ON DELETE CASCADE
		);
		CREATE TRIGGER directory_sizes_entry_insert AFTER INSERT ON entries BEGIN ${record('new')} END;
		CREATE TRIGGER directory_sizes_entry_delete AFTER DELETE ON entries BEGIN ${record('old')} END;
		CREATE TRIGGER directory_sizes_entry_update AFTER UPDATE OF ${columns.join(',')} ON entries
		WHEN ${columns.map((column) => `old.${column} IS NOT new.${column}`).join(' OR ')}
		BEGIN ${record('old')} ${record('new')} END;
		CREATE TRIGGER directory_sizes_root_insert AFTER INSERT ON index_roots BEGIN
			INSERT INTO directory_sizes_dirty_roots VALUES(new.id) ON CONFLICT DO NOTHING;
		END;
		CREATE TRIGGER directory_sizes_root_update AFTER UPDATE OF owner_id, kind, virtual_path ON index_roots
		WHEN old.owner_id IS NOT new.owner_id OR old.kind IS NOT new.kind OR old.virtual_path IS NOT new.virtual_path
		BEGIN INSERT INTO directory_sizes_dirty_roots VALUES(new.id) ON CONFLICT DO NOTHING; END;
		INSERT INTO directory_sizes_dirty_roots SELECT id FROM index_roots;
	`)
	new DirectorySizes(database).sync()
}

function ancestorPaths(relativePath: string) {
	const paths = ['']
	for (let slash = relativePath.indexOf('/'); slash !== -1; slash = relativePath.indexOf('/', slash + 1)) {
		paths.push(relativePath.slice(0, slash))
	}
	return paths
}

function included(root: Root, relativePath: string) {
	return !(
		root.kind === 'home' &&
		root.virtual_path === `/Users/${root.owner_id}` &&
		(relativePath === 'Trash' || relativePath.startsWith('Trash/'))
	)
}

function identity(entry: Entry) {
	return entry.device === '' || entry.inode === '' ? `entry:${entry.entry_id}` : `inode:${entry.device}:${entry.inode}`
}

export default class DirectorySizes {
	#database: Database
	#statements = new Map<string, BetterSqlite3.Statement>()

	constructor(database: Database) {
		this.#database = database
	}

	#prepare(sql: string) {
		let statement = this.#statements.get(sql)
		if (!statement) {
			statement = this.#database.prepare(sql)
			this.#statements.set(sql, statement)
		}
		return statement
	}

	sync() {
		if (
			!this.#prepare(
				`SELECT 1 FROM directory_sizes_dirty_roots
				UNION ALL SELECT 1 FROM directory_sizes_dirty_entries LIMIT 1`,
			).get()
		)
			return

		this.#database
			.transaction(() => {
				const roots = new Map(
					(this.#prepare('SELECT id, kind, owner_id, virtual_path FROM index_roots').all() as Root[]).map((root) => [
						root.id,
						root,
					]),
				)
				// Rebuild large journals; normal 256-entry scan batches stay incremental.
				// The fixed cutoff is deliberately simple: deleting 5,000 files can
				// rebuild a much larger root even when incremental work would be cheaper.
				// This synchronous rebuild also delays dispatching reads to the readers;
				// its 1,024-row batches bound memory but do not yield execution. If large
				// roots with bulk changes become common, benchmark a root-size-aware cutoff.
				const rebuilds = this.#prepare(
					`SELECT root_id FROM directory_sizes_dirty_roots
				UNION SELECT root_id FROM directory_sizes_dirty_entries GROUP BY root_id HAVING COUNT(*) > 4096`,
				).all() as Array<{root_id: number}>
				for (const {root_id: rootId} of rebuilds) {
					const root = roots.get(rootId)
					if (root) this.#rebuild(root)
					this.#prepare('DELETE FROM directory_sizes_dirty_entries WHERE root_id = ?').run(rootId)
				}

				const pending = this.#prepare('SELECT * FROM directory_sizes_dirty_entries').all() as DirtyEntry[]
				const directories = new Map<string, number>()
				const groups = new Map<string, {entry: DirtyEntry; paths: Set<string>}>()
				for (const entry of pending) {
					const root = roots.get(entry.root_id)
					if (!root || !included(root, entry.relative_path)) continue
					const key = `${entry.root_id}:${entry.identity}`
					let group = groups.get(key)
					if (!group) {
						group = {entry, paths: new Set()}
						groups.set(key, group)
					}
					for (const path of ancestorPaths(entry.relative_path)) group.paths.add(path)
				}
				const deltas = new Map<number, number>()
				for (const {entry, paths} of groups.values()) {
					const root = roots.get(entry.root_id)!
					const aliases = (
						entry.device === '' || entry.inode === ''
							? this.#prepare(
									`SELECT id AS entry_id, root_id, relative_path, device, inode, size FROM entries
							WHERE id = ? AND root_id = ? AND type = 'file' AND (device = '' OR inode = '')`,
								).all(entry.entry_id, entry.root_id)
							: this.#prepare(
									`SELECT id AS entry_id, root_id, relative_path, device, inode, size FROM entries
							WHERE root_id = ? AND device = ? AND inode = ? AND type = 'file'`,
								).all(entry.root_id, entry.device, entry.inode)
					) as Entry[]
					for (const path of paths) {
						const directoryId = this.#directory(root.id, path, directories)
						const previous = this.#prepare(
							'SELECT size FROM directory_size_identities WHERE directory_id = ? AND identity = ?',
						).get(directoryId, entry.identity) as {size: number} | undefined
						let size: number | undefined
						for (const alias of aliases) {
							if (included(root, alias.relative_path) && (path === '' || alias.relative_path.startsWith(`${path}/`))) {
								size = Math.max(size ?? 0, alias.size)
							}
						}
						if (size === previous?.size) continue
						if (size === undefined) {
							this.#prepare('DELETE FROM directory_size_identities WHERE directory_id = ? AND identity = ?').run(
								directoryId,
								entry.identity,
							)
						} else {
							this.#prepare(
								`INSERT INTO directory_size_identities VALUES(?, ?, ?)
							ON CONFLICT(directory_id, identity) DO UPDATE SET size = excluded.size`,
							).run(directoryId, entry.identity, size)
						}
						deltas.set(directoryId, (deltas.get(directoryId) ?? 0) + (size ?? 0) - (previous?.size ?? 0))
					}
				}
				for (const [id, delta] of deltas) {
					if (delta) this.#prepare('UPDATE directory_sizes SET size = size + ? WHERE id = ?').run(delta, id)
				}
				// Drop bookkeeping as soon as its last file identity is removed. Waiting
				// for directory deletion would leak rows: directory changes aren't journaled.
				// Empty directories read as zero without a row; zero-byte files keep identities.
				for (const id of directories.values()) {
					this.#prepare(
						`DELETE FROM directory_sizes WHERE id = ? AND relative_path != ''
					AND NOT EXISTS (SELECT 1 FROM directory_size_identities WHERE directory_id = directory_sizes.id)`,
					).run(id)
				}
				this.#database.exec('DELETE FROM directory_sizes_dirty_entries; DELETE FROM directory_sizes_dirty_roots')
			})
			.immediate()
	}

	#directory(rootId: number, relativePath: string, cache: Map<string, number>): number {
		const key = `${rootId}:${relativePath}`
		const cached = cache.get(key)
		if (cached !== undefined) return cached
		const existing = this.#prepare('SELECT id FROM directory_sizes WHERE root_id = ? AND relative_path = ?').get(
			rootId,
			relativePath,
		) as {id: number} | undefined
		if (existing) {
			cache.set(key, existing.id)
			return existing.id
		}
		// Files can arrive before any ancestor directory event. These rows only
		// describe aggregation ancestry; they never authorize or list a path.
		const id = Number(
			this.#prepare('INSERT INTO directory_sizes(root_id, relative_path) VALUES(?, ?)').run(rootId, relativePath)
				.lastInsertRowid,
		)
		cache.set(key, id)
		return id
	}

	#rebuild(root: Root) {
		this.#prepare('DELETE FROM directory_sizes WHERE root_id = ?').run(root.id)
		const directories = new Map<string, number>()
		this.#directory(root.id, '', directories)
		// Bound transient memory during upgrade/recovery. Keyset pagination uses
		// the existing (root_id, relative_path) index without loading every file.
		let after = ''
		while (true) {
			const rows = this.#prepare(
				`SELECT id AS entry_id, root_id, relative_path, device, inode, size
				FROM entries WHERE root_id = ? AND relative_path > ? AND type = 'file'
				ORDER BY relative_path LIMIT 1024`,
			).all(root.id, after) as Entry[]
			if (rows.length === 0) break
			for (const entry of rows) {
				if (!included(root, entry.relative_path)) continue
				for (const path of ancestorPaths(entry.relative_path)) {
					const directoryId = this.#directory(root.id, path, directories)
					this.#prepare(
						`INSERT INTO directory_size_identities VALUES(?, ?, ?)
					ON CONFLICT(directory_id, identity) DO UPDATE SET size = MAX(size, excluded.size)`,
					).run(directoryId, identity(entry), entry.size)
				}
			}
			after = rows.at(-1)!.relative_path
		}
		this.#prepare(
			`UPDATE directory_sizes SET size = (
			SELECT COALESCE(SUM(size), 0) FROM directory_size_identities WHERE directory_id = directory_sizes.id
		) WHERE root_id = ?`,
		).run(root.id)
	}
}
