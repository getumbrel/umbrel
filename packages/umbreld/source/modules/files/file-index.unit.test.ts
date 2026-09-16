import nodePath from 'node:path'
import {appendFile, chmod, link, lstat, readFile, symlink, utimes, writeFile} from 'node:fs/promises'

import BetterSqlite3 from 'better-sqlite3'
import fse from 'fs-extra'
import pRetry from 'p-retry'
import {afterEach, describe, expect, test, vi} from 'vitest'

import {migratePhotos} from '../photos/migrations.js'
import {PHOTO_EXTENSIONS, VIDEO_EXTENSIONS} from '../photos/types.js'
import temporaryDirectory from '../utilities/temporary-directory.js'
import FileIndex, {
	walkFileTree,
	type FileIndexEngineOptions,
	type FileIndexRoot,
	type WatcherChange,
} from './file-index-engine.js'
import {
	FILE_INDEX_SCHEMA_VERSION,
	fileIndexMigrations,
	filenameStemSql,
	migrateFileIndex,
	type FileIndexMigration,
} from './file-index/migrations.js'
import {THUMBNAIL_GENERATION_TIMEOUT_MS} from './file-index-enrichment.js'
import {
	PHOTOS_THUMBNAIL_VARIANTS,
	THUMBNAIL_VARIANT,
	thumbnailSystemPath,
	type ThumbnailIdentity,
} from './thumbnail-support.js'

const temporary = temporaryDirectory()
const indexes: FileIndex[] = []

const logger = {
	log: vi.fn(),
	verbose: vi.fn(),
	error: vi.fn(),
}

async function contentRevision(systemPath: string) {
	const stats = await lstat(systemPath, {bigint: true})
	return {
		inode: stats.ino.toString(),
		size: Number(stats.size),
		modifiedNs: stats.mtimeNs.toString(),
		ctimeNs: stats.ctimeNs.toString(),
	}
}

async function indexedContentRevision(systemPath: string) {
	const stats = await lstat(systemPath, {bigint: true})
	return {device: stats.dev.toString(), ...(await contentRevision(systemPath))}
}

afterEach(async () => {
	await Promise.all(indexes.splice(0).map((index) => index.stop()))
	await temporary.destroyRoot()
	vi.clearAllMocks()
})

async function fixture(
	walkTree?: FileIndexEngineOptions['walkTree'],
	options: Partial<
		Pick<
			FileIndexEngineOptions,
			| 'reconciliationIntervalMs'
			| 'watcherBulkThreshold'
			| 'batchSize'
			| 'enrichmentRuntime'
			| 'onPhotosChange'
			| 'onPhotosIndexingProgress'
		>
	> & {includeTrash?: boolean} = {},
) {
	const {enrichmentRuntime, includeTrash = false, ...engineOptions} = options
	const rootDirectory = await temporary.create()
	const dataDirectory = await temporary.create()
	const homeDirectory = nodePath.join(rootDirectory, 'home')
	const trashDirectory = nodePath.join(rootDirectory, 'trash')
	await Promise.all([fse.ensureDir(homeDirectory), fse.ensureDir(trashDirectory)])

	const index = new FileIndex({
		dataDirectory,
		logger,
		isHidden: (name) => name.startsWith('.') || name.endsWith('.umbrel-upload') || name.endsWith('.umbrel-trash'),
		walkTree,
		...engineOptions,
		enrichmentRuntime: {
			availableParallelism: 1,
			extractMediaMetadata: async (systemPath) => ({
				kind: ['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.3gp'].includes(
					nodePath.extname(systemPath).toLowerCase(),
				)
					? 'video'
					: 'photo',
				takenAt: 1,
				createdAt: 1,
				width: 1,
				height: 1,
			}),
			extractThumbnailTint: async () => 0x112233,
			...enrichmentRuntime,
		},
	})
	indexes.push(index)
	await index.start()

	const root: FileIndexRoot = {
		virtualPath: '/Home',
		systemPath: homeDirectory,
		ownerId: 'owner',
		kind: 'home',
		searchEnabled: true,
	}
	const trashRoot: FileIndexRoot = {
		virtualPath: '/Trash',
		systemPath: trashDirectory,
		ownerId: 'owner',
		kind: 'trash',
		searchEnabled: false,
	}
	await index.setRoots(includeTrash ? [root, trashRoot] : [root])
	return {index, root, trashRoot, rootDirectory, dataDirectory, homeDirectory, trashDirectory}
}

async function candidateNames(index: FileIndex, query: string, maxResults = 100) {
	return (await index.searchCandidates('/Home', query, maxResults)).map(({name}) => name).sort()
}

test('uses one durable Umbrel database and a separate disposable file index', async () => {
	const {index, dataDirectory} = await fixture()
	expect(index.databasePath).toBe(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	expect(index.umbrelDatabasePath).toBe(nodePath.join(dataDirectory, 'umbrel.db'))
	await expect(fse.pathExists(index.databasePath)).resolves.toBe(true)
	await expect(fse.pathExists(index.umbrelDatabasePath)).resolves.toBe(true)
	await expect(fse.pathExists(nodePath.join(dataDirectory, 'file-index', 'index.sqlite3'))).resolves.toBe(false)
	await expect(fse.pathExists(nodePath.join(dataDirectory, 'photos', 'photos.sqlite3'))).resolves.toBe(false)
})

test('creates a standalone point-in-time backup of the live WAL-mode Umbrel database', async () => {
	const {index, dataDirectory} = await fixture()
	await index.initializePhotos('owner')
	const album = await index.photosCreateAlbum('owner', 'Before backup')
	await expect(fse.pathExists(`${index.umbrelDatabasePath}-wal`)).resolves.toBe(true)
	await expect(fse.pathExists(`${index.umbrelDatabasePath}-shm`)).resolves.toBe(true)

	const backupPath = nodePath.join(dataDirectory, '.umbrel-backup', 'umbrel.db')
	const backup = index.createUmbrelDatabaseBackup(backupPath)
	const laterMutation = index.photosRenameAlbum('owner', album.id, 'After backup')
	await Promise.all([backup, laterMutation])

	await expect(fse.pathExists(backupPath)).resolves.toBe(true)
	await expect(fse.pathExists(`${backupPath}-wal`)).resolves.toBe(false)
	await expect(fse.pathExists(`${backupPath}-shm`)).resolves.toBe(false)
	const snapshot = new BetterSqlite3(backupPath, {readonly: true})
	expect(snapshot.pragma('quick_check', {simple: true})).toBe('ok')
	expect(snapshot.prepare('SELECT name FROM photos_albums WHERE id = ?').get(album.id)).toStrictEqual({
		name: 'Before backup',
	})
	snapshot.close()

	await expect(index.photosListAlbums('owner')).resolves.toContainEqual(
		expect.objectContaining({id: album.id, name: 'After backup'}),
	)
})

test('repairs a split attached-database WAL commit on restart', async () => {
	const runtime = {
		availableParallelism: 1,
		hashFile: async (systemPath: string) =>
			Buffer.alloc(32, nodePath.basename(systemPath) === 'kept.jpg' ? 0xc1 : 0xc2),
		generateThumbnail: async (_source: string, destination: string) => fse.outputFile(destination, 'thumbnail'),
		extractMediaMetadata: async (systemPath: string) => ({
			kind: 'photo' as const,
			takenAt: nodePath.basename(systemPath) === 'kept.jpg' ? 1_000 : 2_000,
			createdAt: 500,
			width: 100,
			height: 50,
		}),
	}
	const {index, root, homeDirectory, dataDirectory} = await fixture(undefined, {enrichmentRuntime: runtime})
	const kept = nodePath.join(homeDirectory, 'kept.jpg')
	const removed = nodePath.join(homeDirectory, 'removed.jpg')
	await Promise.all([writeFile(kept, 'kept'), writeFile(removed, 'removed')])
	await index.reconcileRoot('/Home', 'split-commit-initial')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	await expect(index.photosListItems('owner', {}, undefined, 10)).resolves.toMatchObject({total: 2})

	// Restoring only the durable side after a later cross-database commit models
	// the split outcome SQLite permits if a WAL-mode host crashes during COMMIT.
	const durableSnapshot = nodePath.join(dataDirectory, 'umbrel-before-delete.db')
	await index.createUmbrelDatabaseBackup(durableSnapshot)
	await fse.remove(removed)
	await index.removePath(removed)
	await expect(index.photosListItems('owner', {}, undefined, 10)).resolves.toMatchObject({total: 1})
	await index.stop()
	await Promise.all([fse.remove(`${index.umbrelDatabasePath}-wal`), fse.remove(`${index.umbrelDatabasePath}-shm`)])
	await fse.copy(durableSnapshot, index.umbrelDatabasePath, {overwrite: true})

	const restarted = new FileIndex({dataDirectory, logger, isHidden: () => false, enrichmentRuntime: runtime})
	indexes.push(restarted)
	await restarted.start()
	await restarted.setRoots([root])
	await expect(restarted.photosListItems('owner', {}, undefined, 10)).resolves.toMatchObject({
		total: 1,
		items: [expect.objectContaining({id: Buffer.alloc(32, 0xc1).toString('hex')})],
	})
	await expect(restarted.photosListItems('owner', {kind: 'photo'}, undefined, 10)).resolves.toMatchObject({total: 1})
	const disposable = new BetterSqlite3(restarted.databasePath, {readonly: true})
	const durable = new BetterSqlite3(restarted.umbrelDatabasePath, {readonly: true})
	expect(disposable.prepare('SELECT generation FROM photos_projection_state WHERE id = 1').get()).toStrictEqual(
		durable.prepare('SELECT generation FROM photos_projection_state WHERE id = 1').get(),
	)
	disposable.close()
	durable.close()
})

function noteWatcherChanges(index: FileIndex, paths: string[], type: WatcherChange['type'] = 'create') {
	index.noteWatcherChanges(
		'/Home',
		paths.map((path) => ({path, type})),
	)
}

function contentIdentity(key: string): ThumbnailIdentity {
	return {kind: 'content', key, variant: THUMBNAIL_VARIANT}
}

describe('file index migrations', () => {
	test('migrates fresh and already-migrated databases', async () => {
		const database = new BetterSqlite3(':memory:')
		await expect(migrateFileIndex(database)).resolves.toBe(FILE_INDEX_SCHEMA_VERSION)
		await expect(migrateFileIndex(database)).resolves.toBe(FILE_INDEX_SCHEMA_VERSION)
		expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toMatchObject({
			count: FILE_INDEX_SCHEMA_VERSION,
		})
		expect(
			database
				.prepare('PRAGMA table_info(entries)')
				.all()
				.map((column: any) => column.name),
		).toStrictEqual([
			'id',
			'root_id',
			'relative_path',
			'name',
			'type',
			'size',
			'modified_ms',
			'hidden',
			'search_name',
			'search_name_folded',
			'device',
			'inode',
			'modified_ns',
			'ctime_ns',
			'thumbnail_identity_kind',
			'content_id',
			'hash_failure_count',
			'hash_retry_at',
			'hash_error',
			'observed_at',
			'birthtime_ms',
		])
		expect(
			database
				.prepare('PRAGMA table_info(media_metadata)')
				.all()
				.map((column: any) => column.name),
		).toEqual(expect.arrayContaining(['altitude', 'user_comment']))
		expect(
			database
				.prepare(
					"SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('contents', 'thumbnail_variants', 'transient_thumbnail_variants') ORDER BY name",
				)
				.all(),
		).toStrictEqual([{name: 'contents'}, {name: 'thumbnail_variants'}, {name: 'transient_thumbnail_variants'}])
		expect(
			database
				.prepare('PRAGMA index_info(entries_pending_content_hash)')
				.all()
				.map((column: any) => column.name),
		).toStrictEqual(['root_id', 'hash_retry_at', 'id'])
		expect(
			database
				.prepare('PRAGMA index_info(entries_by_recent_modification)')
				.all()
				.map((column: any) => column.name),
		).toStrictEqual(['root_id', 'modified_ms', 'id'])
		expect(database.prepare('SELECT id, generation FROM photos_projection_state').get()).toStrictEqual({
			id: 1,
			generation: 0,
		})
		expect(
			database
				.prepare('PRAGMA index_info(entries_by_photos_live_fallback)')
				.all()
				.map((column: any) => column.name),
		).toStrictEqual(['root_id', null, null])
		const fallbackStem = filenameStemSql('name', [...PHOTO_EXTENSIONS, ...VIDEO_EXTENSIONS])
		const liveFallbackPlan = database
			.prepare(
				`EXPLAIN QUERY PLAN SELECT id FROM entries INDEXED BY entries_by_photos_live_fallback
				WHERE root_id = ? AND type = 'file' AND hidden = 0 AND thumbnail_identity_kind = 'content'
					AND substr(relative_path, 1, length(relative_path) - length(name)) = ?
					AND ${fallbackStem} = ?`,
			)
			.all(1, 'Trip/', 'img_0001') as Array<{detail: string}>
		expect(liveFallbackPlan.some(({detail}) => detail.includes('entries_by_photos_live_fallback'))).toBe(true)

		const recentsPlan = database
			.prepare(
				`EXPLAIN QUERY PLAN
				SELECT id FROM entries
				WHERE root_id = ? AND type = 'file' AND hidden = 0
				ORDER BY modified_ms DESC, id DESC
				LIMIT ?`,
			)
			.all(1, 50) as Array<{detail: string}>
		expect(recentsPlan.some(({detail}) => detail.includes('entries_by_recent_modification'))).toBe(true)
		expect(recentsPlan.some(({detail}) => detail.includes('USE TEMP B-TREE FOR ORDER BY'))).toBe(false)

		const hashPlan = database
			.prepare(
				`EXPLAIN QUERY PLAN
				SELECT entries.id
				FROM index_roots
				JOIN entries ON entries.id = (
					SELECT candidate.id
					FROM entries AS candidate INDEXED BY entries_pending_content_hash
					WHERE candidate.root_id = index_roots.id
						AND candidate.thumbnail_identity_kind = 'content'
						AND candidate.content_id IS NULL
						AND (candidate.hash_retry_at IS NULL OR candidate.hash_retry_at <= ?)
					ORDER BY candidate.hash_retry_at, candidate.id
					LIMIT 1
				)
				WHERE index_roots.kind IN ('home', 'trash')
				ORDER BY entries.hash_retry_at, entries.id LIMIT 1`,
			)
			.all(Date.now()) as Array<{detail: string}>
		expect(
			hashPlan.some(({detail}) => detail.includes('entries_pending_content_hash') && detail.includes('root_id=?')),
		).toBe(true)
		expect(hashPlan.some(({detail}) => detail === 'SCAN candidate')).toBe(false)

		for (const [state, workIndex, retryPredicate, parameters] of [
			['pending', 'thumbnail_variants_pending_work', '', []],
			['failed', 'thumbnail_variants_failed_work', 'AND thumbnail_variants.retry_at <= ?', [Date.now()]],
		] as const) {
			const workOrder =
				state === 'pending'
					? 'thumbnail_variants.content_id, entries.id'
					: 'thumbnail_variants.retry_at, thumbnail_variants.content_id, entries.id'
			const plan = database
				.prepare(
					`EXPLAIN QUERY PLAN
					SELECT contents.id FROM thumbnail_variants INDEXED BY ${workIndex}
					JOIN contents ON contents.id = thumbnail_variants.content_id
					JOIN entries INDEXED BY entries_by_content
						ON entries.content_id = thumbnail_variants.content_id
					WHERE thumbnail_variants.variant = ? AND thumbnail_variants.state = '${state}'
						${retryPredicate}
					ORDER BY ${workOrder} LIMIT 1`,
				)
				.all(THUMBNAIL_VARIANT, ...parameters) as Array<{detail: string}>
			expect(plan.some(({detail}) => detail.includes(workIndex))).toBe(true)
			expect(plan.some(({detail}) => detail === 'SCAN entries')).toBe(false)
		}
		database.exec(
			'CREATE TEMP TABLE content_gc_candidates(content_id INTEGER PRIMARY KEY, deferred_at INTEGER NOT NULL)',
		)
		const wakePlan = database
			.prepare(
				`EXPLAIN QUERY PLAN
				SELECT MIN(attempt_at) AS attempt_at FROM (
					SELECT attempt_at FROM (
						SELECT entries.hash_retry_at AS attempt_at
						FROM index_roots
						JOIN entries ON entries.id = (
							SELECT candidate.id
							FROM entries AS candidate INDEXED BY entries_pending_content_hash
							WHERE candidate.root_id = index_roots.id
								AND candidate.thumbnail_identity_kind = 'content'
								AND candidate.content_id IS NULL
								AND candidate.hash_retry_at IS NOT NULL
							ORDER BY candidate.hash_retry_at, candidate.id
							LIMIT 1
						)
						WHERE index_roots.kind IN ('home', 'trash')
						ORDER BY entries.hash_retry_at, entries.id LIMIT 1
					)
					UNION ALL
					SELECT attempt_at FROM (
						SELECT retry_at AS attempt_at
						FROM thumbnail_variants AS failed INDEXED BY thumbnail_variants_failed_work
						WHERE variant = ? AND state = 'failed'
							AND EXISTS (SELECT 1 FROM entries WHERE entries.content_id = failed.content_id)
						ORDER BY retry_at, content_id LIMIT 1
					)
					UNION ALL
					SELECT MIN(deferred_at + ?) AS attempt_at FROM content_gc_candidates
				)`,
			)
			.all(THUMBNAIL_VARIANT, 6 * 60 * 60 * 1000) as Array<{detail: string}>
		expect(
			wakePlan.some(({detail}) => detail.includes('entries_pending_content_hash') && detail.includes('root_id=?')),
		).toBe(true)
		expect(wakePlan.some(({detail}) => detail === 'SCAN candidate')).toBe(false)
		expect(wakePlan.some(({detail}) => detail.includes('thumbnail_variants_failed_work'))).toBe(true)
		expect(wakePlan.some(({detail}) => detail.includes('entries_by_content'))).toBe(true)
		database.close()
	})

	test('migrates existing metadata rows to the lean entry schema', async () => {
		const database = new BetterSqlite3(':memory:')
		await migrateFileIndex(database, [fileIndexMigrations[0]])
		database
			.prepare(
				`INSERT INTO index_roots(
					virtual_path, system_path, owner_id, kind, search_enabled, created_at, updated_at
				) VALUES ('/Home', '/data/home', 'owner', 'home', 1, 1, 1)`,
			)
			.run()
		database
			.prepare(
				`INSERT INTO entries(
					root_id, relative_path, parent_relative_path, name, type, mime_type,
					size, modified_ms, changed_ms, birth_ms, device, inode, mode, uid, gid, nlink,
					hidden, last_seen_generation, indexed_at, updated_at
				) VALUES (1, 'Documents/report.txt', 'Documents', 'report.txt', 'file', 'text/plain',
					7, 1234, 1235, 1200, 10, 20, 33188, 1000, 1000, 1, 0, 3, 100, 200)`,
			)
			.run()

		await expect(migrateFileIndex(database)).resolves.toBe(FILE_INDEX_SCHEMA_VERSION)
		expect(database.prepare('SELECT * FROM entries').get()).toStrictEqual({
			id: 1,
			root_id: 1,
			relative_path: 'Documents/report.txt',
			name: 'report.txt',
			search_name: 'report.txt',
			search_name_folded: 'report.txt',
			type: 'file',
			size: 7,
			modified_ms: 1234,
			hidden: 0,
			device: '',
			inode: '',
			modified_ns: '',
			ctime_ns: '',
			thumbnail_identity_kind: null,
			content_id: null,
			hash_failure_count: 0,
			hash_retry_at: null,
			hash_error: null,
			observed_at: null,
			birthtime_ms: null,
		})
		expect(
			database.prepare(`SELECT rowid FROM entry_names_fts WHERE entry_names_fts MATCH '"rep"'`).all(),
		).toStrictEqual([{rowid: 1}])
		expect(database.prepare("SELECT term, doc FROM entry_names_fts_vocab WHERE term = 'rep'").get()).toStrictEqual({
			term: 'rep',
			doc: 1,
		})
		database.prepare("UPDATE entries SET name = 'renamed.txt', search_name = 'renamed.txt' WHERE id = 1").run()
		expect(
			database.prepare(`SELECT rowid FROM entry_names_fts WHERE entry_names_fts MATCH '"rep"'`).all(),
		).toStrictEqual([])
		expect(
			database.prepare(`SELECT rowid FROM entry_names_fts WHERE entry_names_fts MATCH '"ren"'`).all(),
		).toStrictEqual([{rowid: 1}])
		database.prepare('DELETE FROM index_roots WHERE id = 1').run()
		expect(
			database.prepare(`SELECT rowid FROM entry_names_fts WHERE entry_names_fts MATCH '"ren"'`).all(),
		).toStrictEqual([])
		database.close()
	})

	test('migrates a populated released v6 database directly to the final enrichment schema', async () => {
		const database = new BetterSqlite3(':memory:')
		await migrateFileIndex(database, fileIndexMigrations.slice(0, 6))
		database
			.prepare(
				`INSERT INTO index_roots(
					virtual_path, system_path, owner_id, kind, search_enabled, created_at, updated_at
				) VALUES ('/Home', '/data/home', 'owner', 'home', 1, 1, 1)`,
			)
			.run()
		database
			.prepare(
				`INSERT INTO entries(
					root_id, relative_path, name, search_name, search_name_folded,
					type, size, modified_ms, hidden
				) VALUES (1, 'photo.png', 'photo.png', 'photo.png', 'photo.png', 'file', 5, 1, 0)`,
			)
			.run()

		await expect(migrateFileIndex(database)).resolves.toBe(FILE_INDEX_SCHEMA_VERSION)
		expect(
			database
				.prepare(
					`SELECT relative_path, device, inode, modified_ns, ctime_ns, thumbnail_identity_kind,
						content_id, hash_failure_count, hash_retry_at, hash_error, observed_at
					FROM entries`,
				)
				.get(),
		).toStrictEqual({
			relative_path: 'photo.png',
			device: '',
			inode: '',
			modified_ns: '',
			ctime_ns: '',
			thumbnail_identity_kind: null,
			content_id: null,
			hash_failure_count: 0,
			hash_retry_at: null,
			hash_error: null,
			observed_at: null,
		})
		expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toStrictEqual({
			count: FILE_INDEX_SCHEMA_VERSION,
		})
		expect(
			database
				.prepare('PRAGMA table_info(entries)')
				.all()
				.map((column: any) => column.name),
		).not.toContain('content_hash_valid')
		expect(
			database.prepare("SELECT name FROM sqlite_schema WHERE name = 'entries_by_content_identity'").get(),
		).toBeUndefined()
		const content = database
			.prepare('INSERT INTO contents(blake3, size, created_at) VALUES (?, 5, 1)')
			.run(Buffer.alloc(32, 0xb1))
		database
			.prepare(
				`INSERT INTO thumbnail_variants(content_id, variant, state, updated_at)
				VALUES (?, ?, 'pending', 1)`,
			)
			.run(content.lastInsertRowid, THUMBNAIL_VARIANT)
		expect(database.prepare('SELECT content_id, variant, state FROM thumbnail_variants').get()).toStrictEqual({
			content_id: Number(content.lastInsertRowid),
			variant: THUMBNAIL_VARIANT,
			state: 'pending',
		})
		database.close()
	})

	test('retires the old Files preview when migrating to the shared Photos preview', async () => {
		const database = new BetterSqlite3(':memory:')
		await migrateFileIndex(database, fileIndexMigrations.slice(0, 7))
		const content = database
			.prepare('INSERT INTO contents(blake3, size, created_at) VALUES (?, 5, 1)')
			.run(Buffer.alloc(32, 0xb2))
		database
			.prepare(
				`INSERT INTO thumbnail_variants(content_id, variant, state, updated_at)
				VALUES (?, 'preview-112-webp-v1', 'ready', 1)`,
			)
			.run(content.lastInsertRowid)
		database
			.prepare(
				`INSERT INTO index_roots(
					virtual_path, system_path, owner_id, kind, search_enabled, created_at, updated_at
				) VALUES ('/Home', '/data/home', 'owner', 'home', 1, 1, 1)`,
			)
			.run()
		const entry = database
			.prepare(
				`INSERT INTO entries(
					root_id, relative_path, name, type, size, modified_ms, hidden, thumbnail_identity_kind
				) VALUES (1, 'photo.jpg', 'photo.jpg', 'file', 5, 1, 0, 'transient')`,
			)
			.run()
		database
			.prepare(
				`INSERT INTO transient_thumbnail_variants(
					entry_id, variant, artifact_key, state, updated_at
				) VALUES (?, 'preview-112-webp-v1', ?, 'ready', 1)`,
			)
			.run(entry.lastInsertRowid, 'ab'.repeat(32))

		await expect(migrateFileIndex(database)).resolves.toBe(FILE_INDEX_SCHEMA_VERSION)
		expect(database.prepare('SELECT variant, state FROM thumbnail_variants').get()).toBeUndefined()
		expect(database.prepare('SELECT variant, state FROM transient_thumbnail_variants').get()).toBeUndefined()
		database.close()
	})

	test('invalidates long-edge Photos variants while preserving the 192px rendition', async () => {
		const database = new BetterSqlite3(':memory:')
		await migrateFileIndex(database, fileIndexMigrations.slice(0, 9))
		const content = database
			.prepare('INSERT INTO contents(blake3, size, created_at) VALUES (?, 5, 1)')
			.run(Buffer.alloc(32, 0xb4))
		const insert = database.prepare(
			`INSERT INTO thumbnail_variants(content_id, variant, state, updated_at)
			VALUES (?, ?, 'ready', 1)`,
		)
		for (const variant of ['preview-192-webp-v1', 'preview-512-webp-v1', 'preview-1280-webp-v1']) {
			insert.run(content.lastInsertRowid, variant)
		}

		await expect(migrateFileIndex(database)).resolves.toBe(FILE_INDEX_SCHEMA_VERSION)
		expect(database.prepare('SELECT variant FROM thumbnail_variants ORDER BY variant').all()).toStrictEqual([
			{variant: 'preview-192-webp-v1'},
		])
		database.close()
	})

	test('requeues existing media metadata when adding new EXIF fields', async () => {
		const database = new BetterSqlite3(':memory:')
		await migrateFileIndex(database, fileIndexMigrations.slice(0, 8))
		const content = database
			.prepare('INSERT INTO contents(blake3, size, created_at) VALUES (?, 5, 1)')
			.run(Buffer.alloc(32, 0xb3))
		database
			.prepare(
				`INSERT INTO media_metadata(content_id, state, kind, width, height, failure_count, updated_at)
				VALUES (?, 'ready', 'photo', 100, 50, 0, 1)`,
			)
			.run(content.lastInsertRowid)

		await expect(migrateFileIndex(database)).resolves.toBe(FILE_INDEX_SCHEMA_VERSION)
		expect(
			database.prepare('SELECT state, retry_at, last_error, altitude, user_comment FROM media_metadata').get(),
		).toStrictEqual({state: 'pending', retry_at: null, last_error: null, altitude: null, user_comment: null})
		database.close()
	})

	test('requeues only videos when adding video camera metadata extraction', async () => {
		const database = new BetterSqlite3(':memory:')
		await migrateFileIndex(database, fileIndexMigrations.slice(0, 11))
		const insertContent = database.prepare('INSERT INTO contents(blake3, size, created_at) VALUES (?, 5, 1)')
		const photo = insertContent.run(Buffer.alloc(32, 0xc1)).lastInsertRowid
		const video = insertContent.run(Buffer.alloc(32, 0xc2)).lastInsertRowid
		const insertMetadata = database.prepare(
			`INSERT INTO media_metadata(
				content_id, state, kind, width, height, camera_model,
				failure_count, retry_at, last_error, updated_at
			) VALUES (?, 'ready', ?, 100, 50, 'existing', 3, 123, 'old error', 1)`,
		)
		insertMetadata.run(photo, 'photo')
		insertMetadata.run(video, 'video')

		await expect(migrateFileIndex(database, fileIndexMigrations.slice(0, 12))).resolves.toBe(12)
		expect(
			database
				.prepare(
					`SELECT kind, state, camera_model, failure_count, retry_at, last_error, updated_at
					FROM media_metadata ORDER BY kind`,
				)
				.all(),
		).toStrictEqual([
			{
				kind: 'photo',
				state: 'ready',
				camera_model: 'existing',
				failure_count: 3,
				retry_at: 123,
				last_error: 'old error',
				updated_at: 1,
			},
			{
				kind: 'video',
				state: 'pending',
				camera_model: 'existing',
				failure_count: 0,
				retry_at: null,
				last_error: null,
				updated_at: 0,
			},
		])
		database.close()
	})

	test('requeues all media when changing the metadata reader and field precedence', async () => {
		const database = new BetterSqlite3(':memory:')
		await migrateFileIndex(database, fileIndexMigrations.slice(0, 13))
		const insertContent = database.prepare('INSERT INTO contents(blake3, size, created_at) VALUES (?, 5, 1)')
		const photo = insertContent.run(Buffer.alloc(32, 0xd1)).lastInsertRowid
		const video = insertContent.run(Buffer.alloc(32, 0xd2)).lastInsertRowid
		const insertMetadata = database.prepare(
			`INSERT INTO media_metadata(
				content_id, state, kind, width, height, failure_count, retry_at, last_error, updated_at
			) VALUES (?, 'ready', ?, 100, 50, 3, 123, 'old error', 1)`,
		)
		insertMetadata.run(photo, 'photo')
		insertMetadata.run(video, 'video')

		await expect(migrateFileIndex(database)).resolves.toBe(FILE_INDEX_SCHEMA_VERSION)
		expect(
			database
				.prepare(
					`SELECT kind, state, failure_count, retry_at, last_error, updated_at
					FROM media_metadata ORDER BY kind`,
				)
				.all(),
		).toStrictEqual([
			{kind: 'photo', state: 'pending', failure_count: 0, retry_at: null, last_error: null, updated_at: 0},
			{kind: 'video', state: 'pending', failure_count: 0, retry_at: null, last_error: null, updated_at: 0},
		])
		database.close()
	})

	test('normalizes populated schema v4 filenames when adding the search index', async () => {
		const database = new BetterSqlite3(':memory:')
		await migrateFileIndex(database, fileIndexMigrations.slice(0, 4))
		database
			.prepare(
				`INSERT INTO index_roots(
					virtual_path, system_path, owner_id, kind, search_enabled, created_at, updated_at
				) VALUES ('/Home', '/data/home', 'owner', 'home', 1, 1, 1)`,
			)
			.run()
		const decomposedName = 'Café.jpg'.normalize('NFD')
		database
			.prepare(
				`INSERT INTO entries(root_id, relative_path, name, type, size, modified_ms, hidden)
				VALUES (1, ?, ?, 'file', 0, 1, 0)`,
			)
			.run(decomposedName, decomposedName)

		await expect(migrateFileIndex(database)).resolves.toBe(FILE_INDEX_SCHEMA_VERSION)
		expect(
			database.prepare('SELECT name, search_name, search_name_folded, thumbnail_identity_kind FROM entries').get(),
		).toStrictEqual({
			name: decomposedName,
			search_name: 'Café.jpg',
			search_name_folded: 'café.jpg',
			thumbnail_identity_kind: null,
		})
		expect(
			database.prepare(`SELECT rowid FROM entry_names_fts WHERE entry_names_fts MATCH '"afé"'`).all(),
		).toStrictEqual([{rowid: 1}])
		database.close()
	})

	test('rolls back a partially-applied migration', async () => {
		const database = new BetterSqlite3(':memory:')
		const migrations: FileIndexMigration[] = [
			{
				version: 1,
				up: (transaction) => {
					transaction.exec('CREATE TABLE should_not_exist (id INTEGER PRIMARY KEY)')
					throw new Error('migration failed')
				},
			},
		]

		await expect(migrateFileIndex(database, migrations)).rejects.toThrow('migration failed')
		expect(
			database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'should_not_exist'").get(),
		).toBeUndefined()
		database.close()
	})
})

test('walks past an unreadable child directory and reports its protected path', async () => {
	// A root process can read mode-000 directories, so the engine-level injected
	// error test below remains the portable assertion for privileged test runs.
	if (process.getuid?.() === 0) return

	const root = await temporary.create()
	const unreadable = nodePath.join(root, 'unreadable')
	const hiddenChild = nodePath.join(unreadable, 'hidden.txt')
	const readable = nodePath.join(root, 'readable.txt')
	await fse.outputFile(hiddenChild, 'hidden')
	await writeFile(readable, 'readable')
	await fse.chmod(unreadable, 0o000)

	const paths: string[] = []
	const errors: Array<{systemPath: string; error: unknown}> = []
	try {
		for await (const entry of walkFileTree(
			root,
			() => false,
			undefined,
			(systemPath, error) => {
				errors.push({systemPath, error})
			},
		)) {
			paths.push(entry.systemPath)
		}
	} finally {
		await fse.chmod(unreadable, 0o700)
	}

	expect(paths).toContain(readable)
	expect(paths).toContain(unreadable)
	expect(paths).not.toContain(hiddenChild)
	expect(errors).toHaveLength(1)
	expect(errors[0]).toMatchObject({systemPath: unreadable, error: {code: expect.stringMatching(/EACCES|EPERM/)}})
})

test('indexes accurate metadata and never follows symlinks', async () => {
	const {index, homeDirectory, rootDirectory} = await fixture()
	const visiblePath = nodePath.join(homeDirectory, 'photo.jpg')
	const hiddenPath = nodePath.join(homeDirectory, 'partial.umbrel-upload')
	const directoryPath = nodePath.join(homeDirectory, 'folder')
	const outsideDirectory = nodePath.join(rootDirectory, 'outside')
	await fse.ensureDir(directoryPath)
	await fse.ensureDir(outsideDirectory)
	await writeFile(visiblePath, 'hello')
	await writeFile(hiddenPath, 'partial')
	await writeFile(nodePath.join(outsideDirectory, 'must-not-be-indexed.txt'), 'secret')
	await symlink(outsideDirectory, nodePath.join(homeDirectory, 'outside-link'))

	await index.reconcileRoot('/Home', 'test')

	const stats = await lstat(visiblePath)
	await expect(index.getEntryByVirtualPath('/Home/photo.jpg')).resolves.toMatchObject({
		virtualPath: '/Home/photo.jpg',
		systemPath: visiblePath,
		type: 'file',
		size: 5,
		modifiedMs: Math.trunc(stats.mtimeMs),
		birthtimeMs: Math.trunc(stats.birthtimeMs),
		hidden: false,
	})
	await expect(index.getEntryByVirtualPath('/Home/folder')).resolves.toMatchObject({type: 'directory'})
	await expect(index.getEntryByVirtualPath('/Home/outside-link')).resolves.toMatchObject({type: 'symbolic-link'})
	await expect(index.getEntryByVirtualPath('/Home/outside-link/must-not-be-indexed.txt')).resolves.toBeUndefined()
	await expect(index.getEntryByVirtualPath('/Home/partial.umbrel-upload')).resolves.toMatchObject({hidden: true})
	await expect(candidateNames(index, 'photo')).resolves.toStrictEqual(['photo.jpg'])
	await expect(candidateNames(index, 'outside')).resolves.toStrictEqual(['outside-link'])
	await expect(candidateNames(index, 'folder')).resolves.toStrictEqual(['folder'])
	await expect(candidateNames(index, 'partial')).resolves.toStrictEqual([])
})

test('does not rewrite unchanged entries during reconciliation', async () => {
	const {index, homeDirectory, dataDirectory} = await fixture()
	const file = nodePath.join(homeDirectory, 'stable.txt')
	await writeFile(file, 'stable')
	await index.reconcileRoot('/Home', 'initial')

	const databasePath = nodePath.join(dataDirectory, 'file-index', 'index.db')
	const database = new BetterSqlite3(databasePath)
	database.exec(`
		CREATE TABLE entry_update_audit(entry_id INTEGER NOT NULL);
		CREATE TRIGGER audit_entry_update AFTER UPDATE ON entries BEGIN
			INSERT INTO entry_update_audit(entry_id) VALUES (new.id);
		END;
	`)
	database.close()

	await index.reconcileRoot('/Home', 'unchanged')
	let audit = new BetterSqlite3(databasePath, {readonly: true})
	expect(audit.prepare('SELECT COUNT(*) AS count FROM entry_update_audit').get()).toMatchObject({count: 0})
	audit.close()

	await writeFile(file, 'changed-size')
	await index.reconcileRoot('/Home', 'changed-size')
	audit = new BetterSqlite3(databasePath, {readonly: true})
	expect(audit.prepare('SELECT COUNT(*) AS count FROM entry_update_audit').get()).toMatchObject({count: 1})
	audit.close()

	const future = new Date(Date.now() + 10_000)
	await utimes(file, future, future)
	await index.reconcileRoot('/Home', 'changed-mtime')
	audit = new BetterSqlite3(databasePath, {readonly: true})
	expect(audit.prepare('SELECT COUNT(*) AS count FROM entry_update_audit').get()).toMatchObject({count: 2})
	audit.close()

	await fse.remove(file)
	await fse.ensureDir(file)
	await index.reconcileRoot('/Home', 'changed-type')
	audit = new BetterSqlite3(databasePath, {readonly: true})
	expect(audit.prepare('SELECT COUNT(*) AS count FROM entry_update_audit').get()).toMatchObject({count: 3})
	audit.close()
	await expect(index.getEntryBySystemPath(file)).resolves.toMatchObject({type: 'directory'})
})

test('records stable file identities and invalidates content hashes only when the file revision changes', async () => {
	const {index, homeDirectory, dataDirectory} = await fixture()
	const image = nodePath.join(homeDirectory, 'photo.png')
	const unsupported = nodePath.join(homeDirectory, 'notes.txt')
	await Promise.all([writeFile(image, 'image'), writeFile(unsupported, 'notes')])
	await index.reconcileRoot('/Home', 'initial')

	const databasePath = nodePath.join(dataDirectory, 'file-index', 'index.db')
	let database = new BetterSqlite3(databasePath)
	const imageStats = await lstat(image, {bigint: true})
	expect(
		database
			.prepare(
				`SELECT device, inode, modified_ns, ctime_ns, birthtime_ms, thumbnail_identity_kind, content_id
				FROM entries WHERE relative_path = 'photo.png'`,
			)
			.get(),
	).toStrictEqual({
		device: imageStats.dev.toString(),
		inode: imageStats.ino.toString(),
		modified_ns: imageStats.mtimeNs.toString(),
		ctime_ns: imageStats.ctimeNs.toString(),
		birthtime_ms: Number(imageStats.birthtimeNs / 1_000_000n),
		thumbnail_identity_kind: 'content',
		content_id: null,
	})
	expect(
		database.prepare("SELECT thumbnail_identity_kind FROM entries WHERE relative_path = 'notes.txt'").get(),
	).toStrictEqual({thumbnail_identity_kind: null})

	const content = database
		.prepare('INSERT INTO contents(blake3, size, created_at) VALUES (?, ?, ?) RETURNING id')
		.get(Buffer.alloc(32, 1), imageStats.size, Date.now()) as {id: number}
	database.prepare("UPDATE entries SET content_id = ? WHERE relative_path = 'photo.png'").run(content.id)
	database.close()

	// Raw device IDs are mount-session details, not part of managed content
	// identity. A changed device value must update metadata without rehashing.
	database = new BetterSqlite3(databasePath)
	database.prepare("UPDATE entries SET device = 'different-mount-device' WHERE relative_path = 'photo.png'").run()
	database.close()
	await index.reconcileRoot('/Home', 'unchanged')
	database = new BetterSqlite3(databasePath)
	expect(database.prepare("SELECT content_id FROM entries WHERE relative_path = 'photo.png'").get()).toStrictEqual({
		content_id: content.id,
	})
	database.close()

	// Permission-only ctime changes are recorded but do not invalidate a content
	// hash. Managed-file revisions deliberately use inode, size, and mtime.
	await chmod(image, 0o600)
	await index.reconcileRoot('/Home', 'changed-ctime')
	database = new BetterSqlite3(databasePath)
	expect(database.prepare("SELECT content_id FROM entries WHERE relative_path = 'photo.png'").get()).toStrictEqual({
		content_id: content.id,
	})
	database.close()

	const future = new Date(Date.now() + 10_000)
	await utimes(image, future, future)
	await index.reconcileRoot('/Home', 'changed-mtime')
	database = new BetterSqlite3(databasePath)
	expect(database.prepare("SELECT content_id FROM entries WHERE relative_path = 'photo.png'").get()).toStrictEqual({
		content_id: null,
	})
	database.close()

	const liveImage = nodePath.join(homeDirectory, 'live-photo.png')
	await writeFile(liveImage, 'live')
	await index.reconcilePath(liveImage)
	const liveStats = await lstat(liveImage, {bigint: true})
	database = new BetterSqlite3(databasePath)
	expect(
		database.prepare("SELECT birthtime_ms FROM entries WHERE relative_path = 'live-photo.png'").get(),
	).toStrictEqual({
		birthtime_ms: Number(liveStats.birthtimeNs / 1_000_000n),
	})
	database.close()
})

test('hashes and generates a content-addressed thumbnail on demand', async () => {
	const digest = Buffer.alloc(32, 0xab)
	const hashFile = vi.fn(async () => digest)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const image = nodePath.join(homeDirectory, 'photo.png')
	await writeFile(image, 'image')

	const reference = await index.ensureThumbnail(image)
	expect(reference).toStrictEqual({
		kind: 'content',
		key: digest.toString('hex'),
		variant: THUMBNAIL_VARIANT,
		format: 'webp',
	})
	expect(hashFile).toHaveBeenCalledOnce()
	expect(generateThumbnail).toHaveBeenCalledOnce()
	await expect(index.getExistingThumbnail(image)).resolves.toStrictEqual(reference)
	await expect(index.matchesThumbnail(image, reference.kind, reference.key, reference.variant)).resolves.toBe(true)
	await expect(index.matchesThumbnail(image, 'content', '00'.repeat(32), reference.variant)).resolves.toBe(false)

	const thumbnail = thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), reference)
	await expect(fse.readFile(thumbnail, 'utf8')).resolves.toBe('thumbnail')
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	expect(database.prepare('SELECT COUNT(*) AS count FROM contents').get()).toStrictEqual({count: 1})
	expect(database.prepare('SELECT COUNT(*) AS count FROM thumbnail_variants').get()).toStrictEqual({count: 1})
	expect(database.prepare('SELECT content_id FROM entries WHERE relative_path = ?').get('photo.png')).toMatchObject({
		content_id: expect.any(Number),
	})
	database.close()
})

