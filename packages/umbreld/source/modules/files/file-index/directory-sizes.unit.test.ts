import nodePath from 'node:path'

import BetterSqlite3 from 'better-sqlite3'
import {afterEach, expect, test} from 'vitest'

import temporaryDirectory from '../../utilities/temporary-directory.js'
import DirectorySizes from './directory-sizes.js'
import {fileIndexMigrations, migrateFileIndex} from './migrations.js'
import {fileIndexQueries} from './queries.js'
import type {IndexedDirectorySize} from '../file-index-engine.js'

const temporary = temporaryDirectory()
const databases: BetterSqlite3.Database[] = []

afterEach(async () => {
	for (const database of databases.splice(0)) if (database.open) database.close()
	await temporary.destroyRoot()
})

function open(path: string, readonly = false) {
	const database = new BetterSqlite3(path, {readonly})
	databases.push(database)
	database.pragma('foreign_keys = ON')
	if (!readonly) database.pragma('journal_mode = WAL')
	return database
}

async function fixture(version?: number) {
	const path = nodePath.join(await temporary.create(), 'index.db')
	const database = open(path)
	await migrateFileIndex(
		database,
		version ? fileIndexMigrations.filter((migration) => migration.version <= version) : undefined,
	)
	database.exec(`INSERT INTO index_roots(id,virtual_path,system_path,owner_id,kind,search_enabled,state,created_at,updated_at)
		VALUES (1,'/Home','/home','owner','home',1,'ready',1,1),
		(2,'/Users/alice','/alice','alice','home',1,'ready',1,1),
		(3,'/Users/alice/Trash','/alice/Trash','alice','trash',1,'ready',1,1)`)
	return {database, path, totals: new DirectorySizes(database)}
}

function put(database: BetterSqlite3.Database, path: string, size = 10, inode = path, rootId = 1, type = 'file') {
	const row = database
		.prepare(
			`INSERT INTO entries(root_id,relative_path,name,type,size,modified_ms,hidden,device,inode)
		VALUES(?,?,?,?,?,1,0,'2049',?) ON CONFLICT(root_id,relative_path) DO UPDATE SET
		type=excluded.type, size=excluded.size, device=excluded.device, inode=excluded.inode RETURNING id`,
		)
		.get(rootId, path, nodePath.posix.basename(path), type, size, inode) as {id: number}
	return row.id
}

function requests(paths = ['', 'a', 'a/b', 'c', 'empty'], rootId = 1, virtualRoot = '/Home', reservedTrash = false) {
	return paths.map((relativePath) => ({
		rootId,
		relativePath,
		virtualPath: relativePath ? `${virtualRoot}/${relativePath}` : virtualRoot,
		reservedTrash,
	}))
}

function check(database: BetterSqlite3.Database) {
	const paths = requests().concat(requests(['', 'a'], 2, '/Users/alice', true), requests([''], 3, '/Users/alice/Trash'))
	expect(fileIndexQueries.directorySizes(database, paths)).toEqual(calculateDirectorySizes(database, paths))
	expect(database.pragma('foreign_key_check')).toEqual([])
}

test('upgrades a populated v20 database and backfills exact totals', async () => {
	const {database} = await fixture(20)
	put(database, 'a', 0, 'dir', 1, 'directory')
	put(database, 'a/first', 7, 'shared')
	put(database, 'a/second', 11, 'shared')
	put(database, 'other', 3)
	put(database, 'Trash/reserved', 1000, 'reserved', 2)
	put(database, 'file', 13, 'shared', 2)
	await migrateFileIndex(database)
	check(database)
	expect(fileIndexQueries.directorySizes(database, requests(['']))).toEqual([{virtualPath: '/Home', size: 14}])
	expect(database.prepare('SELECT * FROM directory_sizes_dirty_entries').all()).toEqual([])
	expect(database.prepare('SELECT * FROM directory_sizes_dirty_roots').all()).toEqual([])
})

test('indexes children before parents without exposing bookkeeping as real directories', async () => {
	const {database, totals} = await fixture()
	put(database, 'a/b/child', 37)
	totals.sync()
	expect(fileIndexQueries.directorySizes(database, requests())).toEqual([{virtualPath: '/Home', size: 37}])
	expect(
		database.prepare('SELECT relative_path,size FROM directory_sizes WHERE root_id=1 ORDER BY relative_path').all(),
	).toEqual([
		{relative_path: '', size: 37},
		{relative_path: 'a', size: 37},
		{relative_path: 'a/b', size: 37},
	])
	put(database, 'a/b', 0, 'directory-b', 1, 'directory')
	put(database, 'a', 0, 'directory-a', 1, 'directory')
	put(database, 'empty', 0, 'directory-empty', 1, 'directory')
	put(database, 'a/b/child', 37) // Duplicate watcher notification.
	totals.sync()
	check(database)
	expect(fileIndexQueries.directorySizes(database, requests(['a/b', 'empty']))).toEqual([
		{virtualPath: '/Home/a/b', size: 37},
		{virtualPath: '/Home/empty', size: 0},
	])
})

