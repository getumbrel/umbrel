import nodePath from 'node:path'
import type {BigIntStats, Stats} from 'node:fs'
import {opendir, lstat} from 'node:fs/promises'

import BetterSqlite3 from 'better-sqlite3'
import type DatabaseTypes from 'better-sqlite3'
import fse from 'fs-extra'
import PQueue from 'p-queue'

import {migratePhotos} from '../photos/migrations.js'
import PhotosRepository from '../photos/repository.js'
import FileIndexReaderPool, {type FileIndexReaderPoolOptions} from './file-index/reader-pool.js'
import type {FileIndexReadArgs, FileIndexReadMethod, PhotosReadMethod} from './file-index/reader.js'
import {readDatabase, type ReadSql} from './file-index/read-database.js'
import {SCAN_DATABASE_PRIORITY, ON_DEMAND_DATABASE_PRIORITY} from './file-index/database-priority.js'
import {supportsPhotos, type PhotoFilter, type PhotoIndexingProgress, type PhotoScopeMode} from '../photos/types.js'
import FileIndexEnrichment, {
	BACKGROUND_QUIET_PERIOD_MS,
	assertPublishedRevision,
	type FileIndexEnrichmentRuntime,
	type PublishedFileRevision,
	type ThumbnailReference,
} from './file-index-enrichment.js'
import {
	hasReservedMemberTrashPath,
	isReservedMemberTrashPath,
	relativePathWithin,
	relativeVirtualPath,
	joinVirtualPath,
} from './file-index/paths.js'
import {FILE_INDEX_SCHEMA_VERSION, foldSearchName, migrateFileIndex} from './file-index/migrations.js'
import DirectorySizes from './file-index/directory-sizes.js'
import {
	FILES_THUMBNAIL_VARIANT,
	PHOTOS_THUMBNAIL_VARIANTS,
	supportsThumbnail,
	type ThumbnailIdentityKind,
	type ThumbnailVariant,
} from './thumbnail-support.js'

type Database = DatabaseTypes.Database

const DEFAULT_RECONCILIATION_INTERVAL_MS = 6 * 60 * 60 * 1000
const DEFAULT_RECOVERY_RETRY_MS = 60 * 1000
const MAX_RECOVERY_RETRY_MS = 60 * 60 * 1000
const TRANSIENT_ENTRY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const TRANSIENT_OBSERVATION_REFRESH_MS = 24 * 60 * 60 * 1000
export const DEFAULT_WATCHER_BULK_THRESHOLD = 250
const DEFAULT_BATCH_SIZE = 256
const MAX_LIVE_WORK_PER_SCAN_BATCH = 100
const PHOTOS_ONLY_THUMBNAIL_VARIANT_SET = new Set<ThumbnailVariant>(
	PHOTOS_THUMBNAIL_VARIANTS.filter((variant) => variant !== FILES_THUMBNAIL_VARIANT),
)
const PHOTOS_INDEXING_PROGRESS_INTERVAL_MS = 1000

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

type PhotoEntrySnapshot = {
	relative_path: string
	name: string
	type: EntryType
	size: number
	modified_ms: number
	birthtime_ms: number | null
	device: string
	inode: string
	modified_ns: string
	thumbnail_identity_kind: ThumbnailIdentityKind | null
	hidden: number
}

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