test('shares one content hash across every requested thumbnail size', async () => {
	const digest = Buffer.alloc(32, 0xac)
	const hashFile = vi.fn(async () => digest)
	const generateThumbnail = vi.fn(async (_source: string, destination: string, variant = THUMBNAIL_VARIANT) => {
		await fse.outputFile(destination, variant)
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const image = nodePath.join(homeDirectory, 'photo.png')
	await writeFile(image, 'image')

	const references = await Promise.all([
		index.ensureThumbnail(image, 'preview-192-webp-v1'),
		index.ensureThumbnail(image, 'preview-512-webp-v2'),
		index.ensureThumbnail(image, 'preview-1280-webp-v2'),
	])

	expect(hashFile).toHaveBeenCalledOnce()
	expect(generateThumbnail).toHaveBeenCalledTimes(3)
	expect(new Set(references.map(({key}) => key))).toStrictEqual(new Set([digest.toString('hex')]))
	expect(new Set(references.map(({variant}) => variant))).toStrictEqual(
		new Set(['preview-192-webp-v1', 'preview-512-webp-v2', 'preview-1280-webp-v2']),
	)
	for (const reference of references) {
		await expect(
			fse.readFile(thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), reference), 'utf8'),
		).resolves.toBe(reference.variant)
	}
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	expect(database.prepare('SELECT COUNT(*) AS count FROM contents').get()).toStrictEqual({count: 1})
	expect(database.prepare('SELECT COUNT(*) AS count FROM thumbnail_variants').get()).toStrictEqual({count: 3})
	database.close()
})

test('backfills newly enabled thumbnail sizes without rehashing content', async () => {
	const hashFile = vi.fn(async () => Buffer.alloc(32, 0xad))
	const generateThumbnail = vi.fn(async (_source: string, destination: string, variant = THUMBNAIL_VARIANT) => {
		await fse.outputFile(destination, variant)
	})
	const {index, homeDirectory} = await fixture(undefined, {enrichmentRuntime: {hashFile, generateThumbnail}})
	const image = nodePath.join(homeDirectory, 'photo.png')
	await writeFile(image, 'image')
	await index.ensureThumbnail(image)

	await index.enableThumbnailVariants(['preview-512-webp-v2', 'preview-1280-webp-v2'])
	index.startBackgroundReconciliation()
	await pRetry(
		async () => {
			await expect(index.status()).resolves.toMatchObject({enrichment: {readyThumbnails: 3}})
		},
		{retries: 100, minTimeout: 10, maxTimeout: 20},
	)

	expect(hashFile).toHaveBeenCalledOnce()
	expect(generateThumbnail).toHaveBeenCalledTimes(3)
})

test('backfills a requested Photos variant that is already enabled in memory', async () => {
	const hashFile = vi.fn(async () => Buffer.alloc(32, 0xae))
	const generateThumbnail = vi.fn(async (_source: string, destination: string, variant = THUMBNAIL_VARIANT) => {
		await fse.outputFile(destination, variant)
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const image = nodePath.join(homeDirectory, 'photo.png')
	await writeFile(image, 'image')
	await index.ensureThumbnail(image)
	await index.enableThumbnailVariants(['preview-192-webp-v1', 'preview-512-webp-v2', 'preview-1280-webp-v2'])
	index.startBackgroundReconciliation()
	await pRetry(
		async () => {
			await expect(index.status()).resolves.toMatchObject({enrichment: {readyThumbnails: 3}})
		},
		{retries: 100, minTimeout: 10, maxTimeout: 20},
	)
	const databasePath = nodePath.join(dataDirectory, 'file-index', 'index.db')
	let database = new BetterSqlite3(databasePath)
	const contentId = (database.prepare('SELECT id FROM contents').get() as {id: number}).id
	database
		.prepare("DELETE FROM thumbnail_variants WHERE content_id = ? AND variant = 'preview-192-webp-v1'")
		.run(contentId)
	database.close()
	await fse.remove(
		thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), {
			kind: 'content',
			key: Buffer.alloc(32, 0xae).toString('hex'),
			variant: 'preview-192-webp-v1',
		}),
	)
	generateThumbnail.mockClear()

	// Registration must reconcile persisted rows even when every requested
	// variant is already enabled in memory.
	await index.enableThumbnailVariants(['preview-192-webp-v1', 'preview-512-webp-v2', 'preview-1280-webp-v2'])
	index.startBackgroundReconciliation()
	await pRetry(
		async () => {
			database = new BetterSqlite3(databasePath, {readonly: true})
			const rows = database
				.prepare(
					`SELECT variant, state FROM thumbnail_variants
					WHERE variant IN ('preview-192-webp-v1', 'preview-512-webp-v2', 'preview-1280-webp-v2')
					ORDER BY variant`,
				)
				.all()
			database.close()
			expect(rows).toStrictEqual([
				{variant: 'preview-1280-webp-v2', state: 'ready'},
				{variant: 'preview-192-webp-v1', state: 'ready'},
				{variant: 'preview-512-webp-v2', state: 'ready'},
			])
		},
		{retries: 100, minTimeout: 10, maxTimeout: 20},
	)

	expect(hashFile).toHaveBeenCalledOnce()
	expect(generateThumbnail).toHaveBeenCalledOnce()
})

test('generates all pending Photos renditions together for one content decode', async () => {
	const generateThumbnails = vi.fn(async (_source: string, outputs: Array<{destination: string; variant: string}>) => {
		await Promise.all(outputs.map(({destination}) => fse.outputFile(destination, 'thumbnail')))
	})
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile: async () => Buffer.alloc(32, 0xa8),
			generateThumbnails,
			extractMediaMetadata: async () => ({kind: 'photo' as const, width: 3000, height: 2000}),
		},
	})
	await writeFile(nodePath.join(homeDirectory, 'batched.jpg'), 'photo')
	await index.reconcileRoot('/Home', 'batched-renditions')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})

	expect(generateThumbnails).toHaveBeenCalledOnce()
	expect(generateThumbnails.mock.calls[0]?.[1].map(({variant}) => variant)).toStrictEqual([
		'preview-192-webp-v1',
		'preview-512-webp-v2',
		'preview-1280-webp-v2',
	])
})

test('publishes each Photos item before hashing the next background candidate', async () => {
	let signalSecondHash!: () => void
	let releaseSecondHash!: () => void
	const secondHashStarted = new Promise<void>((resolve) => (signalSecondHash = resolve))
	const secondHashReleased = new Promise<void>((resolve) => (releaseSecondHash = resolve))
	const operations: string[] = []
	let hashCount = 0
	const hashFile = vi.fn(async (systemPath: string) => {
		const ordinal = ++hashCount
		operations.push(`hash:${nodePath.basename(systemPath)}`)
		if (ordinal === 2) {
			signalSecondHash()
			await secondHashReleased
		}
		return Buffer.alloc(32, ordinal)
	})
	const generateThumbnails = vi.fn(
		async (systemPath: string, outputs: Array<{destination: string; variant: string}>) => {
			operations.push(`thumbnails:${nodePath.basename(systemPath)}`)
			await Promise.all(outputs.map(({destination}) => fse.outputFile(destination, 'thumbnail')))
		},
	)
	const extractMediaMetadata = vi.fn(async (systemPath: string) => {
		operations.push(`metadata:${nodePath.basename(systemPath)}`)
		return {kind: 'photo' as const, takenAt: 1, createdAt: 1, width: 100, height: 50}
	})
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnails, extractMediaMetadata},
	})
	await Promise.all([
		writeFile(nodePath.join(homeDirectory, 'first.jpg'), 'first'),
		writeFile(nodePath.join(homeDirectory, 'second.jpg'), 'second'),
	])
	await index.reconcileRoot('/Home', 'incremental-enrichment')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()

	try {
		await secondHashStarted
		const first = nodePath.basename(hashFile.mock.calls[0]![0])
		const second = nodePath.basename(hashFile.mock.calls[1]![0])
		expect(operations).toStrictEqual([`hash:${first}`, `thumbnails:${first}`, `metadata:${first}`, `hash:${second}`])
		const partial = await index.photosListItems('owner', {}, undefined, 10)
		expect(partial).toMatchObject({total: 1, items: [{id: '01'.repeat(32)}]})
		await expect(index.photosGetItem('owner', partial.items[0]!.id)).resolves.toMatchObject({
			path: `/Home/${first}`,
		})
		await expect(index.photosIndexingState('owner')).resolves.toMatchObject({
			phase: 'enriching',
			completed: 1,
			total: 2,
			percentage: 50,
		})
	} finally {
		releaseSecondHash()
	}

	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	await expect(index.photosListItems('owner', {}, undefined, 10)).resolves.toMatchObject({total: 2})
})

test('publishes an enriched Photos item when its thumbnail renditions fail', async () => {
	const extractMediaMetadata = vi.fn(async () => ({
		kind: 'photo' as const,
		takenAt: 1,
		createdAt: 1,
		width: 100,
		height: 50,
	}))
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile: async () => Buffer.alloc(32, 0x31),
			generateThumbnails: async () => {
				throw new Error('invalid thumbnail payload')
			},
			extractMediaMetadata,
		},
	})
	await writeFile(nodePath.join(homeDirectory, 'recoverable.jpg'), 'photo')
	await index.reconcileRoot('/Home', 'thumbnail-failure-isolation')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()

	await pRetry(async () => expect(await index.photosListItems('owner', {}, undefined, 10)).toMatchObject({total: 1}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	await expect(index.photosIndexingState('owner')).resolves.toMatchObject({phase: 'degraded'})
	expect(extractMediaMetadata).toHaveBeenCalledOnce()
})

test('coalesces per-item enrichment for duplicate content across background lanes', async () => {
	let signalBothHashes!: () => void
	const bothHashesStarted = new Promise<void>((resolve) => (signalBothHashes = resolve))
	let hashCount = 0
	const hashFile = vi.fn(async () => {
		if (++hashCount === 2) signalBothHashes()
		await bothHashesStarted
		return Buffer.alloc(32, 0x32)
	})
	const generateThumbnails = vi.fn(
		async (_systemPath: string, outputs: Array<{destination: string; variant: string}>) => {
			await Promise.all(outputs.map(({destination}) => fse.outputFile(destination, 'thumbnail')))
		},
	)
	const extractMediaMetadata = vi.fn(async () => ({
		kind: 'photo' as const,
		takenAt: 1,
		createdAt: 1,
		width: 100,
		height: 50,
	}))
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {availableParallelism: 8, hashFile, generateThumbnails, extractMediaMetadata},
	})
	await Promise.all([
		writeFile(nodePath.join(homeDirectory, 'duplicate-a.jpg'), 'same'),
		writeFile(nodePath.join(homeDirectory, 'duplicate-b.jpg'), 'same'),
	])
	await index.reconcileRoot('/Home', 'parallel-duplicate-enrichment')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()

	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	expect(hashFile).toHaveBeenCalledTimes(2)
	expect(generateThumbnails).toHaveBeenCalledOnce()
	expect(extractMediaMetadata).toHaveBeenCalledOnce()
	await expect(index.photosListItems('owner', {}, undefined, 10)).resolves.toMatchObject({total: 1})
})

test('keeps invalid duplicate media on backoff as new references are discovered', async () => {
	const extractMediaMetadata = vi.fn(async () => {
		throw new Error('invalid image metadata')
	})
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile: async () => Buffer.alloc(32, 0x33),
			generateThumbnails: async (_systemPath, outputs) => {
				await Promise.all(outputs.map(({destination}) => fse.outputFile(destination, 'thumbnail')))
			},
			extractMediaMetadata,
		},
	})
	await Promise.all([
		writeFile(nodePath.join(homeDirectory, 'invalid-duplicate-a.jpg'), 'same'),
		writeFile(nodePath.join(homeDirectory, 'invalid-duplicate-b.jpg'), 'same'),
	])
	await index.reconcileRoot('/Home', 'invalid-duplicate-backoff')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()

	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'degraded'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	expect(extractMediaMetadata).toHaveBeenCalledOnce()
})

test('background-enriches Home and Trash while leaving other indexed roots on demand', async () => {
	const hashFile = vi.fn(async (systemPath: string) => {
		const byte = new Map([
			['included.jpg', 0x41],
			['excluded.jpg', 0x42],
			['trashed.jpg', 0x43],
			['app-generated.jpg', 0x44],
			['machine-art.jpg', 0x45],
		]).get(nodePath.basename(systemPath))
		if (!byte) throw new Error(`Unexpected hash source: ${systemPath}`)
		return Buffer.alloc(32, byte)
	})
	const generateThumbnails = vi.fn(async (_source: string, outputs: Array<{destination: string; variant: string}>) => {
		await Promise.all(outputs.map(({destination}) => fse.outputFile(destination, 'thumbnail')))
	})
	const extractMediaMetadata = vi.fn(async (_systemPath: string) => ({
		kind: 'photo' as const,
		width: 100,
		height: 50,
	}))
	const {index, root, rootDirectory, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnails, extractMediaMetadata},
	})
	const trashDirectory = nodePath.join(rootDirectory, 'trash')
	const appsDirectory = nodePath.join(rootDirectory, 'apps')
	const machinesDirectory = nodePath.join(rootDirectory, 'machines')
	const paths = {
		included: nodePath.join(homeDirectory, 'Included', 'included.jpg'),
		excluded: nodePath.join(homeDirectory, 'Excluded', 'excluded.jpg'),
		trash: nodePath.join(trashDirectory, 'trashed.jpg'),
		apps: nodePath.join(appsDirectory, 'jellyfin', 'app-generated.jpg'),
		machines: nodePath.join(machinesDirectory, 'machine-art.jpg'),
	}
	await Promise.all(Object.values(paths).map((path) => fse.outputFile(path, 'image')))
	await index.setRoots([
		root,
		{virtualPath: '/Trash', systemPath: trashDirectory, ownerId: 'owner', kind: 'trash', searchEnabled: false},
		{virtualPath: '/Apps', systemPath: appsDirectory, ownerId: 'owner', kind: 'apps', searchEnabled: false},
		{
			virtualPath: '/Machines',
			systemPath: machinesDirectory,
			ownerId: 'owner',
			kind: 'machines',
			searchEnabled: false,
		},
	])
	for (const rootPath of ['/Home', '/Trash', '/Apps', '/Machines']) {
		await index.reconcileRoot(rootPath, 'root-scoped-enrichment')
	}

	// Photos folder visibility is independent of the root-level enrichment
	// policy: every supported Home file is enriched, including excluded folders.
	const source = (await index.photosListSources('owner'))[0]!
	await index.photosUpdateSource('owner', source.id, {mode: 'only', paths: ['/Home/Included']})
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()
	await pRetry(
		async () =>
			await expect(index.status()).resolves.toMatchObject({
				enrichment: {
					eligibleEntries: 5,
					hashedEntries: 3,
					pendingHashes: 0,
					readyThumbnails: 9,
					readyMedia: 3,
				},
			}),
		{retries: 200, minTimeout: 10, maxTimeout: 20},
	)
	await expect(index.photosIndexingState('owner')).resolves.toMatchObject({phase: 'ready', total: 1})

	const backgroundSources = new Set([paths.included, paths.excluded, paths.trash])
	expect(new Set(hashFile.mock.calls.map(([systemPath]) => systemPath))).toStrictEqual(backgroundSources)
	expect(new Set(extractMediaMetadata.mock.calls.map(([systemPath]) => systemPath))).toStrictEqual(backgroundSources)
	expect(new Set(generateThumbnails.mock.calls.map(([systemPath]) => systemPath))).toStrictEqual(backgroundSources)
	expect(
		generateThumbnails.mock.calls.every(
			([, outputs]) =>
				outputs.length === 3 && new Set(outputs.map(({variant}) => variant)).size === PHOTOS_THUMBNAIL_VARIANTS.length,
		),
	).toBe(true)

	const databasePath = nodePath.join(dataDirectory, 'file-index', 'index.db')
	const indexedRows = () => {
		const database = new BetterSqlite3(databasePath, {readonly: true})
		try {
			return database
				.prepare(
					`SELECT index_roots.virtual_path, entries.relative_path, entries.content_id
					FROM entries JOIN index_roots ON index_roots.id = entries.root_id
					WHERE entries.type = 'file'
					ORDER BY index_roots.virtual_path, entries.relative_path`,
				)
				.all()
		} finally {
			database.close()
		}
	}
	expect(indexedRows()).toStrictEqual([
		{virtual_path: '/Apps', relative_path: 'jellyfin/app-generated.jpg', content_id: null},
		{virtual_path: '/Home', relative_path: 'Excluded/excluded.jpg', content_id: expect.any(Number)},
		{virtual_path: '/Home', relative_path: 'Included/included.jpg', content_id: expect.any(Number)},
		{virtual_path: '/Machines', relative_path: 'machine-art.jpg', content_id: null},
		{virtual_path: '/Trash', relative_path: 'trashed.jpg', content_id: expect.any(Number)},
	])

	// Browsing an Apps image hashes and renders only the requested Files preview.
	await expect(index.ensureThumbnail(paths.apps)).resolves.toMatchObject({variant: 'preview-192-webp-v1'})
	expect(hashFile).toHaveBeenCalledTimes(4)
	expect(hashFile).toHaveBeenLastCalledWith(paths.apps, expect.anything())
	expect(generateThumbnails).toHaveBeenCalledTimes(4)
	expect(generateThumbnails.mock.calls.at(-1)?.[0]).toBe(paths.apps)
	expect(generateThumbnails.mock.calls.at(-1)?.[1].map(({variant}) => variant)).toStrictEqual(['preview-192-webp-v1'])
	expect(extractMediaMetadata).toHaveBeenCalledTimes(3)

	const database = new BetterSqlite3(databasePath, {readonly: true})
	const appContent = database
		.prepare(
			`SELECT entries.content_id FROM entries
			JOIN index_roots ON index_roots.id = entries.root_id
			WHERE index_roots.virtual_path = '/Apps' AND entries.relative_path = 'jellyfin/app-generated.jpg'`,
		)
		.get() as {content_id: number}
	expect(
		database.prepare('SELECT variant, state FROM thumbnail_variants WHERE content_id = ?').all(appContent.content_id),
	).toStrictEqual([{variant: 'preview-192-webp-v1', state: 'ready'}])
	expect(
		database.prepare('SELECT 1 FROM media_metadata WHERE content_id = ?').get(appContent.content_id),
	).toBeUndefined()
	database.close()
})

test('serves an account-scoped Photos library from indexed media and durable state', async () => {
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, trashDirectory} = await fixture(undefined, {
		includeTrash: true,
		enrichmentRuntime: {
			hashFile: async (systemPath) => Buffer.alloc(32, nodePath.basename(systemPath).startsWith('video') ? 2 : 1),
			generateThumbnail,
			extractMediaMetadata: async (systemPath) => ({
				kind: nodePath.basename(systemPath).startsWith('video') ? 'video' : 'photo',
				takenAt: nodePath.basename(systemPath).startsWith('video') ? 1_000 : 2_000,
				createdAt: 500,
				width: 1920,
				height: 1080,
				...(nodePath.basename(systemPath).startsWith('video') ? {durationMs: 10_000} : {subKind: 'panorama' as const}),
			}),
		},
	})
	await Promise.all([
		writeFile(nodePath.join(homeDirectory, 'photo.jpg'), 'photo'),
		writeFile(nodePath.join(homeDirectory, 'video.mp4'), 'video'),
	])
	await index.reconcileRoot('/Home', 'photos-library')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()

	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	await expect(index.photosSummary('owner')).resolves.toMatchObject({
		counts: {items: 2, favorites: 0, photos: 1, videos: 1, deleted: 0},
		sizeBytes: 10,
		bySubKind: {panorama: 1},
	})
	const page = await index.photosListItems('owner', {}, undefined, 10)
	expect(page.total).toBe(2)
	expect(page.items.map(({kind}) => kind)).toStrictEqual(['photo', 'video'])
	const photo = page.items[0]
	await expect(index.photosGetItem('another-account', photo.id)).resolves.toBeUndefined()
	await index.photosSetFavorite('owner', [photo.id], true)
	const album = await index.photosCreateAlbum('owner', 'Trip', [photo.id])
	await expect(index.photosGetItem('owner', photo.id)).resolves.toMatchObject({
		isFavorite: true,
		albums: [{id: album.id, name: 'Trip'}],
	})
	await fse.move(nodePath.join(homeDirectory, 'photo.jpg'), nodePath.join(trashDirectory, 'photo.jpg'))
	await index.movePath(nodePath.join(homeDirectory, 'photo.jpg'), nodePath.join(trashDirectory, 'photo.jpg'))
	await expect(index.photosSummary('owner')).resolves.toMatchObject({
		counts: {items: 1, favorites: 0, photos: 0, videos: 1, deleted: 1},
	})
	await expect(index.photosListItems('owner', {deleted: true}, undefined, 10)).resolves.toMatchObject({
		total: 1,
		items: [{id: photo.id}],
	})
	await expect(index.photosGetItem('owner', photo.id, true)).resolves.toMatchObject({path: '/Trash/photo.jpg'})
})

test('coalesces Photos changes and reports account-scoped indexing progress snapshots', async () => {
	const onPhotosChange = vi.fn()
	const onPhotosIndexingProgress = vi.fn()
	const {index, homeDirectory} = await fixture(undefined, {
		onPhotosChange,
		onPhotosIndexingProgress,
		enrichmentRuntime: {
			hashFile: async () => Buffer.alloc(32, 0x41),
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
		},
	})
	await writeFile(nodePath.join(homeDirectory, 'notified.jpg'), 'photo')
	await index.reconcileRoot('/Home', 'photos-notification')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()

	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	await pRetry(() => expect(onPhotosChange).toHaveBeenCalled(), {
		retries: 50,
		minTimeout: 10,
		maxTimeout: 20,
	})
	expect(onPhotosChange.mock.calls.length).toBeLessThanOrEqual(2)
	expect(onPhotosChange.mock.calls.flatMap(([accountIds]) => accountIds)).toContain('owner')
	await pRetry(
		() =>
			expect(onPhotosIndexingProgress.mock.calls.flatMap(([progress]) => progress)).toContainEqual({
				accountId: 'owner',
				state: {phase: 'ready', completed: 1, total: 1, percentage: 100},
			}),
		{retries: 200, minTimeout: 10, maxTimeout: 20},
	)
})