test('tracks moves, shrinking hard links, identity changes and deletion of the last link', async () => {
	const {database, totals} = await fixture()
	for (const directory of ['a', 'a/b', 'c']) put(database, directory, 0, directory, 1, 'directory')
	put(database, 'a/first', 10, 'shared')
	put(database, 'a/b/second', 20, 'shared')
	put(database, 'c/third', 30, 'shared')
	totals.sync()
	check(database)
	for (const sql of [
		"UPDATE entries SET size=5 WHERE relative_path='c/third'",
		"UPDATE entries SET relative_path='c/second',name='second' WHERE relative_path='a/b/second'",
		"UPDATE entries SET inode='replacement' WHERE relative_path='a/first'",
		"UPDATE entries SET device='',inode='' WHERE relative_path='c/second'",
		"UPDATE entries SET root_id=2 WHERE relative_path='c/second'",
		"DELETE FROM entries WHERE relative_path='c/third'",
		"DELETE FROM entries WHERE relative_path='a/first'",
		"DELETE FROM entries WHERE type='file'",
	]) {
		database.transaction(() => {
			database.exec(sql)
			totals.sync()
		})()
		check(database)
	}
})

test('preserves zero-size identities, hidden files and unknown identities while ignoring symlinks', async () => {
	const {database, totals} = await fixture()
	put(database, 'a/zero', 0, 'zero')
	put(database, 'a/unknown', 4, '')
	put(database, 'c/unknown', 7, '')
	put(database, 'symlink', 999, 'link', 1, 'symbolic-link')
	database.exec("UPDATE entries SET hidden=1 WHERE relative_path='a/unknown'")
	totals.sync()
	check(database)
	expect(fileIndexQueries.directorySizes(database, requests(['']))[0]?.size).toBe(11)
	expect(database.prepare("SELECT size FROM directory_size_identities WHERE identity='inode:2049:zero'").all()).toEqual(
		[{size: 0}, {size: 0}],
	)
	database.exec("UPDATE entries SET type='directory' WHERE relative_path='a/unknown'")
	totals.sync()
	check(database)
})

test('removes empty folder bookkeeping before a later directory deletion and recreates it on reuse', async () => {
	const {database, totals} = await fixture()
	put(database, 'a', 0, 'directory-a', 1, 'directory')
	put(database, 'a/file', 7)
	put(database, 'a/zero', 0)
	totals.sync()
	const storedSize = database.prepare("SELECT size FROM directory_sizes WHERE root_id=1 AND relative_path='a'")
	expect(storedSize.get()).toEqual({size: 7})

	// A zero-byte file still contributes an identity that maintenance must retain.
	database.transaction(() => {
		database.exec("DELETE FROM entries WHERE root_id=1 AND relative_path='a/file'")
		totals.sync()
	})()
	expect(storedSize.get()).toEqual({size: 0})
	check(database)

	// Removing the last file drops bookkeeping while the directory still exists.
	database.transaction(() => {
		database.exec("DELETE FROM entries WHERE root_id=1 AND relative_path='a/zero'")
		totals.sync()
	})()
	expect(storedSize.get()).toBeUndefined()
	expect(fileIndexQueries.directorySizes(database, requests(['a']))).toEqual([{virtualPath: '/Home/a', size: 0}])
	check(database)

	// A later directory-only deletion produces no file journal to revisit that path.
	database.transaction(() => {
		database.exec("DELETE FROM entries WHERE root_id=1 AND relative_path='a'")
		totals.sync()
	})()
	expect(database.prepare('SELECT * FROM directory_sizes_dirty_entries').all()).toEqual([])
	expect(storedSize.get()).toBeUndefined()
	expect(fileIndexQueries.directorySizes(database, requests(['a']))).toEqual([])
	check(database)

	put(database, 'a', 0, 'replacement-directory-a', 1, 'directory')
	put(database, 'a/new-file', 13)
	totals.sync()
	expect(storedSize.get()).toEqual({size: 13})
	expect(fileIndexQueries.directorySizes(database, requests(['a']))).toEqual([{virtualPath: '/Home/a', size: 13}])
	check(database)
})

