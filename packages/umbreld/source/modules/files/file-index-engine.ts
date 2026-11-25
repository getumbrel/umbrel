import nodePath from 'node:path'
import type {BigIntStats, Stats} from 'node:fs'
import {opendir, lstat, stat} from 'node:fs/promises'

import BetterSqlite3 from 'better-sqlite3'
import type DatabaseTypes from 'better-sqlite3'
import fse from 'fs-extra'
import PQueue from 'p-queue'

import {migratePhotos} from '../photos/migrations.ts'
import type {PeopleChange} from '../photos/people.ts'
import type {SearchRead, SearchReadResult} from '../search/types.ts'
import {placeIn, places} from './places.ts'
import PhotosRepository from '../photos/repository.ts'
import FileIndexReaderPool, {type FileIndexReaderPoolOptions} from './file-index/reader-pool.ts'
import type {FileIndexReadArgs, FileIndexReadMethod, PhotosReadMethod} from './file-index/reader.ts'
import {readDatabase, type ReadSql} from './file-index/read-database.ts'
import {
	BACKGROUND_DATABASE_PRIORITY,
	SCAN_DATABASE_PRIORITY,
	ON_DEMAND_DATABASE_PRIORITY,
} from './file-index/database-priority.ts'
import {embeddingsDatabasePath} from './embeddings-store.ts'
import {readableKind} from './readable.ts'
import {embeddingsAvailable} from './embeddings.ts'
import {
	supportsPhotos,
	type PhotoBackupCloudIdentity,
	type PhotoFilter,
	type PhotoIndexingProgress,
	type PhotoScopeMode,
} from '../photos/types.ts'
import FileIndexEnrichment, {
	hashNotBefore,
	assertPublishedRevision,
	retryGivenUpEnrichmentAfterUpdate,
	type FileIndexEnrichmentRuntime,
	type PublishedFileRevision,
	type ThumbnailReference,
} from './file-index-enrichment.ts'
import {
	hasReservedMemberTrashPath,
	isReservedMemberTrashPath,
	relativePathWithin,
	relativeVirtualPath,
	joinVirtualPath,
} from './file-index/paths.ts'
import {FILE_INDEX_SCHEMA_VERSION, foldSearchName, migrateFileIndex} from './file-index/migrations.ts'
import DirectorySizes from './file-index/directory-sizes.ts'
import {
	FILES_THUMBNAIL_VARIANT,
	PHOTOS_THUMBNAIL_VARIANTS,
	supportsThumbnail,
	type ThumbnailIdentityKind,
	type ThumbnailVariant,
} from './thumbnail-support.ts'

type Database = DatabaseTypes.Database

const DEFAULT_RECONCILIATION_INTERVAL_MS = 6 * 60 * 60 * 1000
const DEFAULT_RECOVERY_RETRY_MS = 60 * 1000
const MAX_RECOVERY_RETRY_MS = 60 * 60 * 1000
const TRANSIENT_ENTRY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const TRANSIENT_OBSERVATION_REFRESH_MS = 24 * 60 * 60 * 1000
export const DEFAULT_WATCHER_BULK_THRESHOLD = 250
const DEFAULT_BATCH_SIZE = 256
const MAX_LIVE_WORK_PER_SCAN_BATCH = 100
// Every request shares the writer's thread, so a request that arrives while a
// scan write runs waits for it, once per step of the request. For a while
// after each request from Files or Photos, scan writes shrink their batch to
// stay near this budget, so the next request someone makes doesn't land behind
// a long write. Otherwise batches stay large, since each commit has a fixed cost.
const SCAN_WRITE_BUDGET_MS = 50
const MIN_SCAN_BATCH_SIZE = 64
// Someone scrolling Photos often pauses for a few seconds before the next page
const SMALL_BATCHES_AFTER_REQUEST_MS = 10_000
// Long enough to bridge the steps of one request, short enough that a client
// polling the index still leaves gaps for the scan
const FOREGROUND_QUIET_MS = 50
// Someone who keeps browsing still lets a long scan write a batch four times a second
const MAX_FOREGROUND_PAUSE_MS = 250
// A directory move rewrites its rows in one transaction that blocks other
// index work, about 6 seconds per 100,000 entries on an N100. Larger trees
// take the generic move instead.
const MAX_IN_PLACE_MOVE_ENTRIES = 100_000
const PHOTOS_ONLY_THUMBNAIL_VARIANT_SET = new Set<ThumbnailVariant>(
	PHOTOS_THUMBNAIL_VARIANTS.filter((variant) => variant !== FILES_THUMBNAIL_VARIANT),
)
const PHOTOS_INDEXING_PROGRESS_INTERVAL_MS = 1000
// Faces found by the models are given to people this long after the first
// of a batch is found, and this many contents at a time when catching up
const FACES_ASSIGNMENT_DELAY_MS = 2000
const FACES_ASSIGNMENT_BATCH = 200
const FACES_SWEEP_DELAY_MS = 60_000
// How long the places an account has photos in are taken as read
const PLACES_KEPT_MS = 60_000
// How far along an account's files are is asked for with every step of the
// work on them, and on a device with more than one account it is counted by
// going through every file the account has. What was counted is kept for
// this long, and for this many times as long as the counting took where that
// is longer: no more than a twentieth of the time goes on counting.
const COUNTS_KEPT_MS = 5000
const COUNTS_KEPT_FOR_TIMES = 20

export type FileIndexLogger = {
	log(message?: string): void
	verbose(message: string): void
	error(message: string, error?: unknown): void
}

export type FileIndexRoot = {
	virtualPath: string
	systemPath: string
	ownerId: string
	kind: 'home' | 'trash' | 'apps' | 'machines'
	searchEnabled: boolean
	scanEnabled?: boolean
}

type RootState = FileIndexRoot & {
	id?: number
	state: 'warming' | 'ready' | 'degraded'
	scanGeneration: number
	lastSuccessfulScanAt?: number
	lastError?: string
}

type EntryType = 'directory' | 'symbolic-link' | 'socket' | 'block-device' | 'character-device' | 'fifo' | 'file'

type EntryWrite = {
	rootId: number
	relativePath: string
	name: string
	type: EntryType
	size: number
	modifiedMs: number
	birthtimeMs: number | null
	device: string
	inode: string
	modifiedNs: string
	ctimeNs: string
	thumbnailIdentityKind: ThumbnailIdentityKind | null
	hashNotBefore: number | null
	observedAt: number | null
	hidden: number
}

type PathMutation =
	| {type: 'write'; entries: EntryWrite[]; markSeen: boolean}
	| {type: 'delete'; rootId: number; relativePath: string}

export type IndexedEntry = Omit<EntryWrite, 'rootId' | 'hidden' | 'hashNotBefore' | 'observedAt'> & {
	id: number
	rootId: number
	rootVirtualPath: string
	virtualPath: string
	systemPath: string
	observedAt?: number
	thumbnailEligible: number
	hidden: boolean
}

export type SearchCandidate = {
	id: number
	name: string
	virtualPath: string
}

export type IndexedDirectorySize = {
	virtualPath: string
	size: number
}

type FileStats = Stats | BigIntStats
type WalkedEntry = {systemPath: string; stats: FileStats}
type WalkPathError = (systemPath: string, error: unknown) => void
type WalkTree = (
	rootSystemPath: string,
	stopping: () => boolean,
	includePath?: (systemPath: string) => boolean,
	onPathError?: WalkPathError,
) => AsyncIterable<WalkedEntry>
export type WatcherChange = {path: string; type: 'create' | 'update' | 'delete'}
type DirectoryReconciliation = 'root' | 'entry'
type PathReconciliationResult = {completion?: Promise<void>}
type RootReconciliation = {requestedRoot: RootState; reason: string; rerun: boolean; promise: Promise<void>}
type ActiveRootSnapshot = {root: RootState; rerunRequested: boolean}
type PendingLiveWork = {
	operation: () => Promise<void>
	priority: number
	cost: number
	sequence: number
	resolve: () => void
	reject: (error: unknown) => void
}

export type FileIndexEngineOptions = {
	dataDirectory: string
	logger: FileIndexLogger
	isHidden: (name: string) => boolean
	onAvailabilityChange?: (available: boolean) => void
	onPhotosChange?: (accountIds: string[]) => void
	onPhotosIndexingProgress?: (progress: PhotoIndexingProgress[]) => void
	reconciliationIntervalMs?: number
	recoveryRetryMs?: number
	watcherBulkThreshold?: number
	batchSize?: number
	release?: string
	walkTree?: WalkTree
	enrichmentRuntime?: FileIndexEnrichmentRuntime
	readerPoolOptions?: FileIndexReaderPoolOptions
}

type RootRow = {
	id: number
	virtual_path: string
	system_path: string
	owner_id: string
	kind: FileIndexRoot['kind']
	search_enabled: number
	state: RootState['state']
	scan_generation: number
	last_successful_scan_at: number | null
	last_error: string | null
}

type EntryRow = {
	id: number
	root_id: number
	root_virtual_path: string
	root_system_path: string
	relative_path: string
	name: string
	search_name: string
	search_name_folded: string
	type: EntryType
	size: number
	modified_ms: number
	birthtime_ms: number | null
	device: string
	inode: string
	modified_ns: string
	ctime_ns: string
	thumbnail_identity_kind: ThumbnailIdentityKind | null
	observed_at: number | null
	hidden: number
}

class ScanCancelledError extends Error {}
class UnsupportedFileIndexSchemaError extends Error {}

function isUnreadablePathError(error: unknown) {
	const code = (error as NodeJS.ErrnoException).code
	return code === 'EACCES' || code === 'EPERM' || code === 'EIO' || code === 'ESTALE'
}

function skipUnreadablePath(systemPath: string, rootSystemPath: string, error: unknown, onPathError?: WalkPathError) {
	if (systemPath === rootSystemPath || !onPathError || !isUnreadablePathError(error)) return false
	onPathError(systemPath, error)
	return true
}

export async function* walkFileTree(
	rootSystemPath: string,
	stopping: () => boolean,
	includePath: (systemPath: string) => boolean = () => true,
	onPathError?: WalkPathError,
): AsyncIterable<WalkedEntry> {
	const directories = [rootSystemPath]

	while (directories.length > 0) {
		if (stopping()) throw new ScanCancelledError('File index is stopping')
		const directory = directories.pop()!

		let handle
		try {
			handle = await opendir(directory)
		} catch (error) {
			if (directory !== rootSystemPath && (error as NodeJS.ErrnoException).code === 'ENOENT') continue
			if (skipUnreadablePath(directory, rootSystemPath, error, onPathError)) continue
			throw error
		}

		try {
			for await (const directoryEntry of handle) {
				if (stopping()) throw new ScanCancelledError('File index is stopping')
				const systemPath = nodePath.join(directory, directoryEntry.name)
				if (!includePath(systemPath)) continue
				let stats: FileStats
				try {
					stats = await lstat(systemPath, {bigint: true})
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
					if (skipUnreadablePath(systemPath, rootSystemPath, error, onPathError)) continue
					throw error
				}

				yield {systemPath, stats}
				if (stats.isDirectory()) directories.push(systemPath)
			}
		} catch (error) {
			if (error instanceof ScanCancelledError) throw error
			if (skipUnreadablePath(directory, rootSystemPath, error, onPathError)) continue
			throw error
		}
	}
}

function unreadableReconciliationError(root: RootState, unreadablePaths: Map<string, unknown>) {
	const examples = [...unreadablePaths].slice(0, 3).map(([relativePath, error]) => {
		const code = (error as NodeJS.ErrnoException).code
		const message = error instanceof Error ? error.message : String(error)
		return `'${joinVirtualPath(root.virtualPath, relativePath)}' (${code ? `${code}: ` : ''}${message})`
	})
	const omitted = unreadablePaths.size - examples.length
	const suffix = omitted > 0 ? `; ${omitted} more` : ''
	return new Error(
		`Skipped ${unreadablePaths.size} unreadable ${unreadablePaths.size === 1 ? 'path' : 'paths'}: ${examples.join(
			', ',
		)}${suffix}`,
	)
}

// A file renamed outside Files reaches a root scan as a new path. Its old row is
// only deleted when the scan finishes, so a hashed row with the same device,
// inode, size and modification time still holds its content. Without this,
// renaming a large photo folder over SMB rehashes every file and Photos loses
// those items until it has. A rename keeps the file's birth time, while a new
// file that took a deleted file's inode gets a new one, so that file is hashed
// instead of taking the deleted file's content. source.type lets the lookup use
// the partial entries_by_size_identity index instead of scanning the root for
// every row.
export const REUSE_RENAMED_CONTENT_SQL = `
	UPDATE entries AS destination SET
		thumbnail_identity_kind = 'content',
		content_id = source.content_id,
		hash_failure_count = source.hash_failure_count,
		hash_retry_at = source.hash_retry_at,
		hash_error = source.hash_error
	FROM entries AS source
	WHERE destination.root_id = ? AND destination.relative_path = ?
		AND destination.type = 'file' AND destination.content_id IS NULL
		AND source.root_id = destination.root_id AND source.type = 'file'
		AND source.device = destination.device AND source.inode = destination.inode
		AND source.id IS NOT destination.id
		AND source.thumbnail_identity_kind = 'content' AND source.content_id IS NOT NULL
		AND source.size = destination.size AND source.modified_ns = destination.modified_ns
		AND source.birthtime_ms IS destination.birthtime_ms
`

export default class FileIndexEngine {
	readonly databasePath: string
	readonly umbrelDatabasePath: string
	readonly embeddingsDatabasePath: string
	readonly logger: FileIndexLogger

	#database?: Database
	#directorySizes?: DirectorySizes
	#schemaVersion = 0
	#available = false
	#started = false
	#stopping = false
	#roots = new Map<string, RootState>()
	#rootsConfigured = false
	#rootScans = new Map<string, RootReconciliation>()
	#activeRootSnapshot?: ActiveRootSnapshot
	#pendingLiveWork: PendingLiveWork[] = []
	#moves = new Set<Promise<void>>()
	#nextLiveWorkSequence = 0
	#mutationQueue = new PQueue({concurrency: 1})
	#foregroundActiveUntil = 0
	#foregroundRequests = 0
	#wakeOnStop = new Set<() => void>()
	#scanQueue = new PQueue({concurrency: 1})
	#reconciliationTimer?: ReturnType<typeof setTimeout>
	#recoveryTimer?: ReturnType<typeof setTimeout>
	#recoveryAttempt?: Promise<void>
	#recoveryAttempts = 0
	#artifactRecoveryBarrierRequired = false
	#facesToAssign: Buffer[] = []
	#facesAssignment?: ReturnType<typeof setTimeout>
	#facesSweep?: ReturnType<typeof setTimeout>
	#facesCaughtUp = false
	#photosAvailable = false
	#photosRecoveryTimer?: ReturnType<typeof setTimeout>
	#photosRecoveryAttempt?: Promise<void>
	#photosRecoveryAttempts = 0
	#photos = new PhotosRepository()
	// What each account's places can be called when typed, and until when that is taken as read
	#placesNamed = new Map<string, {named: ReturnType<ReturnType<typeof places>['named']>; until: number}>()
	#counted = new Map<string, {counts: Promise<unknown>; until: number}>()
	#readers?: FileIndexReaderPool
	#readerPoolOptions?: FileIndexReaderPoolOptions