test('keeps owner and member Photos libraries and metadata search isolated by their indexed Home roots', async () => {
	const {index, root, rootDirectory, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile: async (systemPath) => Buffer.alloc(32, systemPath.includes('member-home') ? 8 : 7),
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
			extractMediaMetadata: async (systemPath) => ({
				kind: 'photo' as const,
				width: 100,
				height: 100,
				userComment: systemPath.includes('member-home') ? 'member alpine secret' : 'owner coastal secret',
			}),
		},
	})
	const memberHome = nodePath.join(rootDirectory, 'member-home')
	await Promise.all([
		fse.outputFile(nodePath.join(homeDirectory, 'owner-private.jpg'), 'owner'),
		fse.outputFile(nodePath.join(memberHome, 'member-private.jpg'), 'member'),
	])
	await index.setRoots([
		root,
		{
			virtualPath: '/Users/alice',
			systemPath: memberHome,
			ownerId: 'alice',
			kind: 'home',
			searchEnabled: true,
		},
	])
	await Promise.all([
		index.reconcileRoot('/Home', 'owner-photos'),
		index.reconcileRoot('/Users/alice', 'member-photos'),
	])
	await index.initializePhotos()
	index.startBackgroundReconciliation()
	await pRetry(
		async () => {
			await expect(index.photosIndexingState('owner')).resolves.toMatchObject({phase: 'ready'})
			await expect(index.photosIndexingState('alice')).resolves.toMatchObject({phase: 'ready'})
		},
		{retries: 200, minTimeout: 10, maxTimeout: 20},
	)

	const owner = (await index.photosListItems('owner', {}, undefined, 10)).items[0]!
	const member = (await index.photosListItems('alice', {}, undefined, 10)).items[0]!
	await expect(index.photosGetItem('owner', member.id)).resolves.toBeUndefined()
	await expect(index.photosGetItem('alice', owner.id)).resolves.toBeUndefined()
	await expect(index.photosResolveItems('owner', [member.id])).resolves.toStrictEqual([])
	await expect(index.photosResolveItems('alice', [owner.id])).resolves.toStrictEqual([])
	await expect(index.photosListItems('owner', {query: 'coastal secret'}, undefined, 10)).resolves.toMatchObject({
		total: 1,
	})
	await expect(index.photosListItems('owner', {query: 'alpine secret'}, undefined, 10)).resolves.toMatchObject({
		total: 0,
	})
	await expect(index.photosListItems('alice', {query: 'alpine secret'}, undefined, 10)).resolves.toMatchObject({
		total: 1,
	})
	await expect(index.photosListItems('alice', {query: 'coastal secret'}, undefined, 10)).resolves.toMatchObject({
		total: 0,
	})
	const memberSource = (await index.photosListSources('alice'))[0]!
	await expect(index.photosUpdateSource('alice', memberSource.id, {mode: 'only', paths: ['/Home']})).rejects.toThrow(
		'[photos-invalid-scope-path]',
	)
	await expect(
		index.photosUpdateSource('alice', memberSource.id, {mode: 'only', paths: ['/Users/alice']}),
	).resolves.toMatchObject({scope: {mode: 'only', paths: ['/Users/alice']}})
	const album = await index.photosCreateAlbum('alice', 'Private', [owner.id, member.id])
	await expect(index.photosListAlbums('alice')).resolves.toContainEqual(
		expect.objectContaining({id: album.id, count: 1}),
	)
	await expect(index.photosSummary('owner')).resolves.toMatchObject({counts: {items: 1}})
	await expect(index.photosSummary('alice')).resolves.toMatchObject({counts: {items: 1}})

	// Removing a member home is account deletion, not a temporary scan gap:
	// durable favorites/albums/items must leave with that account while the
	// owner library remains untouched.
	await index.photosSetFavorite('alice', [member.id], true)
	await index.removeRoot('/Users/alice')
	await expect(index.photosGetItem('alice', member.id)).resolves.toBeUndefined()
	await expect(index.photosListAlbums('alice')).resolves.toStrictEqual([])
	await expect(index.photosSummary('owner')).resolves.toMatchObject({counts: {items: 1}})
})

test('deduplicates Photos by hash after account authorization and uses a stable accessible location', async () => {
	const duplicateHash = Buffer.alloc(32, 0xd0)
	const {index, root, rootDirectory, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile: async (systemPath) => {
				const name = nodePath.basename(systemPath)
				if (['canonical.jpg', 'searchable-sunset.jpg', 'member-copy.jpg'].includes(name)) return duplicateHash
				return Buffer.alloc(32, Number(name[0]))
			},
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
			extractMediaMetadata: async () => ({kind: 'photo' as const, width: 100, height: 50}),
		},
	})
	const memberHome = nodePath.join(rootDirectory, 'member-hash-home')
	const canonical = nodePath.join(homeDirectory, 'A', 'canonical.jpg')
	const searchableDuplicate = nodePath.join(homeDirectory, 'Z', 'searchable-sunset.jpg')
	await Promise.all([
		fse.outputFile(canonical, 'duplicate'),
		fse.outputFile(searchableDuplicate, 'duplicate'),
		fse.outputFile(nodePath.join(homeDirectory, '1-photo.jpg'), 'one'),
		fse.outputFile(nodePath.join(homeDirectory, '2-photo.jpg'), 'two'),
		fse.outputFile(nodePath.join(homeDirectory, '3-photo.jpg'), 'three'),
		fse.outputFile(nodePath.join(memberHome, 'member-copy.jpg'), 'duplicate'),
	])
	await index.setRoots([
		root,
		{virtualPath: '/Users/alice', systemPath: memberHome, ownerId: 'alice', kind: 'home', searchEnabled: true},
	])
	await Promise.all([
		index.reconcileRoot('/Home', 'hash-dedup-owner'),
		index.reconcileRoot('/Users/alice', 'hash-dedup-member'),
	])
	await index.initializePhotos()
	index.startBackgroundReconciliation()
	await pRetry(
		async () => {
			await expect(index.photosIndexingState('owner')).resolves.toMatchObject({phase: 'ready'})
			await expect(index.photosIndexingState('alice')).resolves.toMatchObject({phase: 'ready'})
		},
		{retries: 200, minTimeout: 10, maxTimeout: 20},
	)

	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	database
		.prepare(
			`UPDATE entries SET birthtime_ms = CASE relative_path
				WHEN 'A/canonical.jpg' THEN 1000
				WHEN 'Z/searchable-sunset.jpg' THEN 2000
				ELSE birthtime_ms END
			WHERE root_id = (SELECT id FROM index_roots WHERE virtual_path = '/Home')`,
		)
		.run()
	database.close()

	const hashId = duplicateHash.toString('hex')
	const firstPage = await index.photosListItems('owner', {}, undefined, 2)
	const secondPage = await index.photosListItems('owner', {}, firstPage.nextCursor, 2)
	const pagedIds = [...firstPage.items, ...secondPage.items].map(({id}) => id)
	expect(firstPage.total).toBe(4)
	expect(secondPage.nextCursor).toBeUndefined()
	expect(pagedIds).toHaveLength(4)
	expect(new Set(pagedIds).size).toBe(4)
	expect(pagedIds.filter((id) => id === hashId)).toHaveLength(1)
	expect(hashId).toMatch(/^[a-f0-9]{64}$/)
	await expect(index.photosGetItem('owner', hashId)).resolves.toMatchObject({path: '/Home/A/canonical.jpg'})
	await expect(index.photosResolveItems('owner', [hashId])).resolves.toStrictEqual([
		{id: hashId, path: '/Home/A/canonical.jpg'},
	])
	await expect(index.photosResolveItems('alice', [hashId])).resolves.toStrictEqual([
		{id: hashId, path: '/Users/alice/member-copy.jpg'},
	])
	await expect(index.photosListItems('owner', {query: 'searchable-sunset'}, undefined, 10)).resolves.toMatchObject({
		total: 1,
		items: [{id: hashId}],
	})

	await index.photosSetFavorite('owner', [hashId], true)
	const album = await index.photosCreateAlbum('owner', 'One copy', [hashId, hashId])
	await index.photosSetAlbumCover('owner', album.id, hashId)
	await expect(index.photosListAlbums('owner')).resolves.toContainEqual(
		expect.objectContaining({id: album.id, count: 1, coverId: hashId}),
	)
	await expect(index.photosGetItem('alice', hashId)).resolves.toMatchObject({isFavorite: false})
	await index.photosSetFavorite('alice', [hashId], true)
	await expect(index.photosGetItem('owner', hashId)).resolves.toMatchObject({isFavorite: true})
	await expect(index.photosListAlbums('alice')).resolves.toStrictEqual([])

	const deletionSet = await index.photosResolveItemFiles('owner', [hashId], 'home')
	expect(deletionSet.map(({path}) => path)).toStrictEqual(['/Home/A/canonical.jpg', '/Home/Z/searchable-sunset.jpg'])
	expect(deletionSet.some(({path}) => path === '/Users/alice/member-copy.jpg')).toBe(false)
	await expect(index.photosResolveItemFiles('alice', [hashId], 'home')).resolves.toMatchObject([
		{path: '/Users/alice/member-copy.jpg'},
	])

	const source = (await index.photosListSources('owner'))[0]!
	await expect(
		index.photosListItems('owner', {sourceIds: [source.id], dates: [{from: 900, to: 1_100}]}, undefined, 10),
	).resolves.toMatchObject({total: 1, items: [{id: hashId, takenAt: 1_000}]})
	await index.photosUpdateSource('owner', source.id, {mode: 'only', paths: ['/Home/Z']})
	await expect(
		index.photosListItems('owner', {sourceIds: [source.id], dates: [{from: 1_900, to: 2_100}]}, undefined, 10),
	).resolves.toMatchObject({total: 1, items: [{id: hashId, takenAt: 2_000}]})
	await expect(index.photosListItems('owner', {}, undefined, 10)).resolves.toMatchObject({
		items: expect.arrayContaining([expect.objectContaining({id: hashId, takenAt: 2_000})]),
	})
	await expect(index.photosGetItem('owner', hashId)).resolves.toMatchObject({path: '/Home/Z/searchable-sunset.jpg'})
	await index.photosUpdateSource('owner', source.id, {mode: 'everything', paths: []})
	await expect(index.photosListItems('owner', {}, undefined, 10)).resolves.toMatchObject({
		items: expect.arrayContaining([expect.objectContaining({id: hashId, takenAt: 1_000})]),
	})
	await fse.remove(canonical)
	await index.removePath(canonical)
	await expect(index.photosGetItem('owner', hashId)).resolves.toMatchObject({path: '/Home/Z/searchable-sunset.jpg'})
})

test('treats an in-place edit as a new hash without transferring state and reconnects an old hash later', async () => {
	const oldHash = Buffer.alloc(32, 0x31)
	const newHash = Buffer.alloc(32, 0x32)
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile: async (systemPath) => ((await readFile(systemPath, 'utf8')) === 'old' ? oldHash : newHash),
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
			extractMediaMetadata: async () => ({kind: 'photo' as const, width: 100, height: 50}),
		},
	})
	const photo = nodePath.join(homeDirectory, 'edited.jpg')
	await writeFile(photo, 'old')
	await index.reconcileRoot('/Home', 'old-content')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	const oldId = oldHash.toString('hex')
	await index.photosSetFavorite('owner', [oldId], true)
	const album = await index.photosCreateAlbum('owner', 'Original bytes', [oldId])

	await writeFile(photo, 'new bytes with a different revision')
	// Exercise the batched full-scan write path as well as direct watcher writes:
	// it must invalidate the old cached timeline membership before detaching its hash.
	await index.reconcileRoot('/Home', 'edited-content')
	await pRetry(
		async () =>
			expect((await index.photosListItems('owner', {}, undefined, 10)).items).toStrictEqual([
				expect.objectContaining({id: newHash.toString('hex'), isFavorite: false}),
			]),
		{retries: 200, minTimeout: 10, maxTimeout: 20},
	)
	await expect(index.photosGetItem('owner', oldId)).resolves.toBeUndefined()
	await expect(index.photosListAlbums('owner')).resolves.toContainEqual(
		expect.objectContaining({id: album.id, count: 0}),
	)

	await writeFile(photo, 'old')
	await index.reconcilePath(photo)
	await pRetry(
		async () => expect(await index.photosGetItem('owner', oldId)).toMatchObject({id: oldId, isFavorite: true}),
		{retries: 200, minTimeout: 10, maxTimeout: 20},
	)
	await expect(index.photosListAlbums('owner')).resolves.toContainEqual(
		expect.objectContaining({id: album.id, count: 1}),
	)
})

test('keeps filesystem birth-date fallbacks and screenshot classification per entry for duplicate content', async () => {
	const extractMediaMetadata = vi.fn(async (systemPath: string) => {
		if (systemPath.includes('Screenshot private'))
			throw Object.assign(new Error('unreadable duplicate'), {code: 'EACCES'})
		return {kind: 'photo' as const, width: 100, height: 100}
	})
	const {index, root, rootDirectory, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile: async () => Buffer.alloc(32, 0x61),
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
			extractMediaMetadata,
		},
	})
	const memberHome = nodePath.join(rootDirectory, 'member-metadata-home')
	const ownerPhoto = nodePath.join(homeDirectory, 'Screenshot private.png')
	const memberPhoto = nodePath.join(memberHome, 'ordinary.jpg')
	await Promise.all([fse.outputFile(ownerPhoto, 'same'), fse.outputFile(memberPhoto, 'same')])
	await Promise.all([
		utimes(ownerPhoto, new Date(100_000), new Date(100_000)),
		utimes(memberPhoto, new Date(200_000), new Date(200_000)),
	])
	await index.setRoots([
		root,
		{virtualPath: '/Users/alice', systemPath: memberHome, ownerId: 'alice', kind: 'home', searchEnabled: true},
	])
	await Promise.all([
		index.reconcileRoot('/Home', 'owner-metadata'),
		index.reconcileRoot('/Users/alice', 'member-metadata'),
	])
	await index.initializePhotos()
	index.startBackgroundReconciliation()
	await pRetry(
		async () => {
			await expect(index.photosIndexingState('owner')).resolves.toMatchObject({phase: 'ready'})
			await expect(index.photosIndexingState('alice')).resolves.toMatchObject({phase: 'ready'})
		},
		{retries: 200, minTimeout: 10, maxTimeout: 20},
	)
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	database
		.prepare(
			`UPDATE entries SET birthtime_ms = CASE
				WHEN root_id = (SELECT id FROM index_roots WHERE virtual_path = '/Home') THEN 90000
				ELSE 190000 END
			WHERE relative_path IN ('Screenshot private.png', 'ordinary.jpg')`,
		)
		.run()
	database.close()

	await expect(index.photosListItems('owner', {}, undefined, 10)).resolves.toMatchObject({
		items: [{takenAt: 90_000, subKind: 'screenshot'}],
	})
	await expect(index.photosListItems('alice', {}, undefined, 10)).resolves.toMatchObject({
		items: [{takenAt: 190_000}],
	})
	await expect(index.photosListItems('alice', {subKind: 'screenshot'}, undefined, 10)).resolves.toMatchObject({
		total: 0,
	})
	expect(extractMediaMetadata.mock.calls.map(([path]) => path)).toEqual(
		expect.arrayContaining([ownerPhoto, memberPhoto]),
	)
})

test('classifies wide screenshots before panoramas while preserving spherical media', async () => {
	const contentHashes: Record<string, number> = {
		'Screenshot wide.jpg': 1,
		'wide-export.png': 2,
		'wide-photo.jpg': 3,
		'Screenshot sphere.jpg': 4,
		'FullSizeRender.jpeg': 5,
		'edited-export.jpeg': 6,
	}
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile: async (systemPath) => Buffer.alloc(32, contentHashes[nodePath.basename(systemPath)]!),
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
			extractMediaMetadata: async (systemPath) => {
				const name = nodePath.basename(systemPath)
				return {
					kind: 'photo' as const,
					width: 300,
					height: 100,
					subKind: name === 'Screenshot sphere.jpg' ? ('spherical' as const) : ('panorama' as const),
					...(name === 'FullSizeRender.jpeg' ? {userComment: 'Screenshot'} : {}),
					...(name === 'edited-export.jpeg' ? {userComment: 'Cropped ScReEn ShOt from iPhone'} : {}),
					...(name === 'wide-export.png' ? {} : {cameraMake: 'Camera', cameraModel: 'Model'}),
				}
			},
		},
	})
	await Promise.all(Object.keys(contentHashes).map((name) => writeFile(nodePath.join(homeDirectory, name), name)))
	await index.reconcileRoot('/Home', 'screenshot-panorama-precedence')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})

	const namesForSubKind = async (subKind: 'panorama' | 'screenshot' | 'spherical') => {
		const page = await index.photosListItems('owner', {subKind}, undefined, 10)
		const details = await Promise.all(page.items.map(({id}) => index.photosGetItem('owner', id)))
		return details.map((item) => item!.fileName).sort()
	}
	expect(await namesForSubKind('screenshot')).toStrictEqual([
		'FullSizeRender.jpeg',
		'Screenshot wide.jpg',
		'edited-export.jpeg',
		'wide-export.png',
	])
	expect(await namesForSubKind('panorama')).toStrictEqual(['wide-photo.jpg'])
	expect(await namesForSubKind('spherical')).toStrictEqual(['Screenshot sphere.jpg'])
})

test('orders Photos dates by embedded capture time, filesystem birth time, then modification time', async () => {
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile: async (systemPath) => Buffer.alloc(32, nodePath.basename(systemPath).charCodeAt(0)),
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
			extractMediaMetadata: async (systemPath) => ({
				kind: 'photo' as const,
				width: 100,
				height: 100,
				...(nodePath.basename(systemPath) === 'embedded.jpg' ? {takenAt: 1_000, createdAt: 1_000} : {}),
			}),
		},
	})
	const embedded = nodePath.join(homeDirectory, 'embedded.jpg')
	const birth = nodePath.join(homeDirectory, 'birth.jpg')
	const modified = nodePath.join(homeDirectory, 'modified.jpg')
	await Promise.all([writeFile(embedded, 'embedded'), writeFile(birth, 'birth'), writeFile(modified, 'modified')])
	await utimes(modified, new Date(3_000), new Date(3_000))
	await index.reconcileRoot('/Home', 'date-fallbacks')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	database.prepare("UPDATE entries SET birthtime_ms = 500 WHERE relative_path = 'embedded.jpg'").run()
	database.prepare("UPDATE entries SET birthtime_ms = 2000 WHERE relative_path = 'birth.jpg'").run()
	database.prepare("UPDATE entries SET birthtime_ms = NULL WHERE relative_path = 'modified.jpg'").run()
	database.close()
	const items = await index.photosListItems('owner', {}, undefined, 10)
	const byPath = new Map(
		await Promise.all(items.items.map(async ({id}) => index.photosGetItem('owner', id))).then((details) =>
			details.map((detail) => [detail!.path, detail!]),
		),
	)
	expect(byPath.get('/Home/embedded.jpg')).toMatchObject({takenAt: 1_000, createdAt: 1_000})
	expect(byPath.get('/Home/birth.jpg')).toMatchObject({takenAt: 2_000, createdAt: 2_000})
	expect(byPath.get('/Home/modified.jpg')).toMatchObject({takenAt: 3_000, createdAt: 3_000})
})

test('preflights Photos upload duplicates without publishing or rereading the file', async () => {
	const digest = Buffer.alloc(32, 0x71)
	const hashFile = vi.fn(async () => digest)
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {enrichmentRuntime: {hashFile}})
	const existing = nodePath.join(homeDirectory, 'existing.jpg')
	const uploaded = nodePath.join(homeDirectory, 'uploaded.jpg')
	await Promise.all([writeFile(existing, 'same bytes'), writeFile(uploaded, 'same bytes')])
	await index.reconcileRoot('/Home', 'photos-upload')
	await index.initializePhotos('owner')

	const existingRevision = await contentRevision(existing)
	await expect(
		index.photosRegisterUpload('owner', existing, digest, {...existingRevision, ctimeNs: '0'}),
	).rejects.toThrow('Published upload revision does not match the index')
	const first = await index.photosRegisterUpload('owner', existing, digest, existingRevision)
	await expect(
		index.photosRegisterUpload('owner', existing, digest, {...existingRevision, ctimeNs: '0'}),
	).rejects.toThrow('Published upload revision does not match the index')
	const album = await index.photosCreateAlbum('owner', 'Uploads')
	const duplicate = await index.photosPrepareUpload('owner', digest, album.id)

	expect(first).toMatchObject({status: 'imported'})
	expect(duplicate).toMatchObject({status: 'duplicate', itemId: first.itemId})
	expect(hashFile).not.toHaveBeenCalled()
	const photos = new BetterSqlite3(nodePath.join(dataDirectory, 'umbrel.db'))
	expect(
		photos
			.prepare('SELECT lower(hex(content_hash)) AS content_hash FROM photos_album_items WHERE album_id = ?')
			.get(album.id),
	).toStrictEqual({
		content_hash: first.itemId,
	})
	photos.close()
})

test('does not deduplicate uploads against missing or invalidated durable Photos rows', async () => {
	const oldDigest = Buffer.alloc(32, 0x72)
	const newDigest = Buffer.alloc(32, 0x73)
	const {index, homeDirectory, dataDirectory} = await fixture()
	const changed = nodePath.join(homeDirectory, 'changed.jpg')
	const deleted = nodePath.join(homeDirectory, 'deleted.jpg')
	await Promise.all([writeFile(changed, 'old'), writeFile(deleted, 'old')])
	await index.reconcileRoot('/Home', 'photos-stale-dedupe')
	await index.initializePhotos('owner')
	await index.photosRegisterUpload('owner', changed, oldDigest, await contentRevision(changed))
	await index.photosRegisterUpload('owner', deleted, oldDigest, await contentRevision(deleted))

	// The durable rows survive filesystem churn so favorites/albums can be
	// reattached after a disposable index rebuild, but stale rows must not
	// participate in upload dedupe.
	await writeFile(changed, 'new bytes')
	await fse.remove(deleted)
	await index.reconcileRoot('/Home', 'photos-stale-dedupe-changed')

	const changedUpload = nodePath.join(homeDirectory, 'changed-upload.jpg')
	await writeFile(changedUpload, 'old')
	await index.reconcileRoot('/Home', 'photos-stale-dedupe-uploads')
	await expect(index.photosPrepareUpload('owner', oldDigest)).resolves.toStrictEqual({status: 'new'})
	await expect(
		index.photosRegisterUpload('owner', changedUpload, oldDigest, await contentRevision(changedUpload)),
	).resolves.toMatchObject({
		status: 'imported',
	})
	await expect(index.photosPrepareUpload('owner', oldDigest)).resolves.toMatchObject({status: 'duplicate'})

	const photos = new BetterSqlite3(nodePath.join(dataDirectory, 'umbrel.db'))
	expect(
		photos
			.prepare('SELECT 1 AS present FROM photos_content_state WHERE account_id = ? AND content_hash = ?')
			.get('owner', oldDigest),
	).toStrictEqual({present: 1})
	photos.close()

	// Once the changed file is attached to its new bytes, the new digest is
	// eligible for dedupe again.
	await expect(
		index.photosRegisterUpload('owner', changed, newDigest, await contentRevision(changed)),
	).resolves.toMatchObject({status: 'imported'})
})

test('pairs live photos, hides their motion companions, and resolves both files for mutations', async () => {
	const runtime = {
		hashFile: async (systemPath: string) => Buffer.alloc(32, nodePath.basename(systemPath).endsWith('.mov') ? 2 : 1),
		generateThumbnail: async (_source: string, destination: string) => fse.outputFile(destination, 'thumbnail'),
		extractMediaMetadata: async (systemPath: string) => {
			const video = systemPath.endsWith('.mov')
			return {
				kind: video ? ('video' as const) : ('photo' as const),
				takenAt: 1_000,
				createdAt: 500,
				width: 100,
				height: 50,
				liveIdentifier: 'apple-live-pair',
				...(video ? {durationMs: 3_000} : {}),
			}
		},
	}
	const {index, root, homeDirectory, dataDirectory} = await fixture(undefined, {enrichmentRuntime: runtime})
	const photo = nodePath.join(homeDirectory, 'STILL.heic')
	const motion = nodePath.join(homeDirectory, 'MOTION.mov')
	await Promise.all([writeFile(photo, 'still'), writeFile(motion, 'motion')])
	await index.reconcileRoot('/Home', 'live-photo')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})

	const page = await index.photosListItems('owner', {}, undefined, 10)
	expect(page).toMatchObject({total: 1, items: [{kind: 'photo', subKind: 'live', tint: 0x112233}]})
	const motionId = Buffer.alloc(32, 2).toString('hex')
	await expect(index.photosResolveItems('owner', [motionId])).resolves.toStrictEqual([])
	const photosState = new BetterSqlite3(nodePath.join(dataDirectory, 'umbrel.db'), {readonly: true})
	expect(
		photosState
			.prepare(
				`SELECT lower(hex(content_hash)) AS id, effective_taken_at
				FROM photos_content_state WHERE account_id = ? ORDER BY id`,
			)
			.all('owner'),
	).toStrictEqual([
		{id: page.items[0]!.id, effective_taken_at: 1_000},
		{id: motionId, effective_taken_at: null},
	])
	photosState.close()
	await expect(index.photosResolveLiveCompanion('owner', page.items[0]!.id)).resolves.toStrictEqual({
		id: expect.any(String),
		path: '/Home/MOTION.mov',
	})
	await fse.remove(motion)
	await index.removePath(motion)
	await expect(index.photosResolveLiveCompanion('owner', page.items[0]!.id)).resolves.toBeUndefined()
	await expect(index.photosGetItem('owner', page.items[0]!.id)).resolves.not.toMatchObject({subKind: 'live'})
	await writeFile(motion, 'motion')
	await index.reconcilePath(motion)
	index.startBackgroundReconciliation()
	await pRetry(
		async () => expect(await index.photosGetItem('owner', page.items[0]!.id)).toMatchObject({subKind: 'live'}),
		{retries: 200, minTimeout: 10, maxTimeout: 20},
	)
	await expect(index.photosResolveItemFiles('owner', [page.items[0]!.id], 'home')).resolves.toHaveLength(2)

	// Pairing is reconstructed entirely from the disposable file index. No pair
	// mapping in umbrel.db is needed to restore logical listing or playback.
	await index.stop()
	await fse.remove(nodePath.join(dataDirectory, 'file-index'))
	const rebuilt = new FileIndex({dataDirectory, logger, isHidden: () => false, enrichmentRuntime: runtime})
	indexes.push(rebuilt)
	await rebuilt.start()
	await rebuilt.setRoots([root])
	await rebuilt.reconcileRoot('/Home', 'live-photo-rebuilt')
	await rebuilt.initializePhotos('owner')
	rebuilt.startBackgroundReconciliation()
	await pRetry(async () => expect(await rebuilt.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	await expect(rebuilt.photosListItems('owner', {}, undefined, 10)).resolves.toMatchObject({
		total: 1,
		items: [{id: page.items[0]!.id, kind: 'photo', subKind: 'live'}],
	})
	await expect(rebuilt.photosResolveLiveCompanion('owner', page.items[0]!.id)).resolves.toStrictEqual({
		id: expect.any(String),
		path: '/Home/MOTION.mov',
	})
})

test('pairs a short same-folder motion clip when Apple identifiers are absent', async () => {
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile: async (systemPath) => Buffer.alloc(32, systemPath.toLowerCase().endsWith('.mov') ? 4 : 3),
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
			extractMediaMetadata: async (systemPath) => ({
				kind: systemPath.toLowerCase().endsWith('.mov') ? ('video' as const) : ('photo' as const),
				takenAt: 1_000,
				createdAt: 500,
				width: 100,
				height: 50,
				...(systemPath.toLowerCase().endsWith('.mov') ? {durationMs: 4_000} : {}),
			}),
		},
	})
	await Promise.all([
		fse.outputFile(nodePath.join(homeDirectory, 'Trip', 'IMG_0002.jpg'), 'still'),
		fse.outputFile(nodePath.join(homeDirectory, 'Trip', 'IMG_0002.MOV'), 'motion'),
	])
	await index.reconcileRoot('/Home', 'live-photo-fallback')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})

	const still = (await index.photosListItems('owner', {subKind: 'live'}, undefined, 10)).items[0]!
	const motionId = Buffer.alloc(32, 4).toString('hex')
	await expect(index.photosResolveItems('owner', [motionId])).resolves.toStrictEqual([])
	const originalMotion = nodePath.join(homeDirectory, 'Trip', 'IMG_0002.MOV')
	const movedMotion = nodePath.join(homeDirectory, 'Trip', 'OTHER.MOV')
	await fse.move(originalMotion, movedMotion)
	await index.movePath(originalMotion, movedMotion)
	await expect(index.photosGetItem('owner', still.id)).resolves.not.toMatchObject({subKind: 'live'})
	await expect(index.photosResolveLiveCompanion('owner', still.id)).resolves.toBeUndefined()
	await expect(index.photosResolveItems('owner', [motionId])).resolves.toStrictEqual([
		{id: motionId, path: '/Home/Trip/OTHER.MOV'},
	])
	await expect(index.photosListItems('owner', {}, undefined, 10)).resolves.toMatchObject({total: 2})

	await fse.move(movedMotion, originalMotion)
	await index.movePath(movedMotion, originalMotion)
	await expect(index.photosGetItem('owner', still.id)).resolves.toMatchObject({subKind: 'live'})
	await expect(index.photosResolveItems('owner', [motionId])).resolves.toStrictEqual([])
	await expect(index.photosListItems('owner', {}, undefined, 10)).resolves.toMatchObject({total: 1})

	const source = (await index.photosListSources('owner'))[0]!
	await index.photosUpdateSource('owner', source.id, {mode: 'only', paths: ['/Home/Trip/IMG_0002.jpg']})
	await expect(index.photosGetItem('owner', still.id)).resolves.not.toMatchObject({subKind: 'live'})
	await expect(index.photosResolveLiveCompanion('owner', still.id)).resolves.toBeUndefined()
	await index.photosUpdateSource('owner', source.id, {mode: 'everything', paths: []})
	await expect(index.photosGetItem('owner', still.id)).resolves.toMatchObject({subKind: 'live'})
})

test('refreshes every transitive Live Photo dependency across exact and fallback pairs', async () => {
	const hashBytes = new Map([
		['IMG_1.jpg', 0x91],
		['IMG_1.heic', 0x92],
		['IMG_1.mov', 0x93],
		['x.mov', 0x94],
		['clip.mov', 0x95],
	])
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile: async (systemPath) => Buffer.alloc(32, hashBytes.get(nodePath.basename(systemPath))!),
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
			extractMediaMetadata: async (systemPath) => {
				const name = nodePath.basename(systemPath)
				const video = name.endsWith('.mov')
				const takenAt =
					name === 'IMG_1.jpg' ? 4_000 : name === 'IMG_1.heic' ? 3_000 : name === 'IMG_1.mov' ? 2_000 : 1_000
				const liveIdentifier =
					name === 'IMG_1.jpg' || name === 'clip.mov'
						? 'live-one'
						: name === 'IMG_1.heic' || name === 'x.mov'
							? 'live-two'
							: undefined
				return {
					kind: video ? ('video' as const) : ('photo' as const),
					takenAt,
					createdAt: takenAt,
					width: 100,
					height: 50,
					...(liveIdentifier ? {liveIdentifier} : {}),
					...(video ? {durationMs: 3_000} : {}),
				}
			},
		},
	})
	await Promise.all([
		fse.outputFile(nodePath.join(homeDirectory, 'B', 'IMG_1.jpg'), 'still one'),
		fse.outputFile(nodePath.join(homeDirectory, 'B', 'IMG_1.heic'), 'still two'),
		fse.outputFile(nodePath.join(homeDirectory, 'B', 'IMG_1.mov'), 'fallback motion'),
		fse.outputFile(nodePath.join(homeDirectory, 'D', 'x.mov'), 'exact motion two'),
	])
	await index.reconcileRoot('/Home', 'transitive-live-initial')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	await expect(index.photosListItems('owner', {}, undefined, 10)).resolves.toMatchObject({total: 2})

	// Adding the exact motion for the first still releases its old fallback
	// motion. Reaching that result requires traversing exact -> fallback -> exact
	// dependencies, rather than stopping after a fixed number of joins.
	const exactMotion = nodePath.join(homeDirectory, 'A', 'clip.mov')
	await fse.outputFile(exactMotion, 'exact motion one')
	await index.reconcilePath(exactMotion)
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	const fallbackMotionId = Buffer.alloc(32, hashBytes.get('IMG_1.mov')!).toString('hex')
	await expect(index.photosListItems('owner', {kind: 'video'}, undefined, 10)).resolves.toMatchObject({
		total: 1,
		items: [{id: fallbackMotionId}],
	})
	await expect(index.photosListItems('owner', {}, undefined, 10)).resolves.toMatchObject({
		total: 3,
		items: expect.arrayContaining([expect.objectContaining({id: fallbackMotionId})]),
	})
})