export default class FileIndexEngine {
	readonly databasePath: string
	readonly umbrelDatabasePath: string
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
	#nextLiveWorkSequence = 0
	#mutationQueue = new PQueue({concurrency: 1})
	#scanQueue = new PQueue({concurrency: 1})
	#reconciliationTimer?: ReturnType<typeof setTimeout>
	#recoveryTimer?: ReturnType<typeof setTimeout>
	#recoveryAttempt?: Promise<void>
	#recoveryAttempts = 0
	#artifactRecoveryBarrierRequired = false
	#photosAvailable = false
	#photosRecoveryTimer?: ReturnType<typeof setTimeout>
	#photosRecoveryAttempt?: Promise<void>
	#photosRecoveryAttempts = 0
	#photos = new PhotosRepository()
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
		walkTree = walkFileTree,
		enrichmentRuntime,
		readerPoolOptions,
	}: FileIndexEngineOptions) {
		this.databasePath = nodePath.join(dataDirectory, 'file-index', 'index.db')
		this.umbrelDatabasePath = nodePath.join(dataDirectory, 'umbrel.db')
		this.logger = logger
		this.#isHidden = isHidden
		this.#onAvailabilityChange = onAvailabilityChange
		this.#onPhotosChange = onPhotosChange
		this.#onPhotosIndexingProgress = onPhotosIndexingProgress
		this.#reconciliationIntervalMs = reconciliationIntervalMs
		this.#recoveryRetryMs = recoveryRetryMs
		this.#watcherBulkThreshold = watcherBulkThreshold
		this.#batchSize = batchSize
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
		this.#readers = new FileIndexReaderPool(
			{databasePath: this.databasePath, umbrelDatabasePath: this.umbrelDatabasePath},
			this.#readerPoolOptions,
		)
		await this.#readers.start()
		this.#setAvailable(true)
		this.logger.log(`Opened file index schema v${this.#schemaVersion}`)
		if (this.#roots.size > 0) await this.#syncRoots()
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
		this.#directorySizes = new DirectorySizes(this.#database)
		this.#directorySizes.sync()
		this.#photosAvailable = false
		await this.#openUmbrelDatabase().catch((error) => {
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

	async #openUmbrelDatabase() {
		await fse.ensureDir(nodePath.dirname(this.umbrelDatabasePath))
		let umbrelDatabase: Database | undefined
		let attached = false
		try {
			umbrelDatabase = new BetterSqlite3(this.umbrelDatabasePath, {timeout: 5000})
			migratePhotos(umbrelDatabase)
			umbrelDatabase.close()
			umbrelDatabase = undefined
			this.#requireDatabase().prepare('ATTACH DATABASE ? AS umbrel').run(this.umbrelDatabasePath)
			attached = true
			const sync = this.#requireDatabase().transaction(() => this.#syncPhotosState(this.#requireDatabase()))
			sync.immediate()
			this.#photosAvailable = true
			this.#photosRecoveryAttempts = 0
		} catch (error) {
			this.#photosAvailable = false
			try {
				umbrelDatabase?.close()
			} catch {}
			if (attached) {
				try {
					this.#requireDatabase().exec('DETACH DATABASE umbrel')
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

	#syncPhotosState(database: Database) {
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
		return this.#photos.syncAll(database)
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

			// Root scans are serialized, so this table contains only the current
			// snapshot. An unqualified delete lets SQLite clear it efficiently after
			// a failed scan without walking every temporary row.
			await this.#mutate((database) => run(database, 'DELETE FROM reconciliation_seen'), SCAN_DATABASE_PRIORITY)
			let batch: EntryWrite[] = []
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
				if (batch.length >= this.#batchSize) {
					this.#throwIfRootScanCancelled(root)
					await this.#writeEntries(batch, SCAN_DATABASE_PRIORITY, true)
					batch = []
					await new Promise<void>((resolve) => setImmediate(resolve))
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
					const detached = this.#photosAvailable ? this.#photos.detachUnseen(database, root.id!) : []
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
					if (this.#photosAvailable) this.#photos.refreshEffectiveTakenAt(database, detached)
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

		// Parcel has already debounced and coalesced this callback to at most one
		// event per path. Large native batches are cheaper to cover with one root
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
						// A newly visible directory may already contain files (for example,
						// an atomic move into the watched root). Use the existing coalesced
						// root snapshot rather than maintaining a second subtree crawler.
						// Directory updates only describe the directory inode; Parcel reports
						// child changes separately. Re-scanning the whole root for each one
						// turns modest directory churn into repeated million-entry walks.
						const directoryReconciliation = type === 'create' ? 'root' : 'entry'
						await this.#reconcileSystemPath(systemPath, 5, directoryReconciliation).catch((error) => {
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
				if (this.#photosAvailable) {
					this.#photos.moveItems(
						database,
						{accountId: root.ownerId, rootVirtualPath: root.virtualPath, relativePath: sourceRelativePath},
						{
							accountId: root.ownerId,
							rootVirtualPath: root.virtualPath,
							relativePath: destination.relative_path,
						},
					)
				}
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

	async movePath(sourceSystemPath: string, destinationSystemPath: string) {
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
						if (this.#photosAvailable) {
							return this.#photos.moveItems(
								database,
								{
									accountId: sourceRoot.ownerId,
									rootVirtualPath: sourceRoot.virtualPath,
									relativePath: sourceRelativePath,
								},
								{
									accountId: destinationRoot.ownerId,
									rootVirtualPath: destinationRoot.virtualPath,
									relativePath: destinationRelativePath,
								},
							)
						}
					})
					move.immediate()
				})
				// A watcher may already have removed the source (including a hidden
				// Trash claim), leaving no row for reuseMovedContent. Resolve the live
				// destination's identity before acknowledging a Photos move. Existing
				// hashes/metadata are reused, or rebuilt if orphan cleanup removed them.
				if (this.#photosAvailable && supportsPhotos(nodePath.basename(destinationSystemPath))) {
					const entry = await this.getEntryBySystemPath(destinationSystemPath)
					if (entry?.type === 'file' && !entry.hidden && entry.thumbnailIdentityKind === 'content') {
						await this.#enrichment.ensureMediaMetadata(entry.id)
					}
				}
			}
		} finally {
			await this.removePath(sourceSystemPath)
		}
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
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
					await this.#deleteRelativePath(root, relativePath, priority)
					return
				}
				throw error
			}

			if (relativePath === '') {
				return {completion: this.reconcileRoot(root.virtualPath, 'root-hint')}
			}

			if (stats.isDirectory() && directoryReconciliation === 'root') {
				// A directory event does not tell us which children changed. A full root
				// scan is the smallest simple operation that can also remove stale rows.
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
		const thumbnailEligible = type === 'file' && supportsThumbnail(name)
		const thumbnailIdentityKind = thumbnailEligible ? (root.scanEnabled === false ? 'transient' : 'content') : null

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
			hashNotBefore: thumbnailIdentityKind === 'content' ? Date.now() + BACKGROUND_QUIET_PERIOD_MS : null,
			observedAt: root.scanEnabled === false ? Date.now() : null,
			hidden: Number(this.#isHidden(name)),
		}
	}

	#shouldIndexSystemPath(root: RootState, systemPath: string) {
		return !isReservedMemberTrashPath(root, relativePathWithin(root.systemPath, systemPath))
	}

	async #writeEntries(entries: EntryWrite[], priority = 0, markSeen = false) {
		if (entries.length === 0) return
		const activeRootId = this.#activeRootSnapshot?.root.id
		if (activeRootId && entries.every(({rootId}) => rootId === activeRootId)) markSeen = true
		await this.#mutate((database) => this.#applyPathMutation(database, {type: 'write', entries, markSeen}), priority)
		this.#enrichment.kick()
	}

	async #deleteRelativePath(root: RootState, relativePath: string, priority: number) {
		const rootId = root.id
		if (!rootId) return
		await this.#mutate(
			(database) => this.#applyPathMutation(database, {type: 'delete', rootId, relativePath}),
			priority,
		)
		if (isPhotosRootKind(root.kind)) this.#notifyPhotosChanged([root.ownerId])
		this.#enrichment.kick()
	}

	#applyPathMutation(database: Database, mutation: PathMutation) {
		const photosChangedAccountIds = new Set<string>()
		// #mutate owns the transaction, including size maintenance.
		const apply = (mutation: PathMutation) => {
			if (mutation.type === 'delete') {
				const detached = this.#photosAvailable
					? this.#photos.detachPath(database, mutation.rootId, mutation.relativePath)
					: []
				if (mutation.relativePath === '') {
					run(database, 'DELETE FROM entries WHERE root_id = ?', mutation.rootId)
					run(database, 'DELETE FROM reconciliation_seen WHERE root_id = ?', mutation.rootId)
					if (this.#photosAvailable) this.#photos.refreshEffectiveTakenAt(database, detached)
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
				if (this.#photosAvailable) this.#photos.refreshEffectiveTakenAt(database, detached)
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
							WHEN entries.thumbnail_identity_kind = 'content' AND entries.content_id IS NOT NULL
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
			const previousPhotoEntries = new Map<number, Map<string, PhotoEntrySnapshot>>()
			if (this.#photosAvailable) {
				const pathsByRoot = new Map<number, Set<string>>()
				for (const {rootId, relativePath} of mutation.entries) {
					const paths = pathsByRoot.get(rootId) ?? new Set<string>()
					paths.add(relativePath)
					pathsByRoot.set(rootId, paths)
				}
				for (const [rootId, paths] of pathsByRoot) {
					const rows = database
						.prepare(
							`SELECT entries.relative_path, entries.name, entries.type, entries.size,
								entries.modified_ms, entries.birthtime_ms, entries.device, entries.inode,
								entries.modified_ns, entries.thumbnail_identity_kind, entries.hidden
							FROM entries
							JOIN index_roots ON index_roots.id = entries.root_id
							WHERE entries.root_id = ?
								AND entries.relative_path IN (${[...paths].map(() => '?').join(', ')})
								AND entries.content_id IS NOT NULL
								AND index_roots.kind IN ('home', 'trash')`,
						)
						.all(rootId, ...paths) as PhotoEntrySnapshot[]
					previousPhotoEntries.set(rootId, new Map(rows.map((row) => [row.relative_path, row])))
				}
			}

			for (const entry of mutation.entries) {
				markSeenStatement?.run(entry.rootId, entry.relativePath)
				const previous = previousPhotoEntries.get(entry.rootId)?.get(entry.relativePath)
				const detached =
					previous && photoEntrySortInputsChanged(previous, entry)
						? this.#photos.detachEntry(database, entry.rootId, entry.relativePath)
						: []
				const observationCutoff = entry.observedAt === null ? null : entry.observedAt - TRANSIENT_OBSERVATION_REFRESH_MS
				const result = writeStatement.run(
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
				if (result.changes > 0 && this.#photosAvailable) {
					if (this.#photos.syncEntry(database, entry)) {
						const owner = database.prepare('SELECT owner_id FROM index_roots WHERE id = ?').get(entry.rootId) as
							| {owner_id: string}
							| undefined
						if (owner) photosChangedAccountIds.add(owner.owner_id)
					}
				}
				if (detached.length > 0) this.#photos.refreshEffectiveTakenAt(database, detached)
			}
		}
		apply(mutation)
		this.#notifyPhotosChanged(photosChangedAccountIds)
	}

	async getEntryByVirtualPath(virtualPath: string): Promise<IndexedEntry | undefined> {
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
		const entry = await this.getEntryBySystemPath(systemPath)
		if (!entry?.thumbnailEligible || entry.type !== 'file') throw new Error('Uploaded Photos item was not indexed')
		await this.#enrichment.attachKnownContentHash(entry.id, hash, expectedRevision)
		return this.#mutate((database) => {
			const register = database.transaction(() =>
				this.#photos.registerUpload(this.#photosDatabase(database), accountId, entry.id, albumId),
			)
			return register.immediate()
		})
	}

	async photosUpsertBackupSource(accountId: string, sourceId: string, name: string, createdAt: number) {
		this.#requirePhotos()
		return this.#mutate((database) => {
			const upsert = database.transaction(() =>
				this.#photos.upsertBackupSource(this.#photosDatabase(database), accountId, sourceId, name, createdAt),
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
	) {
		this.#requirePhotos()
		await this.reconcilePath(systemPath)
		const entry = await this.getEntryBySystemPath(systemPath)
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
				),
			)
			return register.immediate()
		})
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
		const stats = await lstat(systemPath, {bigint: true}).catch(() => undefined)
		if (!stats?.isFile()) return
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

	async #mutate<T>(operation: (database: Database) => T, priority = 0): Promise<T> {
		return (await this.#mutationQueue.add(
			() => {
				const database = this.#requireDatabase()
				// Entry changes and their folder totals share one commit. Nested
				// transactions become savepoints; any maintenance failure rolls back
				// the entries too. WAL readers keep seeing the previous complete state
				// until commit, so size reads never need to recalculate a subtree.
				// Callbacks must be synchronous; reader handshakes use the queue directly.
				return database
					.transaction(() => {
						const result = operation(database)
						this.#directorySizes?.sync()
						return result
					})
					.immediate()
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

	#notifyPhotosChanged(accountIds: Iterable<string>) {
		if (!this.#photosAvailable || (!this.#onPhotosChange && !this.#onPhotosIndexingProgress) || this.#stopping) return
		const changedAccountIds = [...new Set(accountIds)]
		if (changedAccountIds.length === 0) return

		if (this.#onPhotosChange) {
			for (const accountId of changedAccountIds) this.#photosChangedAccountIds.add(accountId)
			this.#photosChangeTimer ??= setTimeout(() => {
				this.#photosChangeTimer = undefined
				const accountIds = [...this.#photosChangedAccountIds]
				this.#photosChangedAccountIds.clear()
				this.#onPhotosChange?.(accountIds)
			}, 250)
		}

		if (this.#onPhotosIndexingProgress) {
			for (const accountId of changedAccountIds) this.#photosIndexingProgressAccountIds.add(accountId)
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
	}

	async stop() {
		if (!this.#started) return
		this.#stopping = true
		await this.#readers?.stop()
		this.#readers = undefined
		if (this.#reconciliationTimer) clearTimeout(this.#reconciliationTimer)
		if (this.#recoveryTimer) clearTimeout(this.#recoveryTimer)
		if (this.#photosRecoveryTimer) clearTimeout(this.#photosRecoveryTimer)
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

function photoEntrySortInputsChanged(previous: PhotoEntrySnapshot, next: EntryWrite) {
	return (
		previous.name !== next.name ||
		previous.type !== next.type ||
		Number(previous.size) !== next.size ||
		Number(previous.modified_ms) !== next.modifiedMs ||
		(previous.birthtime_ms === null ? null : Number(previous.birthtime_ms)) !== next.birthtimeMs ||
		previous.device !== next.device ||
		previous.inode !== next.inode ||
		previous.modified_ns !== next.modifiedNs ||
		previous.thumbnail_identity_kind !== next.thumbnailIdentityKind ||
		Number(previous.hidden) !== next.hidden
	)
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
		thumbnailEligible: Number(row.thumbnail_identity_kind !== null),
		observedAt: row.observed_at === null ? undefined : Number(row.observed_at),
		hidden: Boolean(row.hidden),
	}
}

function run(database: Database, sql: string, ...parameters: unknown[]) {
	return database.prepare(sql).run(...parameters)
}

function all(database: Database, sql: string, ...parameters: unknown[]) {
	return database.prepare(sql).all(...parameters)
}