test('scopes identities to roots and rebuilds when member Trash exclusion changes', async () => {
	const {database, totals} = await fixture()
	put(database, 'file', 5, 'same', 1)
	put(database, 'file', 7, 'same', 2)
	put(database, 'Trash/file', 900, 'same', 2)
	put(database, 'file', 900, 'same', 3)
	totals.sync()
	check(database)
	expect(fileIndexQueries.directorySizes(database, requests([''], 2, '/Users/alice', true))[0]?.size).toBe(7)
	database.exec("UPDATE index_roots SET virtual_path='/Other' WHERE id=2")
	const changed = requests([''], 2, '/Other', false)
	totals.sync()
	expect(fileIndexQueries.directorySizes(database, changed)).toEqual(calculateDirectorySizes(database, changed))
	expect(fileIndexQueries.directorySizes(database, changed)[0]?.size).toBe(900)
	database.exec("UPDATE index_roots SET virtual_path='/Users/alice' WHERE id=2")
	totals.sync()
	check(database)
	database.exec('DELETE FROM index_roots WHERE id=2')
	totals.sync()
	for (const table of ['directory_sizes', 'directory_sizes_dirty_entries', 'directory_sizes_dirty_roots']) {
		expect(database.prepare(`SELECT * FROM ${table} WHERE root_id=2`).all()).toEqual([])
	}
	expect(database.pragma('foreign_key_check')).toEqual([])
})

test('recovers a legacy pending journal before serving size reads', async () => {
	const {database, path, totals} = await fixture()
	put(database, 'file', 10)
	totals.sync()
	database.exec("UPDATE entries SET size=99 WHERE relative_path='file'")
	database.close()
	const reopened = open(path)
	expect(
		(reopened.prepare("SELECT size FROM directory_sizes WHERE root_id=1 AND relative_path=''").get() as {size: number})
			.size,
	).toBe(10)
	new DirectorySizes(reopened).sync()
	expect(fileIndexQueries.directorySizes(reopened, requests(['']))[0]?.size).toBe(99)
	expect(
		(reopened.prepare("SELECT size FROM directory_sizes WHERE root_id=1 AND relative_path=''").get() as {size: number})
			.size,
	).toBe(99)
	check(reopened)
})

test('failed maintenance rolls back entries, identities, totals and journals together', async () => {
	const {database, totals} = await fixture()
	put(database, 'a/file', 10)
	totals.sync()
	database.exec(`CREATE TEMP TRIGGER fail_totals BEFORE UPDATE ON directory_sizes
		BEGIN SELECT RAISE(ABORT,'injected failure'); END;`)
	const update = database.transaction(() => {
		database.exec("UPDATE entries SET size=99 WHERE relative_path='a/file'")
		totals.sync()
	})
	expect(update).toThrow('injected failure')
	expect(database.prepare('SELECT size FROM entries').get()).toEqual({size: 10})
	expect(database.prepare('SELECT * FROM directory_sizes_dirty_entries').all()).toEqual([])
	expect(database.prepare('SELECT DISTINCT size FROM directory_size_identities').all()).toEqual([{size: 10}])
	check(database)
	database.exec('DROP TRIGGER fail_totals')
	update()
	check(database)
	expect(database.prepare('SELECT * FROM directory_sizes_dirty_entries').all()).toEqual([])
})

test('rolls back entries, journals and totals together and keeps reader snapshots consistent', async () => {
	const {database, path, totals} = await fixture()
	put(database, 'file', 10)
	totals.sync()
	expect(() =>
		database.transaction(() => {
			database.exec('UPDATE entries SET size=500')
			totals.sync()
			throw new Error('rollback')
		})(),
	).toThrow('rollback')
	expect(fileIndexQueries.directorySizes(database, requests(['']))[0]?.size).toBe(10)
	const reader = open(path, true)
	reader.exec('BEGIN')
	expect(fileIndexQueries.directorySizes(reader, requests(['']))[0]?.size).toBe(10)
	database.transaction(() => {
		database.exec('UPDATE entries SET size=99')
		totals.sync()
	})()
	expect(fileIndexQueries.directorySizes(reader, requests(['']))[0]?.size).toBe(10)
	reader.exec('COMMIT')
	expect(fileIndexQueries.directorySizes(reader, requests(['']))[0]?.size).toBe(99)
})

test('readers see matching entries and totals before, during and after maintenance', async () => {
	const {database, path, totals} = await fixture()
	put(database, 'file', 10)
	totals.sync()
	const reader = open(path, true)
	const assertSize = (size: number) => {
		expect(reader.prepare('SELECT size FROM entries').get()).toEqual({size})
		expect(fileIndexQueries.directorySizes(reader, requests(['']))[0]?.size).toBe(size)
		expect(reader.prepare('SELECT * FROM directory_sizes_dirty_entries').all()).toEqual([])
	}
	database.transaction(() => {
		database.exec('UPDATE entries SET size=20')
		assertSize(10)
		totals.sync()
		assertSize(10)
	})()
	assertSize(20)
})