test('clears the indexed Photos timeline when an entire root is detached', async () => {
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile: async (systemPath) => Buffer.alloc(32, nodePath.basename(systemPath) === 'one.jpg' ? 0xa1 : 0xa2),
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
		},
	})
	await Promise.all([
		writeFile(nodePath.join(homeDirectory, 'one.jpg'), 'one'),
		writeFile(nodePath.join(homeDirectory, 'two.jpg'), 'two'),
	])
	await index.reconcileRoot('/Home', 'root-detach-initial')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	await expect(index.photosListItems('owner', {}, undefined, 10)).resolves.toMatchObject({total: 2})

	await index.removePath(homeDirectory)
	await expect(index.photosListItems('owner', {}, undefined, 10)).resolves.toMatchObject({total: 0, items: []})
	await expect(index.photosListItems('owner', {kind: 'photo'}, undefined, 10)).resolves.toMatchObject({
		total: 0,
		items: [],
	})
	const photos = new BetterSqlite3(nodePath.join(dataDirectory, 'umbrel.db'), {readonly: true})
	expect(
		photos
			.prepare(
				`SELECT COUNT(*) AS count FROM photos_content_state
				WHERE account_id = ? AND effective_taken_at IS NOT NULL`,
			)
			.get('owner'),
	).toStrictEqual({count: 0})
	photos.close()
})

test('removes a Photos item when a Files rename makes it hidden', async () => {
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile: async () => Buffer.alloc(32, 0x41),
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
		},
	})
	const visible = nodePath.join(homeDirectory, 'visible.jpg')
	const hidden = nodePath.join(homeDirectory, '.visible.jpg')
	await writeFile(visible, 'photo')
	await index.reconcileRoot('/Home', 'visible-photo')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	const itemId = (await index.photosListItems('owner', {}, undefined, 10)).items[0]!.id

	await fse.move(visible, hidden)
	await index.movePath(visible, hidden)
	await expect(index.photosListItems('owner', {}, undefined, 10)).resolves.toMatchObject({total: 0})
	await expect(index.photosResolveItems('owner', [itemId])).resolves.toStrictEqual([])
	await index.reconcileRoot('/Home', 'hidden-photo-restart-equivalent')
	await expect(index.photosGetItem('owner', itemId)).resolves.toBeUndefined()
})

test('preserves Photos identity and user state across a watcher-reported rename', async () => {
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile: async () => Buffer.alloc(32, 0x42),
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
		},
	})
	const before = nodePath.join(homeDirectory, 'Before.jpg')
	const after = nodePath.join(homeDirectory, 'After.jpg')
	await writeFile(before, 'photo')
	await index.reconcileRoot('/Home', 'watcher-rename-before')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	const original = (await index.photosListItems('owner', {}, undefined, 10)).items[0]!
	await index.photosSetFavorite('owner', [original.id], true)
	const album = await index.photosCreateAlbum('owner', 'Kept', [original.id])

	await fse.move(before, after)
	index.noteWatcherChanges('/Home', [
		{path: before, type: 'delete'},
		{path: after, type: 'create'},
	])
	await pRetry(
		async () =>
			expect(await index.photosGetItem('owner', original.id)).toMatchObject({
				id: original.id,
				path: '/Home/After.jpg',
				isFavorite: true,
			}),
		{retries: 100, minTimeout: 10, maxTimeout: 20},
	)
	await expect(index.photosListAlbums('owner')).resolves.toContainEqual(
		expect.objectContaining({id: album.id, count: 1}),
	)
})

test('selects one canonical shared Live Photo companion and moves it only with every referencing still', async () => {
	const {index, homeDirectory, trashDirectory} = await fixture(undefined, {
		includeTrash: true,
		enrichmentRuntime: {
			hashFile: async (systemPath) => {
				const name = nodePath.basename(systemPath)
				return Buffer.alloc(32, name === 'a-motion.mov' ? 0x81 : name.endsWith('.mov') ? 0x82 : Number(name[0]))
			},
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
			extractMediaMetadata: async (systemPath) => {
				const video = systemPath.endsWith('.mov')
				return {
					kind: video ? ('video' as const) : ('photo' as const),
					takenAt: 1_000,
					createdAt: 500,
					width: 100,
					height: 50,
					liveIdentifier: 'shared-live-pair',
					...(video ? {durationMs: 3_000} : {}),
				}
			},
		},
	})
	await Promise.all([
		writeFile(nodePath.join(homeDirectory, '1-still.jpg'), 'one'),
		writeFile(nodePath.join(homeDirectory, '2-still.jpg'), 'two'),
		writeFile(nodePath.join(homeDirectory, 'a-motion.mov'), 'first motion'),
		writeFile(nodePath.join(homeDirectory, 'z-motion.mov'), 'second motion'),
	])
	await index.reconcileRoot('/Home', 'shared-live-photo')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})

	const stills = (await index.photosListItems('owner', {kind: 'photo'}, undefined, 10)).items
	expect(stills).toHaveLength(2)
	expect(stills.every(({subKind}) => subKind === 'live')).toBe(true)
	const selectedMotionId = Buffer.alloc(32, 0x81).toString('hex')
	const losingMotionId = Buffer.alloc(32, 0x82).toString('hex')
	await expect(index.photosResolveItems('owner', [selectedMotionId])).resolves.toStrictEqual([])
	await expect(index.photosResolveItems('owner', [losingMotionId])).resolves.toStrictEqual([
		{id: losingMotionId, path: '/Home/z-motion.mov'},
	])
	await expect(index.photosResolveItemFiles('owner', [stills[0]!.id], 'home')).resolves.toMatchObject([
		{id: stills[0]!.id},
	])
	const resolvedPair = await index.photosResolveItemFiles(
		'owner',
		stills.map(({id}) => id),
		'home',
	)
	expect(resolvedPair).toEqual(
		expect.arrayContaining([
			expect.objectContaining({id: stills[0]!.id}),
			expect.objectContaining({id: stills[1]!.id}),
			expect.objectContaining({id: selectedMotionId}),
		]),
	)
	expect(resolvedPair).toHaveLength(3)
	expect(resolvedPair.map(({id}) => id)).not.toContain(losingMotionId)

	// Splitting the stills between Home and Trash must not make the motion file
	// disposable: permanently deleting the Trash-side still later must not erase
	// the only companion still referenced by the Home-side still.
	const secondHomePath = nodePath.join(homeDirectory, '2-still.jpg')
	const secondTrashPath = nodePath.join(trashDirectory, '2-still.jpg')
	await fse.move(secondHomePath, secondTrashPath)
	await index.movePath(secondHomePath, secondTrashPath)
	await expect(index.photosResolveItemFiles('owner', [stills[0]!.id], 'home')).resolves.toMatchObject([
		{id: stills[0]!.id},
	])
	const secondId = Buffer.alloc(32, 2).toString('hex')
	await expect(index.photosResolveItemFiles('owner', [secondId], 'trash')).resolves.toMatchObject([{id: secondId}])
})

test('derives Deleted from enriched Trash media and preserves state across moves', async () => {
	const {index, homeDirectory, trashDirectory} = await fixture(undefined, {
		includeTrash: true,
		enrichmentRuntime: {
			hashFile: async (systemPath) => {
				const name = nodePath.basename(systemPath)
				return Buffer.alloc(32, name.startsWith('home') ? 19 : name.endsWith('.mp4') ? 21 : 20)
			},
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
			extractMediaMetadata: async (systemPath) => ({
				kind: systemPath.endsWith('.mp4') ? ('video' as const) : ('photo' as const),
				takenAt: 1_000,
				createdAt: 500,
				width: 100,
				height: 50,
			}),
		},
	})
	const homePhoto = nodePath.join(homeDirectory, 'home-photo.jpg')
	const trashPhoto = nodePath.join(trashDirectory, 'trash-photo.jpg')
	const trashVideo = nodePath.join(trashDirectory, 'trash-video.mp4')
	await Promise.all([
		writeFile(homePhoto, 'home photo'),
		writeFile(trashPhoto, 'trash photo'),
		writeFile(trashVideo, 'trash video'),
		writeFile(nodePath.join(trashDirectory, 'keep.txt'), 'not media'),
	])
	await Promise.all([
		index.reconcileRoot('/Home', 'trash-derived-home'),
		index.reconcileRoot('/Trash', 'trash-derived-trash'),
	])
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()
	await pRetry(
		async () => {
			await expect(index.photosListItems('owner', {}, undefined, 10)).resolves.toMatchObject({total: 1})
			await expect(index.photosListItems('owner', {deleted: true}, undefined, 10)).resolves.toMatchObject({
				total: 2,
				items: expect.arrayContaining([
					expect.objectContaining({kind: 'photo'}),
					expect.objectContaining({kind: 'video'}),
				]),
			})
		},
		{retries: 200, minTimeout: 10, maxTimeout: 20},
	)

	const homeItem = (await index.photosListItems('owner', {}, undefined, 10)).items[0]!
	await index.photosSetFavorite('owner', [homeItem.id], true)
	const album = await index.photosCreateAlbum('owner', 'Restorable', [homeItem.id])
	await fse.move(homePhoto, nodePath.join(trashDirectory, 'home-photo.jpg'))
	await index.movePath(homePhoto, nodePath.join(trashDirectory, 'home-photo.jpg'))

	await expect(index.photosSummary('owner')).resolves.toMatchObject({
		counts: {items: 0, favorites: 0, photos: 0, videos: 0, deleted: 3},
	})
	await expect(index.photosGetItem('owner', homeItem.id, true)).resolves.toMatchObject({
		path: '/Trash/home-photo.jpg',
		isFavorite: true,
		albums: [{id: album.id, name: 'Restorable'}],
	})
	await expect(index.photosListAlbums('owner')).resolves.toContainEqual(
		expect.objectContaining({id: album.id, count: 0}),
	)
	await expect(index.photosResolveItemFiles('owner', undefined, 'trash')).resolves.toHaveLength(3)

	await fse.move(nodePath.join(trashDirectory, 'home-photo.jpg'), homePhoto)
	await index.movePath(nodePath.join(trashDirectory, 'home-photo.jpg'), homePhoto)
	await expect(index.photosGetItem('owner', homeItem.id)).resolves.toMatchObject({
		path: '/Home/home-photo.jpg',
		isFavorite: true,
	})
	await expect(index.photosListItems('owner', {deleted: true}, undefined, 10)).resolves.toMatchObject({total: 2})
})

test('searches Photos filenames and camera metadata through indexed trigrams and short substrings', async () => {
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile: async (systemPath) => Buffer.alloc(32, systemPath.includes('sunset') ? 5 : 6),
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
			extractMediaMetadata: async (systemPath) => ({
				kind: 'photo' as const,
				takenAt: systemPath.includes('sunset') ? 2_000 : 1_000,
				createdAt: 500,
				width: 100,
				height: 50,
				...(systemPath.includes('sunset')
					? {cameraMake: 'Nikon', cameraModel: 'Z 8', userComment: 'Hidden glacier lagoon'}
					: {cameraMake: 'Canon'}),
			}),
		},
	})
	await Promise.all([
		writeFile(nodePath.join(homeDirectory, 'Iceland sunset.jpg'), 'one'),
		writeFile(nodePath.join(homeDirectory, 'portrait.jpg'), 'two'),
	])
	await index.reconcileRoot('/Home', 'photos-search')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})

	await expect(index.photosListItems('owner', {query: 'sunset Nikon'}, undefined, 10)).resolves.toMatchObject({
		total: 1,
	})
	await expect(index.photosListItems('owner', {query: 'Z'}, undefined, 10)).resolves.toMatchObject({total: 1})
	await expect(index.photosListItems('owner', {query: 'glacier'}, undefined, 10)).resolves.toMatchObject({total: 1})
})

test('returns partial camera metadata, UserComment, and GPS altitude', async () => {
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile: async () => Buffer.alloc(32, 0x29),
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
			extractMediaMetadata: async () => ({
				kind: 'photo' as const,
				width: 100,
				height: 50,
				cameraMake: 'Leica',
				iso: 400,
				latitude: 13.75,
				longitude: 100.5,
				altitude: -12.5,
				userComment: 'Below sea level',
			}),
		},
	})
	await writeFile(nodePath.join(homeDirectory, 'partial.jpg'), 'photo')
	await index.reconcileRoot('/Home', 'partial-camera-metadata')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	const photo = (await index.photosListItems('owner', {}, undefined, 10)).items[0]!
	await expect(index.photosGetItem('owner', photo.id)).resolves.toMatchObject({
		exif: {make: 'Leica', iso: 400, userComment: 'Below sea level'},
		location: {lat: 13.75, lng: 100.5, altitude: -12.5},
	})
})

test('applies Photos source folder scopes to lists, summaries, and source statistics', async () => {
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile: async (systemPath) => Buffer.alloc(32, systemPath.includes('Included') ? 9 : 10),
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
		},
	})
	await Promise.all([
		fse.outputFile(nodePath.join(homeDirectory, 'Included', 'one.jpg'), 'one'),
		fse.outputFile(nodePath.join(homeDirectory, 'Excluded', 'two.jpg'), 'two'),
	])
	await index.reconcileRoot('/Home', 'source-scope')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	const source = (await index.photosListSources('owner'))[0]!
	const originalItems = (await index.photosListItems('owner', {}, undefined, 10)).items
	const itemDetails = await Promise.all(originalItems.map(({id}) => index.photosGetItem('owner', id)))
	const includedItem = itemDetails.find((item) => item?.path === '/Home/Included/one.jpg')!
	const excludedItem = itemDetails.find((item) => item?.path === '/Home/Excluded/two.jpg')!
	const album = await index.photosCreateAlbum('owner', 'Scoped', [includedItem.id, excludedItem.id])
	await index.photosSetAlbumCover('owner', album.id, excludedItem.id)

	await index.photosUpdateSource('owner', source.id, {mode: 'only', paths: ['/Home/Included']})
	await expect(index.photosListItems('owner', {}, undefined, 10)).resolves.toMatchObject({total: 1})
	await expect(index.photosGetItem('owner', excludedItem.id)).resolves.toBeUndefined()
	await expect(index.photosIndexingState('owner')).resolves.toMatchObject({phase: 'ready', total: 1, completed: 1})
	await expect(index.photosSummary('owner')).resolves.toMatchObject({counts: {items: 1}})
	await expect(index.photosListSources('owner')).resolves.toContainEqual(
		expect.objectContaining({id: source.id, stats: {photos: 1, videos: 0, sizeBytes: 3}}),
	)
	await expect(index.photosListAlbums('owner')).resolves.toContainEqual(
		expect.objectContaining({id: album.id, count: 1, coverId: includedItem.id}),
	)
	await expect(index.photosSetAlbumCover('owner', album.id, excludedItem.id)).resolves.toBe(0)
	await index.photosRemoveAlbumItems('owner', album.id, [excludedItem.id])
	await expect(index.photosAddAlbumItems('owner', album.id, [excludedItem.id])).resolves.toBe(0)

	// A valid scope can exclude every item. The source must remain visible so
	// the client can edit that scope again, and the update must not report a
	// false NOT_FOUND after it has already persisted the new setting.
	await expect(
		index.photosUpdateSource('owner', source.id, {mode: 'only', paths: ['/Home/Nowhere']}),
	).resolves.toMatchObject({
		id: source.id,
		scope: {mode: 'only', paths: ['/Home/Nowhere']},
		stats: {photos: 0, videos: 0, sizeBytes: 0},
	})
	await expect(index.photosListItems('owner', {}, undefined, 10)).resolves.toMatchObject({total: 0})

	await index.photosUpdateSource('owner', source.id, {mode: 'everything-except', paths: ['/Home/Included']})
	const excluded = await index.photosListItems('owner', {}, undefined, 10)
	expect(excluded).toMatchObject({total: 1})
	await expect(index.photosGetItem('owner', excluded.items[0]!.id)).resolves.toMatchObject({
		path: '/Home/Excluded/two.jpg',
	})

	await expect(
		index.photosUpdateSource('owner', source.id, {mode: 'only', paths: ['/Home/Outside/../../External']}),
	).rejects.toThrow('[photos-invalid-scope-path]')

	await fse.outputFile(nodePath.join(homeDirectory, 'Literal%_Folder', 'literal.jpg'), 'literal')
	await fse.outputFile(nodePath.join(homeDirectory, 'LiteralXXFolder', 'wildcard.jpg'), 'wildcard')
	await index.reconcileRoot('/Home', 'literal-source-scope')
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	await index.photosUpdateSource('owner', source.id, {mode: 'only', paths: ['/Home/Literal%_Folder']})
	const literalScope = await index.photosListItems('owner', {}, undefined, 10)
	expect(literalScope).toMatchObject({total: 1})
	await expect(index.photosGetItem('owner', literalScope.items[0]!.id)).resolves.toMatchObject({
		path: '/Home/Literal%_Folder/literal.jpg',
	})
})

test('durably registers backup resources that are not Photos-enrichment formats', async () => {
	const hash = Buffer.alloc(32, 0x42)
	const enrichmentRuntime = {hashFile: async () => hash}
	const {index, root, homeDirectory, dataDirectory} = await fixture(undefined, {enrichmentRuntime})
	await index.initializePhotos('owner')
	const sourceId = 'iphone:sidecar-source'
	await index.photosUpsertBackupSource('owner', sourceId, 'Sidecars', 123)
	const resourceKey = 'd'.repeat(64)
	const contents = 'sidecar bytes'
	const bytes = Buffer.byteLength(contents)
	const systemPath = nodePath.join(homeDirectory, 'Photos', 'Sidecars', resourceKey.slice(0, 2), `${resourceKey}.aae`)
	await fse.outputFile(systemPath, contents)

	await expect(
		index.photosRegisterBackupResource(
			'owner',
			sourceId,
			resourceKey,
			systemPath,
			hash,
			await contentRevision(systemPath),
		),
	).resolves.toEqual({
		resourceKey,
		path: `/Home/Photos/Sidecars/${resourceKey.slice(0, 2)}/${resourceKey}.aae`,
		bytes,
	})
	await expect(index.photosConfirmedBackupResources('owner', sourceId, [resourceKey])).resolves.toStrictEqual([
		{
			resourceKey,
			contentHash: hash,
			path: `/Home/Photos/Sidecars/${resourceKey.slice(0, 2)}/${resourceKey}.aae`,
			bytes,
			revision: await indexedContentRevision(systemPath),
		},
	])
	await expect(index.photosListItems('owner', {sourceIds: [sourceId]}, undefined, 10)).resolves.toMatchObject({
		total: 0,
	})
	await index.reconcileRoot('/Home', 'generic-photo-resource')
	await expect(index.photosIndexingState('owner')).resolves.toMatchObject({phase: 'ready'})

	const durable = new BetterSqlite3(nodePath.join(dataDirectory, 'umbrel.db'))
	expect(
		durable
			.prepare(
				`SELECT account_id, source_id, resource_key, lower(hex(content_hash)) AS content_hash
				FROM photos_source_resources`,
			)
			.all(),
	).toStrictEqual([
		{account_id: 'owner', source_id: sourceId, resource_key: resourceKey, content_hash: hash.toString('hex')},
	])
	durable.close()

	const movedPath = nodePath.join(homeDirectory, 'Archive', 'capture.aae')
	await fse.move(systemPath, movedPath)
	await index.movePath(systemPath, movedPath)
	await expect(index.photosConfirmedBackupResources('owner', sourceId, [resourceKey])).resolves.toStrictEqual([
		{
			resourceKey,
			contentHash: hash,
			path: '/Home/Archive/capture.aae',
			bytes,
			revision: await indexedContentRevision(movedPath),
		},
	])

	await index.stop()
	await fse.remove(nodePath.join(dataDirectory, 'file-index'))
	let failRemovalScan = true
	const removalWalk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (
		rootPath,
		stopping,
		includePath,
		onPathError,
	) {
		if (failRemovalScan) throw new Error('simulated source-removal scan failure')
		yield* walkFileTree(rootPath, stopping, includePath, onPathError)
	}
	const rebuilt = new FileIndex({
		dataDirectory,
		logger,
		isHidden: () => false,
		walkTree: removalWalk,
		enrichmentRuntime: {availableParallelism: 1, ...enrichmentRuntime},
	})
	indexes.push(rebuilt)
	await rebuilt.start()
	await rebuilt.setRoots([root])
	await rebuilt.initializePhotos('owner')
	// Removal can replay before startup's background reconciliation has rebuilt
	// the disposable index. Planning must fail closed after a bad scan, retain
	// the durable relation, and retry from a current Home snapshot.
	await expect(rebuilt.photosSourceRemovalFiles('owner', sourceId)).rejects.toThrow(
		"Photos source removal requires a current Home snapshot for 'owner'",
	)
	await expect(rebuilt.photosConfirmedBackupResources('owner', sourceId, [resourceKey])).resolves.toStrictEqual([
		{resourceKey, contentHash: hash},
	])
	failRemovalScan = false
	await expect(rebuilt.photosSourceRemovalFiles('owner', sourceId)).resolves.toStrictEqual([
		{
			id: hash.toString('hex'),
			path: '/Home/Archive/capture.aae',
			revision: await contentRevision(movedPath),
		},
	])
	await expect(rebuilt.photosConfirmedBackupResources('owner', sourceId, [resourceKey])).resolves.toStrictEqual([
		{
			resourceKey,
			contentHash: hash,
			path: '/Home/Archive/capture.aae',
			bytes,
			revision: await indexedContentRevision(movedPath),
		},
	])
	await expect(rebuilt.photosRemoveSource('owner', sourceId, false)).resolves.toBe(true)
	await expect(rebuilt.photosConfirmedBackupResources('owner', sourceId, [resourceKey])).resolves.toStrictEqual([])
})

test('attributes iPhone resources by durable hash after their files move', async () => {
	const hash = Buffer.alloc(32, 0x31)
	const enrichmentRuntime = {
		hashFile: async () => hash,
		generateThumbnail: async (_source: string, destination: string) => fse.outputFile(destination, 'thumbnail'),
		extractMediaMetadata: async () => ({
			kind: 'photo' as const,
			takenAt: 1,
			createdAt: 1,
			width: 1,
			height: 1,
		}),
	}
	const {index, root, trashRoot, homeDirectory, trashDirectory, dataDirectory} = await fixture(undefined, {
		includeTrash: true,
		enrichmentRuntime,
	})
	await index.initializePhotos('owner')
	const sourceId = 'iphone:test-source'
	await index.photosUpsertBackupSource('owner', sourceId, "Luke's iPhone", 123)
	const resourceKey = 'a'.repeat(64)
	const originalFilename = 'IMG_1234.HEIC'
	const sourceCreationDate = 1_706_990_400_000
	const original = nodePath.join(
		homeDirectory,
		'Photos',
		"Luke's iPhone",
		resourceKey.slice(0, 2),
		`${resourceKey}.heic`,
	)
	await fse.outputFile(original, 'still')
	await index.photosRegisterBackupResource(
		'owner',
		sourceId,
		resourceKey,
		original,
		hash,
		await contentRevision(original),
		originalFilename,
		sourceCreationDate,
	)
	await index.photosRegisterBackupResource(
		'owner',
		sourceId,
		resourceKey,
		original,
		hash,
		await contentRevision(original),
		'conflicting.mov',
		sourceCreationDate + 1,
	)
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})

	const item = (await index.photosListItems('owner', {sourceIds: [sourceId]}, undefined, 10)).items[0]!
	expect(item.takenAt).toBe(1)
	await expect(index.photosGetItem('owner', item.id)).resolves.toMatchObject({
		fileName: 'IMG_1234.HEIC',
		createdAt: 1,
		source: {id: sourceId, name: "Luke's iPhone", type: 'iphone'},
		path: `/Home/Photos/Luke's iPhone/${resourceKey.slice(0, 2)}/${resourceKey}.heic`,
	})
	await expect(index.photosListSources('owner')).resolves.toContainEqual(
		expect.objectContaining({
			id: sourceId,
			name: "Luke's iPhone",
			type: 'iphone',
			lastImportAt: expect.any(Number),
			stats: {photos: 1, videos: 0, sizeBytes: 5},
		}),
	)
	await expect(index.photosUpdateSource('owner', sourceId, {mode: 'only', paths: ['/Home/Photos']})).rejects.toThrow(
		'[photos-source-scope-unsupported]',
	)

	const moved = nodePath.join(homeDirectory, 'Trips', 'Iceland.heic')
	await fse.move(original, moved)
	await index.movePath(original, moved)
	await expect(index.photosConfirmedBackupResources('owner', sourceId, [resourceKey])).resolves.toStrictEqual([
		{
			resourceKey,
			contentHash: hash,
			path: '/Home/Trips/Iceland.heic',
			bytes: 5,
			revision: await indexedContentRevision(moved),
		},
	])
	await expect(index.photosGetItem('owner', item.id)).resolves.toMatchObject({
		fileName: 'IMG_1234.HEIC',
		source: {id: sourceId, name: "Luke's iPhone", type: 'iphone'},
		path: '/Home/Trips/Iceland.heic',
	})

	const umbrelSource = (await index.photosListSources('owner')).find(({type}) => type === 'umbrel')!
	await index.photosUpdateSource('owner', umbrelSource.id, {mode: 'only', paths: ['/Home/Photos']})
	await expect(index.photosSetFavorite('owner', [item.id], true)).resolves.toBe(1)
	const tripAlbum = await index.photosCreateAlbum('owner', 'Trip')
	await expect(index.photosAddAlbumItems('owner', tripAlbum.id, [item.id])).resolves.toBe(1)
	await expect(index.photosGetItem('owner', item.id)).resolves.toMatchObject({
		isFavorite: true,
		albums: [{id: tripAlbum.id, name: 'Trip'}],
	})
	await index.photosUpdateSource('owner', umbrelSource.id, {mode: 'everything', paths: []})

	const durable = new BetterSqlite3(nodePath.join(dataDirectory, 'umbrel.db'))
	expect(
		durable
			.prepare(
				`SELECT account_id, source_id, resource_key, lower(hex(content_hash)) AS content_hash,
					original_filename
				FROM photos_source_resources`,
			)
			.all(),
	).toStrictEqual([
		{
			account_id: 'owner',
			source_id: sourceId,
			resource_key: resourceKey,
			content_hash: hash.toString('hex'),
			original_filename: originalFilename,
		},
	])
	expect(
		durable
			.prepare('SELECT source_created_at FROM photos_content_state WHERE account_id = ? AND content_hash = ?')
			.get('owner', hash),
	).toStrictEqual({source_created_at: sourceCreationDate})
	durable.close()

	await index.stop()
	await fse.remove(nodePath.join(dataDirectory, 'file-index'))
	const rebuilt = new FileIndex({dataDirectory, logger, isHidden: () => false, enrichmentRuntime})
	indexes.push(rebuilt)
	await rebuilt.start()
	await rebuilt.setRoots([root, trashRoot])
	await rebuilt.reconcileRoot('/Home', 'rebuilt-iphone-source')
	await rebuilt.initializePhotos('owner')
	rebuilt.startBackgroundReconciliation()
	await pRetry(
		async () =>
			expect(await rebuilt.photosListItems('owner', {sourceIds: [sourceId]}, undefined, 10)).toMatchObject({
				total: 1,
			}),
		{retries: 200, minTimeout: 10, maxTimeout: 20},
	)
	await expect(rebuilt.photosConfirmedBackupResources('owner', sourceId, [resourceKey])).resolves.toStrictEqual([
		{
			resourceKey,
			contentHash: hash,
			path: '/Home/Trips/Iceland.heic',
			bytes: 5,
			revision: await indexedContentRevision(moved),
		},
	])
	await expect(rebuilt.photosSourceRemovalFiles('owner', sourceId)).resolves.toStrictEqual([
		{
			id: hash.toString('hex'),
			path: '/Home/Trips/Iceland.heic',
			revision: await contentRevision(moved),
		},
	])
	const trashed = nodePath.join(trashDirectory, 'Iceland.heic')
	await fse.move(moved, trashed)
	await rebuilt.movePath(moved, trashed)
	await expect(rebuilt.photosRemoveSource('owner', sourceId, false)).resolves.toBe(true)
	await expect(rebuilt.photosListItems('owner', {}, undefined, 10)).resolves.toMatchObject({total: 0})
	await expect(rebuilt.photosListItems('owner', {deleted: true}, undefined, 10)).resolves.toMatchObject({total: 1})
	await expect(rebuilt.photosGetItem('owner', item.id, true)).resolves.toMatchObject({
		path: '/Trash/Iceland.heic',
		source: {type: 'umbrel'},
	})
	await expect(rebuilt.photosConfirmedBackupResources('owner', sourceId, [resourceKey])).resolves.toStrictEqual([])
	await expect(rebuilt.photosListSources('owner')).resolves.not.toContainEqual(expect.objectContaining({id: sourceId}))
})

test('uses an iPhone source date only when the uploaded bytes have no capture date', async () => {
	const hash = Buffer.alloc(32, 0x32)
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile: async () => hash,
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
			extractMediaMetadata: async () => ({kind: 'photo' as const, width: 10, height: 10}),
		},
	})
	await index.initializePhotos('owner')
	const sourceId = 'iphone:date-fallback'
	const resourceKey = 'b'.repeat(64)
	const sourceCreationDate = 1_706_990_400_000
	await index.photosUpsertBackupSource('owner', sourceId, 'Phone', 123)
	const uploaded = nodePath.join(homeDirectory, 'Photos', 'Phone', resourceKey.slice(0, 2), `${resourceKey}.jpg`)
	await fse.outputFile(uploaded, 'photo without embedded date')
	await index.photosRegisterBackupResource(
		'owner',
		sourceId,
		resourceKey,
		uploaded,
		hash,
		await contentRevision(uploaded),
		'IMG_1234.JPG',
		sourceCreationDate,
	)
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})

	const item = (await index.photosListItems('owner', {sourceIds: [sourceId]}, undefined, 10)).items[0]!
	expect(item.takenAt).toBe(sourceCreationDate)
	await expect(index.photosGetItem('owner', item.id)).resolves.toMatchObject({
		fileName: 'IMG_1234.JPG',
		createdAt: sourceCreationDate,
	})
})

test('preserves independently kept duplicate files when removing an iPhone source', async () => {
	const hash = Buffer.alloc(32, 0x61)
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile: async () => hash,
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
		},
	})
	await index.initializePhotos('owner')
	const sourceId = 'iphone:duplicate-source'
	const resourceKey = '6'.repeat(64)
	await index.photosUpsertBackupSource('owner', sourceId, 'Phone', 123)
	const uploaded = nodePath.join(homeDirectory, 'Photos', 'Phone', resourceKey.slice(0, 2), `${resourceKey}.heic`)
	const keptCopy = nodePath.join(homeDirectory, 'Pictures', 'kept-copy.heic')
	await Promise.all([fse.outputFile(uploaded, 'same bytes'), fse.outputFile(keptCopy, 'same bytes')])
	await index.photosRegisterBackupResource(
		'owner',
		sourceId,
		resourceKey,
		uploaded,
		hash,
		await contentRevision(uploaded),
	)
	await index.reconcileRoot('/Home', 'iphone-duplicate')
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})

	await expect(index.photosSourceRemovalFiles('owner', sourceId)).resolves.toStrictEqual([])
	await expect(index.photosRemoveSource('owner', sourceId, false)).resolves.toBe(true)
	const preserved = await index.photosListItems('owner', {}, undefined, 10)
	expect(preserved).toMatchObject({total: 1})
	await expect(index.photosGetItem('owner', preserved.items[0]!.id)).resolves.toMatchObject({
		source: {type: 'umbrel'},
	})
})

test('does not hash unrelated Home files when removing a fully resolved iPhone source', async () => {
	const sourceHash = Buffer.alloc(32, 0x64)
	const hashFile = vi.fn(async () => Buffer.alloc(32, 0x65))
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile,
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
		},
	})
	await index.initializePhotos('owner')
	const sourceId = 'iphone:resolved-source'
	const resourceKey = '8'.repeat(64)
	await index.photosUpsertBackupSource('owner', sourceId, 'Phone', 123)
	const uploaded = nodePath.join(homeDirectory, 'Photos', 'Phone', resourceKey.slice(0, 2), `${resourceKey}.heic`)
	await fse.outputFile(uploaded, 'photo')
	await index.photosRegisterBackupResource(
		'owner',
		sourceId,
		resourceKey,
		uploaded,
		sourceHash,
		await contentRevision(uploaded),
	)
	await fse.outputFile(nodePath.join(homeDirectory, 'Machines', 'large-disk.iso'), 'unrelated bytes')
	await index.reconcileRoot('/Home', 'unrelated-home-file')
	hashFile.mockClear()

	await expect(index.photosSourceRemovalFiles('owner', sourceId)).resolves.toMatchObject([
		{id: sourceHash.toString('hex'), path: `/Home/Photos/Phone/${resourceKey.slice(0, 2)}/${resourceKey}.heic`},
	])
	expect(hashFile).not.toHaveBeenCalled()
})