	#isHidden: (name: string) => boolean
	#onAvailabilityChange?: (available: boolean) => void
	#onPhotosChange?: (accountIds: string[]) => void
	#onPhotosIndexingProgress?: (progress: PhotoIndexingProgress[]) => void
	#photosChangeTimer?: ReturnType<typeof setTimeout>
	#photosChangedAccountIds = new Set<string>()
	#photosIndexingProgressTimer?: ReturnType<typeof setTimeout>
	#photosIndexingProgressAccountIds = new Set<string>()
	#reconciliationIntervalMs: number
	#recoveryRetryMs: number
	#watcherBulkThreshold: number
	#batchSize: number
	#release?: string
	#walkTree: WalkTree
	#enrichment: FileIndexEnrichment

	constructor({
		dataDirectory,
		logger,
		isHidden,
		onAvailabilityChange,
		onPhotosChange,
		onPhotosIndexingProgress,
		reconciliationIntervalMs = DEFAULT_RECONCILIATION_INTERVAL_MS,
		recoveryRetryMs = DEFAULT_RECOVERY_RETRY_MS,
		watcherBulkThreshold = DEFAULT_WATCHER_BULK_THRESHOLD,
		batchSize = DEFAULT_BATCH_SIZE,
		release,
		walkTree = walkFileTree,
		enrichmentRuntime,
		readerPoolOptions,
	}: FileIndexEngineOptions) {
		this.databasePath = nodePath.join(dataDirectory, 'file-index', 'index.db')
		this.umbrelDatabasePath = nodePath.join(dataDirectory, 'umbrel.db')
		this.embeddingsDatabasePath = embeddingsDatabasePath(dataDirectory)
		this.logger = logger
		this.#isHidden = isHidden
		this.#onAvailabilityChange = onAvailabilityChange
		this.#onPhotosChange = onPhotosChange
		this.#onPhotosIndexingProgress = onPhotosIndexingProgress
		this.#reconciliationIntervalMs = reconciliationIntervalMs
		this.#recoveryRetryMs = recoveryRetryMs
		this.#watcherBulkThreshold = watcherBulkThreshold
		this.#batchSize = batchSize
		this.#release = release
		this.#walkTree = walkTree
		this.#readerPoolOptions = readerPoolOptions
		this.#enrichment = new FileIndexEnrichment(
			{
				dataDirectory,
				logger,
				withDatabase: (operation, priority) => this.#mutate(operation, priority),
				readSql: (query, priority, lane) => this.#readSql(query, priority, lane),
				photosAvailable: () => this.#photosAvailable,
				onStalePath: (systemPath) => this.reconcilePath(systemPath),
				onContentAttached: async (entryId, hash) => {
					if (!this.#photosAvailable) return
					const accountIds = await this.#mutate((database) => {
						this.#photos.attachContentHash(database, entryId, hash)
						return this.#photos.accountIdsForEntry(database, entryId)
					})
					this.#notifyPhotosChanged(accountIds)
				},
				onMediaMetadataReady: (database, contentId) => {
					if (!this.#photosAvailable) return
					const accountIds = this.#photos.refreshContentEffectiveTakenAt(database, contentId)
					return () => this.#notifyPhotosChanged(accountIds)
				},
				onThumbnailReady: (contentId) => {
					if (!this.#photosAvailable || this.#stopping) return
					// Publication notifications are fire-and-forget. Reader shutdown or
					// failure must not leave a rejected promise after the artifact is ready.
					void this.#readFiles('accountIdsForContent', [contentId])
						.then((accountIds) => this.#notifyPhotosChanged(accountIds))
						.catch((error) => {
							if (!this.#stopping) this.logger.error('Failed to report thumbnail availability', error)
						})
				},
				onModelWorkSettled: (contentId, work, hash) => {
					if (!this.#photosAvailable || this.#stopping) return
					if (work === 'faces') this.#assignFaces(hash)
					// Nothing about the photo itself changes, only how far indexing has got
					void this.#readFiles('accountIdsForContent', [contentId])
						.then((accountIds) => this.#notifyPhotosIndexingProgress(accountIds))
						.catch((error) => {
							if (!this.#stopping) this.logger.error('Failed to report indexing progress', error)
						})
				},
				onHashFailure: async (entryId) => {
					if (!this.#photosAvailable) return
					const accountIds = await this.#readFiles('accountIdsForEntry', [entryId])
					this.#notifyPhotosChanged(accountIds)
				},
				onContentFailure: async (contentId) => {
					if (!this.#photosAvailable) return
					const accountIds = await this.#mutate((database) =>
						this.#photos.refreshContentEffectiveTakenAt(database, contentId),
					)
					this.#notifyPhotosChanged(accountIds)
				},
			},
			enrichmentRuntime,
		)
	}

	get available() {
		return this.#available
	}

	async start() {
		if (this.#started) return
		this.#started = true
		this.#stopping = false
		this.#recoveryAttempts = 0
		this.#artifactRecoveryBarrierRequired = false
		await this.#enrichment.start()
		await this.#open().catch(async (error) => {
			await this.#handleOpenFailure(error)
		})
	}

	async #handleOpenFailure(error: unknown) {
		await this.#closeDatabase()
		this.#database = undefined
		this.#setAvailable(false)
		this.logger.error('File index is unavailable', error)
		this.#scheduleRecovery()
	}

	#scheduleRecovery() {
		if (!this.#started || this.#stopping || this.#available || this.#recoveryTimer) return
		const delay = Math.min(this.#recoveryRetryMs * 2 ** this.#recoveryAttempts, MAX_RECOVERY_RETRY_MS)
		this.#recoveryAttempts++
		this.#recoveryTimer = setTimeout(() => {
			this.#recoveryTimer = undefined
			this.#recoveryAttempt = this.#recover().finally(() => {
				this.#recoveryAttempt = undefined
			})
		}, delay)
	}

	async #recover() {
		try {
			await this.#open()
			if (this.#stopping) return
			this.#recoveryAttempts = 0
			this.logger.log('Recovered file index database')
			void this.reconcileAll('database-recovered')
		} catch (error) {
			await this.#handleOpenFailure(error)
		}
	}

	async #open() {
		await fse.ensureDir(nodePath.dirname(this.databasePath))

		try {
			await this.#openAndMigrate()
		} catch (error) {
			const quarantineReason = databaseQuarantineReason(error)
			if (!quarantineReason) throw error
			await this.#closeDatabase()
			this.#database = undefined
			await this.#quarantineDatabase(quarantineReason)
			this.#artifactRecoveryBarrierRequired = true
			await this.#openAndMigrate()
		}

		if (this.#stopping) return
		const readersStartedAt = performance.now()
		this.#readers = new FileIndexReaderPool(
			{
				databasePath: this.databasePath,
				umbrelDatabasePath: this.umbrelDatabasePath,
				// Only where the models run, as for the connection that writes
				embeddingsDatabasePath: embeddingsAvailable() ? this.embeddingsDatabasePath : undefined,
			},
			this.#readerPoolOptions,
		)
		await this.#readers.start()
		this.logger.log(`Started file index readers in ${elapsedMs(readersStartedAt)}ms`)
		this.#setAvailable(true)
		this.logger.log(`Opened file index schema v${this.#schemaVersion}`)
		if (this.#roots.size > 0) {
			const rootsSyncedAt = performance.now()
			await this.#syncRoots()
			this.logger.log(`Synced file index roots in ${elapsedMs(rootsSyncedAt)}ms`)
		}
		if (!this.#artifactRecoveryBarrierRequired) this.#enrichment.allowDestructiveArtifactMaintenance()
	}

	async #openAndMigrate() {
		this.#database = new BetterSqlite3(this.databasePath, {timeout: 5000})
		this.#database.pragma('journal_mode = WAL')
		this.#database.pragma('foreign_keys = ON')
		this.#database.function('file_index_now_ms', () => Date.now())
		const migrationStartedAt = performance.now()
		this.#schemaVersion = await migrateFileIndex(this.#database)
		this.logger.log(
			`File index migrations completed in ${Math.round(performance.now() - migrationStartedAt)}ms (schema v${this.#schemaVersion})`,
		)
		if (this.#schemaVersion !== FILE_INDEX_SCHEMA_VERSION) {
			throw new UnsupportedFileIndexSchemaError(
				`Unsupported file index schema v${this.#schemaVersion}; expected v${FILE_INDEX_SCHEMA_VERSION}`,
			)
		}
		if (this.#release) {
			let retried: ReturnType<typeof retryGivenUpEnrichmentAfterUpdate> | undefined
			try {
				retried = retryGivenUpEnrichmentAfterUpdate(this.#database, this.#release)
			} catch (error) {
				this.logger.error('Failed to schedule retries of failed thumbnails and metadata after updating', error)
			}
			if (retried?.rows) {
				this.logger.log(
					`Retrying ${retried.rows} failed thumbnails and metadata over the next day after updating${retried.previous ? ` from v${retried.previous}` : ''}`,
				)
			}
		}
		// Each step that can be slow on a large index logs how long it took, so a
		// startup that never finishes shows which step it's stuck in.
		const trace = (message: string) => this.logger.log(message)
		const countedAt = performance.now()
		const counts = this.#database
			.prepare(
				`SELECT
					(SELECT COUNT(*) FROM entries) AS entries,
					(SELECT COUNT(*) FROM contents) AS contents,
					(SELECT COUNT(*) FROM directory_sizes_dirty_roots) AS dirtyRoots,
					(SELECT COUNT(*) FROM directory_sizes_dirty_entries) AS dirtyEntries`,
			)
			.get() as {entries: number; contents: number; dirtyRoots: number; dirtyEntries: number}
		this.logger.log(
			`File index has ${counts.entries} entries and ${counts.contents} contents, with ${counts.dirtyRoots} roots and ${counts.dirtyEntries} entries waiting for directory sizes (counted in ${elapsedMs(countedAt)}ms)`,
		)
		const directorySizesSyncedAt = performance.now()
		this.#directorySizes = new DirectorySizes(this.#database)
		this.#directorySizes.sync(trace)
		this.logger.log(`Synced directory sizes in ${elapsedMs(directorySizesSyncedAt)}ms`)
		this.#photosAvailable = false
		const photosSyncedAt = performance.now()
		await this.#openUmbrelDatabase(trace)
			.then(() => this.logger.log(`Synced Photos library in ${elapsedMs(photosSyncedAt)}ms`))
			.catch((error) => {
				this.logger.error('Umbrel database is unavailable; file indexing will continue without Photos', error)
				this.#schedulePhotosRecovery()
			})
		this.#database.exec(`
			CREATE TEMP TABLE reconciliation_seen (
				root_id INTEGER NOT NULL,
				relative_path TEXT NOT NULL,
				PRIMARY KEY(root_id, relative_path)
			) WITHOUT ROWID;

			-- Derived assets are reclaimed from authoritative entry relationships.
			-- These transient candidates make ordinary updates O(changes), while the
			-- enrichment startup sweep repairs candidates lost to a process crash.
			CREATE TEMP TABLE content_gc_candidates (
				content_id INTEGER PRIMARY KEY,
				deferred_at INTEGER NOT NULL
			) WITHOUT ROWID;

			CREATE TEMP TABLE transient_artifact_gc_candidates (
				artifact_key TEXT PRIMARY KEY,
				deferred_at INTEGER NOT NULL
			) WITHOUT ROWID;

			CREATE TEMP TRIGGER entries_content_gc_delete AFTER DELETE ON main.entries
			WHEN old.content_id IS NOT NULL BEGIN
				INSERT INTO content_gc_candidates(content_id, deferred_at)
				VALUES(old.content_id, file_index_now_ms())
				ON CONFLICT(content_id) DO UPDATE SET deferred_at = excluded.deferred_at;
			END;

			CREATE TEMP TRIGGER entries_content_gc_update AFTER UPDATE OF content_id ON main.entries
			WHEN old.content_id IS NOT NULL AND old.content_id IS NOT new.content_id BEGIN
				INSERT INTO content_gc_candidates(content_id, deferred_at)
				VALUES(old.content_id, file_index_now_ms())
				ON CONFLICT(content_id) DO UPDATE SET deferred_at = excluded.deferred_at;
			END;

			CREATE TEMP TRIGGER transient_thumbnail_gc_delete
			AFTER DELETE ON main.transient_thumbnail_variants BEGIN
				INSERT INTO transient_artifact_gc_candidates(artifact_key, deferred_at)
				VALUES(old.artifact_key, file_index_now_ms())
				ON CONFLICT(artifact_key) DO UPDATE SET deferred_at = excluded.deferred_at;
			END;

			CREATE TEMP TRIGGER transient_thumbnail_gc_update
			AFTER UPDATE OF artifact_key ON main.transient_thumbnail_variants
			WHEN old.artifact_key IS NOT new.artifact_key BEGIN
				INSERT INTO transient_artifact_gc_candidates(artifact_key, deferred_at)
				VALUES(old.artifact_key, file_index_now_ms())
				ON CONFLICT(artifact_key) DO UPDATE SET deferred_at = excluded.deferred_at;
			END;
		`)
	}

	async #openUmbrelDatabase(trace?: (message: string) => void) {
		await fse.ensureDir(nodePath.dirname(this.umbrelDatabasePath))
		let umbrelDatabase: Database | undefined
		let attached = false
		try {
			const migratedAt = performance.now()
			umbrelDatabase = new BetterSqlite3(this.umbrelDatabasePath, {timeout: 5000})
			migratePhotos(umbrelDatabase)
			trace?.(`Photos database migrations completed in ${elapsedMs(migratedAt)}ms`)
			umbrelDatabase.close()
			umbrelDatabase = undefined
			this.#requireDatabase().prepare('ATTACH DATABASE ? AS umbrel').run(this.umbrelDatabasePath)
			attached = true
			// The faces People are made of are with what the models made of
			// everything else (see ./embeddings-store.ts). Where the models aren't
			// installed there are none.
			if (embeddingsAvailable()) {
				try {
					this.#requireDatabase().prepare('ATTACH DATABASE ? AS embeddings').run(this.embeddingsDatabasePath)
				} catch (error) {
					// Photos works without what the models have read: there are
					// only no people in it, and nothing is found by what it shows
					this.logger.error('Failed to open what the models have read', error)
				}
			}
			const sync = this.#requireDatabase().transaction(() => this.#syncPhotosState(this.#requireDatabase(), trace))
			sync.immediate()
			this.#photosAvailable = true
			this.#photosRecoveryAttempts = 0
			this.#facesCaughtUp = false
			this.#assignFaces()
		} catch (error) {
			this.#photosAvailable = false
			try {
				umbrelDatabase?.close()
			} catch {}
			if (attached) {
				try {
					this.#requireDatabase().exec('DETACH DATABASE umbrel')
				} catch {}
				try {
					this.#requireDatabase().exec('DETACH DATABASE embeddings')
				} catch {}
			}
			throw error
		}
	}

	async createUmbrelDatabaseBackup(destinationPath: string) {
		return this.#mutationQueue.add(async () => {
			this.#requirePhotos()
			await fse.ensureDir(nodePath.dirname(destinationPath))
			await fse.remove(destinationPath)
			const source = new BetterSqlite3(this.umbrelDatabasePath, {readonly: true, fileMustExist: true, timeout: 5000})
			try {
				await source.backup(destinationPath)
			} finally {
				source.close()
			}
		})
	}

	#schedulePhotosRecovery() {
		if (this.#stopping || !this.#started || this.#photosAvailable || this.#photosRecoveryTimer) return
		const delay = Math.min(this.#recoveryRetryMs * 2 ** this.#photosRecoveryAttempts, MAX_RECOVERY_RETRY_MS)
		this.#photosRecoveryAttempts++
		this.#photosRecoveryTimer = setTimeout(() => {
			this.#photosRecoveryTimer = undefined
			const recovery = this.#mutationQueue
				.add(async () => {
					if (this.#photosAvailable || this.#stopping) return
					await this.#openUmbrelDatabase()
				})
				.then(async () => {
					if (!this.#photosAvailable || this.#stopping) return
					await this.#enrichment.enableThumbnailVariants(PHOTOS_THUMBNAIL_VARIANTS)
					this.logger.log('Recovered Photos library database')
					this.#notifyPhotosChanged(
						[...this.#roots.values()].filter(({kind}) => kind === 'home').map(({ownerId}) => ownerId),
					)
				})
				.catch((error) => {
					this.logger.error('Photos library database is still unavailable', error)
					this.#schedulePhotosRecovery()
				})
				.finally(() => {
					if (this.#photosRecoveryAttempt === recovery) this.#photosRecoveryAttempt = undefined
				})
			this.#photosRecoveryAttempt = recovery
		}, delay)
	}

	async #closeDatabase() {
		await this.#readers?.stop()
		this.#readers = undefined
		try {
			this.#database?.close()
		} catch {}
		this.#photosAvailable = false
	}

	async #quarantineDatabase(reason = 'corrupt') {
		const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
		const quarantineBase = `${this.databasePath}.${reason}-${timestamp}`
		let quarantined = false

		for (const suffix of ['', '-wal', '-shm', '.wal']) {
			const source = `${this.databasePath}${suffix}`
			if (!(await fse.pathExists(source))) continue
			await fse.move(source, `${quarantineBase}${suffix}`)
			quarantined = true
		}

		if (quarantined) this.logger.error(`Quarantined ${reason} file index as '${nodePath.basename(quarantineBase)}'`)
	}

	async setRoots(roots: FileIndexRoot[]) {
		this.#rootsConfigured = true
		const previous = this.#roots
		const changedRoots: string[] = []
		this.#roots = new Map(
			roots.map((root) => {
				const existing = previous.get(root.virtualPath)
				if (existing && sameRootDefinition(existing, root)) return [root.virtualPath, existing]
				changedRoots.push(root.virtualPath)
				return [
					root.virtualPath,
					{
						...root,
						id: existing?.id,
						state: root.scanEnabled !== false ? (existing?.state ?? 'warming') : 'ready',
						scanGeneration: existing?.scanGeneration ?? 0,
						lastSuccessfulScanAt: existing?.lastSuccessfulScanAt,
						lastError: existing?.lastError,
					},
				]
			}),
		)
		for (const virtualPath of changedRoots) {
			const active = this.#rootScans.get(virtualPath)
			const replacement = this.#roots.get(virtualPath)
			if (!active || !replacement?.id) continue
			active.requestedRoot = replacement
			active.reason = 'roots-updated'
		}
		if (this.#available) await this.#syncRoots()
	}

	async addRoot(root: FileIndexRoot) {
		const existing = this.#roots.get(root.virtualPath)
		if (existing && sameRootDefinition(existing, root)) return
		const added: RootState = {
			...root,
			id: existing?.id,
			state: root.scanEnabled !== false ? (existing?.state ?? 'warming') : 'ready',
			scanGeneration: existing?.scanGeneration ?? 0,
			lastSuccessfulScanAt: existing?.lastSuccessfulScanAt,
			lastError: existing?.lastError,
		}
		this.#roots.set(root.virtualPath, added)
		if (this.#available) await this.#syncRoots()
		if (this.#started) void this.reconcileRoot(root.virtualPath, 'root-added')
	}

	async removeRoot(virtualPath: string) {
		const removedRoot = this.#roots.get(virtualPath)
		this.#roots.delete(virtualPath)
		if (!this.#available) return
		await this.#mutate((database) => {
			const remove = database.transaction(() => {
				run(database, 'DELETE FROM index_roots WHERE virtual_path = ?', virtualPath)
				run(database, 'DELETE FROM reconciliation_seen WHERE root_id NOT IN (SELECT id FROM index_roots)')
				if (this.#photosAvailable && removedRoot?.kind === 'home') {
					this.#photos.removeAccount(database, removedRoot.ownerId)
				}
			})
			remove.immediate()
		}, 10)
	}

	async #syncRoots() {
		const roots = [...this.#roots.values()]
		await this.#mutate((database) => {
			const sync = database.transaction(() => {
				const existingRows = all(database, 'SELECT virtual_path, owner_id, kind FROM index_roots') as Array<{
					virtual_path: string
					owner_id: string
					kind: FileIndexRoot['kind']
				}>
				const desiredPaths = new Set(roots.map(({virtualPath}) => virtualPath))
				const desiredHomeOwners = new Set(roots.filter(({kind}) => kind === 'home').map(({ownerId}) => ownerId))

				for (const row of existingRows) {
					if (!desiredPaths.has(row.virtual_path)) {
						run(database, 'DELETE FROM index_roots WHERE virtual_path = ?', row.virtual_path)
						if (this.#photosAvailable && row.kind === 'home' && !desiredHomeOwners.has(row.owner_id)) {
							this.#photos.removeAccount(database, row.owner_id)
						}
					}
				}

				const now = Date.now()
				for (const root of roots) {
					run(
						database,
						`INSERT INTO index_roots(
						virtual_path, system_path, owner_id, kind, search_enabled, created_at, updated_at
					) VALUES (?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(virtual_path) DO UPDATE SET
						system_path = excluded.system_path,
						owner_id = excluded.owner_id,
						kind = excluded.kind,
						search_enabled = excluded.search_enabled,
						updated_at = excluded.updated_at`,
						root.virtualPath,
						root.systemPath,
						root.ownerId,
						root.kind,
						Number(root.searchEnabled),
						now,
						now,
					)
				}
				run(database, 'DELETE FROM reconciliation_seen WHERE root_id NOT IN (SELECT id FROM index_roots)')
				if (this.#photosAvailable) this.#syncPhotosState(database)
			})
			sync.immediate()
		}, 10)
		await this.#loadRootState()
	}

	#syncPhotosState(database: Database, trace?: (message: string) => void) {
		if (this.#rootsConfigured) {
			const activeAccounts = new Set(
				[...this.#roots.values()].filter(({kind}) => kind === 'home').map(({ownerId}) => ownerId),
			)
			const storedAccounts = database.prepare('SELECT DISTINCT account_id FROM umbrel.photos_sources').all() as Array<{
				account_id: string
			}>
			for (const {account_id: accountId} of storedAccounts) {
				if (!activeAccounts.has(accountId)) this.#photos.removeAccount(database, accountId)
			}
		}
		return this.#photos.syncAll(database, undefined, trace)
	}

	async #loadRootState() {
		const rows = all(this.#requireDatabase(), 'SELECT * FROM index_roots') as RootRow[]
		for (const row of rows) {
			const registered = this.#roots.get(row.virtual_path)
			if (!registered) continue
			registered.id = Number(row.id)
			registered.state = registered.scanEnabled !== false ? row.state : 'ready'
			registered.scanGeneration = Number(row.scan_generation)
			registered.lastSuccessfulScanAt =
				row.last_successful_scan_at === null ? undefined : Number(row.last_successful_scan_at)
			registered.lastError = row.last_error ?? undefined
		}
	}

	// Whether the models read the library (see FileIndexEnrichment#setModelsEnabled)
	setModelWork(enabled: boolean) {
		this.#enrichment.setModelsEnabled(enabled)
	}

	startBackgroundReconciliation() {
		if (!this.#started || this.#stopping) return
		this.#enrichment.startBackground()
		void this.reconcileAll('startup')
		this.#schedulePeriodicReconciliation()
	}

	scheduleFullReconciliation(reason: string) {
		if (!this.#started || this.#stopping) return
		void this.reconcileAll(reason)
	}

	async reconcileAll(reason: string) {
		if (!this.#available || this.#stopping) return
		const roots = [...this.#roots.values()]
			.filter(({scanEnabled}) => scanEnabled !== false)
			.sort((a, b) => Number(b.searchEnabled) - Number(a.searchEnabled) || a.virtualPath.localeCompare(b.virtualPath))
		for (const root of roots) await this.reconcileRoot(root.virtualPath, reason)
		if (!this.#available || this.#stopping) return
		await this.#expireTransientEntries().catch((error) =>
			this.logger.error('Failed to expire unused transient file index entries', error),
		)
		if (
			this.#artifactRecoveryBarrierRequired &&
			roots.length > 0 &&
			roots.every((root) => this.#roots.get(root.virtualPath) === root && root.state === 'ready')
		) {
			// After database quarantine the artifact directory can still contain a
			// complete cache while the replacement database is empty. Only let the
			// destructive maintenance walk infer untracked files after every
			// scan-enabled root has rebuilt successfully.
			this.#artifactRecoveryBarrierRequired = false
			this.#enrichment.allowDestructiveArtifactMaintenance()
		}
	}

	async #expireTransientEntries() {
		const expired = await this.#mutate((database) => {
			const rootIds = [...this.#roots.values()]
				.filter((root): root is RootState & {id: number} => root.scanEnabled === false && root.id !== undefined)
				.map(({id}) => id)
			if (rootIds.length === 0) return 0
			const placeholders = rootIds.map(() => '?').join(', ')
			return run(
				database,
				`DELETE FROM entries
				WHERE root_id IN (${placeholders})
					AND observed_at IS NOT NULL
					AND observed_at < ?`,
				...rootIds,
				Date.now() - TRANSIENT_ENTRY_RETENTION_MS,
			).changes
		})
		if (expired === 0) return
		this.logger.log(`Expired ${expired} unused transient file index ${expired === 1 ? 'entry' : 'entries'}`)
		this.#enrichment.kick()
	}

	#schedulePeriodicReconciliation() {
		if (this.#reconciliationTimer) clearTimeout(this.#reconciliationTimer)
		const jitter = Math.floor(this.#reconciliationIntervalMs * 0.05 * Math.random())
		this.#reconciliationTimer = setTimeout(async () => {
			await this.reconcileAll('periodic')
			if (!this.#stopping) this.#schedulePeriodicReconciliation()
		}, this.#reconciliationIntervalMs + jitter)
	}

	async reconcileRoot(virtualPath: string, reason: string): Promise<void> {
		if (!this.#available || this.#stopping) return
		const requestedRoot = this.#roots.get(virtualPath)
		if (!requestedRoot?.id || requestedRoot.scanEnabled === false) return
		const activeSnapshot = this.#activeRootSnapshot
		if (activeSnapshot?.root.virtualPath === virtualPath) activeSnapshot.rerunRequested = true
		const existing = this.#rootScans.get(virtualPath)
		if (existing) {
			existing.requestedRoot = requestedRoot
			existing.reason = reason
			existing.rerun = true
			return existing.promise
		}

		const reconciliation: RootReconciliation = {
			requestedRoot,
			reason,
			rerun: false,
			promise: Promise.resolve(),
		}
		reconciliation.promise = this.#runRootReconciliation(virtualPath, reconciliation).finally(() => {
			if (this.#rootScans.get(virtualPath) === reconciliation) this.#rootScans.delete(virtualPath)
		})
		this.#rootScans.set(virtualPath, reconciliation)
		return reconciliation.promise
	}

	async #runRootReconciliation(virtualPath: string, reconciliation: RootReconciliation) {
		while (!this.#stopping && this.#available) {
			const root = reconciliation.requestedRoot
			const reason = reconciliation.reason
			await (this.#scanQueue.add(async () => {
				if (this.#roots.get(virtualPath) !== root) {
					// A removed root cannot satisfy a queued rerun. Clear the flag so
					// this reconciliation exits instead of repeatedly queueing no-op work.
					reconciliation.rerun = false
					return
				}
				// Requests received while this pass was merely queued are covered by
				// the snapshot about to start. Only later requests require a rerun.
				reconciliation.rerun = false
				await this.#scanRootSnapshot(root, reason)
			}) as Promise<void>)
			if (reconciliation.requestedRoot === root && !reconciliation.rerun) return
		}
	}

	async #scanRootSnapshot(root: RootState, reason: string) {
		if (!root.id || this.#rootScanCancelled(root)) return
		if (this.#activeRootSnapshot) throw new Error('File index root snapshots cannot overlap')
		const activeSnapshot: ActiveRootSnapshot = {root, rerunRequested: false}
		this.#activeRootSnapshot = activeSnapshot

		const generation = root.scanGeneration + 1
		const startedAt = Date.now()
		let indexedEntries = 0
		const unreadablePaths = new Map<string, unknown>()
		this.logger.log(`Reconciling '${root.virtualPath}' (${reason})`)

		// Scan writes yield to Photos preparation and user mutations. Lower the
		// scan priority instead of raising reads above earlier favorite/album edits.
		// Each batch is still awaited before the scan submits its next operation.
		try {
			await this.#mutate((database) => {
				this.#throwIfRootScanCancelled(root)
				run(
					database,
					`UPDATE index_roots
					SET scan_generation = ?,
						state = CASE WHEN last_successful_scan_at IS NULL THEN 'warming' ELSE state END,
						last_error = NULL,
						updated_at = ?
					WHERE id = ?`,
					generation,
					Date.now(),
					root.id,
				)
			}, SCAN_DATABASE_PRIORITY)
			root.scanGeneration = generation
			if (root.kind === 'home' && root.lastSuccessfulScanAt === undefined) this.#notifyPhotosChanged([root.ownerId])

			// An update can renumber the filesystem a root lives on (see fileIdentity).
			// Rewrite every renumbered entry in one statement, so the walk below finds
			// them unchanged instead of writing each one back and journaling its size.
			const rootDevice = (await stat(root.systemPath, {bigint: true}).catch(() => undefined))?.dev.toString()
			if (rootDevice !== undefined) {
				const previousDevice = await this.#mutate(
					(database) => remapRenumberedDevice(database, root.id!, rootDevice),
					SCAN_DATABASE_PRIORITY,
				)
				if (previousDevice !== undefined) {
					this.logger.log(`Renumbered '${root.virtualPath}' entries from device ${previousDevice} to ${rootDevice}`)
				}
			}

			// Root scans are serialized, so this table contains only the current
			// snapshot. An unqualified delete lets SQLite clear it efficiently after
			// a failed scan without walking every temporary row.
			await this.#mutate((database) => run(database, 'DELETE FROM reconciliation_seen'), SCAN_DATABASE_PRIORITY)
			let batch: EntryWrite[] = []
			let batchSize = this.#batchSize
			const minBatchSize = Math.min(MIN_SCAN_BATCH_SIZE, this.#batchSize)
			let foregroundRequestsSeen = this.#foregroundRequests
			for await (const entry of this.#walkTree(
				root.systemPath,
				() => this.#rootScanCancelled(root),
				(systemPath) => this.#shouldIndexSystemPath(root, systemPath),
				(systemPath, error) => unreadablePaths.set(relativePathWithin(root.systemPath, systemPath), error),
			)) {
				const write = this.#entryWrite(root, entry.systemPath, entry.stats)
				if (!write) continue
				batch.push(write)
				indexedEntries++
				if (batch.length >= batchSize) {
					await this.#yieldToForeground()
					this.#throwIfRootScanCancelled(root)
					const writeMs = await this.#writeEntries(batch, SCAN_DATABASE_PRIORITY, true)
					// Requests that arrived since the last batch, during its rest, this
					// batch's pause or its write, mean someone is using Files or Photos now
					const contended = this.#foregroundRequests !== foregroundRequestsSeen
					foregroundRequestsSeen = this.#foregroundRequests
					const recentRequest = Date.now() - this.#foregroundActiveUntil < SMALL_BATCHES_AFTER_REQUEST_MS
					const budgetMs = contended || recentRequest ? SCAN_WRITE_BUDGET_MS : Infinity
					if (writeMs > budgetMs) batchSize = Math.max(minBatchSize, Math.floor(batchSize / 2))
					else if (writeMs < budgetMs / 2) batchSize = Math.min(this.#batchSize, batchSize * 2)
					batch = []
					await this.#restAfterBackgroundWrite(contended ? writeMs : 0)
					await this.#drainPendingLiveWork(MAX_LIVE_WORK_PER_SCAN_BATCH)
				}
			}
			this.#throwIfRootScanCancelled(root)
			if (batch.length > 0) await this.#writeEntries(batch, SCAN_DATABASE_PRIORITY, true)
			await new Promise<void>((resolve) => setImmediate(resolve))
			await this.#drainPendingLiveWork(Number.POSITIVE_INFINITY)
			this.#throwIfRootScanCancelled(root)
			if (activeSnapshot.rerunRequested) {
				await this.#mutate((database) => run(database, 'DELETE FROM reconciliation_seen'), SCAN_DATABASE_PRIORITY)
				this.logger.log(`Superseded reconciliation for '${root.virtualPath}'; scheduling a fresh snapshot`)
				return
			}
			if (unreadablePaths.size > 0) {
				await this.#markReconciliationPathsSeen(root, unreadablePaths.keys())
			}

			const completedAt = Date.now()
			const partialError = unreadablePaths.size > 0 ? unreadableReconciliationError(root, unreadablePaths) : undefined
			await this.#mutate((database) => {
				this.#throwIfRootScanCancelled(root)
				const finishScan = database.transaction(() => {
					run(
						database,
						`DELETE FROM entries
						WHERE root_id = ?
							AND NOT EXISTS (
								SELECT 1
								FROM reconciliation_seen
								WHERE reconciliation_seen.root_id = entries.root_id
									AND reconciliation_seen.relative_path = entries.relative_path
							)`,
						root.id,
					)
					this.#syncPhotos(database)
					run(database, 'DELETE FROM reconciliation_seen')
					run(
						database,
						`UPDATE index_roots SET
							state = ?,
							last_successful_scan_at = COALESCE(?, last_successful_scan_at),
							last_error = ?,
							updated_at = ?
						WHERE id = ?`,
						partialError ? 'degraded' : 'ready',
						partialError ? null : completedAt,
						partialError?.message ?? null,
						completedAt,
						root.id,
					)
				})
				finishScan.immediate()
			}, SCAN_DATABASE_PRIORITY)

			if (partialError) {
				root.state = 'degraded'
				root.lastError = partialError.message
				this.logger.error(
					`Partially reconciled '${root.virtualPath}' in ${completedAt - startedAt}ms (${indexedEntries} entries)`,
					partialError,
				)
			} else {
				root.state = 'ready'
				root.lastSuccessfulScanAt = completedAt
				root.lastError = undefined
				this.logger.log(`Reconciled '${root.virtualPath}' in ${completedAt - startedAt}ms (${indexedEntries} entries)`)
			}
			if (isPhotosRootKind(root.kind)) this.#notifyPhotosChanged([root.ownerId])
		} catch (error) {
			if (!(error instanceof ScanCancelledError) && this.#roots.get(root.virtualPath) === root) {
				await this.#degradeRoot(root, error)
				this.logger.error(`Failed to reconcile '${root.virtualPath}'`, error)
			}
		} finally {
			if (this.#activeRootSnapshot === activeSnapshot) this.#activeRootSnapshot = undefined
			this.#releasePendingLiveWork()
			this.#enrichment.kick()
		}
	}

	#rootScanCancelled(root: RootState) {
		return this.#stopping || this.#roots.get(root.virtualPath) !== root
	}

	#throwIfRootScanCancelled(root: RootState) {
		if (this.#rootScanCancelled(root)) throw new ScanCancelledError(`File index root '${root.virtualPath}' changed`)
	}

	async #markReconciliationPathsSeen(root: RootState, relativePaths: Iterable<string>) {
		if (!root.id) return
		await this.#mutate((database) => {
			const markProtected = database.transaction((relativePaths: Iterable<string>) => {
				const markPrefix = database.prepare(`
					INSERT OR IGNORE INTO reconciliation_seen(root_id, relative_path)
					SELECT root_id, relative_path
					FROM entries
					WHERE root_id = ?
						AND (
							relative_path = ?
							OR (relative_path >= ? AND relative_path < ?)
						)
				`)

				for (const relativePath of relativePaths) {
					if (relativePath === '') throw new Error(`Cannot partially reconcile unreadable root '${root.virtualPath}'`)
					const prefix = `${relativePath}/`
					markPrefix.run(root.id, relativePath, prefix, `${relativePath}0`)
				}
			})
			markProtected.immediate(relativePaths)
		}, SCAN_DATABASE_PRIORITY)
	}

	#scheduleLiveWork(operation: () => Promise<void>, priority: number, cost = 1) {
		return new Promise<void>((resolve, reject) => {
			const pending: PendingLiveWork = {
				operation,
				priority,
				cost,
				sequence: this.#nextLiveWorkSequence++,
				resolve,
				reject,
			}
			if (this.#activeRootSnapshot) this.#pendingLiveWork.push(pending)
			else this.#enqueueLiveWork(pending)
		})
	}

	#enqueueLiveWork(pending: PendingLiveWork) {
		void (this.#scanQueue.add(pending.operation, {priority: pending.priority}) as Promise<void>).then(
			() => pending.resolve(),
			(error) => pending.reject(error),
		)
	}

	async #drainPendingLiveWork(limit: number) {
		if (limit <= 0 || this.#pendingLiveWork.length === 0) return
		this.#pendingLiveWork.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence)
		let cost = 0
		let count = 0
		while (count < this.#pendingLiveWork.length) {
			const nextCost = this.#pendingLiveWork[count].cost
			if (count > 0 && cost + nextCost > limit) break
			cost += nextCost
			count++
			if (cost >= limit) break
		}
		const pending = this.#pendingLiveWork.splice(0, count)
		for (const item of pending) {
			try {
				await item.operation()
				item.resolve()
			} catch (error) {
				item.reject(error)
			}
		}
	}

	#releasePendingLiveWork() {
		const pending = this.#pendingLiveWork.splice(0)
		for (const item of pending) this.#enqueueLiveWork(item)
	}

	noteWatcherChanges(virtualPath: string, events: readonly WatcherChange[]) {
		if (!this.#started || this.#stopping || events.length === 0) return
		const root = this.#roots.get(nodePath.posix.normalize(virtualPath))
		if (!root) return

		// The watcher has already batched and coalesced this callback to at most one
		// event per path. Large batches are cheaper to cover with one root
		// snapshot; small batches can be processed directly without rebuilding a
		// second JavaScript debounce/deduplication layer.
		if (events.length >= this.#watcherBulkThreshold) {
			this.noteWatcherBurst(root.virtualPath)
			return
		}

		// A move may arrive as an unordered create+delete pair. Observe all live
		// destinations before removing stale source rows so the index never has a
		// gap where neither path exists.
		const orderedEvents = events.toSorted(
			(left, right) => Number(left.type === 'delete') - Number(right.type === 'delete'),
		)
		const createdPaths = orderedEvents.filter(({type}) => type === 'create').map(({path}) => path)
		for (let offset = 0; offset < orderedEvents.length; offset += MAX_LIVE_WORK_PER_SCAN_BATCH) {
			const batch = orderedEvents.slice(offset, offset + MAX_LIVE_WORK_PER_SCAN_BATCH)
			void this.#scheduleLiveWork(
				async () => {
					for (const {path: systemPath, type} of batch) {
						if (type === 'delete') await this.#reuseWatcherMove(systemPath, createdPaths, 5)
						// A directory event only needs the directory's own entry. Watchman
						// reports every path beneath a directory that appears, including the
						// contents of one moved in whole, and every path removed beneath one
						// that goes. Re-scanning the whole root for each new directory turned
						// every new folder, such as each photo backup shard, into a
						// million-entry walk.
						await this.#reconcileSystemPath(systemPath, 5, 'entry').catch((error) => {
							this.logger.error(`Failed to update file index for '${systemPath}'`, error)
						})
					}
				},
				5,
				batch.length,
			).catch((error) => this.logger.error(`Failed to process file event batch for '${root.virtualPath}'`, error))
		}
	}

	async #reuseWatcherMove(sourceSystemPath: string, createdSystemPaths: string[], priority: number) {
		const root = this.#rootForSystemPath(sourceSystemPath)
		if (!root?.id || createdSystemPaths.length === 0) return
		const sourceRelativePath = relativePathWithin(root.systemPath, sourceSystemPath)
		const candidateRelativePaths = createdSystemPaths
			.filter((path) => this.#rootForSystemPath(path) === root)
			.map((path) => relativePathWithin(root.systemPath, path))
		if (candidateRelativePaths.length === 0) return
		await this.#mutate((database) => {
			const source = database
				.prepare('SELECT device, inode FROM entries WHERE root_id = ? AND relative_path = ?')
				.get(root.id, sourceRelativePath) as {device: string; inode: string} | undefined
			if (!source) return
			const placeholders = candidateRelativePaths.map(() => '?').join(', ')
			const destination = database
				.prepare(
					`SELECT relative_path FROM entries
					WHERE root_id = ? AND device = ? AND inode = ?
						AND relative_path IN (${placeholders}) AND relative_path IS NOT ? AND hidden = 0
					ORDER BY relative_path LIMIT 1`,
				)
				.get(root.id, source.device, source.inode, ...candidateRelativePaths, sourceRelativePath) as
				| {relative_path: string}
				| undefined
			if (!destination) return
			const preserve = database.transaction(() => {
				reuseMovedContent(database, root.id!, sourceRelativePath, root.id!, destination.relative_path)
				this.#syncPhotos(database)
			})
			preserve.immediate()
		}, priority)
	}

	noteWatcherBurst(virtualPath: string) {
		if (!this.#started || this.#stopping) return
		const root = this.#roots.get(nodePath.posix.normalize(virtualPath))
		if (!root) return
		void this.reconcileRoot(root.virtualPath, 'watcher-burst').catch((error) =>
			this.logger.error(`Failed to reconcile watcher burst for '${root.virtualPath}'`, error),
		)
	}

	async reconcilePath(systemPath: string) {
		if (!this.#rootForSystemPath(systemPath) || !this.#available) return
		await this.#schedulePathReconciliation(systemPath, 10, 'root')
	}

	// A directory the caller has just created was empty at that moment, so its own
	// entry is all a scan could find. Anything written into it afterwards arrives as
	// its own watcher event. Like reconcilePath, it indexes nothing in a root that
	// isn't scanned.
	async reconcileCreatedDirectory(systemPath: string) {
		const root = this.#rootForSystemPath(systemPath)
		if (!root || root.scanEnabled === false || !this.#available) return
		await this.#schedulePathReconciliation(systemPath, 10, 'entry')
	}

	async #schedulePathReconciliation(
		systemPath: string,
		priority: number,
		directoryReconciliation: DirectoryReconciliation,
	) {
		let completion: Promise<void> | undefined
		await this.#scheduleLiveWork(async () => {
			completion = (await this.#reconcileSystemPath(systemPath, priority, directoryReconciliation))?.completion
		}, priority)
		await completion
	}

	async removePath(systemPath: string) {
		const root = this.#rootForSystemPath(systemPath)
		if (!root?.id || !this.#available) return
		await this.#scheduleLiveWork(async () => {
			const relativePath = relativePathWithin(root.systemPath, systemPath)
			try {
				await this.#deleteRelativePath(root, relativePath, 10)
			} catch (error) {
				await this.#degradeRoot(root, error)
				throw error
			}
		}, 10)
	}

	// A move checks the file system and hops between the queues, so stop()
	// can't see it by draining them and waits for it here instead
	async movePath(sourceSystemPath: string, destinationSystemPath: string) {
		const move = this.#movePath(sourceSystemPath, destinationSystemPath)
		this.#moves.add(move)
		try {
			await move
		} finally {
			this.#moves.delete(move)
		}
	}

	async #movePath(sourceSystemPath: string, destinationSystemPath: string) {
		if (await this.#moveDirectoryRows(sourceSystemPath, destinationSystemPath)) return
		// Reconcile the live destination before dropping the stale source path.
		try {
			await this.reconcilePath(destinationSystemPath)
			const sourceRoot = this.#rootForSystemPath(sourceSystemPath)
			const destinationRoot = this.#rootForSystemPath(destinationSystemPath)
			if (
				sourceRoot &&
				destinationRoot &&
				isPhotosRootKind(sourceRoot.kind) &&
				isPhotosRootKind(destinationRoot.kind) &&
				sourceRoot.id &&
				destinationRoot.id
			) {
				await this.#mutate((database) => {
					const move = database.transaction(() => {
						const sourceRelativePath = relativePathWithin(sourceRoot.systemPath, sourceSystemPath)
						const destinationRelativePath = relativePathWithin(destinationRoot.systemPath, destinationSystemPath)
						reuseMovedContent(
							database,
							sourceRoot.id!,
							sourceRelativePath,
							destinationRoot.id!,
							destinationRelativePath,
						)
						this.#syncPhotos(database)
					})
					move.immediate()
				})
				// A watcher may already have removed the source (including a hidden
				// Trash claim), leaving no row for reuseMovedContent. Resolve the live
				// destination's identity before acknowledging a Photos move. Existing
				// hashes/metadata are reused, or rebuilt if orphan cleanup removed them.
				if (this.#photosAvailable && supportsPhotos(nodePath.basename(destinationSystemPath))) {
					const entry = await this.#entryBySystemPath(destinationSystemPath)
					if (entry?.type === 'file' && !entry.hidden && entry.thumbnailIdentityKind === 'content') {
						await this.#enrichment.ensureMediaMetadata(entry.id)
					}
				}
			}
		} finally {
			await this.removePath(sourceSystemPath)
		}
	}

	// A directory renamed within one root keeps every inode below it, so its
	// rows can follow it in place, keeping their sizes, hashes and thumbnails,
	// instead of waiting for a root snapshot to rediscover the tree. Anything
	// else, or a destination that isn't the directory the index recorded at the
	// source, is left to the generic move above. Like the generic move, it still
	// requests a root snapshot (without waiting for it) to pick up anything the
	// index hadn't recorded yet, such as children of a tree still being walked.
	async #moveDirectoryRows(sourceSystemPath: string, destinationSystemPath: string) {
		const root = this.#rootForSystemPath(sourceSystemPath)
		if (!root?.id || root.scanEnabled === false || !this.#available) return false
		if (this.#rootForSystemPath(destinationSystemPath) !== root) return false
		const source = relativePathWithin(root.systemPath, sourceSystemPath)
		const destination = relativePathWithin(root.systemPath, destinationSystemPath)
		if (
			source === '' ||
			destination === '' ||
			destination.startsWith(`${source}/`) ||
			source.startsWith(`${destination}/`) ||
			isReservedMemberTrashPath(root, source) ||
			isReservedMemberTrashPath(root, destination)
		) {
			return false
		}
		// Files and other non-directories take the generic move without queueing
		if (!(await lstat(destinationSystemPath).catch(() => undefined))?.isDirectory()) return false

		let moved = false
		await this.#scheduleLiveWork(async () => {
			const stats = await lstat(destinationSystemPath, {bigint: true}).catch(() => undefined)
			const write = stats?.isDirectory() ? this.#entryWrite(root, destinationSystemPath, stats) : undefined
			if (!write || this.#roots.get(root.virtualPath) !== root) return
			// The directory's own row picks up its new name and change time, and
			// both parents their new modification times
			const writes = [write]
			for (const parent of new Set([nodePath.dirname(sourceSystemPath), nodePath.dirname(destinationSystemPath)])) {
				const parentStats = await lstat(parent, {bigint: true}).catch(() => undefined)
				const parentWrite = parentStats && this.#entryWrite(root, parent, parentStats)
				if (parentWrite) writes.push(parentWrite)
			}
			try {
				moved = await this.#mutate((database) => {
					const recorded = database
						.prepare("SELECT device, inode FROM entries WHERE root_id = ? AND relative_path = ? AND type = 'directory'")
						.get(root.id, source) as {device: string; inode: string} | undefined
					if (recorded?.device !== write.device || recorded.inode !== write.inode) return false
					const {entries} = database
						.prepare(
							`SELECT COUNT(*) AS entries FROM (
								SELECT 1 FROM entries WHERE root_id = ? AND relative_path >= ? AND relative_path < ? LIMIT ?
							)`,
						)
						.get(root.id, `${source}/`, `${source}0`, MAX_IN_PLACE_MOVE_ENTRIES + 1) as {entries: number}
					if (entries > MAX_IN_PLACE_MOVE_ENTRIES) return false

					this.#applyPathMutation(database, {type: 'delete', rootId: root.id!, relativePath: destination})
					run(
						database,
						`UPDATE entries SET relative_path = ? || substr(relative_path, length(?) + 1)
						WHERE root_id = ? AND relative_path >= ? AND relative_path < ?`,
						`${destination}/`,
						`${source}/`,
						root.id,
						`${source}/`,
						`${source}0`,
					)
					run(
						database,
						'UPDATE entries SET relative_path = ? WHERE root_id = ? AND relative_path = ?',
						destination,
						root.id,
						source,
					)
					// A running root snapshot may already have walked past the destination
					const markSeen = this.#activeRootSnapshot?.root.id === root.id
					if (markSeen) {
						run(
							database,
							`INSERT INTO reconciliation_seen(root_id, relative_path)
							SELECT root_id, relative_path FROM entries
							WHERE root_id = ? AND relative_path >= ? AND relative_path < ?
							ON CONFLICT(root_id, relative_path) DO NOTHING`,
							root.id,
							`${destination}/`,
							`${destination}0`,
						)
					}
					this.#applyPathMutation(database, {type: 'write', entries: writes, markSeen})
					return true
				}, 10)
			} catch (error) {
				// The transaction rolled back, so the generic move can still apply it
				this.logger.error(`Failed to move index rows from '${sourceSystemPath}' in place`, error)
			}
		}, 10)
		if (!moved) return false
		if (isPhotosRootKind(root.kind)) this.#notifyPhotosChanged([root.ownerId])
		void this.reconcileRoot(root.virtualPath, 'directory-changed').catch((error) =>
			this.logger.error(`Failed to reconcile '${root.virtualPath}' after a directory move`, error),
		)
		return true
	}

	async #reconcileSystemPath(
		systemPath: string,
		priority: number,
		directoryReconciliation: DirectoryReconciliation,
	): Promise<PathReconciliationResult | undefined> {
		const root = this.#rootForSystemPath(systemPath)
		if (!root?.id || !this.#available || this.#stopping) return
		try {
			const relativePath = relativePathWithin(root.systemPath, systemPath)
			if (isReservedMemberTrashPath(root, relativePath)) {
				await this.#deleteRelativePath(root, relativePath, priority)
				return
			}
			let stats: FileStats
			try {
				stats = await lstat(systemPath, {bigint: true})
			} catch (error) {
				// ENOTDIR means a parent is now a file, so the path is gone too
				const code = (error as NodeJS.ErrnoException).code
				if (code === 'ENOENT' || code === 'ENOTDIR') {
					await this.#deleteRelativePath(root, relativePath, priority)
					return
				}
				throw error
			}

			if (relativePath === '') {
				return {completion: this.reconcileRoot(root.virtualPath, 'root-hint')}
			}

			if (stats.isDirectory() && directoryReconciliation === 'root') {
				// A caller asking for a directory wants its contents indexed without
				// waiting for watcher events. A full root scan is the smallest simple
				// operation that can also remove stale rows.
				return {completion: this.reconcileRoot(root.virtualPath, 'directory-changed')}
			}

			const first = this.#entryWrite(root, systemPath, stats)
			if (first) await this.#writeEntries([first], priority)
			return {}
		} catch (error) {
			if (!(error instanceof ScanCancelledError) && this.#roots.get(root.virtualPath) === root) {
				await this.#degradeRoot(root, error)
			}
			throw error
		}
	}

	#entryWrite(root: RootState, systemPath: string, stats: FileStats): EntryWrite | undefined {
		if (!root.id) return undefined
		const relativePath = relativePathWithin(root.systemPath, systemPath)
		if (relativePath === '' || isReservedMemberTrashPath(root, relativePath)) return undefined
		const name = nodePath.basename(systemPath)
		const type = entryType(stats)
		const identity = fileIdentity(stats)
		// A photo or video, which Files and Photos show a picture of, is told by
		// its content where the root is scanned. So is a document or recording
		// that the models read there, where they are installed.
		const thumbnailEligible = type === 'file' && supportsThumbnail(name)
		const read =
			type === 'file' && root.scanEnabled !== false && embeddingsAvailable() && readableKind(name) !== undefined
		const thumbnailIdentityKind = thumbnailEligible
			? root.scanEnabled === false
				? 'transient'
				: 'content'
			: read
				? 'content'
				: null

		return {
			rootId: root.id,
			relativePath,
			name,
			type,
			size: Number(stats.size),
			modifiedMs: identity.modifiedMs,
			birthtimeMs: identity.birthtimeMs,
			device: identity.device,
			inode: identity.inode,
			modifiedNs: identity.modifiedNs,
			ctimeNs: identity.ctimeNs,
			thumbnailIdentityKind,
			hashNotBefore:
				thumbnailIdentityKind === 'content' ? hashNotBefore(Number(stats.size), Number(stats.ctimeMs)) : null,
			observedAt: root.scanEnabled === false ? Date.now() : null,
			hidden: Number(this.#isHidden(name)),
		}
	}

	#shouldIndexSystemPath(root: RootState, systemPath: string) {
		return !isReservedMemberTrashPath(root, relativePathWithin(root.systemPath, systemPath))
	}

	// Returns how long the write transaction took
	async #writeEntries(entries: EntryWrite[], priority = 0, markSeen = false) {
		if (entries.length === 0) return 0
		const activeRootId = this.#activeRootSnapshot?.root.id
		if (activeRootId && entries.every(({rootId}) => rootId === activeRootId)) markSeen = true
		let transactionMs = 0
		await this.#mutate(
			(database) => this.#applyPathMutation(database, {type: 'write', entries, markSeen}),
			priority,
			(milliseconds) => (transactionMs = milliseconds),
		)
		this.#enrichment.kick()
		return transactionMs
	}

	// Requests from people using Files or Photos mark the index busy for a moment
	#noteForeground() {
		this.#foregroundActiveUntil = Date.now() + FOREGROUND_QUIET_MS
		this.#foregroundRequests++
	}

	// A long scan, such as one reconciling a renamed folder, rests after a write
	// that requests overlapped for as long as it took, up to the longest pause.
	// Requests then find the index free at least half the time: on an Umbrel
	// Pro, the slowest thumbnail while renaming 51,000 photos was 1.1 s with the
	// rest and 4.6 s without. Batches nobody overlapped carry straight on.
	async #restAfterBackgroundWrite(restMs: number) {
		if (restMs < 1) return new Promise<void>((resolve) => setImmediate(resolve))
		await this.#sleepUnlessStopping(Math.min(restMs, MAX_FOREGROUND_PAUSE_MS))
	}

	// Background writes wait for a quiet moment between requests, up to a limit
	async #yieldToForeground() {
		const deadline = Date.now() + MAX_FOREGROUND_PAUSE_MS
		while (!this.#stopping && Date.now() < Math.min(this.#foregroundActiveUntil, deadline)) {
			await this.#sleepUnlessStopping(Math.min(this.#foregroundActiveUntil, deadline) - Date.now())
		}
	}

	// Waits that stop() cuts short, so shutting down doesn't wait out a pause
	#sleepUnlessStopping(milliseconds: number) {
		return new Promise<void>((resolve) => {
			if (this.#stopping) return resolve()
			const wake = () => {
				clearTimeout(timer)
				this.#wakeOnStop.delete(wake)
				resolve()
			}
			const timer = setTimeout(wake, milliseconds)
			this.#wakeOnStop.add(wake)
		})
	}

	async #deleteRelativePath(root: RootState, relativePath: string, priority: number) {
		const rootId = root.id
		if (!rootId) return
		const deleted = await this.#mutate((database) => {
			// Nothing is indexed at or beneath most deleted paths the watcher reports,
			// such as temporary files created and removed between batches. Skip them
			// so they don't make Photos clients refetch.
			// Two lookups, since SQLite can't use the path index for an OR of both
			if (
				relativePath !== '' &&
				!database.prepare('SELECT 1 FROM entries WHERE root_id = ? AND relative_path = ?').get(rootId, relativePath) &&
				!database
					.prepare('SELECT 1 FROM entries WHERE root_id = ? AND relative_path >= ? AND relative_path < ? LIMIT 1')
					.get(rootId, `${relativePath}/`, `${relativePath}0`)
			) {
				return false
			}
			this.#applyPathMutation(database, {type: 'delete', rootId, relativePath})
			return true
		}, priority)
		if (!deleted) return
		if (isPhotosRootKind(root.kind)) this.#notifyPhotosChanged([root.ownerId])
		this.#enrichment.kick()
	}

	#applyPathMutation(database: Database, mutation: PathMutation) {
		// #mutate owns the transaction, including size maintenance.
		const apply = (mutation: PathMutation) => {
			if (mutation.type === 'delete') {
				if (mutation.relativePath === '') {
					run(database, 'DELETE FROM entries WHERE root_id = ?', mutation.rootId)
					run(database, 'DELETE FROM reconciliation_seen WHERE root_id = ?', mutation.rootId)
					return
				}
				// SQLite's default binary ordering places every `path/...`
				// descendant between `path/` and the next string, `path0`. This
				// range can use the (root_id, relative_path) index directly.
				const prefix = `${mutation.relativePath}/`
				const prefixEnd = `${mutation.relativePath}0`
				run(
					database,
					'DELETE FROM entries WHERE root_id = ? AND relative_path = ?',
					mutation.rootId,
					mutation.relativePath,
				)
				run(
					database,
					`DELETE FROM entries
						WHERE root_id = ? AND relative_path >= ? AND relative_path < ?`,
					mutation.rootId,
					prefix,
					prefixEnd,
				)
				run(
					database,
					'DELETE FROM reconciliation_seen WHERE root_id = ? AND relative_path = ?',
					mutation.rootId,
					mutation.relativePath,
				)
				run(
					database,
					`DELETE FROM reconciliation_seen
						WHERE root_id = ? AND relative_path >= ? AND relative_path < ?`,
					mutation.rootId,
					prefix,
					prefixEnd,
				)
				return
			}

			const writeStatement = database.prepare(`
				INSERT INTO entries(
						root_id, relative_path, name, search_name, search_name_folded,
						type, size, modified_ms, birthtime_ms, device, inode, modified_ns, ctime_ns,
						thumbnail_identity_kind, hash_retry_at, observed_at, hidden
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(root_id, relative_path) DO UPDATE SET
						name = excluded.name,
						search_name = excluded.search_name,
						search_name_folded = excluded.search_name_folded,
						type = excluded.type,
						size = excluded.size,
						modified_ms = excluded.modified_ms,
						birthtime_ms = excluded.birthtime_ms,
						device = excluded.device,
						inode = excluded.inode,
						modified_ns = excluded.modified_ns,
						ctime_ns = excluded.ctime_ns,
						thumbnail_identity_kind = CASE
							-- Photos backups promote files without thumbnails to a content identity
							-- before attaching their hash. A rescan of the same revision in between
							-- must not undo that, so only a changed file drops the promotion.
							WHEN entries.thumbnail_identity_kind = 'content'
								AND excluded.type = 'file' AND entries.inode IS excluded.inode
								AND entries.size IS excluded.size AND entries.modified_ns IS excluded.modified_ns
							THEN 'content' ELSE excluded.thumbnail_identity_kind END,
						content_id = CASE
							WHEN entries.thumbnail_identity_kind = 'content' AND entries.content_id IS NOT NULL
								AND excluded.type = 'file' AND entries.inode IS excluded.inode
								AND entries.size IS excluded.size AND entries.modified_ns IS excluded.modified_ns
							THEN entries.content_id
							WHEN excluded.thumbnail_identity_kind = 'content'
								AND entries.thumbnail_identity_kind = 'content'
				AND entries.inode IS excluded.inode
				AND entries.size IS excluded.size
				AND entries.modified_ns IS excluded.modified_ns
							THEN entries.content_id
							ELSE NULL
						END,
						hash_failure_count = CASE
							WHEN entries.thumbnail_identity_kind = 'content' AND entries.content_id IS NOT NULL
								AND excluded.type = 'file' AND entries.inode IS excluded.inode
								AND entries.size IS excluded.size AND entries.modified_ns IS excluded.modified_ns
							THEN entries.hash_failure_count
							WHEN excluded.thumbnail_identity_kind = 'content'
								AND entries.thumbnail_identity_kind = 'content'
				AND entries.inode IS excluded.inode
				AND entries.size IS excluded.size
				AND entries.modified_ns IS excluded.modified_ns
							THEN entries.hash_failure_count
							ELSE 0
						END,
						hash_retry_at = CASE
							WHEN entries.thumbnail_identity_kind = 'content' AND entries.content_id IS NOT NULL
								AND excluded.type = 'file' AND entries.inode IS excluded.inode
								AND entries.size IS excluded.size AND entries.modified_ns IS excluded.modified_ns
							THEN entries.hash_retry_at
							WHEN entries.thumbnail_identity_kind = 'content'
								AND excluded.thumbnail_identity_kind = 'content'
				AND entries.inode IS excluded.inode
				AND entries.size IS excluded.size
				AND entries.modified_ns IS excluded.modified_ns
							THEN entries.hash_retry_at
							ELSE excluded.hash_retry_at
						END,
						hash_error = CASE
							WHEN entries.thumbnail_identity_kind = 'content' AND entries.content_id IS NOT NULL
								AND excluded.type = 'file' AND entries.inode IS excluded.inode
								AND entries.size IS excluded.size AND entries.modified_ns IS excluded.modified_ns
							THEN entries.hash_error
							WHEN excluded.thumbnail_identity_kind = 'content'
								AND entries.thumbnail_identity_kind = 'content'
								AND entries.inode IS excluded.inode
								AND entries.size IS excluded.size
								AND entries.modified_ns IS excluded.modified_ns
							THEN entries.hash_error
							ELSE NULL
						END,
						observed_at = CASE
							WHEN excluded.observed_at IS NULL THEN NULL
							WHEN entries.observed_at IS NULL OR entries.observed_at <= ? THEN excluded.observed_at
							ELSE entries.observed_at
						END,
						hidden = excluded.hidden
					WHERE entries.name IS NOT excluded.name
						OR entries.search_name IS NOT excluded.search_name
						OR entries.search_name_folded IS NOT excluded.search_name_folded
						OR entries.type IS NOT excluded.type
						OR entries.size IS NOT excluded.size
						OR entries.modified_ms IS NOT excluded.modified_ms
						OR entries.birthtime_ms IS NOT excluded.birthtime_ms
						OR entries.device IS NOT excluded.device
						OR entries.inode IS NOT excluded.inode
						OR entries.modified_ns IS NOT excluded.modified_ns
						OR entries.ctime_ns IS NOT excluded.ctime_ns
						OR entries.thumbnail_identity_kind IS NOT excluded.thumbnail_identity_kind
						OR (
							excluded.observed_at IS NOT NULL
							AND (entries.observed_at IS NULL OR entries.observed_at <= ?)
						)
						OR entries.hidden IS NOT excluded.hidden
			`)
			const markSeenStatement = mutation.markSeen
				? database.prepare(`
						INSERT INTO reconciliation_seen(root_id, relative_path)
						VALUES (?, ?)
						ON CONFLICT(root_id, relative_path) DO NOTHING
					`)
				: undefined
			const reuseRenamedContentStatement = database.prepare(REUSE_RENAMED_CONTENT_SQL)
			for (const entry of mutation.entries) {
				markSeenStatement?.run(entry.rootId, entry.relativePath)
				const observationCutoff = entry.observedAt === null ? null : entry.observedAt - TRANSIENT_OBSERVATION_REFRESH_MS
				const written = writeStatement.run(
					entry.rootId,
					entry.relativePath,
					entry.name,
					entry.name.normalize('NFC'),
					foldSearchName(entry.name),
					entry.type,
					entry.size,
					entry.modifiedMs,
					entry.birthtimeMs,
					entry.device,
					entry.inode,
					entry.modifiedNs,
					entry.ctimeNs,
					entry.thumbnailIdentityKind,
					entry.hashNotBefore,
					entry.observedAt,
					entry.hidden,
					observationCutoff,
					observationCutoff,
				)
				if (written.changes > 0 && entry.type === 'file')
					reuseRenamedContentStatement.run(entry.rootId, entry.relativePath)
			}
		}
		apply(mutation)
		this.#syncPhotos(database)
	}

	// Triggers journal every change to an entry, metadata or durable state that
	// Photos reads, within the same transaction. Apply them once per mutation:
	// a batch of changed entries then costs one batched library refresh per
	// account rather than one per item, however many entries changed and why.
	#syncPhotos(database: Database) {
		if (!this.#photosAvailable) return
		this.#notifyPhotosChanged(this.#photos.syncChangedContents(database))
	}

	async getEntryByVirtualPath(virtualPath: string): Promise<IndexedEntry | undefined> {
		this.#noteForeground()
		const root = this.#rootForVirtualPath(virtualPath)
		if (!root?.id || !this.#available) return undefined
		const relativePath = relativeVirtualPath(root.virtualPath, virtualPath)
		if (relativePath === '' || isReservedMemberTrashPath(root, relativePath)) return undefined
		const row = (await readDatabase(this.#readSql, ON_DEMAND_DATABASE_PRIORITY)
			.prepare(`${entrySelectSql()} WHERE entries.root_id = ? AND entries.relative_path = ?`)
			.get(root.id, relativePath)) as EntryRow | undefined
		return row && this.#roots.get(root.virtualPath) === root ? indexedEntry(row) : undefined
	}

	async getEntryBySystemPath(systemPath: string): Promise<IndexedEntry | undefined> {
		this.#noteForeground()
		return this.#entryBySystemPath(systemPath)
	}

	// The same lookup for index work, Files moves and Photos uploads, which
	// aren't someone browsing and shouldn't slow scans down
	async #entryBySystemPath(systemPath: string): Promise<IndexedEntry | undefined> {
		const root = this.#rootForSystemPath(systemPath)
		if (!root?.id || !this.#available) return undefined
		const relativePath = relativePathWithin(root.systemPath, systemPath)
		if (relativePath === '' || isReservedMemberTrashPath(root, relativePath)) return undefined
		const row = (await readDatabase(this.#readSql, ON_DEMAND_DATABASE_PRIORITY)
			.prepare(`${entrySelectSql()} WHERE entries.root_id = ? AND entries.relative_path = ?`)
			.get(root.id, relativePath)) as EntryRow | undefined
		return row && this.#roots.get(root.virtualPath) === root ? indexedEntry(row) : undefined
	}

	async ensureThumbnail(systemPath: string, variant?: ThumbnailVariant): Promise<ThumbnailReference> {
		this.#noteForeground()
		if (!supportsThumbnail(nodePath.basename(systemPath))) throw new Error('Unsupported or missing thumbnail source')
		const stats = await lstat(systemPath).catch(() => undefined)
		if (!stats?.isFile()) throw new Error('Unsupported or missing thumbnail source')
		await this.reconcilePath(systemPath)
		const entry = await this.getEntryBySystemPath(systemPath)
		if (!entry?.thumbnailEligible || entry.type !== 'file') throw new Error('Unsupported or missing thumbnail source')
		return this.#enrichment.ensureThumbnail(entry.id, variant)
	}

	async photosRegisterUpload(
		accountId: string,
		systemPath: string,
		hash: Buffer,
		expectedRevision: PublishedFileRevision,
		albumId?: string,
	) {
		this.#requirePhotos()
		await this.reconcilePath(systemPath)
		const entry = await this.#entryBySystemPath(systemPath)
		if (!entry?.thumbnailEligible || entry.type !== 'file') throw new Error('Uploaded Photos item was not indexed')
		await this.#enrichment.attachKnownContentHash(entry.id, hash, expectedRevision)
		return this.#mutate((database) => {
			const register = database.transaction(() =>
				this.#photos.registerUpload(this.#photosDatabase(database), accountId, entry.id, albumId),
			)
			return register.immediate()
		})
	}

	async photosUpsertBackupSource(
		accountId: string,
		sourceId: string,
		name: string,
		createdAt: number,
		platform?: string,
	) {
		this.#requirePhotos()
		return this.#mutate((database) => {
			const upsert = database.transaction(() =>
				this.#photos.upsertBackupSource(this.#photosDatabase(database), accountId, sourceId, name, createdAt, platform),
			)
			return upsert.immediate()
		})
	}

	async photosRegisterBackupResource(
		accountId: string,
		sourceId: string,
		resourceKey: string,
		systemPath: string,
		hash: Buffer,
		expectedRevision: PublishedFileRevision,
		originalFilename?: string,
		sourceCreationDate?: number,
		cloud?: PhotoBackupCloudIdentity,
	) {
		this.#requirePhotos()
		await this.reconcilePath(systemPath)
		const entry = await this.#entryBySystemPath(systemPath)
		if (
			!entry ||
			entry.type !== 'file' ||
			entry.hidden ||
			entry.inode !== expectedRevision.inode ||
			entry.size !== expectedRevision.size ||
			entry.modifiedNs !== expectedRevision.modifiedNs ||
			entry.ctimeNs !== expectedRevision.ctimeNs
		) {
			throw new Error('Uploaded Photos backup resource was not indexed')
		}
		await assertPublishedRevision(systemPath, expectedRevision)
		await this.#promoteContentIdentity(entry.id, expectedRevision)
		await this.#enrichment.attachKnownContentHash(entry.id, hash, expectedRevision)
		return this.#mutate((database) => {
			const register = database.transaction(() =>
				this.#photos.registerBackupResource(
					this.#photosDatabase(database),
					accountId,
					sourceId,
					resourceKey,
					entry.id,
					hash,
					originalFilename,
					sourceCreationDate,
					cloud,
				),
			)
			return register.immediate()
		})
	}

	async photosRecordMatchedBackupResources(
		accountId: string,
		sourceId: string,
		matches: Array<{
			resourceKey: string
			hash: Buffer
			originalFilename?: string
			sourceCreationDate?: number
			cloud?: PhotoBackupCloudIdentity
		}>,
	) {
		this.#requirePhotos()
		return this.#mutate((database) => {
			const record = database.transaction(() =>
				this.#photos.recordMatchedBackupResources(this.#photosDatabase(database), accountId, sourceId, matches),
			)
			return record.immediate()
		})
	}

	async photosBackupSourceContentLocations(accountId: string, sourceId: string, hash: Buffer) {
		this.#requirePhotos()
		return this.#mutate((database) =>
			this.#photos.backupSourceContentLocations(this.#photosDatabase(database), accountId, sourceId, hash),
		)
	}

	async photosBackupCloudIdentityMatches(accountId: string, sourceId: string, identities: PhotoBackupCloudIdentity[]) {
		this.#requirePhotos()
		return this.#mutate((database) =>
			this.#photos.backupCloudIdentityMatches(this.#photosDatabase(database), accountId, sourceId, identities),
		)
	}

	async photosAttachBackupCloudIdentities(
		accountId: string,
		sourceId: string,
		resources: Array<PhotoBackupCloudIdentity & {resourceKey: string}>,
	) {
		this.#requirePhotos()
		return this.#mutate((database) =>
			this.#photos.attachBackupCloudIdentities(this.#photosDatabase(database), accountId, sourceId, resources),
		)
	}

	async photosConfirmedBackupResources(accountId: string, sourceId: string, resourceKeys: string[]) {
		this.#requirePhotos()
		let resources = await this.#mutate((database) =>
			this.#photos.confirmedBackupResources(this.#photosDatabase(database), accountId, sourceId, resourceKeys),
		)
		await this.#recoverBackupResourceIdentities(
			accountId,
			resources.filter(({path}) => path === undefined).map(({contentHash}) => contentHash),
		)
		resources = await this.#mutate((database) =>
			this.#photos.confirmedBackupResources(this.#photosDatabase(database), accountId, sourceId, resourceKeys),
		)
		return resources
	}

	async #promoteContentIdentity(entryId: number, revision: PublishedFileRevision) {
		const promoted = await this.#mutate(
			(database) =>
				database
					.prepare(
						`UPDATE entries SET thumbnail_identity_kind = 'content', hash_retry_at = NULL, hash_error = NULL
					WHERE id = ? AND type = 'file' AND hidden = 0
						AND inode = ? AND size = ? AND modified_ns = ? AND ctime_ns = ?`,
					)
					.run(entryId, revision.inode, revision.size, revision.modifiedNs, revision.ctimeNs).changes,
		)
		if (promoted === 0) throw new Error('Photos backup resource changed before content indexing')
	}

	async #recoverBackupResourceIdentities(accountId: string, hashes: Buffer[]) {
		const unresolved = new Set(hashes.map((hash) => hash.toString('hex')))
		if (unresolved.size === 0) return
		const candidates = await this.#mutate(
			(database) =>
				database
					.prepare(
						`SELECT entries.id, entries.name, entries.inode, entries.size, entries.modified_ns, entries.ctime_ns
						FROM entries
						JOIN index_roots ON index_roots.id = entries.root_id
						WHERE index_roots.owner_id = ? AND index_roots.kind = 'home'
							AND entries.type = 'file' AND entries.hidden = 0 AND entries.content_id IS NULL`,
					)
					.all(accountId) as Array<{
					id: number
					name: string
					inode: string
					size: number
					modified_ns: string
					ctime_ns: string
				}>,
			20,
		)
		// A normal Files move preserves the resource-key filename, so try those
		// cheap, high-confidence candidates first. Renamed resources remain
		// recoverable by hash without making path metadata durable.
		candidates.sort((left, right) => {
			const leftNamed = /^[0-9a-f]{64}\.[0-9a-z]{1,16}$/i.test(left.name)
			const rightNamed = /^[0-9a-f]{64}\.[0-9a-z]{1,16}$/i.test(right.name)
			return Number(rightNamed) - Number(leftNamed)
		})
		for (const candidate of candidates) {
			if (unresolved.size === 0) break
			const revision = {
				inode: candidate.inode,
				size: Number(candidate.size),
				modifiedNs: candidate.modified_ns,
				ctimeNs: candidate.ctime_ns,
			}
			try {
				await this.#promoteContentIdentity(candidate.id, revision)
				const hash = await this.#enrichment.ensureContentHash(candidate.id)
				unresolved.delete(hash.toString('hex'))
			} catch (error) {
				this.logger.error(`Failed to recover Photos backup identity for '${candidate.name}'`, error)
			}
		}
	}

	async photosPrepareUpload(accountId: string, hash: Buffer, albumId?: string) {
		this.#requirePhotos()
		return this.#mutate((database) => {
			const prepare = database.transaction(() =>
				this.#photos.prepareUpload(this.#photosDatabase(database), accountId, hash, albumId),
			)
			return prepare.immediate()
		})
	}

	async getExistingThumbnail(systemPath: string, variant?: ThumbnailVariant): Promise<ThumbnailReference | undefined> {
		this.#noteForeground()
		const entry = await this.#currentThumbnailEntry(systemPath)
		if (!entry) return
		return this.#enrichment.getExistingThumbnail(entry.id, variant)
	}

	async enableThumbnailVariants(variants: ThumbnailVariant[]) {
		const availableVariants = this.#photosAvailable
			? variants
			: variants.filter((variant) => !PHOTOS_ONLY_THUMBNAIL_VARIANT_SET.has(variant))
		await this.#enrichment.enableThumbnailVariants(availableVariants)
	}

	async initializePhotos(accountId?: string) {
		this.#requirePhotos()
		const result = await this.#mutate((database) => {
			const sync = database.transaction(() => this.#photos.syncAll(database, accountId))
			return sync.immediate()
		})
		await this.#enrichment.enableThumbnailVariants(PHOTOS_THUMBNAIL_VARIANTS)
		return result
	}

	#readerPool() {
		this.#requireDatabase()
		if (this.#stopping) throw new Error('File index readers are stopped')
		if (!this.#readers) throw new Error('File index readers are unavailable')
		return this.#readers
	}

	#readSql: ReadSql = async (query, priority, lane) =>
		this.#readerPool().read('sql', [query], (begin) => begin(), {priority, lane})

	async #readFiles<M extends Exclude<FileIndexReadMethod, PhotosReadMethod>>(method: M, args: FileIndexReadArgs<M>) {
		return this.#readerPool().read(method, args, (begin) => begin())
	}

	async #readPhotos<M extends PhotosReadMethod>(method: M, args: FileIndexReadArgs<M>) {
		// Indexing progress is also read after each Photos change, so it isn't browsing
		if (method !== 'indexingState') this.#noteForeground()
		this.#requirePhotos()
		const readers = this.#readerPool()
		for (let attempt = 0; ; attempt++) {
			try {
				// Stay FIFO with user mutations; scan writes have background priority.
				// This limits idle reader reservations without letting fresh reads
				// repeatedly overtake a queued favorite/album edit.
				return await readers.read(method, args, (begin) =>
					this.#mutationQueue.add(async () => {
						this.#requirePhotos()
						if (this.#stopping) throw new Error('Photos readers are stopped')
						// Commit Photos maintenance before pinning the reader snapshot.
						// Hold the writer queue, but never a SQLite transaction, across await.
						this.#photos.prepareRead(this.#requireDatabase(), args[0] as string, method === 'indexingState')
						await begin()
					}),
				)
			} catch (error) {
				if (attempt >= 2 || (error as NodeJS.ErrnoException).code !== 'PHOTOS_READ_RETRY') throw error
			}
		}
	}

	async photosSummary(accountId: string) {
		return this.#readPhotos('summary', [accountId])
	}

	async photosIndexingState(accountId: string) {
		return this.#readPhotos('indexingState', [accountId])
	}

	async photosListItems(accountId: string, filter: PhotoFilter, cursor: string | undefined, limit: number) {
		return this.#readPhotos('listItems', [accountId, filter, cursor, limit])
	}

	// Search's questions of the index (see ../search/search.ts)
	async photosSearch<R extends SearchRead>(accountId: string, request: R): Promise<SearchReadResult[R['type']]>
	async photosSearch(accountId: string, request: SearchRead): Promise<SearchReadResult[SearchRead['type']]> {
		const read = <T extends SearchRead>(asked: T) =>
			this.#readPhotos('search', [accountId, asked]) as Promise<SearchReadResult[T['type']]>
		// Places have their names here, where the table of them is loaded (see
		// places.ts). Which ones an account has photos in is asked at most once
		// a minute: it is read from its whole library, for every search.
		if (request.type === 'place') {
			let known = this.#placesNamed.get(accountId)
			if (!known || known.until < Date.now()) {
				known = {named: places().named(await read({type: 'places'})), until: Date.now() + PLACES_KEPT_MS}
				this.#placesNamed.set(accountId, known)
			}
			return placeIn(request.text, known.named)
		}
		if (request.type === 'insights') {
			const {where, ...insights} = await read(request)
			return {...insights, ...(where ? {place: places().name(where)} : {})}
		}
		// How far along the account's files are, as last counted (see COUNTS_KEPT_MS)
		const counted = <T extends {type: 'status'} | {type: 'progress'}>(asked: T) => {
			const key = `${asked.type} ${accountId}`
			let kept = this.#counted.get(key)
			if (!kept || kept.until < Date.now()) {
				const started = Date.now()
				const counting = {counts: read(asked) as Promise<unknown>, until: Infinity}
				counting.counts.then(
					() =>
						(counting.until = Date.now() + Math.max(COUNTS_KEPT_MS, COUNTS_KEPT_FOR_TIMES * (Date.now() - started))),
					() => (counting.until = 0),
				)
				this.#counted.set(key, (kept = counting))
			}
			return kept.counts as Promise<SearchReadResult[T['type']]>
		}
		if (request.type === 'progress') return counted(request)
		// Whether the models are waiting for memory, or for room to be fetched
		// into, is the enrichment's to say
		if (request.type === 'status') {
			const status = {
				...(await counted(request)),
				...(this.#enrichment.modelsShortOfRoom ? {noRoomForModels: true} : {}),
			}
			const waiting = this.#enrichment.modelsWaitingForMemory
			if (!waiting || status.completed >= status.total) return status
			return {...status, waitingForMemorySince: waiting.since, ...(waiting.now ? {waitingForMemory: true} : {})}
		}
		return read(request)
	}

	async photosMapPoints(accountId: string, filter: PhotoFilter) {
		return this.#readPhotos('mapPoints', [accountId, filter])
	}

	async photosGetItem(accountId: string, id: string, deleted = false) {
		return this.#readPhotos('getItem', [accountId, id, deleted])
	}

	async photosNeighbors(accountId: string, id: string, filter: PhotoFilter) {
		return this.#readPhotos('neighbors', [accountId, id, filter])
	}

	async photosSetFavorite(accountId: string, ids: string[], favorite: boolean) {
		return this.#mutate((database) =>
			this.#photos.setFavorite(this.#photosDatabase(database), accountId, ids, favorite),
		)
	}

	async photosResolveItems(accountId: string, ids: string[]) {
		return this.#readPhotos('resolveItems', [accountId, ids])
	}

	async photosResolveItemFiles(accountId: string, ids: string[] | undefined, rootKind: 'home' | 'trash') {
		return this.#readPhotos('resolveItemFiles', [accountId, ids, rootKind])
	}

	async photosResolveLiveCompanion(accountId: string, id: string) {
		return this.#readPhotos('resolveLiveCompanion', [accountId, id])
	}

	async photosListAlbums(accountId: string) {
		return this.#readPhotos('listAlbums', [accountId])
	}

	async photosListPeople(accountId: string, hidden: boolean) {
		return this.#readPhotos('listPeople', [accountId, hidden])
	}

	async photosListPersonSuggestions(accountId: string) {
		return this.#readPhotos('listPersonSuggestions', [accountId])
	}

	async photosChangePeople(accountId: string, change: PeopleChange) {
		return this.#mutate((database) => this.#photos.changePeople(this.#photosDatabase(database), accountId, change))
	}

	// Gives the faces the models have just found to people, a few contents at
	// a time: a library being read for the first time finds them by the
	// thousand, and each batch is one write.
	#assignFaces(hash?: Buffer) {
		if (hash) this.#facesToAssign.push(hash)
		this.#facesAssignment ??= setTimeout(() => {
			this.#facesAssignment = undefined
			const hashes = this.#facesToAssign.splice(0)
			if (!this.#photosAvailable || this.#stopping) return
			void this.#mutate((database) => {
				const photos = this.#photosDatabase(database)
				// With nothing just found, whatever was missed: found while nobody
				// was told, or in a library the content has only now arrived in
				const contents = hashes.length > 0 ? hashes : this.#photos.unassignedFaces(photos, FACES_ASSIGNMENT_BATCH)
				if (contents.length === 0) this.#facesCaughtUp = true
				return this.#photos.assignFaces(photos, contents)
			}, BACKGROUND_DATABASE_PRIORITY)
				.then((accountIds) => {
					this.#notifyPhotosChanged(accountIds, true)
					if (!this.#facesCaughtUp) this.#assignFaces()
				})
				.catch((error) => {
					// What was worked out about people on the way was not written down
					this.#photos.forgetPeople()
					if (!this.#stopping) this.logger.error('Failed to give faces to people', error)
				})
		}, FACES_ASSIGNMENT_DELAY_MS)
		this.#facesAssignment.unref()
	}

	async photosCreateAlbum(accountId: string, name: string, ids?: string[]) {
		return this.#mutate((database) => this.#photos.createAlbum(this.#photosDatabase(database), accountId, name, ids))
	}

	async photosRenameAlbum(accountId: string, id: string, name: string) {
		return this.#mutate((database) => this.#photos.renameAlbum(this.#photosDatabase(database), accountId, id, name))
	}

	async photosSetAlbumCover(accountId: string, id: string, itemId?: string) {
		return this.#mutate((database) => this.#photos.setAlbumCover(this.#photosDatabase(database), accountId, id, itemId))
	}

	async photosDeleteAlbum(accountId: string, id: string) {
		return this.#mutate((database) => this.#photos.deleteAlbum(this.#photosDatabase(database), accountId, id))
	}

	async photosAddAlbumItems(accountId: string, id: string, ids: string[]) {
		return this.#mutate((database) => this.#photos.addAlbumItems(this.#photosDatabase(database), accountId, id, ids))
	}

	async photosRemoveAlbumItems(accountId: string, id: string, ids: string[]) {
		return this.#mutate((database) => this.#photos.removeAlbumItems(this.#photosDatabase(database), accountId, id, ids))
	}

	async photosListSources(accountId: string) {
		return this.#readPhotos('listSources', [accountId])
	}

	async photosUpdateSource(accountId: string, id: string, scope?: {mode: PhotoScopeMode; paths: string[]}) {
		return this.#mutate((database) => this.#photos.updateSource(this.#photosDatabase(database), accountId, id, scope))
	}

	async photosSourceRemovalFiles(accountId: string, id: string) {
		this.#requirePhotos()
		// Source-removal intents replay early at startup, while the ordinary
		// background scan may still be rebuilding a disposable index. Wait for a
		// current Home snapshot so keepItems:false cannot silently leave an
		// unindexed backup behind as a later Umbrel item.
		const homeRoot = [...this.#roots.values()].find(
			(root) => root.ownerId === accountId && root.kind === 'home' && root.scanEnabled !== false,
		)
		if (!homeRoot?.id) throw new Error(`Photos source removal requires an indexed Home root for '${accountId}'`)
		const scanGeneration = homeRoot.scanGeneration
		await this.reconcileRoot(homeRoot.virtualPath, 'photos-source-removal')
		if (
			this.#roots.get(homeRoot.virtualPath) !== homeRoot ||
			homeRoot.scanGeneration <= scanGeneration ||
			homeRoot.state !== 'ready' ||
			homeRoot.lastSuccessfulScanAt === undefined
		) {
			throw new Error(`Photos source removal requires a current Home snapshot for '${accountId}'`)
		}
		const resourceHashes = await this.#mutate((database) =>
			this.#photos.unresolvedBackupResourceHashes(this.#photosDatabase(database), accountId, id),
		)
		await this.#recoverBackupResourceIdentities(accountId, resourceHashes)
		return this.#mutate((database) => this.#photos.sourceRemovalFiles(this.#photosDatabase(database), accountId, id))
	}

	// For the removal dialog, from the index as it stands. Removal itself rescans
	// Home first, so a copy made moments before can still change the answer.
	async photosSourceRemovalItemCount(accountId: string, id: string) {
		this.#requirePhotos()
		return this.#mutate((database) =>
			this.#photos.sourceRemovalItemCount(this.#photosDatabase(database), accountId, id),
		)
	}

	async photosRemoveSource(accountId: string, id: string, keepItems: boolean) {
		return this.#mutate((database) =>
			this.#photos.removeSource(this.#photosDatabase(database), accountId, id, keepItems),
		)
	}

	async matchesThumbnail(systemPath: string, kind: string, key: string, variant: string) {
		const entry = await this.#currentThumbnailEntry(systemPath)
		if (!entry) return false
		return this.#enrichment.matchesThumbnail(entry.id, kind, key, variant)
	}

	async #observeTransientEntry(entry: IndexedEntry) {
		const root = this.#roots.get(entry.rootVirtualPath)
		if (root?.scanEnabled !== false || root.id !== entry.rootId) return
		const now = Date.now()
		if (entry.observedAt !== undefined && entry.observedAt > now - TRANSIENT_OBSERVATION_REFRESH_MS) return
		await this.#mutate((database) => {
			if (this.#roots.get(root.virtualPath) !== root) return
			run(
				database,
				`UPDATE entries SET observed_at = ?
				WHERE id = ? AND root_id = ?
					AND (observed_at IS NULL OR observed_at <= ?)`,
				now,
				entry.id,
				entry.rootId,
				now - TRANSIENT_OBSERVATION_REFRESH_MS,
			)
		}, 10)
	}

	async #currentThumbnailEntry(systemPath: string) {
		const entry = await this.getEntryBySystemPath(systemPath)
		if (!entry?.thumbnailEligible || entry.type !== 'file') return
		const stats = await lstat(systemPath, {bigint: true}).catch((error: NodeJS.ErrnoException) => error)
		// A file moved outside Files, such as with the rest of a renamed folder,
		// keeps its content's thumbnail until the scan that's moving its row gets
		// there, instead of every thumbnail in the folder failing for minutes
		if (stats instanceof Error)
			return stats.code === 'ENOENT' && entry.thumbnailIdentityKind === 'content' ? entry : undefined
		if (!stats.isFile()) return
		const identity = fileIdentity(stats)
		const revisionChanged =
			entry.inode !== identity.inode ||
			entry.size !== Number(stats.size) ||
			entry.modifiedNs !== identity.modifiedNs ||
			(entry.thumbnailIdentityKind === 'transient' && entry.device !== identity.device)
		if (revisionChanged) {
			void this.reconcilePath(systemPath).catch((error) =>
				this.logger.error(`Failed to refresh thumbnail source '${systemPath}'`, error),
			)
			return
		}
		await this.#observeTransientEntry(entry)
		return entry
	}

	async searchCandidates(virtualRoot: string, query: string, maxResults: number): Promise<SearchCandidate[]> {
		if (query.includes('\0')) throw new TypeError('File search queries cannot contain NUL')
		if (!Number.isSafeInteger(maxResults) || maxResults <= 0) {
			throw new TypeError('File search maxResults must be a positive integer')
		}
		const root = this.#roots.get(virtualRoot)
		if (!root?.id || !root.searchEnabled || !this.#available) {
			throw new Error(`File index root '${virtualRoot}' is unavailable`)
		}
		this.#noteForeground()
		const results = await this.#readFiles('searchCandidates', [root, query, maxResults])
		if (this.#roots.get(root.virtualPath) !== root)
			throw new Error(`File index root '${virtualRoot}' changed during search`)
		return results
	}

	async recentCandidates(
		virtualRoot: string,
		maxResults: number,
		excludedDirectoryNames: readonly string[] = [],
	): Promise<SearchCandidate[]> {
		if (!Number.isSafeInteger(maxResults) || maxResults <= 0) {
			throw new TypeError('File recents maxResults must be a positive integer')
		}
		if (
			excludedDirectoryNames.some(
				(name) => !name || name === '.' || name === '..' || name.includes('/') || name.includes('\0'),
			)
		) {
			throw new TypeError('Excluded file recents directories must be single directory names')
		}
		const root = this.#roots.get(virtualRoot)
		if (!root?.id || root.kind !== 'home' || !this.#available) {
			throw new Error(`File index home root '${virtualRoot}' is unavailable`)
		}
		const rootId = root.id

		const reservedTrashExclusion = hasReservedMemberTrashPath(root)
			? `AND entries.relative_path != 'Trash' AND entries.relative_path NOT GLOB 'Trash/*'`
			: ''
		const exclusions = excludedDirectoryNames
			.map(() => `AND instr('/' || entries.relative_path, '/' || ? || '/') = 0`)
			.join('\n')
		const rows = (await readDatabase(this.#readSql)
			.prepare(
				`SELECT id, name, relative_path
			FROM entries
			WHERE root_id = ? AND type = 'file' AND hidden = 0
			${reservedTrashExclusion}
			${exclusions}
			ORDER BY modified_ms DESC, id DESC
			LIMIT ?`,
			)
			.all(rootId, ...excludedDirectoryNames, maxResults)) as Array<{id: number; name: string; relative_path: string}>
		if (this.#roots.get(root.virtualPath) !== root)
			throw new Error(`File index root '${virtualRoot}' changed during recents lookup`)
		return rows.map((row) => ({
			id: Number(row.id),
			name: row.name,
			virtualPath: joinVirtualPath(root.virtualPath, row.relative_path),
		}))
	}

	async directorySizes(virtualPaths: readonly string[]): Promise<IndexedDirectorySize[]> {
		const requestedPaths = virtualPaths.map((virtualPath) => {
			if (!nodePath.posix.isAbsolute(virtualPath) || virtualPath.includes('\0')) {
				throw new TypeError('Indexed directory paths must be absolute and cannot contain NUL')
			}
			return nodePath.posix.normalize(virtualPath)
		})
		if (!this.#available || requestedPaths.length === 0) return []

		const roots = new Map(this.#roots)
		const requests = requestedPaths.flatMap((virtualPath) => {
			const root = this.#rootForVirtualPath(virtualPath)
			if (!root?.id || root.scanEnabled === false || root.state !== 'ready') return []
			const relativePath = relativeVirtualPath(root.virtualPath, virtualPath)
			if (relativePath && isReservedMemberTrashPath(root, relativePath)) return []
			return [{virtualPath, rootId: root.id, relativePath}]
		})
		this.#noteForeground()
		const results = await this.#readFiles('directorySizes', [requests])
		return results.filter(({virtualPath}) => {
			const root = this.#rootForVirtualPath(virtualPath)
			return root && roots.get(root.virtualPath) === root
		})
	}

	async status() {
		let entryCount = 0
		let enrichment = {
			eligibleEntries: 0,
			hashedEntries: 0,
			pendingHashes: 0,
			hashFailures: 0,
			uniqueContents: 0,
			readyThumbnails: 0,
			thumbnailFailures: 0,
			readyMedia: 0,
			mediaFailures: 0,
		}
		if (this.#available) {
			const row = (await readDatabase(this.#readSql, 0, 'bulk')
				.prepare('SELECT COUNT(*) AS count FROM entries')
				.get()) as {count: number}
			entryCount = Number(row.count)
			enrichment = await this.#enrichment.status()
		}

		return {
			available: this.#available,
			photosAvailable: this.#photosAvailable,
			readers: this.#readers?.status() ?? {threadIds: [], active: 0, queued: 0},
			schemaVersion: this.#schemaVersion,
			entryCount,
			enrichment,
			roots: [...this.#roots.values()].map((root) => ({
				virtualPath: root.virtualPath,
				state: root.state,
				scanGeneration: root.scanGeneration,
				lastSuccessfulScanAt: root.lastSuccessfulScanAt,
				lastError: root.lastError,
			})),
		}
	}

	async #degradeRoot(root: RootState, error: unknown) {
		const message = error instanceof Error ? error.message : String(error)
		root.state = 'degraded'
		root.lastError = message
		if (!root.id || !this.#available) return
		await this.#mutate((database) =>
			run(
				database,
				`UPDATE index_roots SET state = 'degraded', last_error = ?, updated_at = ? WHERE id = ?`,
				message,
				Date.now(),
				root.id,
			),
		).catch(() => {})
		if (root.kind === 'home') this.#notifyPhotosChanged([root.ownerId])
	}

	#rootForSystemPath(systemPath: string) {
		const normalized = nodePath.resolve(systemPath)
		return [...this.#roots.values()]
			.filter((root) => isPathInsideOrEqual(root.systemPath, normalized))
			.sort((a, b) => b.systemPath.length - a.systemPath.length)[0]
	}

	#rootForVirtualPath(virtualPath: string) {
		const normalized = nodePath.posix.normalize(virtualPath)
		return [...this.#roots.values()]
			.filter((root) => normalized === root.virtualPath || normalized.startsWith(`${root.virtualPath}/`))
			.sort((a, b) => b.virtualPath.length - a.virtualPath.length)[0]
	}

	async #mutate<T>(
		operation: (database: Database) => T,
		priority = 0,
		onTransactionDuration?: (milliseconds: number) => void,
	): Promise<T> {
		return (await this.#mutationQueue.add(
			() => {
				const database = this.#requireDatabase()
				const startedAt = performance.now()
				// Entry changes and their folder totals share one commit. Nested
				// transactions become savepoints; any maintenance failure rolls back
				// the entries too. WAL readers keep seeing the previous complete state
				// until commit, so size reads never need to recalculate a subtree.
				// Callbacks must be synchronous; reader handshakes use the queue directly.
				const result = database
					.transaction(() => {
						const result = operation(database)
						this.#directorySizes?.sync()
						return result
					})
					.immediate()
				onTransactionDuration?.(performance.now() - startedAt)
				return result
			},
			{priority},
		)) as T
	}

	#requireDatabase() {
		if (!this.#database) throw new Error('File index is unavailable')
		return this.#database
	}

	#requirePhotos() {
		if (!this.#photosAvailable) throw new Error('Photos library is unavailable')
	}

	#photosDatabase(database: Database) {
		this.#requirePhotos()
		return database
	}

	#setAvailable(available: boolean) {
		if (this.#available === available) return
		this.#available = available
		this.#onAvailabilityChange?.(available)
	}

	#notifyPhotosChanged(accountIds: Iterable<string>, byFaces = false) {
		if (!this.#photosAvailable || (!this.#onPhotosChange && !this.#onPhotosIndexingProgress) || this.#stopping) return
		const changedAccountIds = [...new Set(accountIds)]
		if (changedAccountIds.length === 0) return
		// A library that changed may have gained something whose faces are
		// already known: a folder made part of Photos, or a copy of what
		// someone else has. Nobody is told of those one at a time, so every
		// library is looked through for them, at most this often.
		if (!byFaces) {
			this.#facesSweep ??= setTimeout(() => {
				this.#facesSweep = undefined
				this.#facesCaughtUp = false
				this.#assignFaces()
			}, FACES_SWEEP_DELAY_MS)
			this.#facesSweep.unref()
		}

		if (this.#onPhotosChange) {
			for (const accountId of changedAccountIds) this.#photosChangedAccountIds.add(accountId)
			this.#photosChangeTimer ??= setTimeout(() => {
				this.#photosChangeTimer = undefined
				const accountIds = [...this.#photosChangedAccountIds]
				this.#photosChangedAccountIds.clear()
				this.#onPhotosChange?.(accountIds)
			}, 250)
		}

		this.#notifyPhotosIndexingProgress(changedAccountIds)
	}

	#notifyPhotosIndexingProgress(accountIds: Iterable<string>) {
		if (!this.#photosAvailable || !this.#onPhotosIndexingProgress || this.#stopping) return
		for (const accountId of accountIds) this.#photosIndexingProgressAccountIds.add(accountId)
		if (this.#photosIndexingProgressAccountIds.size === 0) return
		this.#photosIndexingProgressTimer ??= setTimeout(() => {
			this.#photosIndexingProgressTimer = undefined
			const accountIds = [...this.#photosIndexingProgressAccountIds]
			this.#photosIndexingProgressAccountIds.clear()
			void Promise.all(
				accountIds.map(async (accountId) => ({
					accountId,
					state: await this.photosIndexingState(accountId),
				})),
			)
				.then((progress) => {
					if (!this.#stopping) this.#onPhotosIndexingProgress?.(progress)
				})
				.catch((error) => this.logger.error('Failed to report Photos indexing progress', error))
		}, PHOTOS_INDEXING_PROGRESS_INTERVAL_MS)
	}

	async stop() {
		if (!this.#started) return
		this.#stopping = true
		for (const wake of this.#wakeOnStop) wake()
		await this.#readers?.stop()
		this.#readers = undefined
		if (this.#reconciliationTimer) clearTimeout(this.#reconciliationTimer)
		if (this.#recoveryTimer) clearTimeout(this.#recoveryTimer)
		if (this.#photosRecoveryTimer) clearTimeout(this.#photosRecoveryTimer)
		clearTimeout(this.#facesAssignment)
		this.#facesAssignment = undefined
		clearTimeout(this.#facesSweep)
		this.#facesSweep = undefined
		if (this.#photosChangeTimer) clearTimeout(this.#photosChangeTimer)
		if (this.#photosIndexingProgressTimer) clearTimeout(this.#photosIndexingProgressTimer)
		this.#reconciliationTimer = undefined
		this.#recoveryTimer = undefined
		this.#photosRecoveryTimer = undefined
		this.#photosChangeTimer = undefined
		this.#photosIndexingProgressTimer = undefined
		this.#photosChangedAccountIds.clear()
		this.#photosIndexingProgressAccountIds.clear()
		await this.#recoveryAttempt
		await this.#photosRecoveryAttempt
		await this.#enrichment.stop()
		await Promise.allSettled(this.#moves)
		await this.#scanQueue.onIdle()
		await this.#mutationQueue.onIdle()
		try {
			this.#database?.close()
		} catch (error) {
			this.logger.error('Failed to close file index', error)
		}
		this.#database = undefined
		this.#setAvailable(false)
		this.#started = false
	}
}

function reuseMovedContent(
	database: Database,
	sourceRootId: number,
	sourceRelativePath: string,
	destinationRootId: number,
	destinationRelativePath: string,
) {
	const sourcePrefix = `${sourceRelativePath}/`
	const destinationPrefix = `${destinationRelativePath}/`
	database
		.prepare(
			`UPDATE entries AS destination SET
				thumbnail_identity_kind = 'content',
				content_id = source.content_id,
				hash_failure_count = source.hash_failure_count,
				hash_retry_at = source.hash_retry_at,
				hash_error = source.hash_error
			FROM entries AS source
			WHERE source.root_id = ?
				AND (source.relative_path = ? OR (source.relative_path >= ? AND source.relative_path < ?))
				AND destination.root_id = ?
				AND destination.relative_path = CASE
					WHEN source.relative_path = ? THEN ?
					ELSE ? || substr(source.relative_path, length(?) + 1)
				END
				AND source.thumbnail_identity_kind = 'content'
				AND destination.type = 'file'
				AND source.content_id IS NOT NULL
				AND destination.inode = source.inode
				AND destination.size = source.size
				AND destination.modified_ns = source.modified_ns`,
		)
		.run(
			sourceRootId,
			sourceRelativePath,
			sourcePrefix,
			`${sourceRelativePath}0`,
			destinationRootId,
			sourceRelativePath,
			destinationRelativePath,
			destinationPrefix,
			sourcePrefix,
		)
}

function elapsedMs(startedAt: number) {
	return Math.round(performance.now() - startedAt)
}

function databaseQuarantineReason(error: unknown) {
	if (error instanceof UnsupportedFileIndexSchemaError) return 'unsupported-schema'
	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
	if (
		message.includes('corrupt') ||
		message.includes('malformed') ||
		message.includes('not a database') ||
		message.includes('short read on page')
	) {
		return 'corrupt'
	}
}

function isPathInsideOrEqual(basePath: string, candidatePath: string) {
	const relative = nodePath.relative(nodePath.resolve(basePath), nodePath.resolve(candidatePath))
	return (
		relative === '' ||
		(!relative.startsWith(`..${nodePath.sep}`) && relative !== '..' && !nodePath.isAbsolute(relative))
	)
}

function sameRootDefinition(left: FileIndexRoot, right: FileIndexRoot) {
	return (
		left.virtualPath === right.virtualPath &&
		left.systemPath === right.systemPath &&
		left.ownerId === right.ownerId &&
		left.kind === right.kind &&
		left.searchEnabled === right.searchEnabled &&
		(left.scanEnabled ?? true) === (right.scanEnabled ?? true)
	)
}

function isPhotosRootKind(kind: string): kind is 'home' | 'trash' {
	return kind === 'home' || kind === 'trash'
}

function entryType(stats: FileStats): EntryType {
	if (stats.isDirectory()) return 'directory'
	if (stats.isSymbolicLink()) return 'symbolic-link'
	if (stats.isSocket()) return 'socket'
	if (stats.isBlockDevice()) return 'block-device'
	if (stats.isCharacterDevice()) return 'character-device'
	if (stats.isFIFO()) return 'fifo'
	return 'file'
}

// The device and inode together identify a file, because inode numbers are only
// unique within one filesystem. On local filesystems an inode lasts as long as
// the file does, but the device number can change between boots. Filesystems
// without a block device, such as ZFS datasets, are numbered in mount order, and
// block devices in the order they're detected. An update that mounts one more
// filesystem earlier, as kernel 7.2 did, renumbers every entry, so a device-only
// change must stay cheap to apply.
function fileIdentity(stats: FileStats) {
	if (isBigIntStats(stats)) {
		return {
			device: stats.dev.toString(),
			inode: stats.ino.toString(),
			modifiedNs: stats.mtimeNs.toString(),
			ctimeNs: stats.ctimeNs.toString(),
			modifiedMs: Number(stats.mtimeNs / 1_000_000n),
			birthtimeMs: stats.birthtimeNs > 0n ? Number(stats.birthtimeNs / 1_000_000n) : null,
		}
	}

	return {
		device: stats.dev.toString(),
		inode: stats.ino.toString(),
		modifiedNs: BigInt(Math.round(stats.mtimeMs * 1_000_000)).toString(),
		ctimeNs: BigInt(Math.round(stats.ctimeMs * 1_000_000)).toString(),
		modifiedMs: Math.trunc(stats.mtimeMs),
		birthtimeMs: Number.isFinite(stats.birthtimeMs) && stats.birthtimeMs > 0 ? Math.trunc(stats.birthtimeMs) : null,
	}
}

function isBigIntStats(stats: FileStats): stats is BigIntStats {
	return typeof stats.size === 'bigint'
}

function entrySelectSql() {
	return `SELECT
		entries.*,
		index_roots.virtual_path AS root_virtual_path,
		index_roots.system_path AS root_system_path
	FROM entries
	JOIN index_roots ON index_roots.id = entries.root_id`
}

function indexedEntry(row: EntryRow): IndexedEntry {
	return {
		id: Number(row.id),
		rootId: Number(row.root_id),
		rootVirtualPath: row.root_virtual_path,
		virtualPath: joinVirtualPath(row.root_virtual_path, row.relative_path),
		systemPath: nodePath.join(row.root_system_path, ...row.relative_path.split('/')),
		relativePath: row.relative_path,
		name: row.name,
		type: row.type,
		size: Number(row.size),
		modifiedMs: Number(row.modified_ms),
		birthtimeMs: row.birthtime_ms === null ? null : Number(row.birthtime_ms),
		device: row.device,
		inode: row.inode,
		modifiedNs: row.modified_ns,
		ctimeNs: row.ctime_ns,
		thumbnailIdentityKind: row.thumbnail_identity_kind,
		thumbnailEligible: Number(row.thumbnail_identity_kind !== null && supportsThumbnail(row.name)),
		observedAt: row.observed_at === null ? undefined : Number(row.observed_at),
		hidden: Boolean(row.hidden),
	}
}

// Returns the device number the root's entries were moved from, if they were.
function remapRenumberedDevice(database: Database, rootId: number, rootDevice: string) {
	// The usual case: the root's filesystem kept its number. The index makes this
	// lookup and the count below cheap.
	if (database.prepare('SELECT 1 FROM entries WHERE root_id = ? AND device = ? LIMIT 1').get(rootId, rootDevice)) {
		return
	}
	// The number most entries recorded is the root filesystem's previous one.
	// Filesystems mounted inside the root keep their own entries. A wrong guess,
	// such as a root holding only a mount, costs a wasted rewrite: the walk still
	// compares every entry with lstat and writes back any device that differs.
	const previous = database
		.prepare(
			`SELECT device FROM entries WHERE root_id = ? AND device != ''
			GROUP BY device ORDER BY COUNT(*) DESC LIMIT 1`,
		)
		.get(rootId) as {device: string} | undefined
	if (!previous) return
	// Folder sizes journal every rewritten file, and a journal this large makes
	// them rebuild the root once instead of applying each file.
	run(database, 'UPDATE entries SET device = ? WHERE root_id = ? AND device = ?', rootDevice, rootId, previous.device)
	return previous.device
}

function run(database: Database, sql: string, ...parameters: unknown[]) {
	return database.prepare(sql).run(...parameters)
}

function all(database: Database, sql: string, ...parameters: unknown[]) {
	return database.prepare(sql).all(...parameters)
}