test('does no size maintenance for unrelated metadata or repeated unchanged events', async () => {
	const {database, totals} = await fixture()
	put(database, 'file', 10)
	totals.sync()
	put(database, 'file', 10)
	database.exec("UPDATE entries SET modified_ms=100,hidden=1,hash_error='retry'")
	expect(database.prepare('SELECT * FROM directory_sizes_dirty_entries').all()).toEqual([])
	totals.sync()
	check(database)
})

test('coalesces old and new identities inside repeated entry upserts', async () => {
	const {database, totals} = await fixture()
	put(database, 'file', 10)
	totals.sync()
	put(database, 'file', 20)
	put(database, 'file', 30)
	expect(database.prepare('SELECT * FROM directory_sizes_dirty_entries').all()).toHaveLength(1)
	totals.sync()
	expect(fileIndexQueries.directorySizes(database, requests(['']))[0]?.size).toBe(30)
})

test('bulk backfill and subtree deletion produce the same totals as incremental changes', async () => {
	const {database, totals} = await fixture()
	totals.sync()
	database.transaction(() => {
		for (let i = 0; i < 4200; i++) put(database, `a/b/${i}`, i % 37, String(i % 200))
		totals.sync()
	})()
	check(database)
	database.transaction(() => {
		database.exec("DELETE FROM entries WHERE relative_path >= 'a/' AND relative_path < 'a0'")
		totals.sync()
	})()
	check(database)
	expect(database.prepare('SELECT * FROM directory_size_identities').all()).toEqual([])
})

test('mixed out-of-order batches stay equivalent to the original query', async () => {
	const {database, totals} = await fixture()
	for (const directory of ['a', 'a/b', 'c', 'empty']) put(database, directory, 0, directory, 1, 'directory')
	let random = 12345
	const next = () => {
		random = (Math.imul(random, 1664525) + 1013904223) >>> 0
		return random
	}
	for (let batch = 0; batch < 100; batch++) {
		database.transaction(() => {
			for (let i = 0; i < 10; i++) {
				const root = 1 + (next() % 3),
					path = `${['a', 'a/b', 'c', 'missing/parent', 'Trash'][next() % 5]}/${next() % 40}`
				if (next() % 4 === 0)
					database.prepare('DELETE FROM entries WHERE root_id=? AND relative_path=?').run(root, path)
				else put(database, path, next() % 1000, next() % 7 === 0 ? '' : String(next() % 25), root)
			}
			totals.sync()
		})()
		check(database)
	}
})

// Original aggregation retained only as a test oracle.
function calculateDirectorySizes(
	database: BetterSqlite3.Database,
	paths: ReturnType<typeof requests>,
): IndexedDirectorySize[] {
	if (paths.length === 0) return []

	const directory = database.prepare(`SELECT type FROM entries WHERE root_id = ? AND relative_path = ?`)
	const rootSize = database.prepare(
		`SELECT COALESCE(SUM(size), 0) AS size
				FROM (
					SELECT MAX(size) AS size
					FROM entries
					WHERE root_id = ? AND type = 'file'
						AND (? = 0 OR (relative_path != 'Trash' AND relative_path NOT GLOB 'Trash/*'))
					GROUP BY CASE
						WHEN device = '' OR inode = '' THEN 'entry:' || id
						ELSE 'inode:' || device || ':' || inode
					END
				)`,
	)
	const subtreeSize = database.prepare(
		`SELECT COALESCE(SUM(size), 0) AS size
				FROM (
					SELECT MAX(size) AS size
					FROM entries
					WHERE root_id = ? AND type = 'file'
						AND relative_path >= ? AND relative_path < ?
					GROUP BY CASE
						WHEN device = '' OR inode = '' THEN 'entry:' || id
						ELSE 'inode:' || device || ':' || inode
					END
				)`,
	)

	const sizes: IndexedDirectorySize[] = []
	for (const {virtualPath, rootId, relativePath, reservedTrash} of paths) {
		if (relativePath) {
			const row = directory.get(rootId, relativePath) as {type: string} | undefined
			if (row?.type !== 'directory') continue
		}

		const row = (
			relativePath
				? subtreeSize.get(rootId, `${relativePath}/`, `${relativePath}0`)
				: rootSize.get(rootId, Number(reservedTrash))
		) as {size: number}
		sizes.push({virtualPath, size: Number(row.size)})
	}
	return sizes
}