test('restores iPhone attribution only after its source relation is freshly registered', async () => {
	const hash = Buffer.alloc(32, 0x62)
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile: async () => hash,
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
		},
	})
	await index.initializePhotos('owner')
	const sourceId = 'iphone:reregistered-source'
	const resourceKey = '7'.repeat(64)
	await index.photosUpsertBackupSource('owner', sourceId, 'Phone', 123)
	const uploaded = nodePath.join(homeDirectory, 'Photos', 'Phone', resourceKey.slice(0, 2), `${resourceKey}.heic`)
	await fse.outputFile(uploaded, 'photo')
	const revision = await contentRevision(uploaded)
	await index.photosRegisterBackupResource('owner', sourceId, resourceKey, uploaded, hash, revision)
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	const item = (await index.photosListItems('owner', {}, undefined, 10)).items[0]!
	await expect(index.photosGetItem('owner', item.id)).resolves.toMatchObject({source: {id: sourceId, type: 'iphone'}})
	await expect(index.photosRemoveSource('owner', sourceId, true)).resolves.toBe(true)
	await expect(index.photosConfirmedBackupResources('owner', sourceId, [resourceKey])).resolves.toStrictEqual([])
	await expect(index.photosGetItem('owner', item.id)).resolves.toMatchObject({source: {type: 'umbrel'}})

	await index.photosUpsertBackupSource('owner', sourceId, 'Phone', 456)
	await index.photosRegisterBackupResource('owner', sourceId, resourceKey, uploaded, hash, revision)

	await expect(index.photosConfirmedBackupResources('owner', sourceId, [resourceKey])).resolves.toHaveLength(1)
	await expect(index.photosGetItem('owner', item.id)).resolves.toMatchObject({source: {id: sourceId, type: 'iphone'}})
})

test('paginates and combines Photos filters without duplicates or unstable offsets', async () => {
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile: async (systemPath) => Buffer.alloc(32, Number(nodePath.basename(systemPath)[0])),
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
			extractMediaMetadata: async (systemPath) => {
				const order = Number(nodePath.basename(systemPath)[0])
				return {
					kind: order === 5 ? ('video' as const) : ('photo' as const),
					takenAt: order * 1_000,
					createdAt: 500,
					width: 100,
					height: 50,
					...(order === 4 ? {subKind: 'panorama' as const} : {}),
				}
			},
		},
	})
	await Promise.all(
		[1, 2, 3, 4].map((order) => writeFile(nodePath.join(homeDirectory, `${order}-photo.jpg`), String(order))),
	)
	await writeFile(nodePath.join(homeDirectory, '5-video.mp4'), '5')
	await index.reconcileRoot('/Home', 'pagination')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})

	const first = await index.photosListItems('owner', {}, undefined, 2)
	const second = await index.photosListItems('owner', {}, first.nextCursor, 2)
	const third = await index.photosListItems('owner', {}, second.nextCursor, 2)
	expect(first.total).toBe(5)
	expect(second.total).toBeUndefined()
	expect([...first.items, ...second.items, ...third.items].map(({id}) => id)).toHaveLength(5)
	expect(new Set([...first.items, ...second.items, ...third.items].map(({id}) => id)).size).toBe(5)
	await index.photosSetFavorite('owner', [second.items[0]!.id], true)
	const album = await index.photosCreateAlbum('owner', 'Filtered', [second.items[0]!.id])
	await expect(
		index.photosListItems(
			'owner',
			{favorite: true, albumIds: [album.id], dates: [{from: 2_000, to: 5_000}], kind: 'photo'},
			undefined,
			10,
		),
	).resolves.toMatchObject({total: 1})
	await expect(index.photosListItems('owner', {kind: 'video'}, undefined, 10)).resolves.toMatchObject({total: 1})
	await expect(index.photosListItems('owner', {subKind: 'panorama'}, undefined, 10)).resolves.toMatchObject({total: 1})
})

test('preserves a Photos id, favorite, and album membership across a filesystem move', async () => {
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			hashFile: async () => Buffer.alloc(32, 0x32),
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
		},
	})
	const source = nodePath.join(homeDirectory, 'Before', 'photo.jpg')
	const destination = nodePath.join(homeDirectory, 'After', 'renamed.jpg')
	await fse.outputFile(source, 'photo')
	await index.reconcileRoot('/Home', 'move-state')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	const original = (await index.photosListItems('owner', {}, undefined, 10)).items[0]!
	await index.photosSetFavorite('owner', [original.id], true)
	const album = await index.photosCreateAlbum('owner', 'Moves', [original.id])
	await fse.move(source, destination)
	await index.movePath(source, destination)

	await expect(index.photosGetItem('owner', original.id)).resolves.toMatchObject({
		id: original.id,
		path: '/Home/After/renamed.jpg',
		isFavorite: true,
		albums: [{id: album.id, name: 'Moves'}],
	})
})

test('reports indexing, enrichment progress, ready, and persistent enrichment failures', async () => {
	const onPhotosIndexingProgress = vi.fn()
	const {index, homeDirectory} = await fixture(undefined, {
		onPhotosIndexingProgress,
		enrichmentRuntime: {
			hashFile: async () => Buffer.alloc(32, 0x42),
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
			extractMediaMetadata: async () => {
				throw new Error('unsupported image payload')
			},
		},
	})
	await writeFile(nodePath.join(homeDirectory, 'broken.jpg'), 'broken')
	await expect(index.photosIndexingState('owner')).resolves.toMatchObject({phase: 'indexing'})
	await index.reconcileRoot('/Home', 'index-state')
	await index.initializePhotos('owner')
	await expect(index.photosIndexingState('owner')).resolves.toMatchObject({phase: 'enriching', completed: 0, total: 1})
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'degraded'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	await pRetry(
		() =>
			expect(onPhotosIndexingProgress.mock.calls.flatMap(([progress]) => progress)).toContainEqual(
				expect.objectContaining({accountId: 'owner', state: expect.objectContaining({phase: 'degraded'})}),
			),
		{retries: 200, minTimeout: 10, maxTimeout: 20},
	)
})

test('preserves Photos ids and user state when the disposable file index is rebuilt', async () => {
	const digest = Buffer.alloc(32, 0xae)
	const runtime = {
		availableParallelism: 1,
		hashFile: async () => digest,
		generateThumbnail: async (_source: string, destination: string) => fse.outputFile(destination, 'thumbnail'),
		extractMediaMetadata: async () => ({
			kind: 'photo' as const,
			takenAt: 2_000,
			createdAt: 1_000,
			width: 100,
			height: 50,
		}),
	}
	const {index, root, homeDirectory, dataDirectory} = await fixture(undefined, {enrichmentRuntime: runtime})
	await writeFile(nodePath.join(homeDirectory, 'kept.jpg'), 'photo')
	await index.reconcileRoot('/Home', 'initial')
	await index.initializePhotos('owner')
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	const original = (await index.photosListItems('owner', {}, undefined, 10)).items[0]
	await index.photosSetFavorite('owner', [original.id], true)
	const album = await index.photosCreateAlbum('owner', 'Kept', [original.id])

	await index.stop()
	await fse.remove(nodePath.join(dataDirectory, 'file-index'))
	const rebuilt = new FileIndex({dataDirectory, logger, isHidden: () => false, enrichmentRuntime: runtime})
	indexes.push(rebuilt)
	await rebuilt.start()
	await rebuilt.setRoots([root])
	await rebuilt.reconcileRoot('/Home', 'rebuilt')
	await rebuilt.initializePhotos('owner')
	await expect(rebuilt.photosIndexingState('owner')).resolves.toMatchObject({
		phase: 'enriching',
		completed: 0,
		total: 1,
	})
	await expect(rebuilt.photosListItems('owner', {}, undefined, 10)).resolves.toMatchObject({total: 0, items: []})
	const warmingPhotos = new BetterSqlite3(nodePath.join(dataDirectory, 'umbrel.db'))
	expect(
		warmingPhotos
			.prepare('SELECT is_favorite FROM photos_content_state WHERE account_id = ? AND content_hash = ?')
			.get('owner', digest),
	).toStrictEqual({is_favorite: 1})
	warmingPhotos.close()
	rebuilt.startBackgroundReconciliation()
	await pRetry(async () => expect(await rebuilt.photosIndexingState('owner')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})

	const restored = (await rebuilt.photosListItems('owner', {}, undefined, 10)).items[0]
	expect(restored).toMatchObject({id: original.id, isFavorite: true})
	await expect(rebuilt.photosListAlbums('owner')).resolves.toContainEqual(
		expect.objectContaining({id: album.id, count: 1}),
	)
})

test('recreates externally removed thumbnail shard directories', async () => {
	const digests = [Buffer.alloc(32, 0xb1), Buffer.alloc(32, 0xb2)]
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await writeFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile: async () => digests.shift()!, generateThumbnail},
	})
	const firstImage = nodePath.join(homeDirectory, 'first.png')
	await writeFile(firstImage, 'first')
	await index.ensureThumbnail(firstImage)

	const thumbnailDirectory = nodePath.join(dataDirectory, 'thumbnails')
	await fse.remove(thumbnailDirectory)
	const secondImage = nodePath.join(homeDirectory, 'second.png')
	await writeFile(secondImage, 'second')
	const second = await index.ensureThumbnail(secondImage)

	await expect(fse.readFile(thumbnailSystemPath(thumbnailDirectory, second), 'utf8')).resolves.toBe('thumbnail')
	expect(generateThumbnail).toHaveBeenCalledTimes(2)
})

test('keeps the file index available when thumbnail artifact storage cannot start', async () => {
	const rootDirectory = await temporary.create()
	const dataDirectory = await temporary.create()
	const homeDirectory = nodePath.join(rootDirectory, 'home')
	const image = nodePath.join(homeDirectory, 'photo.png')
	await Promise.all([
		fse.outputFile(nodePath.join(dataDirectory, 'thumbnails'), 'blocks the thumbnail directory'),
		fse.outputFile(image, 'image'),
	])
	const index = new FileIndex({dataDirectory, logger, isHidden: () => false})
	indexes.push(index)

	await index.start()
	await index.setRoots([
		{
			virtualPath: '/Home',
			systemPath: homeDirectory,
			ownerId: 'owner',
			kind: 'home',
			searchEnabled: true,
		},
	])
	await index.reconcileRoot('/Home', 'thumbnail-storage-failure')

	await expect(index.status()).resolves.toMatchObject({available: true, entryCount: 1})
	await expect(candidateNames(index, 'photo')).resolves.toStrictEqual(['photo.png'])
	expect(logger.error).toHaveBeenCalledWith(
		'Thumbnail artifact storage is unavailable; file indexing will continue',
		expect.objectContaining({code: 'EEXIST'}),
	)
})

test('backs off persistent runtime artifact-directory failures instead of hot-looping', async () => {
	const rootDirectory = await temporary.create()
	const dataDirectory = await temporary.create()
	const homeDirectory = nodePath.join(rootDirectory, 'home')
	const image = nodePath.join(homeDirectory, 'photo.png')
	await Promise.all([
		fse.outputFile(nodePath.join(dataDirectory, 'thumbnails'), 'blocks the thumbnail directory'),
		fse.outputFile(image, 'image'),
	])
	const generateThumbnail = vi.fn()
	const index = new FileIndex({
		dataDirectory,
		logger,
		isHidden: () => false,
		enrichmentRuntime: {hashFile: async () => Buffer.alloc(32, 0xbc), generateThumbnail},
	})
	indexes.push(index)
	await index.start()
	await index.setRoots([
		{
			virtualPath: '/Home',
			systemPath: homeDirectory,
			ownerId: 'owner',
			kind: 'home',
			searchEnabled: true,
		},
	])
	await index.reconcileRoot('/Home', 'artifact-runtime-failure')
	index.startBackgroundReconciliation()

	await pRetry(async () => expect(await index.status()).toMatchObject({enrichment: {thumbnailFailures: 1}}), {
		retries: 50,
		minTimeout: 10,
		maxTimeout: 20,
	})
	await new Promise((resolve) => setTimeout(resolve, 150))
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	expect(database.prepare('SELECT state, failure_count FROM thumbnail_variants').get()).toStrictEqual({
		state: 'failed',
		failure_count: 1,
	})
	database.close()
	expect(generateThumbnail).not.toHaveBeenCalled()
	expect(
		logger.error.mock.calls.filter(([message]) =>
			[`Failed to enrich '${image}'`, `Failed to generate thumbnail for '${image}'`].some((prefix) =>
				String(message).startsWith(prefix),
			),
		),
	).toHaveLength(1)
})

test('rejects unsupported thumbnail sources without reconciling their root', async () => {
	const walkTree = vi.fn(walkFileTree)
	const {index, homeDirectory} = await fixture(walkTree)
	await index.reconcileRoot('/Home', 'initial')
	walkTree.mockClear()
	const directory = nodePath.join(homeDirectory, 'album.jpg')
	const unsupported = nodePath.join(homeDirectory, 'notes.txt')
	await Promise.all([fse.ensureDir(directory), writeFile(unsupported, 'notes')])

	await expect(index.ensureThumbnail(directory)).rejects.toThrow('Unsupported or missing thumbnail source')
	await expect(index.ensureThumbnail(unsupported)).rejects.toThrow('Unsupported or missing thumbnail source')
	expect(walkTree).not.toHaveBeenCalled()
})

test.each(['/External', '/Apps'])(
	'indexes %s thumbnails on demand without hashing or crawling the root',
	async (virtualPath) => {
		const hashFile = vi.fn(async () => Buffer.alloc(32, 0xac))
		const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
			await fse.outputFile(destination, 'thumbnail')
		})
		const {index, rootDirectory, dataDirectory} = await fixture(undefined, {
			enrichmentRuntime: {hashFile, generateThumbnail},
		})
		const externalDirectory = nodePath.join(rootDirectory, 'external')
		const image = nodePath.join(externalDirectory, 'camera', 'photo.png')
		await fse.outputFile(image, 'external image')
		await index.addRoot({
			virtualPath,
			systemPath: externalDirectory,
			ownerId: 'owner',
			kind: 'apps',
			searchEnabled: false,
			scanEnabled: false,
		})

		await index.reconcileAll('must-not-crawl-transient-storage')
		await expect(index.directorySizes([virtualPath])).resolves.toEqual([])
		await expect(index.getEntryBySystemPath(image)).resolves.toBeUndefined()
		const reference = await index.ensureThumbnail(image)
		expect(reference).toMatchObject({
			kind: 'transient',
			key: expect.stringMatching(/^[a-f0-9]{64}$/),
			variant: THUMBNAIL_VARIANT,
			format: 'webp',
		})
		await expect(index.getEntryBySystemPath(image)).resolves.toMatchObject({name: 'photo.png'})
		expect(hashFile).not.toHaveBeenCalled()
		expect(generateThumbnail).toHaveBeenCalledOnce()
		const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
		expect(database.prepare('SELECT COUNT(*) AS count FROM contents').get()).toStrictEqual({count: 0})
		expect(
			database
				.prepare('SELECT thumbnail_identity_kind, content_id FROM entries WHERE relative_path = ?')
				.get('camera/photo.png'),
		).toStrictEqual({thumbnail_identity_kind: 'transient', content_id: null})
		expect(database.prepare('SELECT artifact_key, state FROM transient_thumbnail_variants').get()).toStrictEqual({
			artifact_key: reference.key,
			state: 'ready',
		})
		database.close()
	},
)

test('publishes a transient thumbnail only for a stable filesystem fingerprint', async () => {
	let mutateSource = true
	const generateThumbnail = vi.fn(async (source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
		if (mutateSource) {
			mutateSource = false
			await appendFile(source, ' changed during generation')
		}
	})
	const {index, rootDirectory, dataDirectory} = await fixture(undefined, {enrichmentRuntime: {generateThumbnail}})
	const externalDirectory = nodePath.join(rootDirectory, 'external')
	const image = nodePath.join(externalDirectory, 'camera.png')
	await fse.outputFile(image, 'external image')
	await index.addRoot({
		virtualPath: '/External',
		systemPath: externalDirectory,
		ownerId: 'owner',
		kind: 'apps',
		searchEnabled: false,
		scanEnabled: false,
	})

	const reference = await index.ensureThumbnail(image)
	expect(reference.kind).toBe('transient')
	expect(generateThumbnail).toHaveBeenCalledTimes(2)
	await expect(
		fse.pathExists(thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), reference)),
	).resolves.toBe(true)
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	expect(database.prepare('SELECT COUNT(*) AS count FROM contents').get()).toStrictEqual({count: 0})
	expect(database.prepare('SELECT COUNT(*) AS count FROM transient_thumbnail_variants').get()).toStrictEqual({count: 1})
	database.close()
})

test('refreshes used transient thumbnails and expires entries unused for seven days', async () => {
	const day = 24 * 60 * 60 * 1000
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, rootDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			generateThumbnail,
		},
	})
	const externalDirectory = nodePath.join(rootDirectory, 'external')
	const unused = nodePath.join(externalDirectory, 'unused.png')
	const retained = nodePath.join(externalDirectory, 'retained.png')
	await Promise.all([fse.outputFile(unused, 'unused'), fse.outputFile(retained, 'retained')])
	await index.addRoot({
		virtualPath: '/External',
		systemPath: externalDirectory,
		ownerId: 'owner',
		kind: 'apps',
		searchEnabled: false,
		scanEnabled: false,
	})

	const unusedReference = await index.ensureThumbnail(unused)
	const retainedReference = await index.ensureThumbnail(retained)
	const databasePath = nodePath.join(dataDirectory, 'file-index', 'index.db')
	const setObservedAt = (relativePath: string, observedAt: number) => {
		const database = new BetterSqlite3(databasePath)
		database.prepare('UPDATE entries SET observed_at = ? WHERE relative_path = ?').run(observedAt, relativePath)
		database.close()
	}
	const observedAt = (relativePath: string) => {
		const database = new BetterSqlite3(databasePath, {readonly: true})
		const row = database.prepare('SELECT observed_at FROM entries WHERE relative_path = ?').get(relativePath) as
			| {observed_at: number}
			| undefined
		database.close()
		return row?.observed_at
	}

	setObservedAt('retained.png', Date.now() - 2 * day)
	await expect(index.getExistingThumbnail(retained)).resolves.toStrictEqual(retainedReference)
	const listingObservation = observedAt('retained.png')!
	expect(listingObservation).toBeGreaterThan(Date.now() - day)
	await expect(index.getExistingThumbnail(retained)).resolves.toStrictEqual(retainedReference)
	expect(observedAt('retained.png')).toBe(listingObservation)

	setObservedAt('retained.png', Date.now() - 2 * day)
	await expect(
		index.matchesThumbnail(retained, retainedReference.kind, retainedReference.key, retainedReference.variant),
	).resolves.toBe(true)
	expect(observedAt('retained.png')).toBeGreaterThan(Date.now() - day)
	setObservedAt('retained.png', Date.now() - 2 * day)
	await expect(index.ensureThumbnail(retained)).resolves.toStrictEqual(retainedReference)
	expect(observedAt('retained.png')).toBeGreaterThan(Date.now() - day)

	setObservedAt('unused.png', Date.now() - 8 * day)
	await fse.remove(unused)
	await index.reconcileAll('expire-transient-entries')
	await expect(index.getEntryBySystemPath(unused)).resolves.toBeUndefined()
	await expect(index.getEntryBySystemPath(retained)).resolves.toMatchObject({name: 'retained.png'})

	index.startBackgroundReconciliation()
	const unusedThumbnail = thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), unusedReference)
	await pRetry(async () => expect(await fse.pathExists(unusedThumbnail)).toBe(false), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})
	expect(generateThumbnail).toHaveBeenCalledTimes(2)
})

test('keeps reconciliation non-rejecting when transient expiry fails', async () => {
	const {index, rootDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
		},
	})
	const externalDirectory = nodePath.join(rootDirectory, 'external')
	const image = nodePath.join(externalDirectory, 'expired.png')
	await fse.outputFile(image, 'external image')
	await index.addRoot({
		virtualPath: '/External',
		systemPath: externalDirectory,
		ownerId: 'owner',
		kind: 'apps',
		searchEnabled: false,
		scanEnabled: false,
	})
	await index.ensureThumbnail(image)

	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	database.prepare('UPDATE entries SET observed_at = 0 WHERE relative_path = ?').run('expired.png')
	database.exec(`
		CREATE TRIGGER reject_transient_expiry BEFORE DELETE ON entries
		WHEN OLD.observed_at = 0
		BEGIN
			SELECT RAISE(ABORT, 'injected transient expiry failure');
		END
	`)
	database.close()

	await expect(index.reconcileAll('transient-expiry-failure')).resolves.toBeUndefined()
	expect(logger.error).toHaveBeenCalledWith(
		'Failed to expire unused transient file index entries',
		expect.objectContaining({message: 'injected transient expiry failure'}),
	)
	await expect(index.getEntryBySystemPath(image)).resolves.toMatchObject({name: 'expired.png'})
})

test('uses the standard BLAKE3 digest and never rehashes an unchanged revision', async () => {
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory} = await fixture(undefined, {enrichmentRuntime: {generateThumbnail}})
	const image = nodePath.join(homeDirectory, 'known.png')
	await writeFile(image, 'abc')

	const first = await index.ensureThumbnail(image)
	expect(first.key).toBe('6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85')
	await expect(index.ensureThumbnail(image)).resolves.toStrictEqual(first)
	expect(generateThumbnail).toHaveBeenCalledOnce()
})

test('rehashes a changed revision and garbage-collects its old content-addressed asset', async () => {
	const digests = [Buffer.alloc(32, 0x21), Buffer.alloc(32, 0x22)]
	const hashFile = vi.fn(async () => digests.shift()!)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const image = nodePath.join(homeDirectory, 'changing.png')
	await writeFile(image, 'first')
	const first = await index.ensureThumbnail(image)
	await expect(index.ensureThumbnail(image)).resolves.toStrictEqual(first)

	await writeFile(image, 'second revision with a different size')
	const second = await index.ensureThumbnail(image)
	expect(second.key).not.toBe(first.key)
	expect(hashFile).toHaveBeenCalledTimes(2)
	expect(generateThumbnail).toHaveBeenCalledTimes(2)

	const oldThumbnail = thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), first)
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await fse.pathExists(oldThumbnail)).toBe(false), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})
})

test('drains the durable thumbnail backlog one entry at a time', async () => {
	let releaseGeneration!: () => void
	let signalGeneration!: () => void
	const generationStarted = new Promise<void>((resolve) => (signalGeneration = resolve))
	const generationReleased = new Promise<void>((resolve) => (releaseGeneration = resolve))
	let firstGeneration = true
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		if (firstGeneration) {
			firstGeneration = false
			signalGeneration()
			await generationReleased
		}
		await fse.outputFile(destination, 'thumbnail')
	})
	const hashFile = vi.fn(async (systemPath: string) => {
		const number = Number(nodePath.basename(systemPath).match(/\d+/)?.[0] ?? 0)
		return Buffer.alloc(32, number + 1)
	})
	const {index, homeDirectory} = await fixture(undefined, {enrichmentRuntime: {hashFile, generateThumbnail}})
	const fileCount = 100
	await Promise.all(
		Array.from({length: fileCount}, (_, number) =>
			writeFile(nodePath.join(homeDirectory, `background-${String(number).padStart(3, '0')}.png`), String(number)),
		),
	)

	index.startBackgroundReconciliation()
	await generationStarted
	await expect(index.status()).resolves.toMatchObject({
		entryCount: fileCount,
		roots: [{state: 'ready'}],
		enrichment: {eligibleEntries: fileCount, readyThumbnails: 0},
	})

	releaseGeneration()
	await pRetry(
		async () => {
			await expect(index.status()).resolves.toMatchObject({
				enrichment: {
					eligibleEntries: fileCount,
					hashedEntries: fileCount,
					pendingHashes: 0,
					uniqueContents: fileCount,
					readyThumbnails: fileCount,
				},
			})
		},
		{retries: 500, minTimeout: 10, maxTimeout: 20},
	)
	expect(hashFile).toHaveBeenCalledTimes(fileCount)
	expect(generateThumbnail).toHaveBeenCalledTimes(fileCount)
})

test('uses one quarter of available CPU threads for background enrichment', async () => {
	let activeHashes = 0
	let maxActiveHashes = 0
	let releaseHashes!: () => void
	const hashesReleased = new Promise<void>((resolve) => (releaseHashes = resolve))
	const hashFile = vi.fn(async (systemPath: string) => {
		activeHashes++
		maxActiveHashes = Math.max(maxActiveHashes, activeHashes)
		try {
			await hashesReleased
		} finally {
			activeHashes--
		}
		const number = Number(nodePath.basename(systemPath).match(/\d+/)?.[0] ?? 0)
		return Buffer.alloc(32, number + 1)
	})
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {availableParallelism: 8, hashFile, generateThumbnail},
	})
	const fileCount = 4
	await Promise.all(
		Array.from({length: fileCount}, (_, number) =>
			writeFile(nodePath.join(homeDirectory, `parallel-background-${number}.png`), String(number)),
		),
	)

	index.startBackgroundReconciliation()
	try {
		await pRetry(async () => expect(maxActiveHashes).toBe(2), {retries: 100, minTimeout: 10, maxTimeout: 20})
	} finally {
		releaseHashes()
	}

	await pRetry(async () => expect(await index.status()).toMatchObject({enrichment: {readyThumbnails: fileCount}}), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})
	expect(maxActiveHashes).toBe(2)
	expect(hashFile).toHaveBeenCalledTimes(fileCount)
	expect(generateThumbnail).toHaveBeenCalledTimes(fileCount)
})

test('uses three quarters of available CPU threads for on-demand enrichment', async () => {
	let activeConversions = 0
	let maxActiveConversions = 0
	let releaseConversions!: () => void
	const conversionsReleased = new Promise<void>((resolve) => (releaseConversions = resolve))
	const hashFile = vi.fn(async (systemPath: string) => {
		const number = Number(nodePath.basename(systemPath).match(/\d+/)?.[0] ?? 0)
		return Buffer.alloc(32, number + 1)
	})
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		activeConversions++
		maxActiveConversions = Math.max(maxActiveConversions, activeConversions)
		try {
			await conversionsReleased
		} finally {
			activeConversions--
		}
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {availableParallelism: 8, hashFile, generateThumbnail},
	})
	const paths = Array.from({length: 8}, (_, number) => nodePath.join(homeDirectory, `parallel-on-demand-${number}.png`))
	await Promise.all(paths.map((path, number) => writeFile(path, String(number))))
	await Promise.all(paths.map((path) => index.reconcilePath(path)))

	const thumbnails = paths.map((path) => index.ensureThumbnail(path))
	try {
		await pRetry(async () => expect(maxActiveConversions).toBe(6), {retries: 100, minTimeout: 10, maxTimeout: 20})
	} finally {
		releaseConversions()
	}
	await expect(Promise.all(thumbnails)).resolves.toHaveLength(paths.length)

	expect(maxActiveConversions).toBe(6)
	expect(hashFile).toHaveBeenCalledTimes(paths.length)
	expect(generateThumbnail).toHaveBeenCalledTimes(paths.length)
})

test('coalesces concurrent on-demand enrichment for the same entry', async () => {
	let signalHashStarted!: () => void
	let releaseHash!: () => void
	const hashStarted = new Promise<void>((resolve) => (signalHashStarted = resolve))
	const hashReleased = new Promise<void>((resolve) => (releaseHash = resolve))
	const hashFile = vi.fn(async () => {
		signalHashStarted()
		await hashReleased
		return Buffer.alloc(32, 0x77)
	})
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {availableParallelism: 8, hashFile, generateThumbnail},
	})
	const path = nodePath.join(homeDirectory, 'parallel-same-entry.png')
	await writeFile(path, 'image')
	await index.reconcilePath(path)

	const thumbnails = Array.from({length: 8}, () => index.ensureThumbnail(path))
	try {
		await hashStarted
		await new Promise((resolve) => setTimeout(resolve, 50))
		expect(hashFile).toHaveBeenCalledOnce()
	} finally {
		releaseHash()
	}
	const references = await Promise.all(thumbnails)

	expect(references.every((reference) => reference.key === references[0].key)).toBe(true)
	expect(hashFile).toHaveBeenCalledOnce()
	expect(generateThumbnail).toHaveBeenCalledOnce()
})

test('continues background thumbnail enrichment during an active metadata reconciliation', async () => {
	let releaseScan!: () => void
	let signalScanBlocked!: () => void
	const scanReleased = new Promise<void>((resolve) => (releaseScan = resolve))
	const scanBlocked = new Promise<void>((resolve) => (signalScanBlocked = resolve))
	let blockAfterFirstEntry = true
	const walkTree: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (
		rootSystemPath,
		stopping,
		includePath,
		onPathError,
	) {
		for await (const entry of walkFileTree(rootSystemPath, stopping, includePath, onPathError)) {
			yield entry
			if (blockAfterFirstEntry) {
				blockAfterFirstEntry = false
				signalScanBlocked()
				await scanReleased
			}
		}
	}
	const hashFile = vi.fn(async () => Buffer.alloc(32, 0xb7))
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory} = await fixture(walkTree, {
		batchSize: 1,
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	await writeFile(nodePath.join(homeDirectory, 'during-scan.png'), 'image')

	index.startBackgroundReconciliation()
	await scanBlocked
	try {
		await pRetry(
			async () => {
				await expect(index.status()).resolves.toMatchObject({
					roots: [{state: 'warming'}],
					enrichment: {hashedEntries: 1, readyThumbnails: 1},
				})
			},
			{retries: 200, minTimeout: 10, maxTimeout: 20},
		)
	} finally {
		releaseScan()
	}

	expect(hashFile).toHaveBeenCalledOnce()
	expect(generateThumbnail).toHaveBeenCalledOnce()
})

test('serves on-demand work while a background conversion is still active', async () => {
	let releaseBackground!: () => void
	let signalBackgroundStarted!: () => void
	const backgroundReleased = new Promise<void>((resolve) => (releaseBackground = resolve))
	const backgroundStarted = new Promise<void>((resolve) => (signalBackgroundStarted = resolve))
	const generateThumbnail = vi.fn(async (source: string, destination: string) => {
		if (nodePath.basename(source) === 'background.png') {
			signalBackgroundStarted()
			await backgroundReleased
		}
		await fse.outputFile(destination, 'thumbnail')
	})
	const hashFile = vi.fn(async (systemPath: string) => {
		return Buffer.alloc(32, nodePath.basename(systemPath) === 'background.png' ? 0xc1 : 0xc2)
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const background = nodePath.join(homeDirectory, 'background.png')
	const requested = nodePath.join(homeDirectory, 'requested.png')
	await writeFile(background, 'background')
	await index.reconcilePath(background)
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	database.prepare('UPDATE entries SET hash_retry_at = 0').run()
	database.close()

	index.startBackgroundReconciliation()
	await backgroundStarted
	await writeFile(requested, 'requested')
	try {
		await expect(
			Promise.race([
				index.ensureThumbnail(requested),
				new Promise((_, reject) => setTimeout(() => reject(new Error('on-demand work was blocked')), 1_000)),
			]),
		).resolves.toMatchObject({kind: 'content', key: 'c2'.repeat(32)})
	} finally {
		releaseBackground()
	}

	expect(generateThumbnail.mock.calls.map(([source]) => nodePath.basename(source))).toStrictEqual([
		'background.png',
		'requested.png',
	])
})

test('does not restart background hashing while on-demand work is active', async () => {
	let releaseOnDemand!: () => void
	let signalOnDemandStarted!: () => void
	const onDemandReleased = new Promise<void>((resolve) => (releaseOnDemand = resolve))
	const onDemandStarted = new Promise<void>((resolve) => (signalOnDemandStarted = resolve))
	const hashFile = vi.fn(async (systemPath: string) =>
		Buffer.alloc(32, nodePath.basename(systemPath) === 'requested.png' ? 0xd1 : 0xd2),
	)
	const generateThumbnail = vi.fn(async (source: string, destination: string) => {
		if (nodePath.basename(source) === 'requested.png') {
			signalOnDemandStarted()
			await onDemandReleased
		}
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const requested = nodePath.join(homeDirectory, 'requested.png')
	const background = nodePath.join(homeDirectory, 'background.png')
	await Promise.all([writeFile(requested, 'requested'), writeFile(background, 'background')])
	await Promise.all([index.reconcilePath(requested), index.reconcilePath(background)])
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	database.prepare('UPDATE entries SET hash_retry_at = 0').run()
	database.close()

	const requestedThumbnail = index.ensureThumbnail(requested)
	await onDemandStarted
	index.startBackgroundReconciliation()
	try {
		await new Promise((resolve) => setTimeout(resolve, 350))
		expect(hashFile.mock.calls.map(([source]) => nodePath.basename(source))).toStrictEqual(['requested.png'])
	} finally {
		releaseOnDemand()
	}
	await expect(requestedThumbnail).resolves.toMatchObject({kind: 'content', key: 'd1'.repeat(32)})
	await pRetry(async () => expect(await index.status()).toMatchObject({enrichment: {readyThumbnails: 2}}), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})
	expect(hashFile).toHaveBeenCalledTimes(2)
})

test('shares content and one thumbnail between duplicate files', async () => {
	const digest = Buffer.alloc(32, 0xcd)
	const hashFile = vi.fn(async () => digest)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const first = nodePath.join(homeDirectory, 'first.png')
	const second = nodePath.join(homeDirectory, 'second.png')
	await Promise.all([writeFile(first, 'same content'), writeFile(second, 'same content')])

	const [firstReference, secondReference] = await Promise.all([
		index.ensureThumbnail(first),
		index.ensureThumbnail(second),
	])
	expect(secondReference).toStrictEqual(firstReference)
	expect(hashFile).toHaveBeenCalledTimes(2)
	expect(generateThumbnail).toHaveBeenCalledOnce()

	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	expect(database.prepare('SELECT COUNT(*) AS count FROM contents').get()).toStrictEqual({count: 1})
	expect(database.prepare('SELECT COUNT(DISTINCT content_id) AS count FROM entries').get()).toStrictEqual({count: 1})
	database.close()
})

test('uses another duplicate when a thumbnail content reference disappears', async () => {
	const digest = Buffer.alloc(32, 0xcf)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile: async () => digest, generateThumbnail},
	})
	const vanished = nodePath.join(homeDirectory, 'first.png')
	const available = nodePath.join(homeDirectory, 'second.png')
	await Promise.all([writeFile(vanished, 'same content'), writeFile(available, 'same content')])
	const reference = await index.ensureThumbnail(vanished)
	await index.ensureThumbnail(available)
	const thumbnail = thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), reference)
	await fse.remove(thumbnail)
	await expect(index.getExistingThumbnail(available)).resolves.toBeUndefined()
	generateThumbnail.mockClear()
	await fse.remove(vanished)

	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.getExistingThumbnail(available)).toStrictEqual(reference), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})

	expect(generateThumbnail).toHaveBeenCalledOnce()
	expect(generateThumbnail.mock.calls[0]?.[0]).toBe(available)
	await expect(index.getEntryBySystemPath(vanished)).resolves.toBeUndefined()
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	expect(database.prepare('SELECT state, failure_count FROM thumbnail_variants').get()).toStrictEqual({
		state: 'ready',
		failure_count: 0,
	})
	database.close()
})

test('does not retry a failed thumbnail for every newly hashed duplicate', async () => {
	const digest = Buffer.alloc(32, 0xce)
	const hashFile = vi.fn(async () => digest)
	const generateThumbnail = vi.fn(async () => {
		throw new Error('invalid image')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const fileCount = 20
	const old = new Date(Date.now() - 10_000)
	await Promise.all(
		Array.from({length: fileCount}, async (_, number) => {
			const image = nodePath.join(homeDirectory, `invalid-duplicate-${number}.png`)
			await writeFile(image, 'same invalid image')
			await utimes(image, old, old)
		}),
	)
	await index.reconcileRoot('/Home', 'duplicate-failure-test')

	index.startBackgroundReconciliation()
	await pRetry(
		async () => {
			await expect(index.status()).resolves.toMatchObject({
				enrichment: {
					hashedEntries: fileCount,
					pendingHashes: 0,
					uniqueContents: 1,
					thumbnailFailures: 1,
				},
			})
		},
		{retries: 200, minTimeout: 10, maxTimeout: 20},
	)

	expect(hashFile).toHaveBeenCalledTimes(fileCount)
	expect(generateThumbnail).toHaveBeenCalledOnce()
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	expect(database.prepare('SELECT state, failure_count FROM thumbnail_variants').get()).toStrictEqual({
		state: 'failed',
		failure_count: 1,
	})
	database.close()
})

test('hashes each new hard-link entry before deduplicating by its content hash', async () => {
	const digest = Buffer.alloc(32, 0xef)
	const hashFile = vi.fn(async () => digest)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory} = await fixture(undefined, {enrichmentRuntime: {hashFile, generateThumbnail}})
	const first = nodePath.join(homeDirectory, 'first.png')
	const hardLink = nodePath.join(homeDirectory, 'hard-link.png')
	await writeFile(first, 'same inode')
	await link(first, hardLink)

	await index.ensureThumbnail(first)
	await index.ensureThumbnail(hardLink)
	expect(hashFile).toHaveBeenCalledTimes(2)
	expect(generateThumbnail).toHaveBeenCalledOnce()
})

test('preserves a moved entry hash and reuses its content-addressed thumbnail', async () => {
	const digest = Buffer.alloc(32, 0xf1)
	const hashFile = vi.fn(async () => digest)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const source = nodePath.join(homeDirectory, 'source.png')
	const destination = nodePath.join(homeDirectory, 'destination.png')
	await writeFile(source, 'same inode after rename')
	const before = await index.ensureThumbnail(source)

	await fse.move(source, destination)
	await index.movePath(source, destination)
	const after = await index.ensureThumbnail(destination)

	expect(after).toStrictEqual(before)
	expect(hashFile).toHaveBeenCalledOnce()
	expect(generateThumbnail).toHaveBeenCalledOnce()
	await expect(index.getEntryBySystemPath(source)).resolves.toBeUndefined()
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	expect(
		database.prepare("SELECT content_id FROM entries WHERE relative_path = 'destination.png'").get(),
	).toMatchObject({
		content_id: expect.any(Number),
	})
	database.close()
})

test('rehashes moved directory entries and reuses their content-addressed thumbnails', async () => {
	const hashFile = vi.fn(async (systemPath: string) => {
		const number = Number(nodePath.basename(systemPath).match(/\d+/)?.[0] ?? 0)
		return Buffer.alloc(32, number + 1)
	})
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory} = await fixture(undefined, {enrichmentRuntime: {hashFile, generateThumbnail}})
	const source = nodePath.join(homeDirectory, 'source-directory')
	const destination = nodePath.join(homeDirectory, 'destination-directory')
	await Promise.all(
		Array.from({length: 3}, (_, number) =>
			fse.outputFile(nodePath.join(source, `image-${number}.png`), `image ${number}`),
		),
	)
	const before = await Promise.all(
		Array.from({length: 3}, (_, number) => index.ensureThumbnail(nodePath.join(source, `image-${number}.png`))),
	)

	await fse.move(source, destination)
	await index.movePath(source, destination)
	const after = await Promise.all(
		Array.from({length: 3}, (_, number) => index.ensureThumbnail(nodePath.join(destination, `image-${number}.png`))),
	)

	expect(after).toStrictEqual(before)
	expect(hashFile).toHaveBeenCalledTimes(6)
	expect(generateThumbnail).toHaveBeenCalledTimes(3)
})

test('processes watcher move destinations before deletions and reuses their content thumbnail', async () => {
	const hashFile = vi.fn(async () => Buffer.alloc(32, 0xa4))
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory} = await fixture(undefined, {enrichmentRuntime: {hashFile, generateThumbnail}})
	const source = nodePath.join(homeDirectory, 'watcher-source.png')
	const destination = nodePath.join(homeDirectory, 'watcher-destination.png')
	await writeFile(source, 'watcher move')
	const before = await index.ensureThumbnail(source)

	await fse.move(source, destination)
	index.noteWatcherChanges('/Home', [
		{path: source, type: 'delete'},
		...Array.from({length: 99}, (_, index) => ({
			path: nodePath.join(homeDirectory, `missing-${index}.png`),
			type: 'create' as const,
		})),
		{path: destination, type: 'create'},
	])
	await pRetry(async () => expect(await index.getEntryBySystemPath(source)).toBeUndefined(), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})
	const after = await index.ensureThumbnail(destination)

	expect(after).toStrictEqual(before)
	expect(hashFile).toHaveBeenCalledOnce()
	expect(generateThumbnail).toHaveBeenCalledOnce()
})

test('keeps watcher-moved content attached while background enrichment is active', async () => {
	const digest = Buffer.alloc(32, 0xa5)
	const hashFile = vi.fn(async () => digest)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory} = await fixture(undefined, {enrichmentRuntime: {hashFile, generateThumbnail}})
	const source = nodePath.join(homeDirectory, 'background-source.png')
	const destination = nodePath.join(homeDirectory, 'background-destination.png')
	await writeFile(source, 'watcher move')
	const reference = await index.ensureThumbnail(source)
	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await index.status()).toMatchObject({roots: [{state: 'ready'}]}), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})

	await fse.move(source, destination)
	index.noteWatcherChanges('/Home', [
		{path: source, type: 'delete'},
		{path: destination, type: 'create'},
	])
	await pRetry(async () => expect(await index.getExistingThumbnail(destination)).toStrictEqual(reference), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})

	expect(hashFile).toHaveBeenCalledOnce()
	expect(generateThumbnail).toHaveBeenCalledOnce()
})

test('garbage-collects a deferred content candidate after its safety deadline', async () => {
	const digest = Buffer.alloc(32, 0xa6)
	const hashFile = vi.fn(async () => digest)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail, orphanGcMaxDeferralMs: 300},
	})
	const removed = nodePath.join(homeDirectory, 'removed.png')
	const pending = nodePath.join(homeDirectory, 'pending.png')
	await writeFile(removed, 'removed')
	const reference = await index.ensureThumbnail(removed)
	const thumbnail = thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), reference)
	await writeFile(pending, 'pending')
	await index.reconcilePath(pending)
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	database.prepare("UPDATE entries SET hash_retry_at = ? WHERE relative_path = 'pending.png'").run(Date.now() + 5_000)
	database.close()
	await fse.remove(removed)
	await index.removePath(removed)

	index.startBackgroundReconciliation()
	await new Promise((resolve) => setTimeout(resolve, 50))
	await expect(fse.pathExists(thumbnail)).resolves.toBe(true)
	await pRetry(async () => expect(await fse.pathExists(thumbnail)).toBe(false), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})
	expect(hashFile).toHaveBeenCalledOnce()
})

test('hash failures do not prevent unrelated content garbage collection', async () => {
	const digest = Buffer.alloc(32, 0xa7)
	const hashFile = vi.fn(async (systemPath: string) => {
		if (nodePath.basename(systemPath) === 'unreadable.png') throw new Error('injected unreadable source')
		return digest
	})
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const removed = nodePath.join(homeDirectory, 'removed.png')
	const unreadable = nodePath.join(homeDirectory, 'unreadable.png')
	await writeFile(removed, 'removed')
	const reference = await index.ensureThumbnail(removed)
	const thumbnail = thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), reference)
	await writeFile(unreadable, 'unreadable')
	await expect(index.ensureThumbnail(unreadable)).rejects.toThrow('injected unreadable source')
	await fse.remove(removed)
	await index.removePath(removed)

	index.startBackgroundReconciliation()
	await pRetry(async () => expect(await fse.pathExists(thumbnail)).toBe(false), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})
	await expect(index.status()).resolves.toMatchObject({enrichment: {hashFailures: 1, pendingHashes: 1}})
	expect(hashFile).toHaveBeenCalledTimes(2)
})

test('keeps shared assets until the final indexed content reference is deleted', async () => {
	const digest = Buffer.alloc(32, 0x12)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile: async () => digest, generateThumbnail},
	})
	const first = nodePath.join(homeDirectory, 'first.png')
	const second = nodePath.join(homeDirectory, 'second.png')
	await Promise.all([writeFile(first, 'same'), writeFile(second, 'same')])
	const reference = await index.ensureThumbnail(first)
	await index.ensureThumbnail(second)
	const thumbnail = thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), reference)
	index.startBackgroundReconciliation()

	await fse.remove(first)
	await index.removePath(first)
	await expect(fse.pathExists(thumbnail)).resolves.toBe(true)

	await fse.remove(second)
	await index.removePath(second)
	await pRetry(async () => expect(await fse.pathExists(thumbnail)).toBe(false), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	expect(database.prepare('SELECT COUNT(*) AS count FROM contents').get()).toStrictEqual({count: 0})
	expect(database.prepare('SELECT COUNT(*) AS count FROM thumbnail_variants').get()).toStrictEqual({count: 0})
	database.close()
})

test('serializes artifact GC with re-adoption of the same content hash', async () => {
	const digest = Buffer.alloc(32, 0x13)
	let blockedArtifact: string | undefined
	let releaseRemoval!: () => void
	let signalRemoval!: () => void
	const removalStarted = new Promise<void>((resolve) => (signalRemoval = resolve))
	const removalReleased = new Promise<void>((resolve) => (releaseRemoval = resolve))
	const remove = vi.fn(async (systemPath: string) => {
		if (systemPath === blockedArtifact) {
			signalRemoval()
			await removalReleased
			blockedArtifact = undefined
		}
		await fse.remove(systemPath)
	})
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile: async () => digest, generateThumbnail, remove},
	})
	const first = nodePath.join(homeDirectory, 'first.png')
	const second = nodePath.join(homeDirectory, 'second.png')
	await writeFile(first, 'same bytes')
	const reference = await index.ensureThumbnail(first)
	blockedArtifact = thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), reference)

	await fse.remove(first)
	await index.removePath(first)
	index.startBackgroundReconciliation()
	await removalStarted

	await writeFile(second, 'same bytes')
	let settled = false
	const reAdopted = index.ensureThumbnail(second).finally(() => (settled = true))
	await new Promise((resolve) => setTimeout(resolve, 50))
	expect(settled).toBe(false)

	releaseRemoval()
	await expect(reAdopted).resolves.toStrictEqual(reference)
	await expect(
		fse.pathExists(thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), reference)),
	).resolves.toBe(true)
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	expect(database.prepare('SELECT state FROM thumbnail_variants').get()).toStrictEqual({state: 'ready'})
	database.close()
	expect(generateThumbnail).toHaveBeenCalledTimes(2)
})

test('repairs missing and untracked thumbnail artifacts without racing recent temporary publications', async () => {
	const digest = Buffer.alloc(32, 0x34)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, `thumbnail-${generateThumbnail.mock.calls.length}`)
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile: async () => digest, generateThumbnail},
	})
	const image = nodePath.join(homeDirectory, 'repair.png')
	await writeFile(image, 'image')
	const reference = await index.ensureThumbnail(image)
	const thumbnailDirectory = nodePath.join(dataDirectory, 'thumbnails')
	const thumbnail = thumbnailSystemPath(thumbnailDirectory, reference)

	// Simulate all relevant crash leftovers: a ready DB row with no file, a
	// sharded artifact with no content row, a temporary, the discarded two-level
	// shard layout, and an old flat LRU-era artifact. All recovery is inferred
	// from authoritative DB state.
	await fse.remove(thumbnail)
	const orphan = thumbnailSystemPath(thumbnailDirectory, contentIdentity('56'.repeat(32)))
	const temporary = `${thumbnail}.tmp-interrupted.webp`
	const recentTemporary = `${thumbnail}.tmp-active.webp`
	const oldTwoLevel = nodePath.join(
		thumbnailDirectory,
		THUMBNAIL_VARIANT,
		reference.key.slice(0, 2),
		reference.key.slice(2, 4),
		`${reference.key}.webp`,
	)
	const obsoleteLongEdge = nodePath.join(
		thumbnailDirectory,
		'content',
		'preview-512-webp-v1',
		reference.key.slice(0, 2),
		`${reference.key}.webp`,
	)
	const legacy = nodePath.join(thumbnailDirectory, 'legacy-random-id.webp')
	const emptyShard = nodePath.join(thumbnailDirectory, 'content', THUMBNAIL_VARIANT, 'ff')
	await Promise.all([
		fse.outputFile(orphan, 'orphan'),
		fse.outputFile(temporary, 'temporary'),
		fse.outputFile(recentTemporary, 'active temporary'),
		fse.outputFile(oldTwoLevel, 'old-two-level'),
		fse.outputFile(obsoleteLongEdge, 'obsolete-long-edge'),
		fse.outputFile(legacy, 'legacy'),
		fse.ensureDir(emptyShard),
	])
	const staleTemporaryTime = new Date(Date.now() - 2 * THUMBNAIL_GENERATION_TIMEOUT_MS - 1_000)
	await utimes(temporary, staleTemporaryTime, staleTemporaryTime)

	index.startBackgroundReconciliation()
	await pRetry(
		async () => {
			expect(await fse.pathExists(thumbnail)).toBe(true)
			expect(await fse.pathExists(orphan)).toBe(false)
			expect(await fse.pathExists(temporary)).toBe(false)
			expect(await fse.pathExists(oldTwoLevel)).toBe(false)
			expect(await fse.pathExists(obsoleteLongEdge)).toBe(false)
			expect(await fse.pathExists(legacy)).toBe(false)
			expect(await fse.pathExists(recentTemporary)).toBe(true)
			expect(await fse.pathExists(emptyShard)).toBe(true)
		},
		{retries: 200, minTimeout: 10, maxTimeout: 20},
	)
	expect(generateThumbnail).toHaveBeenCalledTimes(2)

	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	expect(database.prepare("SELECT name FROM sqlite_schema WHERE name = 'artifact_gc'").get()).toBeUndefined()
	expect(database.prepare('SELECT state FROM thumbnail_variants').get()).toStrictEqual({state: 'ready'})
	database.close()
})

test('preserves pre-quarantine artifacts until a replacement index finishes rebuilding', async () => {
	const rootDirectory = await temporary.create()
	const dataDirectory = await temporary.create()
	const homeDirectory = nodePath.join(rootDirectory, 'home')
	const image = nodePath.join(homeDirectory, 'recovered.png')
	const digest = Buffer.alloc(32, 0x57)
	const thumbnail = thumbnailSystemPath(
		nodePath.join(dataDirectory, 'thumbnails'),
		contentIdentity(digest.toString('hex')),
	)
	await Promise.all([fse.outputFile(image, 'image'), fse.outputFile(thumbnail, 'existing thumbnail')])
	const databaseDirectory = nodePath.join(dataDirectory, 'file-index')
	await fse.ensureDir(databaseDirectory)
	await writeFile(nodePath.join(databaseDirectory, 'index.db'), 'not a database')

	let releaseWalk!: () => void
	let signalWalk!: () => void
	const walkStarted = new Promise<void>((resolve) => (signalWalk = resolve))
	const walkReleased = new Promise<void>((resolve) => (releaseWalk = resolve))
	let firstWalk = true
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (...arguments_) {
		if (firstWalk) {
			firstWalk = false
			signalWalk()
			await walkReleased
		}
		yield* walkFileTree(...arguments_)
	}
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'generated thumbnail')
	})
	const index = new FileIndex({
		dataDirectory,
		logger,
		isHidden: () => false,
		walkTree: walk,
		enrichmentRuntime: {hashFile: async () => digest, generateThumbnail},
	})
	indexes.push(index)
	await index.start()
	await index.setRoots([
		{
			virtualPath: '/Home',
			systemPath: homeDirectory,
			ownerId: 'owner',
			kind: 'home',
			searchEnabled: true,
		},
	])
	index.startBackgroundReconciliation()
	await walkStarted
	await new Promise((resolve) => setTimeout(resolve, 50))
	await expect(fse.readFile(thumbnail, 'utf8')).resolves.toBe('existing thumbnail')

	releaseWalk()
	await pRetry(
		async () =>
			expect(await index.getExistingThumbnail(image)).toMatchObject({kind: 'content', key: digest.toString('hex')}),
		{
			retries: 200,
			minTimeout: 10,
			maxTimeout: 20,
		},
	)
	await expect(fse.readFile(thumbnail, 'utf8')).resolves.toBe('existing thumbnail')
	expect(generateThumbnail).not.toHaveBeenCalled()
})

test('never publishes an empty thumbnail artifact as ready', async () => {
	const digest = Buffer.alloc(32, 0x35)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, '')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile: async () => digest, generateThumbnail},
	})
	const image = nodePath.join(homeDirectory, 'empty-output.png')
	await writeFile(image, 'image')

	await expect(index.ensureThumbnail(image)).rejects.toThrow('empty or invalid artifact')
	const thumbnailDirectory = nodePath.join(dataDirectory, 'thumbnails')
	await expect(
		fse.pathExists(thumbnailSystemPath(thumbnailDirectory, contentIdentity(digest.toString('hex')))),
	).resolves.toBe(false)
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	expect(database.prepare('SELECT state, failure_count FROM thumbnail_variants').get()).toStrictEqual({
		state: 'failed',
		failure_count: 1,
	})
	database.close()
})

test('repairs a zero-length artifact before serving it again', async () => {
	const digest = Buffer.alloc(32, 0x36)
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, `thumbnail-${generateThumbnail.mock.calls.length}`)
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile: async () => digest, generateThumbnail},
	})
	const image = nodePath.join(homeDirectory, 'truncated.png')
	await writeFile(image, 'image')
	const reference = await index.ensureThumbnail(image)
	const thumbnail = thumbnailSystemPath(nodePath.join(dataDirectory, 'thumbnails'), reference)
	await fse.outputFile(thumbnail, '')

	await expect(index.getExistingThumbnail(image)).resolves.toBeUndefined()
	index.startBackgroundReconciliation()
	await pRetry(
		async () => {
			await expect(index.getExistingThumbnail(image)).resolves.toStrictEqual(reference)
			expect((await fse.stat(thumbnail)).size).toBeGreaterThan(0)
		},
		{retries: 100, minTimeout: 10, maxTimeout: 20},
	)
	expect(generateThumbnail).toHaveBeenCalledTimes(2)
})

test('runs artifact maintenance while an unreadable file is waiting for its hash retry', async () => {
	const hashFile = vi.fn(async () => {
		throw new Error('injected unreadable source')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {enrichmentRuntime: {hashFile}})
	const image = nodePath.join(homeDirectory, 'unreadable.png')
	await writeFile(image, 'unreadable image')
	await index.reconcilePath(image)

	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	database.prepare('UPDATE entries SET hash_retry_at = 0').run()
	database.close()
	const legacyArtifact = nodePath.join(dataDirectory, 'thumbnails', 'legacy-untracked.webp')
	await fse.outputFile(legacyArtifact, 'legacy')

	index.startBackgroundReconciliation()
	await pRetry(
		async () => {
			await expect(index.status()).resolves.toMatchObject({enrichment: {hashFailures: 1, pendingHashes: 1}})
			await expect(fse.pathExists(legacyArtifact)).resolves.toBe(false)
		},
		{retries: 200, minTimeout: 10, maxTimeout: 20},
	)
	expect(hashFile).toHaveBeenCalledOnce()
})

test('settles queued thumbnail requests when the index stops', async () => {
	let releaseGeneration!: () => void
	let signalGeneration!: () => void
	const generationStarted = new Promise<void>((resolve) => (signalGeneration = resolve))
	const generationReleased = new Promise<void>((resolve) => (releaseGeneration = resolve))
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		signalGeneration()
		await generationReleased
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile: async () => Buffer.alloc(32, 0x78), generateThumbnail},
	})
	const image = nodePath.join(homeDirectory, 'shutdown.png')
	const queuedImage = nodePath.join(homeDirectory, 'shutdown-queued.png')
	await Promise.all([writeFile(image, 'image'), writeFile(queuedImage, 'queued image')])

	const active = index.ensureThumbnail(image)
	await generationStarted
	const queued = index.ensureThumbnail(queuedImage)
	const queuedResult = queued.then(
		() => 'resolved',
		(error: Error) => error.message,
	)
	await new Promise((resolve) => setTimeout(resolve, 10))
	const stopping = index.stop()
	releaseGeneration()

	await expect(active).resolves.toMatchObject({kind: 'content', key: '78'.repeat(32)})
	await expect(queuedResult).resolves.toBe('File enrichment is unavailable')
	await expect(stopping).resolves.toBeUndefined()
})

test('persists hash and thumbnail failures and lets an on-demand retry recover immediately', async () => {
	const hashFile = vi
		.fn()
		.mockRejectedValueOnce(new Error('injected hash read failure'))
		.mockResolvedValue(Buffer.alloc(32, 0x81))
	const generateThumbnail = vi
		.fn(async (_source: string, destination: string) => fse.outputFile(destination, 'thumbnail'))
		.mockRejectedValueOnce(new Error('injected convert failure'))
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const image = nodePath.join(homeDirectory, 'retry.png')
	await writeFile(image, 'retry image')

	await expect(index.ensureThumbnail(image)).rejects.toThrow('injected hash read failure')
	let database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	expect(database.prepare('SELECT hash_failure_count, hash_retry_at, hash_error FROM entries').get()).toMatchObject({
		hash_failure_count: 1,
		hash_retry_at: expect.any(Number),
		hash_error: 'injected hash read failure',
	})
	database.close()

	await expect(index.ensureThumbnail(image)).rejects.toThrow('injected convert failure')
	database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	expect(
		database.prepare('SELECT state, failure_count, retry_at, last_error FROM thumbnail_variants').get(),
	).toMatchObject({
		state: 'failed',
		failure_count: 1,
		retry_at: expect.any(Number),
		last_error: 'injected convert failure',
	})
	database.close()

	await expect(index.ensureThumbnail(image)).resolves.toMatchObject({kind: 'content', key: '81'.repeat(32)})
	expect(hashFile).toHaveBeenCalledTimes(2)
	expect(generateThumbnail).toHaveBeenCalledTimes(2)
	database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	expect(database.prepare('SELECT hash_failure_count, hash_retry_at, hash_error FROM entries').get()).toStrictEqual({
		hash_failure_count: 0,
		hash_retry_at: null,
		hash_error: null,
	})
	expect(
		database.prepare('SELECT state, failure_count, retry_at, last_error FROM thumbnail_variants').get(),
	).toStrictEqual({
		state: 'ready',
		failure_count: 0,
		retry_at: null,
		last_error: null,
	})
	database.close()
})

test('backs off artifact-side ENOENT failures instead of treating the source as stale', async () => {
	const artifactError = Object.assign(new Error('artifact disappeared during publication'), {code: 'ENOENT'})
	const generateThumbnail = vi.fn().mockRejectedValue(artifactError)
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile: async () => Buffer.alloc(32, 0x83), generateThumbnail},
	})
	const image = nodePath.join(homeDirectory, 'artifact-error.png')
	await writeFile(image, 'image')

	await expect(index.ensureThumbnail(image)).rejects.toThrow('artifact disappeared during publication')

	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	expect(
		database.prepare('SELECT state, failure_count, retry_at, last_error FROM thumbnail_variants').get(),
	).toMatchObject({
		state: 'failed',
		failure_count: 1,
		retry_at: expect.any(Number),
		last_error: 'artifact disappeared during publication',
	})
	database.close()
	expect(generateThumbnail).toHaveBeenCalledOnce()
})

test('wakes for a thumbnail retry before a later unrelated hash retry', async () => {
	const hashFile = vi.fn(async (systemPath: string) => {
		if (nodePath.basename(systemPath) === 'hash-retry.png') throw new Error('injected hash failure')
		return Buffer.alloc(32, 0x82)
	})
	const generateThumbnail = vi
		.fn(async (_source: string, destination: string) => fse.outputFile(destination, 'thumbnail'))
		.mockRejectedValueOnce(new Error('injected thumbnail failure'))
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const thumbnailRetry = nodePath.join(homeDirectory, 'thumbnail-retry.png')
	const hashRetry = nodePath.join(homeDirectory, 'hash-retry.png')
	await Promise.all([writeFile(thumbnailRetry, 'thumbnail'), writeFile(hashRetry, 'hash')])

	await expect(index.ensureThumbnail(thumbnailRetry)).rejects.toThrow('injected thumbnail failure')
	await expect(index.ensureThumbnail(hashRetry)).rejects.toThrow('injected hash failure')
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	const now = Date.now()
	database.prepare("UPDATE thumbnail_variants SET retry_at = ? WHERE state = 'failed'").run(now + 150)
	database.prepare("UPDATE entries SET hash_retry_at = ? WHERE relative_path = 'hash-retry.png'").run(now + 2_000)
	database.close()

	index.startBackgroundReconciliation()
	await pRetry(
		async () =>
			expect(await index.getExistingThumbnail(thumbnailRetry)).toMatchObject({kind: 'content', key: '82'.repeat(32)}),
		{
			retries: 100,
			minTimeout: 10,
			maxTimeout: 20,
		},
	)
	expect(hashFile).toHaveBeenCalledTimes(2)
	expect(generateThumbnail).toHaveBeenCalledTimes(2)
})

test('does not poll the retry scheduler while due hash work is already in flight', async () => {
	let signalHashStarted!: () => void
	let releaseHash!: () => void
	const hashStarted = new Promise<void>((resolve) => (signalHashStarted = resolve))
	const hashReleased = new Promise<void>((resolve) => (releaseHash = resolve))
	const hashFile = vi.fn(async () => {
		signalHashStarted()
		await hashReleased
		return Buffer.alloc(32, 0x85)
	})
	const generateThumbnail = vi.fn(async (_source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {availableParallelism: 8, hashFile, generateThumbnail},
	})
	const image = nodePath.join(homeDirectory, 'in-flight-retry.png')
	await writeFile(image, 'image')
	await index.reconcilePath(image)
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	database.prepare('UPDATE entries SET hash_retry_at = 0').run()
	database.close()

	const prepare = vi.spyOn(BetterSqlite3.prototype, 'prepare')
	index.startBackgroundReconciliation()
	try {
		await hashStarted
		await new Promise((resolve) => setTimeout(resolve, 50))
		const settledQueryCount = prepare.mock.calls.filter(([sql]) =>
			String(sql).includes('SELECT MIN(attempt_at) AS attempt_at'),
		).length
		await new Promise((resolve) => setTimeout(resolve, 100))
		const schedulerQueries = prepare.mock.calls.filter(([sql]) =>
			String(sql).includes('SELECT MIN(attempt_at) AS attempt_at'),
		)
		expect(schedulerQueries).toHaveLength(settledQueryCount)
	} finally {
		prepare.mockRestore()
		releaseHash()
	}

	await pRetry(async () => expect(await index.status()).toMatchObject({enrichment: {readyThumbnails: 1}}), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})
	expect(hashFile).toHaveBeenCalledOnce()
	expect(generateThumbnail).toHaveBeenCalledOnce()
})

test('ignores orphaned failed variants when scheduling the next retry wake', async () => {
	const {index, homeDirectory, dataDirectory} = await fixture()
	const pending = nodePath.join(homeDirectory, 'future-hash.png')
	await writeFile(pending, 'pending')
	await index.reconcilePath(pending)
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	database.prepare('UPDATE entries SET hash_retry_at = ?').run(Date.now() + 60_000)
	const orphan = database
		.prepare('INSERT INTO contents(blake3, size, created_at) VALUES (?, 1, ?) RETURNING id')
		.get(Buffer.alloc(32, 0x84), Date.now()) as {id: number}
	database
		.prepare(
			`INSERT INTO thumbnail_variants(content_id, variant, state, failure_count, retry_at, updated_at)
			VALUES (?, ?, 'failed', 1, 0, ?)`,
		)
		.run(orphan.id, THUMBNAIL_VARIANT, Date.now())
	database.close()

	const prepare = vi.spyOn(BetterSqlite3.prototype, 'prepare')
	index.startBackgroundReconciliation()
	await vi.waitFor(() =>
		expect(prepare.mock.calls.some(([sql]) => String(sql).includes('SELECT MIN(attempt_at) AS attempt_at'))).toBe(true),
	)
	await new Promise((resolve) => setTimeout(resolve, 50))
	const settledQueryCount = prepare.mock.calls.filter(([sql]) =>
		String(sql).includes('SELECT MIN(attempt_at) AS attempt_at'),
	).length
	await new Promise((resolve) => setTimeout(resolve, 100))
	const schedulerQueries = prepare.mock.calls.filter(([sql]) =>
		String(sql).includes('SELECT MIN(attempt_at) AS attempt_at'),
	)
	expect(schedulerQueries).toHaveLength(settledQueryCount)
})

test('discards stale hash and thumbnail work when the source changes during generation', async () => {
	const digests = [Buffer.alloc(32, 0x91), Buffer.alloc(32, 0x92)]
	const hashFile = vi.fn(async () => digests.shift()!)
	let changeSource = true
	const generateThumbnail = vi.fn(async (source: string, destination: string) => {
		await fse.outputFile(destination, 'thumbnail')
		if (changeSource) {
			changeSource = false
			await appendFile(source, ' changed during generation')
		}
	})
	const {index, homeDirectory, dataDirectory} = await fixture(undefined, {
		enrichmentRuntime: {hashFile, generateThumbnail},
	})
	const image = nodePath.join(homeDirectory, 'changing-during-generation.png')
	await writeFile(image, 'first revision')

	const reference = await index.ensureThumbnail(image)
	expect(reference.key).toBe('92'.repeat(32))
	expect(hashFile).toHaveBeenCalledTimes(2)
	expect(generateThumbnail).toHaveBeenCalledTimes(2)
	const thumbnailDirectory = nodePath.join(dataDirectory, 'thumbnails')
	await expect(fse.pathExists(thumbnailSystemPath(thumbnailDirectory, contentIdentity('91'.repeat(32))))).resolves.toBe(
		false,
	)
	await expect(fse.pathExists(thumbnailSystemPath(thumbnailDirectory, reference))).resolves.toBe(true)
	const temporaryFiles = await fse.readdir(
		nodePath.dirname(thumbnailSystemPath(thumbnailDirectory, contentIdentity('91'.repeat(32)))),
	)
	expect(temporaryFiles.some((name) => name.includes('.tmp-'))).toBe(false)
})

test('waits for background sources to be quiet without letting an active writer block stable work', async () => {
	const generationOrder: string[] = []
	const hashFile = vi.fn(async (systemPath: string) =>
		Buffer.alloc(32, nodePath.basename(systemPath).startsWith('active') ? 0xa1 : 0xa2),
	)
	const generateThumbnail = vi.fn(async (source: string, destination: string) => {
		generationOrder.push(nodePath.basename(source))
		await fse.outputFile(destination, 'thumbnail')
	})
	const {index, homeDirectory} = await fixture(undefined, {enrichmentRuntime: {hashFile, generateThumbnail}})
	const active = nodePath.join(homeDirectory, 'active.png')
	const stable = nodePath.join(homeDirectory, 'stable.png')
	await Promise.all([writeFile(active, 'active'), writeFile(stable, 'stable')])
	// File timestamps are untrusted metadata: camera clocks and network shares can
	// put them far in the future. Quietness is measured from when this revision was
	// observed, so a future-dated stable file must still be enriched normally.
	const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
	await utimes(stable, future, future)
	await index.reconcileRoot('/Home', 'quiet-period-test')

	// Observe another revision of the active file later. Its persisted quiet
	// deadline moves forward without delaying the already-stable file.
	await new Promise((resolve) => setTimeout(resolve, 500))
	await appendFile(active, ' still-writing')
	await index.reconcilePath(active)

	index.startBackgroundReconciliation()
	await pRetry(async () => expect(generationOrder).toContain('stable.png'), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})
	expect(generationOrder).toStrictEqual(['stable.png'])
	await pRetry(async () => expect(generationOrder).toStrictEqual(['stable.png', 'active.png']), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
})

test('returns bounded recent files by modification time with a deterministic tie break', async () => {
	const {index, homeDirectory} = await fixture()
	const oldest = nodePath.join(homeDirectory, 'oldest.txt')
	const tiedFirst = nodePath.join(homeDirectory, 'tied-first.txt')
	const tiedLast = nodePath.join(homeDirectory, 'tied-last.txt')
	const newest = nodePath.join(homeDirectory, 'newest.txt')
	await Promise.all([
		writeFile(oldest, 'oldest'),
		writeFile(tiedFirst, 'tied first'),
		writeFile(tiedLast, 'tied last'),
		writeFile(newest, 'newest'),
	])
	const base = new Date('2025-01-01T00:00:00.000Z')
	const tied = new Date('2025-01-02T00:00:00.000Z')
	await Promise.all([
		utimes(oldest, base, base),
		utimes(tiedFirst, tied, tied),
		utimes(tiedLast, tied, tied),
		utimes(newest, new Date('2025-01-03T00:00:00.000Z'), new Date('2025-01-03T00:00:00.000Z')),
	])
	// Reconcile tied entries in a known order so their ids provide a stable
	// ordering when the filesystem exposes the same millisecond mtime.
	for (const path of [oldest, tiedFirst, tiedLast, newest]) await index.reconcilePath(path)

	await expect(index.recentCandidates('/Home', 3)).resolves.toMatchObject([
		{name: 'newest.txt'},
		{name: 'tied-last.txt'},
		{name: 'tied-first.txt'},
	])

	const latest = new Date('2025-01-04T00:00:00.000Z')
	await utimes(oldest, latest, latest)
	await index.reconcilePath(oldest)
	await expect(index.recentCandidates('/Home', 2)).resolves.toMatchObject([{name: 'oldest.txt'}, {name: 'newest.txt'}])

	await fse.remove(oldest)
	await index.reconcilePath(oldest)
	await expect(index.recentCandidates('/Home', 10)).resolves.not.toEqual(
		expect.arrayContaining([expect.objectContaining({name: 'oldest.txt'})]),
	)
})

test('scopes recent files to a visible Home root and excludes named directory trees', async () => {
	const {index, homeDirectory, trashDirectory} = await fixture(undefined, {includeTrash: true})
	const visible = nodePath.join(homeDirectory, 'visible.txt')
	const hidden = nodePath.join(homeDirectory, '.hidden.txt')
	const directory = nodePath.join(homeDirectory, 'folder')
	const linkPath = nodePath.join(homeDirectory, 'visible-link')
	const backup = nodePath.join(homeDirectory, 'Umbrel Backup.backup', 'backup.txt')
	const nestedBackup = nodePath.join(homeDirectory, 'nested', 'Umbrel Backup.backup', 'nested-backup.txt')
	const sameNamedFile = nodePath.join(homeDirectory, 'ordinary', 'Umbrel Backup.backup')
	const literalWildcardDirectory = nodePath.join(homeDirectory, 'excluded_[100%]', 'excluded.txt')
	const similarDirectory = nodePath.join(homeDirectory, 'excluded_X100Y', 'included.txt')
	const trashFile = nodePath.join(trashDirectory, 'trashed.txt')
	await Promise.all([
		writeFile(visible, 'visible'),
		writeFile(hidden, 'hidden'),
		fse.ensureDir(directory),
		fse.outputFile(backup, 'backup'),
		fse.outputFile(nestedBackup, 'nested backup'),
		fse.outputFile(sameNamedFile, 'ordinary file'),
		fse.outputFile(literalWildcardDirectory, 'excluded'),
		fse.outputFile(similarDirectory, 'included'),
		writeFile(trashFile, 'trash'),
	])
	await symlink(visible, linkPath)
	await Promise.all([index.reconcileRoot('/Home', 'recents-filter'), index.reconcileRoot('/Trash', 'recents-filter')])

	await expect(index.recentCandidates('/Home', 50, ['Umbrel Backup.backup', 'excluded_[100%]'])).resolves.toEqual(
		expect.arrayContaining([
			expect.objectContaining({name: 'visible.txt'}),
			expect.objectContaining({name: 'included.txt'}),
			expect.objectContaining({name: 'Umbrel Backup.backup'}),
		]),
	)
	const names = (await index.recentCandidates('/Home', 50, ['Umbrel Backup.backup', 'excluded_[100%]'])).map(
		({name}) => name,
	)
	expect(names).not.toEqual(
		expect.arrayContaining([
			'.hidden.txt',
			'folder',
			'visible-link',
			'backup.txt',
			'nested-backup.txt',
			'excluded.txt',
			'trashed.txt',
		]),
	)
})

test('rejects invalid recent-file queries and non-Home roots', async () => {
	const {index} = await fixture(undefined, {includeTrash: true})

	await expect(index.recentCandidates('/Home', 0)).rejects.toThrow('positive integer')
	await expect(index.recentCandidates('/Home', 1.5)).rejects.toThrow('positive integer')
	for (const name of ['', '.', '..', 'nested/name', 'nul\0name']) {
		await expect(index.recentCandidates('/Home', 10, [name])).rejects.toThrow('single directory names')
	}
	await expect(index.recentCandidates('/Trash', 10)).rejects.toThrow("home root '/Trash' is unavailable")
	await expect(index.recentCandidates('/Users/missing', 10)).rejects.toThrow(
		"home root '/Users/missing' is unavailable",
	)
})

test('aggregates ready indexed directories without following links or double-counting hard links', async () => {
	const {index, homeDirectory, trashDirectory} = await fixture(undefined, {includeTrash: true})
	const documents = nodePath.join(homeDirectory, 'documents')
	const nested = nodePath.join(documents, 'nested')
	const empty = nodePath.join(homeDirectory, 'empty')
	await Promise.all([fse.ensureDir(nested), fse.ensureDir(empty)])
	await Promise.all([
		writeFile(nodePath.join(documents, 'document.txt'), 'abc'),
		writeFile(nodePath.join(nested, 'nested.txt'), '12345'),
		writeFile(nodePath.join(documents, '.hidden'), '1234567'),
		writeFile(nodePath.join(homeDirectory, 'root.txt'), '12'),
		writeFile(nodePath.join(trashDirectory, 'trashed.txt'), '12345678901'),
	])
	await link(nodePath.join(documents, 'document.txt'), nodePath.join(documents, 'document-hard-link.txt'))
	await symlink(nodePath.join(documents, 'document.txt'), nodePath.join(documents, 'document-symbolic-link.txt'))
	await Promise.all([index.reconcileRoot('/Home', 'directory-sizes'), index.reconcileRoot('/Trash', 'directory-sizes')])

	await expect(
		index.directorySizes([
			'/Home',
			'/Home/documents',
			'/Home/documents/nested',
			'/Home/empty',
			'/Trash',
			'/Home/documents/document.txt',
			'/Home/missing',
			'/External',
		]),
	).resolves.toStrictEqual([
		{virtualPath: '/Home', size: 17},
		{virtualPath: '/Home/documents', size: 15},
		{virtualPath: '/Home/documents/nested', size: 5},
		{virtualPath: '/Home/empty', size: 0},
		{virtualPath: '/Trash', size: 11},
	])
})

test('updates indexed directory aggregates after writes, copies, moves, and deletes', async () => {
	const {index, homeDirectory} = await fixture()
	const sourceDirectory = nodePath.join(homeDirectory, 'source')
	const destinationDirectory = nodePath.join(homeDirectory, 'destination')
	const sourcePath = nodePath.join(sourceDirectory, 'changing.txt')
	const destinationPath = nodePath.join(destinationDirectory, 'changing.txt')
	await Promise.all([fse.ensureDir(sourceDirectory), fse.ensureDir(destinationDirectory)])
	await writeFile(sourcePath, '123')
	await index.reconcileRoot('/Home', 'initial-directory-sizes')
	await expect(index.directorySizes(['/Home/source', '/Home/destination'])).resolves.toStrictEqual([
		{virtualPath: '/Home/source', size: 3},
		{virtualPath: '/Home/destination', size: 0},
	])

	await writeFile(sourcePath, '1234567')
	await index.reconcilePath(sourcePath)
	await expect(index.directorySizes(['/Home/source'])).resolves.toStrictEqual([{virtualPath: '/Home/source', size: 7}])

	await fse.copy(sourcePath, destinationPath)
	await index.reconcilePath(destinationPath)
	await expect(index.directorySizes(['/Home/source', '/Home/destination'])).resolves.toStrictEqual([
		{virtualPath: '/Home/source', size: 7},
		{virtualPath: '/Home/destination', size: 7},
	])
	await fse.remove(destinationPath)
	await index.removePath(destinationPath)

	await fse.move(sourcePath, destinationPath)
	await index.movePath(sourcePath, destinationPath)
	await expect(index.directorySizes(['/Home/source', '/Home/destination'])).resolves.toStrictEqual([
		{virtualPath: '/Home/source', size: 0},
		{virtualPath: '/Home/destination', size: 7},
	])

	await fse.remove(destinationPath)
	await index.removePath(destinationPath)
	await expect(index.directorySizes(['/Home/destination'])).resolves.toStrictEqual([
		{virtualPath: '/Home/destination', size: 0},
	])
})

test('only aggregates roots that are scanned and fully ready', async () => {
	let failWalk = false
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root, stopping) {
		if (failWalk) throw new Error('simulated scan failure')
		yield* walkFileTree(root, stopping)
	}
	const {index, homeDirectory, rootDirectory, root} = await fixture(walk)
	const unscannedDirectory = nodePath.join(rootDirectory, 'external')
	await Promise.all([writeFile(nodePath.join(homeDirectory, 'home.txt'), 'home'), fse.ensureDir(unscannedDirectory)])
	await writeFile(nodePath.join(unscannedDirectory, 'external.txt'), 'external')
	await index.setRoots([
		root,
		{
			virtualPath: '/External',
			systemPath: unscannedDirectory,
			ownerId: 'owner',
			kind: 'home',
			searchEnabled: false,
			scanEnabled: false,
		},
	])

	await expect(index.directorySizes(['/Home', '/External'])).resolves.toStrictEqual([])
	await index.reconcileRoot('/Home', 'ready-directory-sizes')
	await expect(index.directorySizes(['/Home', '/External'])).resolves.toStrictEqual([{virtualPath: '/Home', size: 4}])

	failWalk = true
	await index.reconcileRoot('/Home', 'degraded-directory-sizes')
	await expect(index.status()).resolves.toMatchObject({
		roots: expect.arrayContaining([expect.objectContaining({virtualPath: '/Home', state: 'degraded'})]),
	})
	await expect(index.directorySizes(['/Home', '/External'])).resolves.toStrictEqual([])
})

test('validates indexed directory aggregate paths', async () => {
	const {index} = await fixture()
	await expect(index.directorySizes(['Home'])).rejects.toThrow('must be absolute')
	await expect(index.directorySizes(['/Home\0invalid'])).rejects.toThrow('cannot contain NUL')
})

test('scores indexed filenames with the established fuzzy matcher', async () => {
	const {index, homeDirectory} = await fixture()
	const decomposedCafe = 'café.jpg'.normalize('NFD')
	const decomposedKorean = '한글.txt'.normalize('NFD')
	await Promise.all([
		writeFile(nodePath.join(homeDirectory, 'Bitcoin.PDF'), ''),
		writeFile(nodePath.join(homeDirectory, 'vacation-photo.jpg'), ''),
		writeFile(nodePath.join(homeDirectory, 'vacuum-notes.txt'), ''),
		writeFile(nodePath.join(homeDirectory, 'unrelated.txt'), ''),
		writeFile(nodePath.join(homeDirectory, 'abcdzzzz.txt'), ''),
		writeFile(nodePath.join(homeDirectory, 'holiday.jpg'), ''),
		writeFile(nodePath.join(homeDirectory, 'abcde.txt'), ''),
		writeFile(nodePath.join(homeDirectory, 'résumé.pdf'), ''),
		writeFile(nodePath.join(homeDirectory, decomposedCafe), ''),
		writeFile(nodePath.join(homeDirectory, decomposedKorean), ''),
		writeFile(nodePath.join(homeDirectory, 'İstanbul.txt'), ''),
		writeFile(nodePath.join(homeDirectory, 'ᎠᎡᎢ.txt'), ''),
		writeFile(nodePath.join(homeDirectory, 'ab'), ''),
		writeFile(nodePath.join(homeDirectory, 'Äö'), ''),
		writeFile(nodePath.join(homeDirectory, '.bitcoin-secret.txt'), ''),
		...['olu', 'lud', 'uda', 'ito', 'toc', 'oci', 'cin'].map((name) =>
			writeFile(nodePath.join(homeDirectory, `${name}.txt`), ''),
		),
	])
	await index.reconcileRoot('/Home', 'search-test')

	await expect(candidateNames(index, 'BITCOIN')).resolves.toStrictEqual(['Bitcoin.PDF'])
	await expect(candidateNames(index, 'vacationphoto')).resolves.toStrictEqual(['vacation-photo.jpg'])
	await expect(candidateNames(index, 'bit corn')).resolves.toStrictEqual(['Bitcoin.PDF'])
	await expect(candidateNames(index, 'bitocin')).resolves.toStrictEqual(['Bitcoin.PDF'])
	await expect(candidateNames(index, 'holuday')).resolves.toStrictEqual(['holiday.jpg'])
	await expect(candidateNames(index, 'holi')).resolves.toStrictEqual(['holiday.jpg'])
	await expect(candidateNames(index, 'abcde')).resolves.toStrictEqual(['abcde.txt'])
	await expect(candidateNames(index, 'abxde')).resolves.toStrictEqual([])
	await expect(candidateNames(index, 'resume')).resolves.toStrictEqual(['résumé.pdf'])
	await expect(candidateNames(index, 'café')).resolves.toStrictEqual([decomposedCafe])
	await expect(candidateNames(index, '한글.txt')).resolves.toStrictEqual([decomposedKorean])
	await expect(candidateNames(index, 'İSTAN')).resolves.toStrictEqual(['İstanbul.txt'])
	await expect(candidateNames(index, 'ᎠᎡᎢ')).resolves.toStrictEqual(['ᎠᎡᎢ.txt'])
	await expect(candidateNames(index, 'abcdefgh')).resolves.toStrictEqual([])
	await expect(candidateNames(index, 'completely-nonexistent-query')).resolves.toStrictEqual([])
	await expect(index.searchCandidates('/Home', 'vacaton', 1)).resolves.toMatchObject([{name: 'vacation-photo.jpg'}])
	await expect(index.searchCandidates('/Home', 'ab', 1)).resolves.toMatchObject([{name: 'ab'}])
	await expect(candidateNames(index, 'äö')).resolves.toStrictEqual(['Äö'])
	await expect(index.searchCandidates('/Home', 'abc\0def', 10)).rejects.toThrow('cannot contain NUL')
	await expect(index.searchCandidates('/Home', 'vacation', 250.5)).rejects.toThrow('positive integer')
})

test('uses folded literal substring candidates for one- and two-character searches', async () => {
	const {index, homeDirectory} = await fixture()
	await Promise.all([
		writeFile(nodePath.join(homeDirectory, 'CV.pdf'), ''),
		writeFile(nodePath.join(homeDirectory, 'myCV.pdf'), ''),
		writeFile(nodePath.join(homeDirectory, 'notes.txt'), ''),
		writeFile(nodePath.join(homeDirectory, 'Äö'), ''),
		writeFile(nodePath.join(homeDirectory, 'Äö-decoy.txt'), ''),
	])
	await index.reconcileRoot('/Home', 'short-search-test')

	await expect(candidateNames(index, 'cv')).resolves.toStrictEqual(['CV.pdf', 'myCV.pdf'])
	await expect(candidateNames(index, 'v')).resolves.toStrictEqual(['CV.pdf', 'myCV.pdf'])
	await expect(index.searchCandidates('/Home', 'äö', 1)).resolves.toMatchObject([{name: 'Äö'}])
})

test('ranks indexed exact names ahead of bounded substring candidates', async () => {
	const names = [
		...Array.from({length: 1_200}, (_, index) => `abcdef-decoy-${String(index).padStart(4, '0')}`),
		'abcdef',
		...Array.from({length: 1_200}, (_, index) => `ab-decoy-${String(index).padStart(4, '0')}`),
		'ab',
	]
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root) {
		const stats = await lstat(root)
		for (const name of names) yield {systemPath: nodePath.join(root, name), stats}
	}
	const {index} = await fixture(walk)
	await index.reconcileRoot('/Home', 'exact-ranking-test')

	await expect(index.searchCandidates('/Home', 'abcdef', 1)).resolves.toMatchObject([{name: 'abcdef'}])
	await expect(index.searchCandidates('/Home', 'ab', 1)).resolves.toMatchObject([{name: 'ab'}])
})

test('ranks fuzzy results across strict and relaxed FTS candidate phases', async () => {
	const {index, homeDirectory} = await fixture()
	await Promise.all([
		writeFile(nodePath.join(homeDirectory, 'abcdef'), ''),
		writeFile(nodePath.join(homeDirectory, 'abcxef'), ''),
		writeFile(nodePath.join(homeDirectory, 'abcdcdef'), ''),
	])
	await index.reconcileRoot('/Home', 'search-phase-ranking-test')

	await expect(index.searchCandidates('/Home', 'abcdef', 2)).resolves.toMatchObject([
		{name: 'abcdef'},
		{name: 'abcxef'},
	])
})

test('finds a contiguous match beyond the bounded non-contiguous candidate set', async () => {
	const decoys = Array.from({length: 1_200}, (_, index) => `abc-bcd-cde-def-${String(index).padStart(4, '0')}`)
	const target = 'abcdef-target.txt'
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root) {
		const stats = await lstat(root)
		for (const name of [...decoys, target]) yield {systemPath: nodePath.join(root, name), stats}
	}
	const {index} = await fixture(walk)
	await index.reconcileRoot('/Home', 'bounded-substring-candidate-test')

	await expect(index.searchCandidates('/Home', 'abcdef', 1)).resolves.toMatchObject([{name: target}])
})

test('searches partial indexed state while a root is warming', async () => {
	const {index, homeDirectory} = await fixture()
	const warmingPath = nodePath.join(homeDirectory, 'warming-result.txt')
	await writeFile(warmingPath, '')

	await index.reconcilePath(warmingPath)

	await expect(index.status()).resolves.toMatchObject({roots: [{virtualPath: '/Home', state: 'warming'}]})
	await expect(candidateNames(index, 'warming')).resolves.toStrictEqual(['warming-result.txt'])
})

test('searches committed rows while a bulk reconciliation is running', async () => {
	let releaseWalk!: () => void
	let signalPaused!: () => void
	const paused = new Promise<void>((resolve) => (signalPaused = resolve))
	const released = new Promise<void>((resolve) => (releaseWalk = resolve))
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root, stopping) {
		for await (const entry of walkFileTree(root, stopping)) {
			yield entry
			signalPaused()
			await released
		}
	}
	const {index, homeDirectory} = await fixture(walk, {batchSize: 1})
	await writeFile(nodePath.join(homeDirectory, 'partial-scan-result.txt'), '')

	const scan = index.reconcileRoot('/Home', 'partial-search-test')
	await paused

	try {
		await expect(candidateNames(index, 'partialscan')).resolves.toStrictEqual(['partial-scan-result.txt'])
	} finally {
		releaseWalk()
	}
	await scan
	await expect(candidateNames(index, 'partialscan')).resolves.toStrictEqual(['partial-scan-result.txt'])
})

test('sweeps stale entries only after a successful scan', async () => {
	let failWalk = false
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root, stopping) {
		let yielded = false
		for await (const entry of walkFileTree(root, stopping)) {
			yield entry
			if (failWalk && !yielded) {
				yielded = true
				throw new Error('simulated read failure')
			}
		}
	}
	const {index, homeDirectory} = await fixture(walk)
	const retainedPath = nodePath.join(homeDirectory, 'retained.txt')
	const otherPath = nodePath.join(homeDirectory, 'other.txt')
	await writeFile(retainedPath, 'retained')
	await writeFile(otherPath, 'other')
	await index.reconcileRoot('/Home', 'initial')
	await fse.remove(retainedPath)

	failWalk = true
	await index.reconcileRoot('/Home', 'failing')
	await expect(index.getEntryBySystemPath(retainedPath)).resolves.toMatchObject({name: 'retained.txt'})
	await expect(index.status()).resolves.toMatchObject({roots: [{virtualPath: '/Home', state: 'degraded'}]})

	failWalk = false
	await index.reconcileRoot('/Home', 'repair')
	await expect(index.getEntryBySystemPath(retainedPath)).resolves.toBeUndefined()
	await expect(index.status()).resolves.toMatchObject({roots: [{virtualPath: '/Home', state: 'ready'}]})
})

test('sweeps readable paths while preserving an unreadable subtree', async () => {
	let unreadablePath = ''
	let simulateUnreadable = false
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (
		root,
		stopping,
		includePath,
		onPathError,
	) {
		if (!simulateUnreadable) {
			yield* walkFileTree(root, stopping, includePath)
			return
		}

		const error = Object.assign(new Error('simulated permission failure'), {code: 'EACCES'})
		onPathError?.(unreadablePath, error)
		yield* walkFileTree(root, stopping, (systemPath) => {
			if (includePath && !includePath(systemPath)) return false
			return systemPath !== unreadablePath && !systemPath.startsWith(`${unreadablePath}${nodePath.sep}`)
		})
	}
	const {index, homeDirectory} = await fixture(walk)
	unreadablePath = nodePath.join(homeDirectory, 'unreadable_%')
	const retainedPath = nodePath.join(unreadablePath, 'retained.txt')
	const staleReadablePath = nodePath.join(homeDirectory, 'stale-readable.txt')
	const similarReadablePath = nodePath.join(homeDirectory, 'unreadable_%0-sibling.txt')
	const newReadablePath = nodePath.join(homeDirectory, 'new-readable.txt')
	await fse.outputFile(retainedPath, 'retained')
	await writeFile(staleReadablePath, 'stale')
	await writeFile(similarReadablePath, 'similar')
	await index.reconcileRoot('/Home', 'initial')
	const initialStatus = await index.status()
	const initialSuccessfulScanAt = initialStatus.roots[0].lastSuccessfulScanAt

	await fse.remove(retainedPath)
	await fse.remove(staleReadablePath)
	await fse.remove(similarReadablePath)
	await writeFile(newReadablePath, 'new')
	simulateUnreadable = true
	await index.reconcileRoot('/Home', 'partially-unreadable')

	await expect(index.getEntryBySystemPath(retainedPath)).resolves.toMatchObject({name: 'retained.txt'})
	await expect(index.getEntryBySystemPath(staleReadablePath)).resolves.toBeUndefined()
	await expect(index.getEntryBySystemPath(similarReadablePath)).resolves.toBeUndefined()
	await expect(index.getEntryBySystemPath(newReadablePath)).resolves.toMatchObject({name: 'new-readable.txt'})
	await expect(candidateNames(index, 'retained')).resolves.toStrictEqual(['retained.txt'])
	await expect(index.status()).resolves.toMatchObject({
		roots: [
			{
				virtualPath: '/Home',
				state: 'degraded',
				lastSuccessfulScanAt: initialSuccessfulScanAt,
				lastError: expect.stringContaining("Skipped 1 unreadable path: '/Home/unreadable_%' (EACCES"),
			},
		],
	})
	expect(logger.error).toHaveBeenCalledWith(
		expect.stringContaining("Partially reconciled '/Home'"),
		expect.objectContaining({message: expect.stringContaining("'/Home/unreadable_%'")}),
	)

	simulateUnreadable = false
	await index.reconcileRoot('/Home', 'readable-again')
	await expect(index.getEntryBySystemPath(retainedPath)).resolves.toBeUndefined()
	await expect(index.status()).resolves.toMatchObject({
		roots: [{virtualPath: '/Home', state: 'ready', lastError: undefined}],
	})
})

test('processes a Parcel watcher batch after an active full scan', async () => {
	let releaseWalk!: () => void
	let signalPaused!: () => void
	const paused = new Promise<void>((resolve) => (signalPaused = resolve))
	const released = new Promise<void>((resolve) => (releaseWalk = resolve))
	let shouldPause = true
	let activeWalks = 0
	let maximumActiveWalks = 0
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root, stopping) {
		activeWalks++
		maximumActiveWalks = Math.max(maximumActiveWalks, activeWalks)
		try {
			for await (const entry of walkFileTree(root, stopping)) {
				yield entry
				if (shouldPause) {
					shouldPause = false
					signalPaused()
					await released
				}
			}
		} finally {
			activeWalks--
		}
	}
	const {index, homeDirectory} = await fixture(walk)
	await writeFile(nodePath.join(homeDirectory, 'first.txt'), 'first')

	const scan = index.reconcileRoot('/Home', 'test-race')
	await paused
	const latePath = nodePath.join(homeDirectory, 'late.txt')
	await writeFile(latePath, 'late')
	// Watchman may report the watched root itself for a subtree change. The
	// already-coalesced Parcel batch waits behind the active scan without
	// overlapping it, then processes both events in order.
	noteWatcherChanges(index, [latePath, homeDirectory])
	releaseWalk()
	await scan

	await pRetry(async () => expect(await index.getEntryBySystemPath(latePath)).toMatchObject({name: 'late.txt'}), {
		retries: 20,
		minTimeout: 10,
		maxTimeout: 20,
	})
	expect(await candidateNames(index, 'late')).toContain('late.txt')
	expect(maximumActiveWalks).toBe(1)
})

test('applies direct path changes between full-scan batches', async () => {
	let releaseFirstBatch!: () => void
	let releaseLastBatch!: () => void
	let signalWalkStarted!: () => void
	let signalBetweenBatches!: () => void
	const firstBatchReleased = new Promise<void>((resolve) => (releaseFirstBatch = resolve))
	const lastBatchReleased = new Promise<void>((resolve) => (releaseLastBatch = resolve))
	const walkStarted = new Promise<void>((resolve) => (signalWalkStarted = resolve))
	const betweenBatches = new Promise<void>((resolve) => (signalBetweenBatches = resolve))
	let firstPath = ''
	let lastPath = ''
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* () {
		signalWalkStarted()
		await firstBatchReleased
		yield {systemPath: firstPath, stats: await lstat(firstPath)}
		// The generator is resumed only after the scanner has written the first
		// batch and drained its queued live work.
		signalBetweenBatches()
		await lastBatchReleased
		yield {systemPath: lastPath, stats: await lstat(lastPath)}
	}
	const {index, homeDirectory} = await fixture(walk, {batchSize: 1})
	firstPath = nodePath.join(homeDirectory, 'first-batch.txt')
	lastPath = nodePath.join(homeDirectory, 'last-batch.txt')
	const removedPath = nodePath.join(homeDirectory, 'removed-live.txt')
	const createdPath = nodePath.join(homeDirectory, 'created-live.txt')
	await Promise.all([writeFile(firstPath, 'first'), writeFile(lastPath, 'last'), writeFile(removedPath, 'remove')])
	await index.reconcilePath(removedPath)

	const scan = index.reconcileRoot('/Home', 'interleaved-live-work')
	await walkStarted
	await Promise.all([writeFile(createdPath, 'created'), fse.remove(removedPath)])
	const liveChanges = Promise.all([index.reconcilePath(createdPath), index.reconcilePath(removedPath)])
	let scanFinished = false
	void scan.then(() => (scanFinished = true))

	releaseFirstBatch()
	await betweenBatches
	await liveChanges

	expect(scanFinished).toBe(false)
	await expect(index.getEntryBySystemPath(createdPath)).resolves.toMatchObject({name: 'created-live.txt'})
	await expect(index.getEntryBySystemPath(removedPath)).resolves.toBeUndefined()

	releaseLastBatch()
	await scan
	await expect(index.getEntryBySystemPath(createdPath)).resolves.toMatchObject({name: 'created-live.txt'})
	await expect(index.getEntryBySystemPath(removedPath)).resolves.toBeUndefined()
})

test('reruns an active snapshot after watcher recovery requests a full reconciliation', async () => {
	let releaseFirstWalk!: () => void
	let signalFirstWalkPaused!: () => void
	const firstWalkReleased = new Promise<void>((resolve) => (releaseFirstWalk = resolve))
	const firstWalkPaused = new Promise<void>((resolve) => (signalFirstWalkPaused = resolve))
	let rootWalks = 0
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root, stopping) {
		rootWalks++
		if (rootWalks === 1) {
			const oldPath = nodePath.join(root, 'removed-during-recovery.txt')
			yield {systemPath: oldPath, stats: await lstat(oldPath)}
			signalFirstWalkPaused()
			await firstWalkReleased
			return
		}
		yield* walkFileTree(root, stopping)
	}
	const {index, homeDirectory} = await fixture(walk, {batchSize: 1})
	const removedPath = nodePath.join(homeDirectory, 'removed-during-recovery.txt')
	const recoveredPath = nodePath.join(homeDirectory, 'found-after-recovery.txt')
	await writeFile(removedPath, 'old')

	const scan = index.reconcileRoot('/Home', 'watcher-active-before-recovery')
	await firstWalkPaused
	await Promise.all([fse.remove(removedPath), writeFile(recoveredPath, 'new')])
	index.scheduleFullReconciliation('watcher-restarted')
	releaseFirstWalk()
	await scan

	expect(rootWalks).toBe(2)
	await expect(index.getEntryBySystemPath(removedPath)).resolves.toBeUndefined()
	await expect(index.getEntryBySystemPath(recoveredPath)).resolves.toMatchObject({name: 'found-after-recovery.txt'})
})

test('collapses large Parcel batches during a scan into one follow-up snapshot', async () => {
	let releaseFirstWalk!: () => void
	let signalFirstWalk!: () => void
	const firstWalkPaused = new Promise<void>((resolve) => (signalFirstWalk = resolve))
	const firstWalkReleased = new Promise<void>((resolve) => (releaseFirstWalk = resolve))
	let rootWalks = 0
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root, stopping) {
		rootWalks++
		if (rootWalks === 1) {
			for (const name of ['first.txt', 'removed-during-retry.txt']) {
				const systemPath = nodePath.join(root, name)
				yield {systemPath, stats: await lstat(systemPath)}
			}
			signalFirstWalk()
			await firstWalkReleased
			return
		}
		yield* walkFileTree(root, stopping)
	}
	const {index, homeDirectory} = await fixture(walk, {watcherBulkThreshold: 2})
	await writeFile(nodePath.join(homeDirectory, 'first.txt'), 'first')
	const removedDuringRetry = nodePath.join(homeDirectory, 'removed-during-retry.txt')
	await writeFile(removedDuringRetry, 'removed')

	const scan = index.reconcileRoot('/Home', 'burst-during-scan')
	await firstWalkPaused
	await fse.remove(removedDuringRetry)
	const latePaths = ['late-a.txt', 'late-b.txt', 'late-c.txt', 'late-d.txt'].map((name) =>
		nodePath.join(homeDirectory, name),
	)
	await Promise.all(latePaths.map((path) => writeFile(path, 'late')))
	noteWatcherChanges(index, latePaths.slice(0, 2))
	noteWatcherChanges(index, latePaths.slice(2))
	releaseFirstWalk()
	await scan

	await pRetry(
		async () =>
			expect(await candidateNames(index, 'late')).toStrictEqual([
				'late-a.txt',
				'late-b.txt',
				'late-c.txt',
				'late-d.txt',
			]),
		{retries: 20, minTimeout: 10, maxTimeout: 20},
	)
	expect(rootWalks).toBe(2)
	await expect(index.getEntryBySystemPath(removedDuringRetry)).resolves.toBeUndefined()
})

test('processes already-coalesced Parcel batches for creates and deletes', async () => {
	const {index, homeDirectory} = await fixture()
	await index.reconcileRoot('/Home', 'initial')
	const directory = nodePath.join(homeDirectory, 'new-directory')
	const file = nodePath.join(directory, 'event.txt')
	await fse.ensureDir(directory)
	await writeFile(file, 'one')
	noteWatcherChanges(index, [file, directory])

	await pRetry(async () => expect(await index.getEntryBySystemPath(file)).toMatchObject({name: 'event.txt', size: 3}), {
		retries: 20,
		minTimeout: 10,
		maxTimeout: 20,
	})

	await fse.remove(file)
	noteWatcherChanges(index, [file], 'delete')
	await pRetry(async () => expect(await index.getEntryBySystemPath(file)).toBeUndefined(), {
		retries: 20,
		minTimeout: 10,
		maxTimeout: 20,
	})
})

test('does not turn directory update events into repeated root scans', async () => {
	let rootWalks = 0
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root, stopping) {
		rootWalks++
		yield* walkFileTree(root, stopping)
	}
	const {index, homeDirectory} = await fixture(walk)
	const directories = Array.from({length: 20}, (_, number) => nodePath.join(homeDirectory, `directory-${number}`))
	await Promise.all(directories.map((directory) => fse.ensureDir(directory)))
	const file = nodePath.join(directories.at(-1)!, 'event.txt')
	await writeFile(file, 'old')
	await index.reconcileRoot('/Home', 'initial')

	await writeFile(file, 'new content')
	index.noteWatcherChanges('/Home', [
		...directories.map((path) => ({path, type: 'update' as const})),
		{path: file, type: 'update'},
	])

	await pRetry(async () => expect(await index.getEntryBySystemPath(file)).toMatchObject({size: 11}), {
		retries: 20,
		minTimeout: 10,
		maxTimeout: 20,
	})
	expect(rootWalks).toBe(1)
})

test('removes every indexed descendant of a deleted Unicode directory', async () => {
	const {index, homeDirectory} = await fixture()
	const directory = nodePath.join(homeDirectory, 'emoji-😀')
	const child = nodePath.join(directory, 'child.txt')
	const grandchild = nodePath.join(directory, 'nested', 'grandchild.txt')
	const lowerSibling = nodePath.join(homeDirectory, 'emoji-😀.txt')
	const upperSibling = nodePath.join(homeDirectory, 'emoji-😀0.txt')
	await fse.ensureDir(nodePath.dirname(grandchild))
	await Promise.all([
		writeFile(child, 'child'),
		writeFile(grandchild, 'grandchild'),
		writeFile(lowerSibling, 'lower'),
		writeFile(upperSibling, 'upper'),
	])
	await index.reconcileRoot('/Home', 'unicode-delete-test')

	await fse.remove(directory)
	noteWatcherChanges(index, [directory], 'delete')

	await pRetry(async () => expect(await index.getEntryBySystemPath(child)).toBeUndefined(), {
		retries: 20,
		minTimeout: 10,
		maxTimeout: 20,
	})
	await expect(index.getEntryBySystemPath(grandchild)).resolves.toBeUndefined()
	await expect(index.getEntryBySystemPath(lowerSibling)).resolves.toMatchObject({name: 'emoji-😀.txt'})
	await expect(index.getEntryBySystemPath(upperSibling)).resolves.toMatchObject({name: 'emoji-😀0.txt'})
	await expect(candidateNames(index, 'grandchild')).resolves.toStrictEqual([])
})

test('uses one root snapshot for a large watcher burst', async () => {
	let rootWalks = 0
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root, stopping) {
		rootWalks++
		yield* walkFileTree(root, stopping)
	}
	const {index, homeDirectory} = await fixture(walk, {watcherBulkThreshold: 3})
	const paths = Array.from({length: 3}, (_, number) => nodePath.join(homeDirectory, `burst-${number}.txt`))
	await Promise.all(paths.map((path) => writeFile(path, 'burst')))
	noteWatcherChanges(index, paths)

	await pRetry(async () => expect(await index.status()).toMatchObject({entryCount: 3}), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})

	expect(rootWalks).toBe(1)
	expect(logger.log).toHaveBeenCalledWith("Reconciling '/Home' (watcher-burst)")
})

test('uses a full root reconciliation for a watcher directory creation', async () => {
	const entryCount = 2_000
	const walkedRoots: string[] = []
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root) {
		walkedRoots.push(root)
		const stats = await lstat(root)
		for (let index = 0; index < entryCount; index++) {
			yield {systemPath: nodePath.join(root, `watcher-bulk-${String(index).padStart(4, '0')}`), stats}
		}
	}
	const {index, homeDirectory} = await fixture(walk)
	const changedDirectory = nodePath.join(homeDirectory, 'watcher-directory')
	await fse.ensureDir(changedDirectory)

	noteWatcherChanges(index, [changedDirectory])

	await pRetry(async () => expect(await index.status()).toMatchObject({entryCount}), {
		retries: 100,
		minTimeout: 10,
		maxTimeout: 20,
	})
	expect(walkedRoots).toStrictEqual([homeDirectory])
	expect(logger.log).toHaveBeenCalledWith("Reconciling '/Home' (directory-changed)")
}, 10_000)

test('applies direct move hints to both paths, including regular files', async () => {
	const {index, homeDirectory} = await fixture()
	const source = nodePath.join(homeDirectory, 'before.txt')
	const destination = nodePath.join(homeDirectory, 'after.txt')
	await writeFile(source, 'moved')
	await index.reconcileRoot('/Home', 'initial')
	await fse.move(source, destination)

	await index.movePath(source, destination)

	await expect(index.getEntryBySystemPath(source)).resolves.toBeUndefined()
	await expect(index.getEntryBySystemPath(destination)).resolves.toMatchObject({name: 'after.txt', size: 5})
	await expect(candidateNames(index, 'before')).resolves.toStrictEqual([])
	await expect(candidateNames(index, 'after')).resolves.toStrictEqual(['after.txt'])
})

test('removes a stale move source even when destination reconciliation fails', async () => {
	const {index, homeDirectory, dataDirectory} = await fixture()
	const source = nodePath.join(homeDirectory, 'before.txt')
	const destination = nodePath.join(homeDirectory, 'after.txt')
	await writeFile(source, 'moved')
	await index.reconcilePath(source)
	await fse.move(source, destination)
	const database = new BetterSqlite3(nodePath.join(dataDirectory, 'file-index', 'index.db'))
	database.exec(`
		CREATE TRIGGER reject_move_destination BEFORE INSERT ON entries
		WHEN NEW.relative_path = 'after.txt'
		BEGIN
			SELECT RAISE(ABORT, 'injected destination reconciliation failure');
		END
	`)
	database.close()

	await expect(index.movePath(source, destination)).rejects.toThrow('injected destination reconciliation failure')
	await expect(index.getEntryBySystemPath(source)).resolves.toBeUndefined()
})

test('converges concurrent direct hints through serial mutations', async () => {
	const {index, homeDirectory} = await fixture()
	const moves = Array.from({length: 40}, (_, index) => ({
		source: nodePath.join(homeDirectory, `before-${index}.txt`),
		destination: nodePath.join(homeDirectory, `after-${index}.txt`),
	}))
	await Promise.all(moves.map(({source}) => writeFile(source, 'moved')))
	await index.reconcileRoot('/Home', 'initial')
	await Promise.all(moves.map(({source, destination}) => fse.move(source, destination)))

	await Promise.all(moves.map(({source, destination}) => index.movePath(source, destination)))

	await expect(index.status()).resolves.toMatchObject({entryCount: moves.length})
	for (const {source, destination} of moves) {
		await expect(index.getEntryBySystemPath(source)).resolves.toBeUndefined()
		await expect(index.getEntryBySystemPath(destination)).resolves.toMatchObject({type: 'file', size: 5})
	}
})

test('drains queued direct hints while stopping', async () => {
	const {index, homeDirectory} = await fixture(undefined, {batchSize: 1})
	const moves = Array.from({length: 40}, (_, entry) => ({
		source: nodePath.join(homeDirectory, `queued-before-${entry}.txt`),
		destination: nodePath.join(homeDirectory, `queued-after-${entry}.txt`),
	}))
	await Promise.all(moves.map(({source}) => writeFile(source, 'moved')))
	await index.reconcileRoot('/Home', 'initial')
	await Promise.all(moves.map(({source, destination}) => fse.move(source, destination)))

	const hints = moves.map(({source, destination}) => index.movePath(source, destination))
	await new Promise<void>((resolve) => setImmediate(resolve))

	await expect(index.stop()).resolves.toBeUndefined()
	await expect(Promise.all(hints)).resolves.toHaveLength(moves.length)
})

test('persists every entry from a large scan', async () => {
	const entryCount = 20_000
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root) {
		const stats = await lstat(root)
		for (let index = 0; index < entryCount; index++) {
			yield {systemPath: nodePath.join(root, `bulk-${String(index).padStart(5, '0')}`), stats}
		}
	}
	const {index} = await fixture(walk)

	await index.reconcileRoot('/Home', 'large-scan')

	await expect(index.status()).resolves.toMatchObject({entryCount})
}, 30_000)

test('coalesces repeated requests during a scan into one serial rerun', async () => {
	let releaseFirstWalk!: () => void
	let signalFirstWalk!: () => void
	const firstWalkReleased = new Promise<void>((resolve) => (releaseFirstWalk = resolve))
	const firstWalkStarted = new Promise<void>((resolve) => (signalFirstWalk = resolve))
	let walks = 0
	let activeWalks = 0
	let maximumActiveWalks = 0
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root, stopping) {
		walks++
		activeWalks++
		maximumActiveWalks = Math.max(maximumActiveWalks, activeWalks)
		try {
			if (walks === 1) {
				signalFirstWalk()
				await firstWalkReleased
			}
			for await (const entry of walkFileTree(root, stopping)) yield entry
		} finally {
			activeWalks--
		}
	}
	const {index} = await fixture(walk)

	const first = index.reconcileRoot('/Home', 'one')
	await firstWalkStarted
	const second = index.reconcileRoot('/Home', 'two')
	const third = index.reconcileRoot('/Home', 'three')
	releaseFirstWalk()
	await Promise.all([first, second, third])

	expect(walks).toBe(2)
	expect(maximumActiveWalks).toBe(1)
})

test('restarts a cancelled scan when its root changes', async () => {
	let releaseFirstWalk!: () => void
	let signalFirstWalk!: () => void
	const firstWalkPaused = new Promise<void>((resolve) => (signalFirstWalk = resolve))
	const firstWalkReleased = new Promise<void>((resolve) => (releaseFirstWalk = resolve))
	let walks = 0
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root, stopping) {
		walks++
		for await (const entry of walkFileTree(root, stopping)) yield entry
		if (walks === 1) {
			signalFirstWalk()
			await firstWalkReleased
		}
	}
	const {index, root, rootDirectory, homeDirectory} = await fixture(walk)
	await writeFile(nodePath.join(homeDirectory, 'old-root.txt'), 'old')
	const replacementDirectory = nodePath.join(rootDirectory, 'replacement')
	await fse.ensureDir(replacementDirectory)
	const replacementFile = nodePath.join(replacementDirectory, 'replacement-root.txt')
	await writeFile(replacementFile, 'replacement')

	const firstScan = index.reconcileRoot('/Home', 'old-root')
	await firstWalkPaused
	await index.setRoots([{...root, systemPath: replacementDirectory}])
	releaseFirstWalk()
	await firstScan

	expect(walks).toBe(2)
	await expect(index.getEntryBySystemPath(nodePath.join(homeDirectory, 'old-root.txt'))).resolves.toBeUndefined()
	await expect(index.getEntryBySystemPath(replacementFile)).resolves.toMatchObject({name: 'replacement-root.txt'})
	await expect(candidateNames(index, 'replacementroot')).resolves.toStrictEqual(['replacement-root.txt'])
})

test('stops a queued rerun when its root is removed during an active scan', async () => {
	let releaseWalk!: () => void
	let signalWalkStarted!: () => void
	const walkReleased = new Promise<void>((resolve) => (releaseWalk = resolve))
	const walkStarted = new Promise<void>((resolve) => (signalWalkStarted = resolve))
	let walks = 0
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* () {
		walks++
		signalWalkStarted()
		await walkReleased
	}
	const {index} = await fixture(walk)

	const firstScan = index.reconcileRoot('/Home', 'active-before-removal')
	await walkStarted
	const queuedRerun = index.reconcileRoot('/Home', 'queued-before-removal')
	await index.removeRoot('/Home')
	releaseWalk()

	await Promise.all([firstScan, queuedRerun])
	expect(walks).toBe(1)
	await expect(index.status()).resolves.toMatchObject({entryCount: 0, roots: []})
})

test('keeps an active root scan alive while another root is added', async () => {
	let releaseFirstWalk!: () => void
	let signalFirstWalk!: () => void
	const firstWalkPaused = new Promise<void>((resolve) => (signalFirstWalk = resolve))
	const firstWalkReleased = new Promise<void>((resolve) => (releaseFirstWalk = resolve))
	let shouldPause = true
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* (root, stopping) {
		for await (const entry of walkFileTree(root, stopping)) {
			yield entry
			if (shouldPause) {
				shouldPause = false
				signalFirstWalk()
				await firstWalkReleased
			}
		}
	}
	const {index, rootDirectory, homeDirectory} = await fixture(walk)
	const homeFile = nodePath.join(homeDirectory, 'home-scan-survives.txt')
	await writeFile(homeFile, 'home')
	const memberDirectory = nodePath.join(rootDirectory, 'member-home')
	await fse.ensureDir(memberDirectory)
	await writeFile(nodePath.join(memberDirectory, 'member.txt'), 'member')

	const homeScan = index.reconcileRoot('/Home', 'active-before-root-add')
	await firstWalkPaused
	await index.addRoot({
		virtualPath: '/Users/alice',
		systemPath: memberDirectory,
		ownerId: 'alice',
		kind: 'home',
		searchEnabled: true,
	})
	releaseFirstWalk()
	await homeScan

	await expect(index.getEntryBySystemPath(homeFile)).resolves.toMatchObject({name: 'home-scan-survives.txt'})
	await expect(index.status()).resolves.toMatchObject({
		roots: expect.arrayContaining([expect.objectContaining({virtualPath: '/Home', state: 'ready'})]),
	})
})

test('excludes the reserved Trash subtree from member-home indexing', async () => {
	const {index, rootDirectory} = await fixture()
	const memberHome = nodePath.join(rootDirectory, 'member-home')
	const reservedHomeTrash = nodePath.join(memberHome, 'Trash')
	const memberTrash = nodePath.join(rootDirectory, 'member-trash')
	const visibleFile = nodePath.join(memberHome, 'visible.txt')
	const shadowedFile = nodePath.join(reservedHomeTrash, 'shadowed.txt')
	const realTrashFile = nodePath.join(memberTrash, 'trashed.txt')
	await Promise.all([fse.ensureDir(reservedHomeTrash), fse.ensureDir(memberTrash)])
	await Promise.all([
		writeFile(visibleFile, 'visible'),
		writeFile(shadowedFile, 'shadowed'),
		writeFile(realTrashFile, 'trashed'),
	])
	await index.addRoot({
		virtualPath: '/Users/alice',
		systemPath: memberHome,
		ownerId: 'alice',
		kind: 'home',
		searchEnabled: true,
	})
	await index.addRoot({
		virtualPath: '/Users/alice/Trash',
		systemPath: memberTrash,
		ownerId: 'alice',
		kind: 'trash',
		searchEnabled: false,
	})

	await index.reconcileRoot('/Users/alice', 'member-home-with-reserved-trash')
	await index.reconcileRoot('/Users/alice/Trash', 'member-trash')

	// A pre-fix database may retain this row until its first successful sweep.
	// Reads must reject it immediately, and a direct hint must purge it.
	const database = new BetterSqlite3(index.databasePath)
	const memberHomeRoot = database.prepare("SELECT id FROM index_roots WHERE virtual_path = '/Users/alice'").get() as {
		id: number
	}
	database
		.prepare(
			`INSERT INTO entries(
				root_id, relative_path, name, search_name, search_name_folded,
				type, size, modified_ms, hidden
			) VALUES (?, 'Trash/shadowed.txt', 'shadowed.txt', 'shadowed.txt', 'shadowed.txt', 'file', 8, 1, 0)`,
		)
		.run(memberHomeRoot.id)
	database.close()

	await expect(index.searchCandidates('/Users/alice', 'visible', 10)).resolves.toMatchObject([{name: 'visible.txt'}])
	await expect(index.searchCandidates('/Users/alice', 'shadowed', 10)).resolves.toStrictEqual([])
	await expect(index.recentCandidates('/Users/alice', 10)).resolves.toMatchObject([{name: 'visible.txt'}])
	await expect(index.getEntryBySystemPath(shadowedFile)).resolves.toBeUndefined()
	await expect(index.getEntryBySystemPath(realTrashFile)).resolves.toMatchObject({name: 'trashed.txt'})
	await expect(index.directorySizes(['/Users/alice', '/Users/alice/Trash'])).resolves.toStrictEqual([
		{virtualPath: '/Users/alice', size: 7},
		{virtualPath: '/Users/alice/Trash', size: 7},
	])

	const laterShadowedFile = nodePath.join(reservedHomeTrash, 'later-shadowed.txt')
	await writeFile(laterShadowedFile, 'later')
	await index.reconcilePath(reservedHomeTrash)
	await expect(index.getEntryBySystemPath(laterShadowedFile)).resolves.toBeUndefined()
	await expect(index.status()).resolves.toMatchObject({entryCount: 2})
})

test('runs periodic reconciliation serially', async () => {
	let walks = 0
	let activeWalks = 0
	let maximumActiveWalks = 0
	const walk: NonNullable<FileIndexEngineOptions['walkTree']> = async function* () {
		walks++
		activeWalks++
		maximumActiveWalks = Math.max(maximumActiveWalks, activeWalks)
		try {
			await new Promise((resolve) => setTimeout(resolve, 10))
		} finally {
			activeWalks--
		}
	}
	const {index} = await fixture(walk, {reconciliationIntervalMs: 5})

	index.startBackgroundReconciliation()
	await pRetry(async () => expect(walks).toBeGreaterThanOrEqual(3), {
		retries: 20,
		minTimeout: 10,
		maxTimeout: 10,
	})

	expect(maximumActiveWalks).toBe(1)
})

test('persists entries and removes stale member roots on restart', async () => {
	const {index, dataDirectory, homeDirectory, rootDirectory} = await fixture()
	const memberDirectory = nodePath.join(rootDirectory, 'member')
	const file = nodePath.join(homeDirectory, 'persistent.txt')
	const memberFile = nodePath.join(memberDirectory, 'member.txt')
	await fse.ensureDir(memberDirectory)
	await writeFile(file, 'persistent')
	await writeFile(memberFile, 'member')
	await index.addRoot({
		virtualPath: '/Users/member',
		systemPath: memberDirectory,
		ownerId: 'member',
		kind: 'home',
		searchEnabled: true,
	})
	await index.reconcileRoot('/Home', 'initial')
	await index.reconcileRoot('/Users/member', 'initial')
	await expect(index.status()).resolves.toMatchObject({entryCount: 2})
	await index.stop()
	indexes.splice(indexes.indexOf(index), 1)

	const reopened = new FileIndex({dataDirectory, logger, isHidden: () => false})
	indexes.push(reopened)
	await reopened.start()
	await reopened.setRoots([
		{
			virtualPath: '/Home',
			systemPath: homeDirectory,
			ownerId: 'owner',
			kind: 'home',
			searchEnabled: true,
		},
	])

	await expect(reopened.getEntryBySystemPath(file)).resolves.toMatchObject({name: 'persistent.txt'})
	await expect(reopened.status()).resolves.toMatchObject({entryCount: 1, roots: [{virtualPath: '/Home'}]})
})

test('removes populated roots and searches after re-adding them', async () => {
	const {index, root, homeDirectory} = await fixture()
	await Promise.all(
		Array.from({length: 100}, (_, number) =>
			writeFile(nodePath.join(homeDirectory, `before-root-removal-${number}.txt`), 'before'),
		),
	)
	await index.reconcileRoot('/Home', 'before-root-removal')

	await index.removeRoot('/Home')
	await expect(index.status()).resolves.toMatchObject({entryCount: 0, roots: []})

	await writeFile(nodePath.join(homeDirectory, 'after-root-removal.txt'), 'after')
	await index.addRoot(root)
	await index.reconcileRoot('/Home', 'after-root-removal')
	expect(await candidateNames(index, 'afterrootremoval')).toContain('after-root-removal.txt')
})

test('quarantines a corrupt derived database and starts cleanly', async () => {
	const dataDirectory = await temporary.create()
	const databaseDirectory = nodePath.join(dataDirectory, 'file-index')
	const databasePath = nodePath.join(databaseDirectory, 'index.db')
	const umbrelDatabasePath = nodePath.join(dataDirectory, 'umbrel.db')
	await fse.ensureDir(databaseDirectory)
	const umbrelDatabase = new BetterSqlite3(umbrelDatabasePath)
	migratePhotos(umbrelDatabase)
	umbrelDatabase
		.prepare(
			"INSERT INTO photos_sources(id, account_id, type, name, created_at) VALUES ('kept', 'owner', 'umbrel', 'Umbrel', 1)",
		)
		.run()
	umbrelDatabase.close()
	await writeFile(databasePath, 'not a database')
	const index = new FileIndex({dataDirectory, logger, isHidden: () => false})
	indexes.push(index)

	await index.start()

	await expect(index.status()).resolves.toMatchObject({available: true, schemaVersion: FILE_INDEX_SCHEMA_VERSION})
	const files = await fse.readdir(databaseDirectory)
	expect(files.some((name) => name.startsWith('index.db.corrupt-'))).toBe(true)
	const preservedUmbrelDatabase = new BetterSqlite3(umbrelDatabasePath)
	expect(preservedUmbrelDatabase.prepare("SELECT id FROM photos_sources WHERE id = 'kept'").get()).toStrictEqual({
		id: 'kept',
	})
	preservedUmbrelDatabase.close()
})

test('quarantines a newer pre-release schema and starts cleanly', async () => {
	const dataDirectory = await temporary.create()
	const databaseDirectory = nodePath.join(dataDirectory, 'file-index')
	const databasePath = nodePath.join(databaseDirectory, 'index.db')
	await fse.ensureDir(databaseDirectory)
	const database = new BetterSqlite3(databasePath)
	await migrateFileIndex(database)
	database
		.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
		.run(FILE_INDEX_SCHEMA_VERSION + 1, Date.now())
	database.close()
	const index = new FileIndex({dataDirectory, logger, isHidden: () => false})
	indexes.push(index)

	await index.start()

	await expect(index.status()).resolves.toMatchObject({
		available: true,
		schemaVersion: FILE_INDEX_SCHEMA_VERSION,
		entryCount: 0,
	})
	const files = await fse.readdir(databaseDirectory)
	expect(files.some((name) => name.startsWith('index.db.unsupported-schema-'))).toBe(true)
})

test('recovers from a non-corruption open failure without restarting', async () => {
	const dataDirectory = await temporary.create()
	const blockingPath = nodePath.join(dataDirectory, 'file-index')
	await writeFile(blockingPath, 'blocks the database directory')
	const index = new FileIndex({dataDirectory, logger, isHidden: () => false, recoveryRetryMs: 5})
	indexes.push(index)

	await index.start()
	await expect(index.status()).resolves.toMatchObject({available: false})
	await fse.remove(blockingPath)

	await pRetry(
		async () => expect(await index.status()).toMatchObject({available: true, schemaVersion: FILE_INDEX_SCHEMA_VERSION}),
		{
			retries: 20,
			minTimeout: 10,
			maxTimeout: 10,
		},
	)
	expect(logger.log).toHaveBeenCalledWith('Recovered file index database')
})

test('does not replace the durable Umbrel database when it cannot be opened', async () => {
	const dataDirectory = await temporary.create()
	const umbrelDatabasePath = nodePath.join(dataDirectory, 'umbrel.db')
	await fse.ensureDir(umbrelDatabasePath)
	await writeFile(nodePath.join(umbrelDatabasePath, 'keep-me'), 'durable state')
	const index = new FileIndex({dataDirectory, logger, isHidden: () => false, recoveryRetryMs: 60_000})
	indexes.push(index)

	await index.start()

	await expect(index.status()).resolves.toMatchObject({available: true})
	await expect(index.photosSummary('owner')).rejects.toThrow('Photos library is unavailable')
	expect((await fse.stat(umbrelDatabasePath)).isDirectory()).toBe(true)
	await expect(readFile(nodePath.join(umbrelDatabasePath, 'keep-me'), 'utf8')).resolves.toBe('durable state')
})

test('preserves and recovers the shared Umbrel database without restarting file indexing', async () => {
	const rootDirectory = await temporary.create()
	const dataDirectory = await temporary.create()
	const homeDirectory = nodePath.join(rootDirectory, 'home')
	await fse.ensureDir(homeDirectory)
	const photoPath = nodePath.join(homeDirectory, 'available-to-files.jpg')
	await fse.outputFile(photoPath, 'image')
	const umbrelDatabasePath = nodePath.join(dataDirectory, 'umbrel.db')
	const incompatible = new BetterSqlite3(umbrelDatabasePath)
	incompatible.exec(`
		CREATE TABLE schema_migrations(
			module TEXT NOT NULL,
			version INTEGER NOT NULL,
			applied_at INTEGER NOT NULL,
			PRIMARY KEY(module, version)
		);
		INSERT INTO schema_migrations VALUES ('photos', 999, 1);
		CREATE TABLE durable_probe(value TEXT NOT NULL);
		INSERT INTO durable_probe VALUES ('preserved');
	`)
	incompatible.close()

	const index = new FileIndex({
		dataDirectory,
		logger,
		isHidden: () => false,
		recoveryRetryMs: 10,
		enrichmentRuntime: {
			hashFile: async () => Buffer.alloc(32, 0x51),
			generateThumbnail: async (_source, destination) => fse.outputFile(destination, 'thumbnail'),
		},
	})
	indexes.push(index)
	await index.start()
	await index.setRoots([
		{virtualPath: '/Home', systemPath: homeDirectory, ownerId: 'owner', kind: 'home', searchEnabled: true},
	])
	await expect(index.photosSummary('owner')).rejects.toThrow('Photos library is unavailable')
	await expect(index.status()).resolves.toMatchObject({available: true})
	await expect(index.enableThumbnailVariants([...PHOTOS_THUMBNAIL_VARIANTS])).resolves.toBeUndefined()
	await expect(index.ensureThumbnail(photoPath)).resolves.toMatchObject({variant: THUMBNAIL_VARIANT})
	const repair = new BetterSqlite3(umbrelDatabasePath)
	expect(repair.prepare('SELECT value FROM durable_probe').get()).toStrictEqual({value: 'preserved'})
	repair.prepare("DELETE FROM schema_migrations WHERE module = 'photos'").run()
	repair.close()

	await pRetry(() => index.initializePhotos('owner'), {retries: 100, minTimeout: 10, maxTimeout: 20})
	await expect(index.photosSummary('owner')).resolves.toMatchObject({counts: {items: 0}})
	const recoveredPhotos = new BetterSqlite3(umbrelDatabasePath)
	expect(recoveredPhotos.prepare('SELECT value FROM durable_probe').get()).toStrictEqual({value: 'preserved'})
	expect(
		recoveredPhotos
			.prepare("SELECT hex(content_hash) AS hash FROM photos_content_state WHERE account_id = 'owner'")
			.get(),
	).toStrictEqual({hash: Buffer.alloc(32, 0x51).toString('hex').toUpperCase()})
	recoveredPhotos.close()
})

test('purges a removed member when the optional Photos database recovers', async () => {
	const rootDirectory = await temporary.create()
	const dataDirectory = await temporary.create()
	const ownerHome = nodePath.join(rootDirectory, 'owner-home')
	const memberHome = nodePath.join(rootDirectory, 'member-home')
	await Promise.all([
		fse.outputFile(nodePath.join(ownerHome, 'owner.jpg'), 'owner'),
		fse.outputFile(nodePath.join(memberHome, 'member.jpg'), 'member'),
	])
	const ownerRoot: FileIndexRoot = {
		virtualPath: '/Home',
		systemPath: ownerHome,
		ownerId: 'owner',
		kind: 'home',
		searchEnabled: true,
	}
	const memberRoot: FileIndexRoot = {
		virtualPath: '/Users/alice',
		systemPath: memberHome,
		ownerId: 'alice',
		kind: 'home',
		searchEnabled: true,
	}
	const runtime = {
		availableParallelism: 1,
		hashFile: async (path: string) => Buffer.alloc(32, path.includes('member') ? 0x62 : 0x61),
		generateThumbnail: async (_source: string, destination: string) => fse.outputFile(destination, 'thumbnail'),
		extractMediaMetadata: async () => ({
			kind: 'photo' as const,
			takenAt: 1,
			createdAt: 1,
			width: 1,
			height: 1,
		}),
	}
	const initial = new FileIndex({
		dataDirectory,
		logger,
		isHidden: (name) => name.startsWith('.'),
		enrichmentRuntime: runtime,
	})
	indexes.push(initial)
	await initial.setRoots([ownerRoot, memberRoot])
	await initial.start()
	await Promise.all([initial.reconcileRoot('/Home', 'owner'), initial.reconcileRoot('/Users/alice', 'member')])
	await initial.initializePhotos()
	initial.startBackgroundReconciliation()
	await pRetry(async () => expect(await initial.photosIndexingState('alice')).toMatchObject({phase: 'ready'}), {
		retries: 200,
		minTimeout: 10,
		maxTimeout: 20,
	})
	const memberItem = (await initial.photosListItems('alice', {}, undefined, 10)).items[0]!
	await initial.photosCreateAlbum('alice', 'Private', [memberItem.id])
	await initial.stop()

	const umbrelDatabasePath = nodePath.join(dataDirectory, 'umbrel.db')
	const incompatible = new BetterSqlite3(umbrelDatabasePath)
	incompatible
		.prepare('INSERT INTO schema_migrations(module, version, applied_at) VALUES (?, ?, ?)')
		.run('photos', 999, Date.now())
	incompatible.close()

	const recovered = new FileIndex({
		dataDirectory,
		logger,
		isHidden: (name) => name.startsWith('.'),
		recoveryRetryMs: 10,
		enrichmentRuntime: runtime,
	})
	indexes.push(recovered)
	await recovered.setRoots([ownerRoot])
	await recovered.start()
	await expect(recovered.photosSummary('owner')).rejects.toThrow('Photos library is unavailable')
	const repair = new BetterSqlite3(umbrelDatabasePath)
	repair.prepare("DELETE FROM schema_migrations WHERE module = 'photos' AND version = 999").run()
	repair.close()

	await pRetry(() => recovered.initializePhotos('owner'), {retries: 100, minTimeout: 10, maxTimeout: 20})
	const photos = new BetterSqlite3(umbrelDatabasePath)
	expect(photos.prepare("SELECT COUNT(*) AS count FROM photos_sources WHERE account_id = 'alice'").get()).toStrictEqual(
		{
			count: 0,
		},
	)
	expect(
		photos.prepare("SELECT COUNT(*) AS count FROM photos_content_state WHERE account_id = 'alice'").get(),
	).toStrictEqual({
		count: 0,
	})
	expect(photos.prepare("SELECT COUNT(*) AS count FROM photos_albums WHERE account_id = 'alice'").get()).toStrictEqual({
		count: 0,
	})
	photos.close()
})
