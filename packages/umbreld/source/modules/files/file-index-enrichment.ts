import {constants as fsConstants} from 'node:fs'
import {mkdir, open, opendir} from 'node:fs/promises'
import {availableParallelism as nodeAvailableParallelism} from 'node:os'
import nodePath from 'node:path'
import {createHash, randomUUID} from 'node:crypto'

import type DatabaseTypes from 'better-sqlite3'
import {execa} from 'execa'
import fse from 'fs-extra'
import PQueue from 'p-queue'

import {photoKind, type PhotoKind, type PhotoSubKind} from '../photos/types.js'
import {readDatabase, type ReadDatabase, type ReadLane, type ReadSql} from './file-index/read-database.js'
import {BACKGROUND_DATABASE_PRIORITY, ON_DEMAND_DATABASE_PRIORITY} from './file-index/database-priority.js'
import {Blake3Hasher} from './blake3.js'
import {foldSearchName} from './file-index/migrations.js'
import {
	FILES_THUMBNAIL_VARIANT,
	PHOTOS_THUMBNAIL_VARIANTS,
	THUMBNAIL_FORMAT,
	THUMBNAIL_VARIANTS,
	isThumbnailVariant,
	thumbnailSystemPath,
	type ThumbnailIdentity,
	type ThumbnailIdentityKind,
	type ThumbnailVariant,
} from './thumbnail-support.js'

type Database = DatabaseTypes.Database

const HASH_RETRY_BASE_MS = 30_000
const THUMBNAIL_RETRY_BASE_MS = 60_000
const MAX_RETRY_MS = 24 * 60 * 60 * 1000
const IDLE_RECHECK_MS = 60_000
const INFRASTRUCTURE_RETRY_MS = 60_000
const REFERENCE_FAILURE_PREFIX = '[source-reference] '
const ALL_THUMBNAIL_VARIANTS = Object.keys(THUMBNAIL_VARIANTS) as ThumbnailVariant[]
const PHOTOS_ONLY_VARIANT_SET = new Set<ThumbnailVariant>(
	PHOTOS_THUMBNAIL_VARIANTS.filter((variant) => variant !== FILES_THUMBNAIL_VARIANT),
)
const CAMERA_RAW_EXTENSIONS = new Set(['.arw', '.cr2', '.cr3', '.dng', '.nef', '.orf', '.raf', '.rw2'])
// Every scan-enabled root is indexed, but proactive content I/O is limited to
// personal Home and Trash roots. Other roots are enriched by Files only when browsed.
const BACKGROUND_ENRICHMENT_ROOT_SQL = "index_roots.kind IN ('home', 'trash')"
const IMAGE_MAGICK_MEDIA_CODERS = new Map([
	// Camera RAW formats need an explicit coder because their container can be
	// mistaken for TIFF (or only expose a small embedded preview) once the held
	// source descriptor hides the filename extension.
	['.arw', 'ARW'],
	['.cr2', 'CR2'],
	['.cr3', 'CR3'],
	['.dng', 'DNG'],
	['.nef', 'NEF'],
	['.orf', 'ORF'],
	['.raf', 'RAF'],
	['.rw2', 'RW2'],
	// Video containers also need an explicit ImageMagick coder when read from a
	// descriptor. MTS/M2TS are MPEG transport streams, while INSV and GoPro 360
	// files use MP4-family containers.
	['.360', 'MP4'],
	['.3gp', '3GP'],
	['.3g2', '3G2'],
	['.avi', 'AVI'],
	['.insv', 'MP4'],
	['.m4v', 'M4V'],
	['.mkv', 'MKV'],
	['.m2ts', 'MPEG'],
	['.mov', 'MOV'],
	['.mp4', 'MP4'],
	['.mpeg', 'MPEG'],
	['.mpg', 'MPEG'],
	['.mts', 'MPEG'],
	['.webm', 'WEBM'],
	['.wmv', 'WMV'],
])
const ARTIFACT_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000
const ARTIFACT_MAINTENANCE_BATCH_SIZE = 256
const ORPHAN_SWEEP_BATCH_SIZE = 256
const ARTIFACT_IO_CONCURRENCY = 16
export const BACKGROUND_QUIET_PERIOD_MS = 1_000
export const THUMBNAIL_GENERATION_TIMEOUT_MS = 60_000
export const ORPHAN_GC_MAX_DEFERRAL_MS = 6 * 60 * 60 * 1000
const TEMPORARY_ARTIFACT_GRACE_MS = 2 * THUMBNAIL_GENERATION_TIMEOUT_MS

const THUMBNAIL_MEMORY_LIMIT_BYTES = 256 * 1024 * 1024
const THUMBNAIL_MAP_LIMIT_BYTES = 512 * 1024 * 1024
const THUMBNAIL_DISK_LIMIT_BYTES = 1024 * 1024 * 1024
const THUMBNAIL_THREAD_LIMIT = 1

export type ContentFingerprint = {
	inode: string
	size: number
	modifiedNs: string
}

export type PublishedFileRevision = ContentFingerprint & {ctimeNs: string}

export type ThumbnailReference = {
	kind: ThumbnailIdentityKind
	key: string
	variant: ThumbnailVariant
	format: typeof THUMBNAIL_FORMAT
}

export type ThumbnailOutput = {destination: string; variant: ThumbnailVariant}

type EntryCandidate = ContentFingerprint & {
	id: number
	device: string
	ctimeNs: string
	systemPath: string
	thumbnailIdentityKind: ThumbnailIdentityKind
}

type ContentCandidate = {
	id: number
	entryId: number
	hash: string
	systemPath: string
	fingerprint: ContentFingerprint
}

type ContentThumbnailCandidate = ContentCandidate & {variant: ThumbnailVariant}

export type MediaMetadata = {
	kind: PhotoKind
	subKind?: PhotoSubKind
	takenAt?: number
	takenAtOffsetMinutes?: number
	createdAt?: number
	width: number
	height: number
	durationMs?: number
	tint?: number
	cameraMake?: string
	cameraModel?: string
	lens?: string
	focalLength?: string
	aperture?: string
	exposure?: string
	iso?: number
	latitude?: number
	longitude?: number
	altitude?: number
	userComment?: string
	liveIdentifier?: string
}

type OrphanedContent = {id: number; key: string}
type OrphanedContentRow = {id: number; hash: string}
type OrphanMaintenance = {processed: boolean; orphans: OrphanedContent[]}
type ReadyThumbnail = {contentId: number; key: string; variant: ThumbnailVariant}

export type FileIndexEnrichmentLogger = {
	log(message?: string): void
	verbose(message: string): void
	error(message: string, error?: unknown): void
}

export type FileIndexEnrichmentOptions = {
	dataDirectory: string
	logger: FileIndexEnrichmentLogger
	readSql: ReadSql
	withDatabase: <T>(operation: (database: Database) => T, priority?: number) => Promise<T>
	photosAvailable: () => boolean
	onStalePath: (systemPath: string) => Promise<void>
	onContentAttached?: (entryId: number, hash: Buffer) => Promise<void>
	// The returned callback runs after the surrounding database transaction
	// commits, so consumers can update durable projections atomically while
	// deferring notifications until the new state is visible.
	onMediaMetadataReady?: (database: Database, contentId: number) => void | (() => void)
	onThumbnailReady?: (contentId: number, variant: ThumbnailVariant) => void
	onHashFailure?: (entryId: number) => Promise<void>
	onContentFailure?: (contentId: number) => Promise<void>
}

export type FileIndexEnrichmentRuntime = {
	hashFile?: typeof hashFileRevision
	generateThumbnail?: typeof generateThumbnailFile
	generateThumbnails?: typeof generateThumbnailFiles
	extractMediaMetadata?: typeof extractMediaMetadata
	extractThumbnailTint?: typeof extractThumbnailTint
	thumbnailIsUsable?: typeof thumbnailArtifactIsUsable
	remove?: typeof fse.remove
	orphanGcMaxDeferralMs?: number
	availableParallelism?: number
}

export function enrichmentQueueConcurrency(availableParallelism: number) {
	const parallelism = Math.max(1, Math.floor(availableParallelism))
	return {
		background: Math.max(1, Math.floor(parallelism / 4)),
		onDemand: Math.max(1, Math.ceil(parallelism * 0.75)),
	}
}

class StaleFileRevisionError extends Error {}
class PersistedEnrichmentFailure extends Error {
	constructor(cause: unknown) {
		super(errorMessage(cause), {cause})
		this.name = 'PersistedEnrichmentFailure'
	}
}

export default class FileIndexEnrichment {
	readonly thumbnailDirectory: string
	readonly logger: FileIndexEnrichmentLogger

	#withDatabase: FileIndexEnrichmentOptions['withDatabase']
	#readSql: ReadSql
	#selectionQueue = new PQueue({concurrency: 1})
	#photosAvailable: () => boolean
	#onStalePath: (systemPath: string) => Promise<void>
	#onContentAttached?: (entryId: number, hash: Buffer) => Promise<void>
	#onMediaMetadataReady?: (database: Database, contentId: number) => void | (() => void)
	#onThumbnailReady?: (contentId: number, variant: ThumbnailVariant) => void
	#onHashFailure?: (entryId: number) => Promise<void>
	#onContentFailure?: (contentId: number) => Promise<void>
	#hashFile: typeof hashFileRevision
	#generateThumbnail: typeof generateThumbnailFile
	#generateThumbnails: typeof generateThumbnailFiles
	#extractMediaMetadata: typeof extractMediaMetadata
	#extractThumbnailTint: typeof extractThumbnailTint
	#thumbnailIsUsable: typeof thumbnailArtifactIsUsable
	#remove: typeof fse.remove
	#orphanGcMaxDeferralMs: number
	#backgroundConcurrency: number
	#backgroundQueue: PQueue
	#onDemandQueue: PQueue
	#onDemandOperations = new Map<string, Promise<ThumbnailReference>>()
	#contentOperations = new Map<number, Promise<ContentCandidate>>()
	#mediaOperations = new Map<number, Promise<void>>()
	#started = false
	#stopping = false
	#backgroundEnabled = false
	#backgroundQueued = 0
	#wakeRequested = false
	#timer?: ReturnType<typeof setTimeout>
	#activeHashEntries = new Set<number>()
	#activeThumbnailContents = new Set<number>()
	#activeMediaContents = new Set<number>()
	#maintenanceActive = false
	#orphanSweepCursor?: number
	#thumbnailVerificationCursor?: {variant: string; contentId: number}
	#thumbnailVerificationCompletedAt = 0
	#artifactFiles?: AsyncGenerator<string>
	#artifactMaintenanceCompletedAt = 0
	#destructiveArtifactMaintenanceAllowed = false
	#directoryPublication = new Map<string, Promise<void>>()
	#artifactOperations = new Map<string, Promise<void>>()
	#enabledThumbnailVariants = new Set<ThumbnailVariant>([FILES_THUMBNAIL_VARIANT])

	constructor(
		{
			dataDirectory,
			logger,
			withDatabase,
			readSql,
			photosAvailable,
			onStalePath,
			onContentAttached,
			onMediaMetadataReady,
			onThumbnailReady,
			onHashFailure,
			onContentFailure,
		}: FileIndexEnrichmentOptions,
		{
			hashFile = hashFileRevision,
			generateThumbnail = generateThumbnailFile,
			generateThumbnails,
			extractMediaMetadata: extractMedia = extractMediaMetadata,
			extractThumbnailTint: extractTint = extractThumbnailTint,
			thumbnailIsUsable = thumbnailArtifactIsUsable,
			remove = fse.remove,
			orphanGcMaxDeferralMs = ORPHAN_GC_MAX_DEFERRAL_MS,
			availableParallelism = nodeAvailableParallelism(),
		}: FileIndexEnrichmentRuntime = {},
	) {
		const concurrency = enrichmentQueueConcurrency(availableParallelism)
		this.thumbnailDirectory = nodePath.join(dataDirectory, 'thumbnails')
		this.logger = logger
		this.#withDatabase = withDatabase
		this.#readSql = readSql
		this.#photosAvailable = photosAvailable
		this.#onStalePath = onStalePath
		this.#onContentAttached = onContentAttached
		this.#onMediaMetadataReady = onMediaMetadataReady
		this.#onThumbnailReady = onThumbnailReady
		this.#onHashFailure = onHashFailure
		this.#onContentFailure = onContentFailure
		this.#hashFile = hashFile
		this.#generateThumbnail = generateThumbnail
		this.#generateThumbnails =
			generateThumbnails ??
			(generateThumbnail === generateThumbnailFile
				? generateThumbnailFiles
				: async (systemPath, outputs, sourceFileDescriptor) => {
						for (const output of outputs) {
							await generateThumbnail(systemPath, output.destination, output.variant, sourceFileDescriptor)
						}
					})
		this.#extractMediaMetadata = extractMedia
		this.#extractThumbnailTint = extractTint
		this.#thumbnailIsUsable = thumbnailIsUsable
		this.#remove = remove
		this.#orphanGcMaxDeferralMs = orphanGcMaxDeferralMs
		this.#backgroundConcurrency = concurrency.background
		this.#backgroundQueue = new PQueue({concurrency: concurrency.background})
		this.#onDemandQueue = new PQueue({concurrency: concurrency.onDemand})
	}

	#readDatabase<T>(operation: (database: ReadDatabase) => Promise<T>, priority = 0, lane: ReadLane = 'interactive') {
		return operation(readDatabase(this.#readSql, priority, lane))
	}

	#selectDatabase<T>(operation: (database: ReadDatabase) => Promise<T>, priority: number): Promise<T> {
		// Selection and the in-memory reservation must remain serial even though
		// the database lookup now yields to another thread.
		return this.#selectionQueue.add(() => this.#readDatabase(operation, priority)) as Promise<T>
	}

	async start() {
		if (this.#started) return
		this.#started = true
		this.#stopping = false
		this.#orphanSweepCursor = 0
		this.#thumbnailVerificationCursor = undefined
		this.#thumbnailVerificationCompletedAt = 0
		this.#artifactFiles = undefined
		this.#artifactMaintenanceCompletedAt = 0
		this.#destructiveArtifactMaintenanceAllowed = false
		this.#directoryPublication.clear()
		this.#artifactOperations.clear()
		this.#onDemandOperations.clear()
		this.#contentOperations.clear()
		this.#mediaOperations.clear()
		this.#activeHashEntries.clear()
		this.#activeThumbnailContents.clear()
		this.#activeMediaContents.clear()
		this.#maintenanceActive = false
		this.#backgroundQueued = 0
		this.#wakeRequested = false
		await this.#ensureArtifactDirectory(this.thumbnailDirectory).catch((error) =>
			this.logger.error('Thumbnail artifact storage is unavailable; file indexing will continue', error),
		)
	}

	startBackground() {
		this.#backgroundEnabled = true
		this.kick()
	}

	async enableThumbnailVariants(variants: readonly ThumbnailVariant[]) {
		const requested = [...new Set(variants)]
		if (requested.length === 0) return
		await this.#withDatabase((database) => {
			const insert = database.prepare(
				`INSERT INTO thumbnail_variants(content_id, variant, state, failure_count, updated_at)
				SELECT DISTINCT entries.content_id, ?, 'pending', 0, ? FROM entries
				JOIN index_roots ON index_roots.id = entries.root_id
				WHERE entries.content_id IS NOT NULL AND ${BACKGROUND_ENRICHMENT_ROOT_SQL}
				ON CONFLICT(content_id, variant) DO NOTHING`,
			)
			const registerMedia = requested.some((variant) => PHOTOS_ONLY_VARIANT_SET.has(variant))
			const register = database.transaction(() => {
				// Reconcile every requested variant against the database even when it
				// is already enabled in memory. This matters when an OTA changes the
				// default Files size: the new default starts enabled, but existing
				// content has rows only for the old variant.
				for (const variant of requested) insert.run(variant, Date.now())
				if (!registerMedia) return
				const contentRows = database
					.prepare(
						`SELECT DISTINCT contents.id, entries.name FROM contents
						JOIN entries ON entries.content_id = contents.id
						JOIN index_roots ON index_roots.id = entries.root_id
						WHERE ${BACKGROUND_ENRICHMENT_ROOT_SQL}
							AND NOT EXISTS (SELECT 1 FROM media_metadata WHERE media_metadata.content_id = contents.id)`,
					)
					.all() as Array<{id: number; name: string}>
				const insertMedia = database.prepare(
					`INSERT INTO media_metadata(content_id, state, kind, failure_count, updated_at)
					VALUES (?, 'pending', ?, 0, ?) ON CONFLICT(content_id) DO NOTHING`,
				)
				for (const row of contentRows) {
					const kind = photoKind(row.name)
					if (kind) insertMedia.run(row.id, kind, Date.now())
				}
			})
			register.immediate()
		}, ON_DEMAND_DATABASE_PRIORITY)
		for (const variant of requested) this.#enabledThumbnailVariants.add(variant)
		this.kick()
	}

	allowDestructiveArtifactMaintenance() {
		if (this.#destructiveArtifactMaintenanceAllowed) return
		this.#destructiveArtifactMaintenanceAllowed = true
		this.kick()
	}

	kick() {
		if (!this.#started || this.#stopping || !this.#backgroundEnabled) return
		if (this.#backgroundQueued >= this.#backgroundConcurrency) {
			this.#wakeRequested = true
			return
		}
		if (this.#timer) clearTimeout(this.#timer)
		this.#timer = undefined
		while (this.#backgroundQueued < this.#backgroundConcurrency) this.#queueBackgroundStep()
	}

	#queueBackgroundStep() {
		this.#backgroundQueued++
		void (this.#backgroundQueue.add(() => this.#backgroundStep()) as Promise<void>)
			.catch((error) => this.logger.error('File enrichment background step failed', error))
			.finally(() => {
				this.#backgroundQueued--
				if (this.#stopping || !this.#backgroundEnabled) return
				if (this.#wakeRequested) {
					this.#wakeRequested = false
					this.kick()
				} else if (!this.#timer && this.#backgroundQueued === 0) {
					this.#schedule(IDLE_RECHECK_MS)
				}
			})
	}

	async ensureThumbnail(
		entryId: number,
		variant: ThumbnailVariant = FILES_THUMBNAIL_VARIANT,
	): Promise<ThumbnailReference> {
		if (!this.#started || this.#stopping) throw new Error('File enrichment is unavailable')
		const operationKey = `${entryId}:${variant}`
		const existing = this.#onDemandOperations.get(operationKey)
		if (existing) return existing
		const operation = this.#onDemandQueue.add(async () => {
			if (this.#stopping) throw new Error('File enrichment is unavailable')
			for (let attempt = 0; attempt < 2; attempt++) {
				try {
					const candidate = await this.#entryCandidate(entryId, ON_DEMAND_DATABASE_PRIORITY)
					if (!candidate) throw new Error('Unsupported or missing thumbnail source')
					if (candidate.thumbnailIdentityKind === 'transient') {
						return await this.#ensureTransientThumbnail(candidate, variant)
					}
					const content = await this.#ensureEntryContent(entryId, true, candidate)
					await this.#ensureContentThumbnail(content, variant, true)
					return contentThumbnailReference(content.hash, variant)
				} catch (error) {
					if (!(error instanceof StaleFileRevisionError) || attempt > 0) throw error
					const candidate = await this.#entryCandidate(entryId, ON_DEMAND_DATABASE_PRIORITY)
					if (!candidate) throw error
					await this.#onStalePath(candidate.systemPath)
				}
			}
			throw new StaleFileRevisionError('File kept changing during thumbnail generation')
		}) as Promise<ThumbnailReference>
		this.#onDemandOperations.set(operationKey, operation)
		try {
			return await operation
		} finally {
			if (this.#onDemandOperations.get(operationKey) === operation) this.#onDemandOperations.delete(operationKey)
		}
	}

	async attachKnownContentHash(entryId: number, hash: Buffer, expectedRevision?: PublishedFileRevision) {
		if (hash.length !== 32) throw new TypeError('BLAKE3 digest must be 32 bytes')
		const expectedHash = hash.toString('hex')
		let candidate: EntryCandidate | undefined
		if (expectedRevision) {
			candidate = await this.#entryCandidate(entryId, ON_DEMAND_DATABASE_PRIORITY)
			if (
				!candidate ||
				candidate.thumbnailIdentityKind !== 'content' ||
				!samePublishedRevision(candidate, expectedRevision)
			) {
				throw new StaleFileRevisionError('Published upload revision does not match the index')
			}
			await assertPublishedRevision(candidate.systemPath, expectedRevision)
		}
		const ready = await this.#contentForEntry(entryId, ON_DEMAND_DATABASE_PRIORITY)
		if (ready) {
			if (ready.hash !== expectedHash) throw new StaleFileRevisionError('Indexed content hash does not match upload')
			if (expectedRevision) await assertPublishedRevision(candidate!.systemPath, expectedRevision)
			return ready
		}
		const existing = this.#contentOperations.get(entryId)
		if (existing) {
			const content = await existing
			if (content.hash !== expectedHash) throw new StaleFileRevisionError('Indexed content hash does not match upload')
			if (expectedRevision) await assertPublishedRevision(candidate!.systemPath, expectedRevision)
			return content
		}
		candidate ??= await this.#entryCandidate(entryId, ON_DEMAND_DATABASE_PRIORITY)
		if (!candidate || candidate.thumbnailIdentityKind !== 'content') {
			throw new Error('Unsupported or missing thumbnail source')
		}
		await assertContentRevision(candidate.systemPath, candidate)
		const operation = this.#attachEntryContent(candidate, hash, ON_DEMAND_DATABASE_PRIORITY, expectedRevision)
		this.#contentOperations.set(entryId, operation)
		try {
			const content = await operation
			if (expectedRevision) {
				try {
					await assertPublishedRevision(candidate.systemPath, expectedRevision)
				} catch (error) {
					await this.#onStalePath(candidate.systemPath).catch(() => {})
					throw error
				}
			}
			return content
		} finally {
			if (this.#contentOperations.get(entryId) === operation) this.#contentOperations.delete(entryId)
		}
	}

	async ensureContentHash(entryId: number) {
		const content = await this.#ensureEntryContent(entryId, true)
		return Buffer.from(content.hash, 'hex')
	}

	async ensureMediaMetadata(entryId: number) {
		if (!this.#started || this.#stopping) throw new Error('File enrichment is unavailable')
		await this.#onDemandQueue.add(async () => {
			if (this.#stopping) throw new Error('File enrichment is unavailable')
			const content = await this.#ensureEntryContent(entryId, true)
			await this.#ensureMediaMetadataOnce(content, true)
		})
	}

	async getExistingThumbnail(
		entryId: number,
		variant: ThumbnailVariant = FILES_THUMBNAIL_VARIANT,
	): Promise<ThumbnailReference | undefined> {
		const candidate = await this.#entryCandidate(entryId, ON_DEMAND_DATABASE_PRIORITY)
		if (!candidate) return
		if (candidate.thumbnailIdentityKind === 'transient') {
			return this.#getExistingTransientThumbnail(candidate, variant)
		}
		const content = await this.#contentForEntry(entryId, ON_DEMAND_DATABASE_PRIORITY)
		if (!content) return
		const ready = await this.#readDatabase(
			async (database) =>
				Boolean(
					await database
						.prepare(
							`SELECT 1 FROM thumbnail_variants
							WHERE content_id = ? AND variant = ? AND state = 'ready'`,
						)
						.get(content.id, variant),
				),
			ON_DEMAND_DATABASE_PRIORITY,
		)
		if (!ready) return

		const systemPath = thumbnailSystemPath(this.thumbnailDirectory, contentIdentity(content.hash, variant))
		if (!(await this.#thumbnailIsUsable(systemPath))) {
			await this.#markThumbnailPending([{contentId: content.id, variant}], ON_DEMAND_DATABASE_PRIORITY)
			this.kick()
			return
		}

		return contentThumbnailReference(content.hash, variant)
	}

	async matchesThumbnail(entryId: number, kind: string, key: string, variant: string) {
		if (!isThumbnailVariant(variant)) return false
		const candidate = await this.#entryCandidate(entryId, ON_DEMAND_DATABASE_PRIORITY)
		if (!candidate || candidate.thumbnailIdentityKind !== kind) return false
		if (kind === 'transient') {
			if (transientArtifactKey(candidate) !== key) return false
			return Boolean(await this.#getExistingTransientThumbnail(candidate, variant))
		}
		const content = await this.#contentForEntry(entryId, ON_DEMAND_DATABASE_PRIORITY)
		if (!content || content.hash !== key) return false
		return Boolean(await this.getExistingThumbnail(entryId, variant))
	}

	async status() {
		return this.#readDatabase(
			async (database) => {
				const row = (await database
					.prepare(
						`SELECT
						COUNT(*) FILTER (WHERE thumbnail_identity_kind IS NOT NULL) AS eligible_entries,
						COUNT(*) FILTER (WHERE thumbnail_identity_kind = 'content' AND content_id IS NOT NULL) AS hashed_entries,
						COUNT(*) FILTER (WHERE thumbnail_identity_kind = 'content' AND content_id IS NULL
							AND ${BACKGROUND_ENRICHMENT_ROOT_SQL}) AS pending_hashes,
						COUNT(*) FILTER (WHERE thumbnail_identity_kind = 'content' AND hash_error IS NOT NULL
							AND ${BACKGROUND_ENRICHMENT_ROOT_SQL}) AS hash_failures,
						(SELECT COUNT(*) FROM contents) AS unique_contents,
						(SELECT COUNT(*) FROM thumbnail_variants WHERE state = 'ready') +
							(SELECT COUNT(*) FROM transient_thumbnail_variants WHERE state = 'ready') AS ready_thumbnails,
						(SELECT COUNT(*) FROM thumbnail_variants WHERE state = 'failed') +
							(SELECT COUNT(*) FROM transient_thumbnail_variants WHERE state = 'failed') AS thumbnail_failures,
						(SELECT COUNT(*) FROM media_metadata WHERE state = 'ready') AS ready_media,
						(SELECT COUNT(*) FROM media_metadata WHERE state = 'failed') AS media_failures
					FROM entries
					JOIN index_roots ON index_roots.id = entries.root_id`,
					)
					.get()) as Record<string, number>
				return {
					eligibleEntries: Number(row.eligible_entries),
					hashedEntries: Number(row.hashed_entries),
					pendingHashes: Number(row.pending_hashes),
					hashFailures: Number(row.hash_failures),
					uniqueContents: Number(row.unique_contents),
					readyThumbnails: Number(row.ready_thumbnails),
					thumbnailFailures: Number(row.thumbnail_failures),
					readyMedia: Number(row.ready_media),
					mediaFailures: Number(row.media_failures),
				}
			},
			ON_DEMAND_DATABASE_PRIORITY,
			'bulk',
		)
	}

	async stop() {
		if (!this.#started) return
		this.#stopping = true
		this.#backgroundEnabled = false
		if (this.#timer) clearTimeout(this.#timer)
		this.#timer = undefined
		this.#wakeRequested = false
		await Promise.all([this.#backgroundQueue.onIdle(), this.#onDemandQueue.onIdle()])
		await this.#artifactFiles?.return(undefined)
		this.#artifactFiles = undefined
		this.#started = false
	}

	async #backgroundStep() {
		if (this.#stopping || this.#onDemandBusy()) {
			this.#schedule(100)
			return
		}

		// Entry triggers provide exact, transient GC hints for ordinary mutations.
		// The bounded startup sweep below remains the crash-recovery source of truth.
		const immediateMaintenanceProcessed = await this.#withMaintenanceSlot(async () => {
			const candidates = await this.#takeOrphanCandidates()
			if (candidates.processed) {
				await this.#removeOrphanedArtifacts(candidates.orphans)
				return true
			}
			const transientArtifacts = await this.#takeTransientArtifactCandidates()
			if (!transientArtifacts.processed) return false
			await this.#removeTransientArtifacts(transientArtifacts.keys)
			return true
		})
		if (immediateMaintenanceProcessed) {
			this.#schedule(0)
			return
		}

		const entry = await this.#nextEntryNeedingHash()
		if (entry) {
			let retryDelay = 0
			try {
				const content = await this.#ensureEntryContent(entry.id, false, entry)
				if (photoKind(entry.systemPath)) {
					// Keep a newly discovered item in the same background slot through
					// its derived work. Draining the global hash backlog first can leave
					// Photos empty even after thousands of renditions have been built.
					// Metadata is published last so its change event exposes an item only
					// after its normal thumbnail variants have been attempted.
					retryDelay = Math.max(retryDelay, await this.#backgroundThumbnailStep(content, false, true))
					retryDelay = Math.max(retryDelay, await this.#backgroundMediaStep(content, false, true))
				}
			} catch (error) {
				if (error instanceof StaleFileRevisionError) {
					await this.#onStalePath(entry.systemPath).catch((refreshError) => {
						retryDelay = INFRASTRUCTURE_RETRY_MS
						this.logger.error(`Failed to refresh stale thumbnail source '${entry.systemPath}'`, refreshError)
					})
				} else {
					if (!(error instanceof PersistedEnrichmentFailure)) retryDelay = INFRASTRUCTURE_RETRY_MS
					this.logger.error(`Failed to enrich '${entry.systemPath}'`, error)
				}
			} finally {
				this.#activeHashEntries.delete(entry.id)
			}
			this.#schedule(retryDelay)
			return
		}

		const media = await this.#nextContentNeedingMetadata()
		if (media) {
			const retryDelay = await this.#backgroundMediaStep(media, true)
			this.#schedule(retryDelay)
			return
		}

		const content = await this.#nextContentNeedingThumbnail()
		if (content) {
			const retryDelay = await this.#backgroundThumbnailStep(content, true)
			this.#schedule(retryDelay)
			return
		}

		// Maintenance is independent of a source file's retry schedule. In
		// particular, one unreadable file must not prevent repair or garbage
		// collection for every other content record.
		const maintenanceProcessed = await this.#withMaintenanceSlot(async () => {
			if (await this.#artifactMaintenanceStep()) return true
			const sweep = await this.#orphanSweepStep()
			if (sweep.processed) await this.#removeOrphanedArtifacts(sweep.orphans)
			return sweep.processed
		})
		if (maintenanceProcessed) {
			this.#schedule(0)
			return
		}

		const nextAttemptAt = await this.#nextAttemptAt()
		if (nextAttemptAt !== undefined) {
			this.#schedule(Math.min(IDLE_RECHECK_MS, Math.max(10, nextAttemptAt - Date.now())))
		}
	}

	async #backgroundMediaStep(content: ContentCandidate, alreadyReserved = false, freshReference = false) {
		const ownsReservation = alreadyReserved || !this.#activeMediaContents.has(content.id)
		if (!alreadyReserved && ownsReservation) this.#activeMediaContents.add(content.id)
		let retryDelay = 0
		try {
			await this.#ensureMediaMetadataOnce(content, false, freshReference)
		} catch (error) {
			if (error instanceof StaleFileRevisionError) {
				await this.#onStalePath(content.systemPath).catch((refreshError) => {
					retryDelay = INFRASTRUCTURE_RETRY_MS
					this.logger.error(`Failed to refresh stale media source '${content.systemPath}'`, refreshError)
				})
			} else {
				if (!(error instanceof PersistedEnrichmentFailure)) retryDelay = INFRASTRUCTURE_RETRY_MS
				this.logger.error(`Failed to extract media metadata for '${content.systemPath}'`, error)
			}
		} finally {
			if (ownsReservation) this.#activeMediaContents.delete(content.id)
		}
		return retryDelay
	}

	async #backgroundThumbnailStep(
		content: ContentCandidate & {variant?: ThumbnailVariant},
		alreadyReserved = false,
		freshReference = false,
	) {
		const ownsReservation = alreadyReserved || !this.#activeThumbnailContents.has(content.id)
		if (!alreadyReserved && ownsReservation) this.#activeThumbnailContents.add(content.id)
		let retryDelay = 0
		try {
			await this.#ensureContentThumbnail(content, content.variant ?? FILES_THUMBNAIL_VARIANT, false, freshReference)
		} catch (error) {
			if (error instanceof StaleFileRevisionError) {
				await this.#onStalePath(content.systemPath).catch((refreshError) => {
					retryDelay = INFRASTRUCTURE_RETRY_MS
					this.logger.error(`Failed to refresh stale thumbnail source '${content.systemPath}'`, refreshError)
				})
			} else {
				if (!(error instanceof PersistedEnrichmentFailure)) retryDelay = INFRASTRUCTURE_RETRY_MS
				this.logger.error(`Failed to generate thumbnail for '${content.systemPath}'`, error)
			}
		} finally {
			if (ownsReservation) this.#activeThumbnailContents.delete(content.id)
		}
		return retryDelay
	}

	#onDemandBusy() {
		return this.#onDemandQueue.pending > 0 || this.#onDemandQueue.size > 0
	}

	async #withMaintenanceSlot(operation: () => Promise<boolean>) {
		if (this.#maintenanceActive) return
		this.#maintenanceActive = true
		try {
			return await operation()
		} finally {
			this.#maintenanceActive = false
		}
	}

	#schedule(delay: number) {
		if (this.#stopping || !this.#backgroundEnabled) return
		if (this.#timer) clearTimeout(this.#timer)
		this.#timer = setTimeout(() => {
			this.#timer = undefined
			this.kick()
		}, delay)
	}

	async #nextEntryNeedingHash() {
		return this.#selectDatabase(async (database) => {
			const excludedIds = [...this.#activeHashEntries]
			const exclusion =
				excludedIds.length > 0 ? `AND candidate.id NOT IN (${excludedIds.map(() => '?').join(', ')})` : ''
			const row = (await database
				.prepare(
					`SELECT entries.id, entries.device, entries.inode, entries.size, entries.modified_ns,
						entries.ctime_ns, entries.thumbnail_identity_kind,
						index_roots.system_path AS root_system_path, entries.relative_path
					FROM index_roots
					JOIN entries ON entries.id = (
						SELECT candidate.id
						FROM entries AS candidate INDEXED BY entries_pending_content_hash
						WHERE candidate.root_id = index_roots.id
							AND candidate.thumbnail_identity_kind = 'content'
							AND candidate.content_id IS NULL
							AND (candidate.hash_retry_at IS NULL OR candidate.hash_retry_at <= ?)
							${exclusion}
						ORDER BY candidate.hash_retry_at, candidate.id
						LIMIT 1
					)
					WHERE ${BACKGROUND_ENRICHMENT_ROOT_SQL}
					ORDER BY entries.hash_retry_at, entries.id
					LIMIT 1`,
				)
				.get(Date.now(), ...excludedIds)) as
				| {
						id: number
						device: string
						inode: string
						size: number
						modified_ns: string
						ctime_ns: string
						thumbnail_identity_kind: ThumbnailIdentityKind
						root_system_path: string
						relative_path: string
				  }
				| undefined
			if (!row) return
			const candidate = entryCandidate(row)
			if (this.#activeHashEntries.has(candidate.id)) return
			this.#activeHashEntries.add(candidate.id)
			return candidate
		}, BACKGROUND_DATABASE_PRIORITY)
	}

	async #nextContentNeedingMetadata() {
		return this.#selectDatabase(async (database) => {
			const excluded = [...this.#activeMediaContents]
			const exclusion =
				excluded.length > 0 ? `AND media_metadata.content_id NOT IN (${excluded.map(() => '?').join(', ')})` : ''
			const select = async (state: 'pending' | 'failed') =>
				(await database
					.prepare(
						`SELECT contents.id, entries.id AS entry_id, hex(contents.blake3) AS hash,
							entries.device, entries.inode, entries.size, entries.modified_ns,
							entries.ctime_ns, entries.thumbnail_identity_kind,
							index_roots.system_path AS root_system_path, entries.relative_path
						FROM media_metadata INDEXED BY ${state === 'pending' ? 'media_metadata_pending_work' : 'media_metadata_failed_work'}
						JOIN contents ON contents.id = media_metadata.content_id
						JOIN entries INDEXED BY entries_by_content ON entries.content_id = media_metadata.content_id
						JOIN index_roots ON index_roots.id = entries.root_id
						WHERE media_metadata.state = '${state}'
							AND ${BACKGROUND_ENRICHMENT_ROOT_SQL}
							${state === 'failed' ? 'AND media_metadata.retry_at <= ?' : ''}
							${exclusion}
						ORDER BY ${state === 'failed' ? 'media_metadata.retry_at,' : ''} media_metadata.content_id, entries.id
						LIMIT 1`,
					)
					.get(...(state === 'failed' ? [Date.now()] : []), ...excluded)) as ContentCandidateRow | undefined
			const row = (await select('pending')) ?? (await select('failed'))
			if (!row) return
			const candidate = contentCandidate(row)
			if (this.#activeMediaContents.has(candidate.id)) return
			this.#activeMediaContents.add(candidate.id)
			return candidate
		}, BACKGROUND_DATABASE_PRIORITY)
	}

	async #ensureMediaMetadata(content: ContentCandidate, onDemand: boolean, freshReference = false) {
		const priority = onDemand ? ON_DEMAND_DATABASE_PRIORITY : BACKGROUND_DATABASE_PRIORITY
		const current = await this.#readDatabase(
			async (database) =>
				(await database
					.prepare('SELECT state, retry_at, last_error FROM media_metadata WHERE content_id = ?')
					.get(content.id)) as
					| {state: 'pending' | 'ready' | 'failed'; retry_at: number | null; last_error: string | null}
					| undefined,
			priority,
		)
		if (!current || current.state === 'ready') return
		if (
			!onDemand &&
			current.state === 'failed' &&
			current.retry_at !== null &&
			current.retry_at > Date.now() &&
			!(freshReference && referenceFailureMessage(current.last_error))
		)
			return

		const attemptedEntries = new Set<number>()
		while (true) {
			attemptedEntries.add(content.entryId)
			let source: Awaited<ReturnType<typeof open>> | undefined
			try {
				source = await openContentRevision(content.systemPath, content.fingerprint)
				const metadata = await this.#extractMediaMetadata(content.systemPath, source.fd, (error) =>
					this.logger.verbose(
						`Optional ExifTool metadata extraction failed for '${content.systemPath}': ${errorMessage(error)}`,
					),
				)
				let tint = metadata.tint
				if (tint === undefined) {
					const existingPreview = thumbnailSystemPath(
						this.thumbnailDirectory,
						contentIdentity(content.hash, 'preview-192-webp-v1'),
					)
					if (await this.#thumbnailIsUsable(existingPreview)) {
						tint = await this.#extractThumbnailTint(existingPreview).catch((error) => {
							this.logger.error(`Failed to extract thumbnail tint from '${existingPreview}'`, error)
							return undefined
						})
					}
				}
				await assertHandleContentRevision(source, content.fingerprint)
				const afterCommit = await this.#withDatabase((database) => {
					const persist = database.transaction(() => {
						const source = database
							.prepare(
								`SELECT 1 FROM entries WHERE content_id = ? AND inode = ? AND size = ?
								AND modified_ns = ?`,
							)
							.get(content.id, content.fingerprint.inode, content.fingerprint.size, content.fingerprint.modifiedNs)
						if (!source) throw new StaleFileRevisionError('File changed while extracting media metadata')
						database
							.prepare(
								`UPDATE media_metadata SET state = 'ready', kind = ?, sub_kind = ?, taken_at = ?,
								taken_at_offset_minutes = ?, created_at = ?, width = ?, height = ?, duration_ms = ?, tint = COALESCE(?, tint),
								camera_make = ?, camera_model = ?, lens = ?, focal_length = ?, aperture = ?, exposure = ?,
								iso = ?, latitude = ?, longitude = ?, altitude = ?, user_comment = ?, live_identifier = ?, search_text = ?,
								failure_count = 0, retry_at = NULL,
								last_error = NULL, updated_at = ? WHERE content_id = ?`,
							)
							.run(
								metadata.kind,
								metadata.subKind ?? null,
								metadata.takenAt,
								metadata.takenAtOffsetMinutes ?? null,
								metadata.createdAt,
								metadata.width,
								metadata.height,
								metadata.durationMs ?? null,
								tint ?? null,
								metadata.cameraMake ?? null,
								metadata.cameraModel ?? null,
								metadata.lens ?? null,
								metadata.focalLength ?? null,
								metadata.aperture ?? null,
								metadata.exposure ?? null,
								metadata.iso ?? null,
								metadata.latitude ?? null,
								metadata.longitude ?? null,
								metadata.altitude ?? null,
								metadata.userComment ?? null,
								metadata.liveIdentifier ?? null,
								foldSearchName(
									[metadata.cameraMake, metadata.cameraModel, metadata.userComment].filter(Boolean).join(' '),
								),
								Date.now(),
								content.id,
							)
						return this.#onMediaMetadataReady?.(database, content.id)
					})
					return persist.immediate()
				}, priority)
				afterCommit?.()
				return
			} catch (error) {
				const referenceFailure = referenceFailureKind(error) ?? (await contentReferenceFailure(error, content))
				if (referenceFailure) {
					if (referenceFailure === 'stale') await this.#onStalePath(content.systemPath).catch(() => {})
					const alternative = await this.#nextContentReference(content.id, attemptedEntries, priority, !onDemand)
					if (alternative) {
						content = alternative
						continue
					}
					if (referenceFailure === 'stale')
						throw new StaleFileRevisionError('No current metadata source remains', {cause: error})
				}
				await this.#recordMediaMetadataFailure(content.id, error, priority, referenceFailure === 'unreadable')
				await this.#onContentFailure?.(content.id)
				throw new PersistedEnrichmentFailure(error)
			} finally {
				await source?.close().catch(() => {})
			}
		}
	}

	async #ensureMediaMetadataOnce(content: ContentCandidate, onDemand: boolean, freshReference = false) {
		const existing = this.#mediaOperations.get(content.id)
		if (existing) return existing
		const operation = this.#ensureMediaMetadata(content, onDemand, freshReference)
		this.#mediaOperations.set(content.id, operation)
		try {
			await operation
		} finally {
			if (this.#mediaOperations.get(content.id) === operation) this.#mediaOperations.delete(content.id)
		}
	}

	async #recordMediaMetadataFailure(contentId: number, error: unknown, priority: number, referenceFailure = false) {
		await this.#withDatabase((database) => {
			const current = database
				.prepare('SELECT failure_count FROM media_metadata WHERE content_id = ?')
				.get(contentId) as {failure_count: number} | undefined
			if (!current) return
			const failureCount = Number(current.failure_count) + 1
			database
				.prepare(
					`UPDATE media_metadata SET state = 'failed', failure_count = ?, retry_at = ?, last_error = ?, updated_at = ?
					WHERE content_id = ?`,
				)
				.run(
					failureCount,
					Date.now() + retryDelay(THUMBNAIL_RETRY_BASE_MS, failureCount),
					persistedFailureMessage(error, referenceFailure),
					Date.now(),
					contentId,
				)
		}, priority)
	}

	async #nextAttemptAt() {
		// This TEMP table is private scheduling state on the writer connection.
		// Read its deadline there; the persistent-table scans run on a reader.
		const deferred = await this.#withDatabase(
			(database) =>
				database
					.prepare('SELECT MIN(deferred_at + ?) AS attempt_at FROM content_gc_candidates')
					.get(this.#orphanGcMaxDeferralMs) as {attempt_at: number | null},
			BACKGROUND_DATABASE_PRIORITY,
		)
		return this.#readDatabase(async (database) => {
			const variants = [...this.#enabledThumbnailVariants]
			const excludedEntryIds = [...this.#activeHashEntries]
			const excludedContentIds = [...this.#activeThumbnailContents]
			const excludedMediaIds = [...this.#activeMediaContents]
			const hashExclusion =
				excludedEntryIds.length > 0 ? `AND candidate.id NOT IN (${excludedEntryIds.map(() => '?').join(', ')})` : ''
			const thumbnailExclusion =
				excludedContentIds.length > 0
					? `AND failed.content_id NOT IN (${excludedContentIds.map(() => '?').join(', ')})`
					: ''
			const mediaExclusion =
				excludedMediaIds.length > 0
					? `AND failed_media.content_id NOT IN (${excludedMediaIds.map(() => '?').join(', ')})`
					: ''
			const row = (await database
				.prepare(
					`SELECT MIN(attempt_at) AS attempt_at FROM (
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
									${hashExclusion}
								ORDER BY candidate.hash_retry_at, candidate.id
								LIMIT 1
							)
							WHERE ${BACKGROUND_ENRICHMENT_ROOT_SQL}
							ORDER BY entries.hash_retry_at, entries.id LIMIT 1
						)
						UNION ALL
						SELECT attempt_at FROM (
							SELECT retry_at AS attempt_at
							FROM thumbnail_variants AS failed INDEXED BY thumbnail_variants_failed_work
							WHERE variant IN (${variants.map(() => '?').join(', ')}) AND state = 'failed'
								AND EXISTS (SELECT 1 FROM entries
									JOIN index_roots ON index_roots.id = entries.root_id
									WHERE entries.content_id = failed.content_id AND ${BACKGROUND_ENRICHMENT_ROOT_SQL})
								${thumbnailExclusion}
							ORDER BY retry_at, content_id LIMIT 1
						)
						UNION ALL
						SELECT attempt_at FROM (
							SELECT retry_at AS attempt_at
							FROM media_metadata AS failed_media INDEXED BY media_metadata_failed_work
							WHERE state = 'failed'
								AND EXISTS (SELECT 1 FROM entries
									JOIN index_roots ON index_roots.id = entries.root_id
									WHERE entries.content_id = failed_media.content_id AND ${BACKGROUND_ENRICHMENT_ROOT_SQL})
								${mediaExclusion}
							ORDER BY retry_at, content_id LIMIT 1
						)
						UNION ALL
						SELECT ? AS attempt_at
					)`,
				)
				.get(...excludedEntryIds, ...variants, ...excludedContentIds, ...excludedMediaIds, deferred.attempt_at)) as {
				attempt_at: number | null
			}
			return row.attempt_at === null ? undefined : Number(row.attempt_at)
		}, BACKGROUND_DATABASE_PRIORITY)
	}

	async #ensureEntryContent(entryId: number, onDemand: boolean, knownCandidate?: EntryCandidate) {
		const priority = onDemand ? ON_DEMAND_DATABASE_PRIORITY : BACKGROUND_DATABASE_PRIORITY
		const ready = await this.#contentForEntry(entryId, priority)
		if (ready) return ready
		const existing = this.#contentOperations.get(entryId)
		if (existing) return existing
		const operation = this.#createEntryContent(entryId, priority, knownCandidate)
		this.#contentOperations.set(entryId, operation)
		try {
			return await operation
		} finally {
			if (this.#contentOperations.get(entryId) === operation) this.#contentOperations.delete(entryId)
		}
	}

	async #createEntryContent(entryId: number, priority: number, knownCandidate?: EntryCandidate) {
		const candidate = knownCandidate ?? (await this.#entryCandidate(entryId, priority))
		if (!candidate) throw new Error('Unsupported or missing thumbnail source')

		let hash: Buffer
		try {
			hash = await this.#hashFile(candidate.systemPath, candidate)
		} catch (error) {
			if (error instanceof StaleFileRevisionError) throw error
			await this.#recordHashFailure(candidate, error, priority)
			await this.#onHashFailure?.(candidate.id)
			throw new PersistedEnrichmentFailure(error)
		}

		return this.#attachEntryContent(candidate, hash, priority)
	}

	async #attachEntryContent(
		candidate: EntryCandidate,
		hash: Buffer,
		priority: number,
		expectedRevision?: PublishedFileRevision,
	) {
		const content = await this.#withDatabase((database) => {
			const attach = database.transaction(() => {
				const kind = photoKind(candidate.systemPath)
				database
					.prepare('INSERT INTO contents(blake3, size, created_at) VALUES (?, ?, ?) ON CONFLICT(blake3) DO NOTHING')
					.run(hash, candidate.size, Date.now())
				const content = database.prepare('SELECT id, hex(blake3) AS hash FROM contents WHERE blake3 = ?').get(hash) as {
					id: number
					hash: string
				}
				const insertVariant = database.prepare(
					`INSERT INTO thumbnail_variants(content_id, variant, state, failure_count, updated_at)
						VALUES (?, ?, 'pending', 0, ?)
						ON CONFLICT(content_id, variant) DO NOTHING`,
				)
				const backgroundEntry = Boolean(
					database
						.prepare(
							`SELECT 1 FROM entries
							JOIN index_roots ON index_roots.id = entries.root_id
							WHERE entries.id = ? AND ${BACKGROUND_ENRICHMENT_ROOT_SQL}`,
						)
						.get(candidate.id),
				)
				const photosEntry = backgroundEntry && this.#photosAvailable()
				if (kind) {
					for (const variant of this.#enabledThumbnailVariants) {
						if (!PHOTOS_ONLY_VARIANT_SET.has(variant) || photosEntry) insertVariant.run(content.id, variant, Date.now())
					}
				}
				if (photosEntry && kind)
					database
						.prepare(
							`INSERT INTO media_metadata(content_id, state, kind, failure_count, updated_at)
						VALUES (?, 'pending', ?, 0, ?)
						ON CONFLICT(content_id) DO NOTHING`,
						)
						.run(content.id, kind, Date.now())
				const result = database
					.prepare(
						`UPDATE entries SET
							content_id = ?,
							hash_failure_count = 0, hash_retry_at = NULL, hash_error = NULL
						WHERE id = ? AND thumbnail_identity_kind = 'content' AND content_id IS NULL
							AND inode = ? AND size = ? AND modified_ns = ?
							${expectedRevision ? 'AND ctime_ns = ?' : ''}`,
					)
					.run(
						content.id,
						candidate.id,
						candidate.inode,
						candidate.size,
						candidate.modifiedNs,
						...(expectedRevision ? [expectedRevision.ctimeNs] : []),
					)
				if (result.changes === 0) throw new StaleFileRevisionError('File changed while hashing')
				return {
					...content,
					entryId: candidate.id,
					hash: content.hash.toLowerCase(),
					systemPath: candidate.systemPath,
					fingerprint: candidate,
				}
			})
			return attach.immediate()
		}, priority)
		await this.#onContentAttached?.(candidate.id, hash)
		return content
	}

	async #recordHashFailure(candidate: EntryCandidate, error: unknown, priority: number) {
		await this.#withDatabase((database) => {
			const current = database.prepare('SELECT hash_failure_count FROM entries WHERE id = ?').get(candidate.id) as
				| {hash_failure_count: number}
				| undefined
			if (!current) return
			const failureCount = Number(current.hash_failure_count) + 1
			database
				.prepare(
					`UPDATE entries SET hash_failure_count = ?, hash_retry_at = ?, hash_error = ?
					WHERE id = ? AND thumbnail_identity_kind = 'content'
						AND inode = ? AND size = ? AND modified_ns = ?`,
				)
				.run(
					failureCount,
					Date.now() + retryDelay(HASH_RETRY_BASE_MS, failureCount),
					errorMessage(error),
					candidate.id,
					candidate.inode,
					candidate.size,
					candidate.modifiedNs,
				)
		}, priority)
	}

	async #nextContentNeedingThumbnail() {
		return this.#selectDatabase(async (database) => {
			const variants = [...this.#enabledThumbnailVariants]
			const excludedIds = [...this.#activeThumbnailContents]
			const exclusion =
				excludedIds.length > 0
					? `AND thumbnail_variants.content_id NOT IN (${excludedIds.map(() => '?').join(', ')})`
					: ''
			const select = async (state: 'pending' | 'failed', variant: ThumbnailVariant) => {
				const workIndex = state === 'pending' ? 'thumbnail_variants_pending_work' : 'thumbnail_variants_failed_work'
				const retryPredicate = state === 'pending' ? '' : 'AND thumbnail_variants.retry_at <= ?'
				const workOrder =
					state === 'pending'
						? 'thumbnail_variants.content_id, entries.id'
						: 'thumbnail_variants.retry_at, thumbnail_variants.content_id, entries.id'
				return (await database
					.prepare(
						`SELECT contents.id, entries.id AS entry_id, hex(contents.blake3) AS hash,
							thumbnail_variants.variant,
							entries.device, entries.inode, entries.size, entries.modified_ns,
							entries.ctime_ns, entries.thumbnail_identity_kind,
							index_roots.system_path AS root_system_path, entries.relative_path
						FROM thumbnail_variants INDEXED BY ${workIndex}
						JOIN contents ON contents.id = thumbnail_variants.content_id
						JOIN entries INDEXED BY entries_by_content ON entries.content_id = thumbnail_variants.content_id
						JOIN index_roots ON index_roots.id = entries.root_id
						WHERE thumbnail_variants.variant = ? AND thumbnail_variants.state = '${state}'
							AND ${BACKGROUND_ENRICHMENT_ROOT_SQL}
							${retryPredicate}
							${exclusion}
						ORDER BY ${workOrder}
						LIMIT 1`,
					)
					.get(variant, ...(state === 'failed' ? [Date.now()] : []), ...excludedIds)) as
					| ContentThumbnailCandidateRow
					| undefined
			}
			let row: ContentThumbnailCandidateRow | undefined
			for (const state of ['pending', 'failed'] as const) {
				for (const variant of variants) {
					row = await select(state, variant)
					if (row) break
				}
				if (row) break
			}
			if (!row) return
			const candidate: ContentThumbnailCandidate = {...contentCandidate(row), variant: row.variant}
			if (this.#activeThumbnailContents.has(candidate.id)) return
			this.#activeThumbnailContents.add(candidate.id)
			return candidate
		}, BACKGROUND_DATABASE_PRIORITY)
	}

	async #thumbnailVariantsForContent(
		contentId: number,
		requested: ThumbnailVariant,
		priority: number,
		freshReference = false,
	) {
		const rows = await this.#readDatabase(
			async (database) =>
				(await database
					.prepare('SELECT variant, state, retry_at, last_error FROM thumbnail_variants WHERE content_id = ?')
					.all(contentId)) as Array<{
					variant: string
					state: 'pending' | 'ready' | 'failed'
					retry_at: number | null
					last_error: string | null
				}>,
			priority,
		)
		const stateByVariant = new Map(rows.map((row) => [row.variant, row]))
		const now = Date.now()
		return ALL_THUMBNAIL_VARIANTS.filter((variant) => {
			if (variant === requested) return true
			if (!this.#enabledThumbnailVariants.has(variant)) return false
			const row = stateByVariant.get(variant)
			return (
				row?.state === 'pending' ||
				(row?.state === 'failed' &&
					((row.retry_at ?? 0) <= now || (freshReference && referenceFailureMessage(row.last_error))))
			)
		})
	}

	async #ensureContentThumbnail(
		content: ContentCandidate,
		variant: ThumbnailVariant,
		onDemand: boolean,
		freshReference = false,
	) {
		const priority = onDemand ? ON_DEMAND_DATABASE_PRIORITY : BACKGROUND_DATABASE_PRIORITY
		const variants = await this.#thumbnailVariantsForContent(content.id, variant, priority, freshReference)
		await this.#withArtifactOperations(
			variants.map((candidate) => contentIdentity(content.hash, candidate)),
			async () => {
				const states = new Map(
					(
						await this.#readDatabase(
							async (database) =>
								(await database
									.prepare('SELECT variant, state, retry_at, last_error FROM thumbnail_variants WHERE content_id = ?')
									.all(content.id)) as Array<{
									variant: ThumbnailVariant
									state: 'pending' | 'ready' | 'failed'
									retry_at: number | null
									last_error: string | null
								}>,
							priority,
						)
					).map((row) => [row.variant, row]),
				)
				const work: Array<{variant: ThumbnailVariant; destination: string}> = []
				for (const candidate of variants) {
					const destination = thumbnailSystemPath(this.thumbnailDirectory, contentIdentity(content.hash, candidate))
					const existing = states.get(candidate)
					if (existing?.state === 'ready' && (await this.#thumbnailIsUsable(destination))) continue
					if (
						!onDemand &&
						existing?.state === 'failed' &&
						existing.retry_at !== null &&
						existing.retry_at > Date.now() &&
						!(freshReference && referenceFailureMessage(existing.last_error))
					) {
						continue
					}
					work.push({variant: candidate, destination})
				}
				if (work.length === 0) return

				const attemptedEntries = new Set<number>()
				while (true) {
					attemptedEntries.add(content.entryId)
					const outputs = work.map((output) => ({
						...output,
						temporary: `${output.destination}.tmp-${randomUUID()}.${THUMBNAIL_FORMAT}`,
					}))
					let source: Awaited<ReturnType<typeof open>> | undefined
					try {
						for (const directory of new Set(outputs.map(({destination}) => nodePath.dirname(destination)))) {
							await this.#ensureArtifactDirectory(directory)
						}
						const missing: typeof outputs = []
						for (const output of outputs) {
							if (await this.#thumbnailIsUsable(output.destination)) continue
							await this.#remove(output.destination).catch(() => {})
							missing.push(output)
						}
						if (missing.length > 0) {
							source = await openContentRevision(content.systemPath, content.fingerprint)
							await this.#generateThumbnails(
								content.systemPath,
								missing.map(({temporary, variant}) => ({destination: temporary, variant})),
								source.fd,
							)
							await assertHandleContentRevision(source, content.fingerprint)
							for (const output of missing) {
								await syncThumbnailArtifact(output.temporary)
								await fse.move(output.temporary, output.destination, {overwrite: false}).catch(async (error) => {
									if (!(await this.#thumbnailIsUsable(output.destination))) throw error
									await this.#remove(output.temporary).catch(() => {})
								})
								await syncThumbnailArtifact(output.destination)
							}
							for (const directory of new Set(missing.map(({destination}) => nodePath.dirname(destination)))) {
								await syncDirectory(directory)
							}
						}
						const tintOutput = outputs.find(({variant}) => variant === FILES_THUMBNAIL_VARIANT)
						if (tintOutput) {
							await this.#recordThumbnailTint(content.id, tintOutput.destination, priority)
						}
						await this.#markThumbnailsReady(
							content,
							outputs.map(({variant}) => variant),
							priority,
						)
						for (const output of outputs) {
							this.#onThumbnailReady?.(content.id, output.variant)
						}
						return
					} catch (error) {
						await Promise.all(outputs.map(({temporary}) => this.#remove(temporary).catch(() => {})))
						const referenceFailure = await contentReferenceFailure(error, content)
						if (referenceFailure) {
							if (referenceFailure === 'stale') {
								await this.#onStalePath(content.systemPath).catch((refreshError) =>
									this.logger.error(`Failed to refresh stale thumbnail source '${content.systemPath}'`, refreshError),
								)
							}
							const alternative = await this.#nextContentReference(content.id, attemptedEntries, priority, !onDemand)
							if (alternative) {
								content = alternative
								continue
							}
							if (referenceFailure === 'stale') {
								throw new StaleFileRevisionError('No current source remains for thumbnail content', {cause: error})
							}
						}
						for (const output of outputs) {
							await this.#recordThumbnailFailure(
								content.id,
								output.variant,
								error,
								priority,
								referenceFailure === 'unreadable',
							)
						}
						await this.#onContentFailure?.(content.id)
						throw new PersistedEnrichmentFailure(error)
					} finally {
						await source?.close().catch(() => {})
					}
				}
			},
		)
	}

	async #recordThumbnailTint(contentId: number, thumbnailPath: string, priority: number) {
		try {
			const tint = await this.#extractThumbnailTint(thumbnailPath)
			await this.#withDatabase((database) => {
				database.prepare('UPDATE media_metadata SET tint = COALESCE(tint, ?) WHERE content_id = ?').run(tint, contentId)
			}, priority)
		} catch (error) {
			this.logger.error(`Failed to extract thumbnail tint from '${thumbnailPath}'`, error)
		}
	}

	async #markThumbnailsReady(content: ContentCandidate, variants: ThumbnailVariant[], priority: number) {
		await this.#withDatabase((database) => {
			const mark = database.transaction(() => {
				const current = database
					.prepare(
						`SELECT 1 FROM entries
					WHERE content_id = ? AND thumbnail_identity_kind = 'content'
						AND inode = ? AND size = ? AND modified_ns = ?`,
					)
					.get(content.id, content.fingerprint.inode, content.fingerprint.size, content.fingerprint.modifiedNs)
				if (!current) throw new StaleFileRevisionError('File changed while generating thumbnail')
				const ready = database.prepare(
					`INSERT INTO thumbnail_variants(
						content_id, variant, state, failure_count, retry_at, last_error, created_at, updated_at
					) VALUES (?, ?, 'ready', 0, NULL, NULL, ?, ?)
					ON CONFLICT(content_id, variant) DO UPDATE SET
						state = 'ready', failure_count = 0, retry_at = NULL,
						last_error = NULL, created_at = excluded.created_at, updated_at = excluded.updated_at`,
				)
				const now = Date.now()
				for (const variant of variants) ready.run(content.id, variant, now, now)
			})
			mark.immediate()
		}, priority)
	}

	async #ensureTransientThumbnail(candidate: EntryCandidate, variant: ThumbnailVariant): Promise<ThumbnailReference> {
		const identity = transientIdentity(candidate, variant)
		await this.#withArtifactOperation(identity, async () => {
			const destination = thumbnailSystemPath(this.thumbnailDirectory, identity)
			const existing = await this.#readDatabase(
				async (database) =>
					(await database
						.prepare(
							`SELECT artifact_key, state FROM transient_thumbnail_variants
							WHERE entry_id = ? AND variant = ?`,
						)
						.get(candidate.id, variant)) as {artifact_key: string; state: 'pending' | 'ready' | 'failed'} | undefined,
				ON_DEMAND_DATABASE_PRIORITY,
			)
			if (
				existing?.artifact_key === identity.key &&
				existing.state === 'ready' &&
				(await this.#thumbnailIsUsable(destination))
			) {
				return
			}

			const temporary = `${destination}.tmp-${randomUUID()}.${THUMBNAIL_FORMAT}`
			let source: Awaited<ReturnType<typeof open>> | undefined
			try {
				await this.#ensureArtifactDirectory(nodePath.dirname(destination))
				source = await openTransientRevision(candidate.systemPath, candidate)
				if (!(await this.#thumbnailIsUsable(destination))) {
					await this.#remove(destination).catch(() => {})
					await this.#generateThumbnail(candidate.systemPath, temporary, variant, source.fd)
					await assertHandleTransientRevision(source, candidate)
					await syncThumbnailArtifact(temporary)
					await fse.move(temporary, destination, {overwrite: false}).catch(async (error) => {
						if (!(await this.#thumbnailIsUsable(destination))) throw error
						await this.#remove(temporary).catch(() => {})
					})
					await syncThumbnailArtifact(destination)
					await syncDirectory(nodePath.dirname(destination))
				}
				await this.#markTransientThumbnailReady(candidate, variant, identity.key)
			} catch (error) {
				await this.#remove(temporary).catch(() => {})
				if (error instanceof StaleFileRevisionError) throw error
				await this.#recordTransientThumbnailFailure(candidate, variant, identity.key, error)
				throw new PersistedEnrichmentFailure(error)
			} finally {
				await source?.close().catch(() => {})
			}
		})
		return transientThumbnailReference(transientArtifactKey(candidate), variant)
	}

	async #getExistingTransientThumbnail(
		candidate: EntryCandidate,
		variant: ThumbnailVariant,
	): Promise<ThumbnailReference | undefined> {
		const identity = transientIdentity(candidate, variant)
		const ready = await this.#readDatabase(
			async (database) =>
				Boolean(
					await database
						.prepare(
							`SELECT 1 FROM transient_thumbnail_variants
							WHERE entry_id = ? AND variant = ? AND artifact_key = ? AND state = 'ready'`,
						)
						.get(candidate.id, variant, identity.key),
				),
			ON_DEMAND_DATABASE_PRIORITY,
		)
		if (!ready) return
		if (!(await this.#thumbnailIsUsable(thumbnailSystemPath(this.thumbnailDirectory, identity)))) {
			await this.#withDatabase(
				(database) =>
					database
						.prepare(
							`UPDATE transient_thumbnail_variants SET state = 'pending', updated_at = ?
							WHERE entry_id = ? AND variant = ? AND artifact_key = ?`,
						)
						.run(Date.now(), candidate.id, variant, identity.key),
				ON_DEMAND_DATABASE_PRIORITY,
			)
			return
		}
		return transientThumbnailReference(identity.key, variant)
	}

	async #markTransientThumbnailReady(candidate: EntryCandidate, variant: ThumbnailVariant, artifactKey: string) {
		await this.#withDatabase((database) => {
			const publish = database.transaction(() => {
				const current = database
					.prepare(
						`SELECT 1 FROM entries
						WHERE id = ? AND thumbnail_identity_kind = 'transient'
							AND device = ? AND inode = ? AND size = ? AND modified_ns = ?`,
					)
					.get(candidate.id, candidate.device, candidate.inode, candidate.size, candidate.modifiedNs)
				if (!current) throw new StaleFileRevisionError('File changed while generating thumbnail')
				database
					.prepare(
						`INSERT INTO transient_thumbnail_variants(
							entry_id, variant, artifact_key, state, failure_count, last_error, created_at, updated_at
						) VALUES (?, ?, ?, 'ready', 0, NULL, ?, ?)
						ON CONFLICT(entry_id, variant) DO UPDATE SET
							artifact_key = excluded.artifact_key, state = 'ready', failure_count = 0,
							last_error = NULL, created_at = excluded.created_at, updated_at = excluded.updated_at`,
					)
					.run(candidate.id, variant, artifactKey, Date.now(), Date.now())
			})
			publish.immediate()
		}, ON_DEMAND_DATABASE_PRIORITY)
	}

	async #recordTransientThumbnailFailure(
		candidate: EntryCandidate,
		variant: ThumbnailVariant,
		artifactKey: string,
		error: unknown,
	) {
		await this.#withDatabase((database) => {
			const record = database.transaction(() => {
				const current = database
					.prepare(
						`SELECT 1 FROM entries
						WHERE id = ? AND thumbnail_identity_kind = 'transient'
							AND device = ? AND inode = ? AND size = ? AND modified_ns = ?`,
					)
					.get(candidate.id, candidate.device, candidate.inode, candidate.size, candidate.modifiedNs)
				if (!current) throw new StaleFileRevisionError('File changed while generating thumbnail')
				const existing = database
					.prepare(
						`SELECT failure_count FROM transient_thumbnail_variants
						WHERE entry_id = ? AND variant = ? AND artifact_key = ?`,
					)
					.get(candidate.id, variant, artifactKey) as {failure_count: number} | undefined
				database
					.prepare(
						`INSERT INTO transient_thumbnail_variants(
							entry_id, variant, artifact_key, state, failure_count, last_error, updated_at
						) VALUES (?, ?, ?, 'failed', ?, ?, ?)
						ON CONFLICT(entry_id, variant) DO UPDATE SET
							artifact_key = excluded.artifact_key, state = 'failed',
							failure_count = excluded.failure_count, last_error = excluded.last_error,
							updated_at = excluded.updated_at`,
					)
					.run(
						candidate.id,
						variant,
						artifactKey,
						Number(existing?.failure_count ?? 0) + 1,
						errorMessage(error),
						Date.now(),
					)
			})
			record.immediate()
		}, ON_DEMAND_DATABASE_PRIORITY)
	}

	async #ensureArtifactDirectory(systemPath: string): Promise<void> {
		const pending = this.#directoryPublication.get(systemPath)
		if (pending) return pending

		const publication = (async () => {
			const parent = nodePath.dirname(systemPath)
			if (systemPath !== this.thumbnailDirectory) await this.#ensureArtifactDirectory(parent)

			let created = false
			try {
				await mkdir(systemPath)
				created = true
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
				const stats = await fse.lstat(systemPath)
				if (!stats.isDirectory()) throw error
			}

			// Persist the directory entry before any lane can publish a ready
			// artifact below it. Syncing only the leaf after the file rename does
			// not make newly-created shard ancestors durable across a power cut.
			if (created) await syncDirectory(parent)
		})()
		this.#directoryPublication.set(systemPath, publication)
		try {
			await publication
		} finally {
			if (this.#directoryPublication.get(systemPath) === publication) this.#directoryPublication.delete(systemPath)
		}
	}

	async #withArtifactOperation<T>(identity: ThumbnailIdentity, operation: () => Promise<T>): Promise<T> {
		const key = `${identity.kind}:${identity.variant}:${identity.key}`
		const previous = this.#artifactOperations.get(key) ?? Promise.resolve()
		let release!: () => void
		const turn = new Promise<void>((resolve) => (release = resolve))
		const tail = previous.catch(() => {}).then(() => turn)
		this.#artifactOperations.set(key, tail)
		await previous.catch(() => {})
		try {
			return await operation()
		} finally {
			release()
			if (this.#artifactOperations.get(key) === tail) this.#artifactOperations.delete(key)
		}
	}

	async #withArtifactOperations<T>(identities: ThumbnailIdentity[], operation: () => Promise<T>): Promise<T> {
		const unique = [
			...new Map(
				identities.map((identity) => [`${identity.kind}:${identity.variant}:${identity.key}`, identity] as const),
			).entries(),
		]
			.toSorted(([left], [right]) => left.localeCompare(right))
			.map(([, identity]) => identity)
		const acquire = (index: number): Promise<T> => {
			const identity = unique[index]
			return identity ? this.#withArtifactOperation(identity, () => acquire(index + 1)) : operation()
		}
		return acquire(0)
	}

	async #nextContentReference(
		contentId: number,
		excludedEntryIds: Set<number>,
		priority: number,
		backgroundOnly = false,
	) {
		return this.#readDatabase(async (database) => {
			const excluded = [...excludedEntryIds]
			const placeholders = excluded.map(() => '?').join(', ')
			const row = (await database
				.prepare(
					`SELECT contents.id, entries.id AS entry_id, hex(contents.blake3) AS hash,
						entries.device, entries.inode, entries.size, entries.modified_ns,
						entries.ctime_ns, entries.thumbnail_identity_kind,
						index_roots.system_path AS root_system_path, entries.relative_path
					FROM entries INDEXED BY entries_by_content
					JOIN contents ON contents.id = entries.content_id
					JOIN index_roots ON index_roots.id = entries.root_id
					WHERE entries.content_id = ? AND entries.thumbnail_identity_kind = 'content'
						${backgroundOnly ? `AND ${BACKGROUND_ENRICHMENT_ROOT_SQL}` : ''}
						AND entries.id NOT IN (${placeholders})
					ORDER BY entries.id LIMIT 1`,
				)
				.get(contentId, ...excluded)) as ContentCandidateRow | undefined
			return row ? contentCandidate(row) : undefined
		}, priority)
	}

	async #recordThumbnailFailure(
		contentId: number,
		variant: ThumbnailVariant,
		error: unknown,
		priority: number,
		referenceFailure = false,
	) {
		await this.#withDatabase((database) => {
			const existing = database
				.prepare('SELECT failure_count FROM thumbnail_variants WHERE content_id = ? AND variant = ?')
				.get(contentId, variant) as {failure_count: number} | undefined
			const failureCount = Number(existing?.failure_count ?? 0) + 1
			database
				.prepare(
					`INSERT INTO thumbnail_variants(
						content_id, variant, state, failure_count, retry_at, last_error, updated_at
					) VALUES (?, ?, 'failed', ?, ?, ?, ?)
					ON CONFLICT(content_id, variant) DO UPDATE SET
						state = 'failed', failure_count = excluded.failure_count,
						retry_at = excluded.retry_at, last_error = excluded.last_error,
						updated_at = excluded.updated_at`,
				)
				.run(
					contentId,
					variant,
					failureCount,
					Date.now() + retryDelay(THUMBNAIL_RETRY_BASE_MS, failureCount),
					persistedFailureMessage(error, referenceFailure),
					Date.now(),
				)
		}, priority)
	}

	async #entryCandidate(entryId: number, priority: number) {
		return this.#readDatabase(async (database) => {
			const row = (await database
				.prepare(
					`SELECT entries.id, entries.device, entries.inode, entries.size, entries.modified_ns,
						entries.ctime_ns, entries.thumbnail_identity_kind,
						index_roots.system_path AS root_system_path, entries.relative_path
					FROM entries
					JOIN index_roots ON index_roots.id = entries.root_id
					WHERE entries.id = ? AND entries.thumbnail_identity_kind IS NOT NULL`,
				)
				.get(entryId)) as EntryCandidateRow | undefined
			return row ? entryCandidate(row) : undefined
		}, priority)
	}

	async #contentForEntry(entryId: number, priority: number) {
		return this.#readDatabase(async (database) => {
			const row = (await database
				.prepare(
					`SELECT contents.id, entries.id AS entry_id, hex(contents.blake3) AS hash,
						entries.device, entries.inode, entries.size, entries.modified_ns,
						entries.ctime_ns, entries.thumbnail_identity_kind,
						index_roots.system_path AS root_system_path, entries.relative_path
					FROM entries
					JOIN contents ON contents.id = entries.content_id
					JOIN index_roots ON index_roots.id = entries.root_id
					WHERE entries.id = ? AND entries.thumbnail_identity_kind = 'content'`,
				)
				.get(entryId)) as ContentCandidateRow | undefined
			return row ? contentCandidate(row) : undefined
		}, priority)
	}

	async #takeOrphanCandidates(): Promise<OrphanMaintenance> {
		return this.#withDatabase((database) => {
			const remove = database.transaction(() => {
				const pendingHash = database
					.prepare(
						`SELECT 1 FROM index_roots
						WHERE ${BACKGROUND_ENRICHMENT_ROOT_SQL}
							AND EXISTS (
								SELECT 1 FROM entries AS candidate INDEXED BY entries_pending_content_hash
								WHERE candidate.root_id = index_roots.id
									AND candidate.thumbnail_identity_kind = 'content'
									AND candidate.content_id IS NULL
									AND candidate.hash_error IS NULL
							)
						LIMIT 1`,
					)
					.get()
				const candidates = database
					.prepare(
						`SELECT content_id FROM content_gc_candidates
						WHERE ? = 0 OR deferred_at <= ?
						ORDER BY content_id LIMIT ?`,
					)
					.all(
						Number(Boolean(pendingHash)),
						Date.now() - this.#orphanGcMaxDeferralMs,
						ORPHAN_SWEEP_BATCH_SIZE,
					) as Array<{
					content_id: number
				}>
				if (candidates.length === 0) return {processed: false, orphans: []}

				const ids = candidates.map(({content_id}) => Number(content_id))
				const placeholders = ids.map(() => '?').join(', ')
				database.prepare(`DELETE FROM content_gc_candidates WHERE content_id IN (${placeholders})`).run(...ids)
				const orphans = database
					.prepare(
						`SELECT id, hex(blake3) AS hash FROM contents
						WHERE id IN (${placeholders})
							AND NOT EXISTS (SELECT 1 FROM entries WHERE entries.content_id = contents.id)`,
					)
					.all(...ids) as OrphanedContentRow[]
				if (orphans.length > 0) {
					const orphanIds = orphans.map(({id}) => Number(id))
					const orphanPlaceholders = orphanIds.map(() => '?').join(', ')
					database
						.prepare(
							`DELETE FROM contents WHERE id IN (${orphanPlaceholders})
								AND NOT EXISTS (SELECT 1 FROM entries WHERE entries.content_id = contents.id)`,
						)
						.run(...orphanIds)
				}
				return {
					processed: true,
					orphans: orphans.map(({id, hash}) => ({id: Number(id), key: hash.toLowerCase()})),
				}
			})
			return remove.immediate()
		}, BACKGROUND_DATABASE_PRIORITY)
	}

	async #orphanSweepStep(): Promise<OrphanMaintenance> {
		if (this.#orphanSweepCursor === undefined) return {processed: false, orphans: []}
		const afterContentId = this.#orphanSweepCursor
		const result = await this.#withDatabase((database) => {
			const sweep = database.transaction(() => {
				const rows = database
					.prepare(
						`SELECT id, hex(blake3) AS hash,
							NOT EXISTS (SELECT 1 FROM entries WHERE entries.content_id = contents.id) AS orphaned
						FROM contents WHERE id > ? ORDER BY id LIMIT ?`,
					)
					.all(afterContentId, ORPHAN_SWEEP_BATCH_SIZE) as Array<OrphanedContentRow & {orphaned: number}>
				const orphans = rows.filter(({orphaned}) => Boolean(orphaned))
				const defer = database.prepare(
					`INSERT INTO content_gc_candidates(content_id, deferred_at) VALUES (?, ?)
					ON CONFLICT(content_id) DO NOTHING`,
				)
				for (const {id} of orphans) defer.run(id, Date.now())
				return {
					rows: rows.length,
					lastId: rows.at(-1)?.id,
				}
			})
			return sweep.immediate()
		}, BACKGROUND_DATABASE_PRIORITY)

		if (result.lastId !== undefined) this.#orphanSweepCursor = Number(result.lastId)
		if (result.rows < ORPHAN_SWEEP_BATCH_SIZE) this.#orphanSweepCursor = undefined
		return {processed: result.rows > 0, orphans: []}
	}

	async #removeOrphanedArtifacts(orphans: OrphanedContent[]) {
		await inConcurrentChunks(orphans, ARTIFACT_IO_CONCURRENCY, async (orphan) => {
			for (const variant of ALL_THUMBNAIL_VARIANTS) {
				const identity = contentIdentity(orphan.key, variant)
				await this.#withArtifactOperation(identity, async () => {
					if ((await this.#trackedContentHashes([orphan.key])).has(orphan.key)) return
					await this.#remove(thumbnailSystemPath(this.thumbnailDirectory, identity)).catch((error) =>
						this.logger.error(`Failed to remove orphaned thumbnail '${orphan.key}'`, error),
					)
				})
			}
		})
	}

	async #takeTransientArtifactCandidates(): Promise<{processed: boolean; keys: string[]}> {
		return this.#withDatabase((database) => {
			const take = database.transaction(() => {
				const rows = database
					.prepare(
						`SELECT artifact_key FROM transient_artifact_gc_candidates
						ORDER BY artifact_key LIMIT ?`,
					)
					.all(ORPHAN_SWEEP_BATCH_SIZE) as Array<{artifact_key: string}>
				if (rows.length === 0) return {processed: false, keys: []}
				const keys = rows.map(({artifact_key}) => artifact_key)
				const placeholders = keys.map(() => '?').join(', ')
				database
					.prepare(`DELETE FROM transient_artifact_gc_candidates WHERE artifact_key IN (${placeholders})`)
					.run(...keys)
				const tracked = new Set(
					(
						database
							.prepare(
								`SELECT DISTINCT artifact_key FROM transient_thumbnail_variants
									WHERE artifact_key IN (${placeholders})`,
							)
							.all(...keys) as Array<{artifact_key: string}>
					).map(({artifact_key}) => artifact_key),
				)
				return {processed: true, keys: keys.filter((key) => !tracked.has(key))}
			})
			return take.immediate()
		}, BACKGROUND_DATABASE_PRIORITY)
	}

	async #removeTransientArtifacts(keys: string[]) {
		await inConcurrentChunks(keys, ARTIFACT_IO_CONCURRENCY, async (key) => {
			for (const variant of ALL_THUMBNAIL_VARIANTS) {
				const identity: ThumbnailIdentity = {kind: 'transient', key, variant}
				await this.#withArtifactOperation(identity, async () => {
					if ((await this.#trackedTransientArtifactKeys([key])).has(key)) return
					await this.#remove(thumbnailSystemPath(this.thumbnailDirectory, identity)).catch((error) =>
						this.logger.error(`Failed to remove unused transient thumbnail '${key}'`, error),
					)
				})
			}
		})
	}

	async #artifactMaintenanceStep() {
		if (
			this.#thumbnailVerificationCursor !== undefined ||
			Date.now() - this.#thumbnailVerificationCompletedAt >= ARTIFACT_MAINTENANCE_INTERVAL_MS
		) {
			if (this.#thumbnailVerificationCursor === undefined) {
				this.#thumbnailVerificationCursor = {variant: '', contentId: 0}
			}
			const ready = await this.#nextReadyThumbnails(this.#thumbnailVerificationCursor)
			if (ready.length > 0) {
				const last = ready.at(-1)!
				this.#thumbnailVerificationCursor = {variant: last.variant, contentId: last.contentId}
				const missing: Array<{contentId: number; variant: ThumbnailVariant}> = []
				await inConcurrentChunks(ready, ARTIFACT_IO_CONCURRENCY, async (thumbnail) => {
					if (
						!(await this.#thumbnailIsUsable(
							thumbnailSystemPath(this.thumbnailDirectory, contentIdentity(thumbnail.key, thumbnail.variant)),
						))
					) {
						missing.push({contentId: thumbnail.contentId, variant: thumbnail.variant})
					}
				})
				await this.#markThumbnailPending(missing, BACKGROUND_DATABASE_PRIORITY)
				return true
			}
			this.#thumbnailVerificationCursor = undefined
			this.#thumbnailVerificationCompletedAt = Date.now()
			return true
		}

		if (!this.#destructiveArtifactMaintenanceAllowed) return false
		// A rebuilt database knows paths before the enrichment lane has had time
		// to reconnect their content hashes. Do not classify artifacts as
		// untracked during that gap (the same invariant also protects live moves).
		if (this.#artifactFiles && (await this.#hasUnsettledContentHashes())) return false
		if (!this.#artifactFiles && Date.now() - this.#artifactMaintenanceCompletedAt < ARTIFACT_MAINTENANCE_INTERVAL_MS) {
			return false
		}

		if (this.#artifactFiles) {
			const paths: string[] = []
			let complete = false
			while (paths.length < ARTIFACT_MAINTENANCE_BATCH_SIZE) {
				const next = await this.#artifactFiles.next()
				if (next.done) {
					this.#artifactFiles = undefined
					this.#artifactMaintenanceCompletedAt = Date.now()
					complete = true
					break
				}
				paths.push(next.value)
			}

			const artifacts = paths.map((systemPath) => ({
				systemPath,
				identity: storedThumbnailIdentity(this.thumbnailDirectory, systemPath),
			}))
			await inConcurrentChunks(artifacts, ARTIFACT_IO_CONCURRENCY, async ({systemPath, identity}) => {
				if (identity) {
					await this.#withArtifactOperation(identity, async () => {
						if (await this.#thumbnailIdentityIsTracked(identity)) return
						if (await isRecentTemporaryArtifact(systemPath)) return
						await this.#remove(systemPath).catch((error) =>
							this.logger.error(`Failed to remove untracked thumbnail artifact '${systemPath}'`, error),
						)
					})
					return
				}
				if (await isRecentTemporaryArtifact(systemPath)) return
				await this.#remove(systemPath).catch((error) =>
					this.logger.error(`Failed to remove untracked thumbnail artifact '${systemPath}'`, error),
				)
			})
			return paths.length > 0 || !complete
		}
		if (await this.#hasUnsettledContentHashes()) return false
		this.#artifactFiles = walkArtifactFiles(this.thumbnailDirectory, this.logger)
		return true
	}

	async #hasUnsettledContentHashes() {
		return this.#readDatabase(
			async (database) =>
				Boolean(
					await database
						.prepare(
							`SELECT 1 FROM index_roots
							WHERE ${BACKGROUND_ENRICHMENT_ROOT_SQL}
								AND EXISTS (
									SELECT 1 FROM entries AS candidate INDEXED BY entries_pending_content_hash
									WHERE candidate.root_id = index_roots.id
										AND candidate.thumbnail_identity_kind = 'content'
										AND candidate.content_id IS NULL
										AND candidate.hash_error IS NULL
								)
							LIMIT 1`,
						)
						.get(),
				),
			BACKGROUND_DATABASE_PRIORITY,
		)
	}

	async #nextReadyThumbnails(after: {variant: string; contentId: number}) {
		return this.#readDatabase(async (database) => {
			const rows = (await database
				.prepare(
					`SELECT thumbnail_variants.content_id, thumbnail_variants.variant, hex(contents.blake3) AS hash
						FROM thumbnail_variants
						JOIN contents ON contents.id = thumbnail_variants.content_id
						WHERE thumbnail_variants.variant IN (${ALL_THUMBNAIL_VARIANTS.map(() => '?').join(', ')})
							AND thumbnail_variants.state = 'ready'
							AND (thumbnail_variants.variant > ? OR
								(thumbnail_variants.variant = ? AND thumbnail_variants.content_id > ?))
						ORDER BY thumbnail_variants.variant, thumbnail_variants.content_id
						LIMIT ?`,
				)
				.all(
					...ALL_THUMBNAIL_VARIANTS,
					after.variant,
					after.variant,
					after.contentId,
					ARTIFACT_MAINTENANCE_BATCH_SIZE,
				)) as Array<{
				content_id: number
				variant: ThumbnailVariant
				hash: string
			}>
			return rows.map(
				(row) =>
					({
						contentId: Number(row.content_id),
						key: row.hash.toLowerCase(),
						variant: row.variant,
					}) satisfies ReadyThumbnail,
			)
		}, BACKGROUND_DATABASE_PRIORITY)
	}

	async #markThumbnailPending(references: Array<{contentId: number; variant: ThumbnailVariant}>, priority: number) {
		if (references.length === 0) return
		await this.#withDatabase((database) => {
			const update = database.prepare(
				`UPDATE thumbnail_variants SET
						state = 'pending', failure_count = 0, retry_at = NULL,
						last_error = NULL, created_at = NULL, updated_at = ?
					WHERE content_id = ? AND variant = ?`,
			)
			const mark = database.transaction(() => {
				for (const {contentId, variant} of references) update.run(Date.now(), contentId, variant)
			})
			mark.immediate()
		}, priority)
	}

	async #trackedContentHashes(hashes: string[]) {
		if (hashes.length === 0) return new Set<string>()
		return this.#readDatabase(async (database) => {
			const unique = [...new Set(hashes)]
			const placeholders = unique.map(() => '?').join(', ')
			const rows = (await database
				.prepare(
					`SELECT hex(blake3) AS hash FROM contents
					WHERE blake3 IN (${placeholders})`,
				)
				.all(...unique.map((hash) => Buffer.from(hash, 'hex')))) as Array<{hash: string}>
			return new Set(rows.map(({hash}) => hash.toLowerCase()))
		}, BACKGROUND_DATABASE_PRIORITY)
	}

	async #trackedTransientArtifactKeys(keys: string[]) {
		if (keys.length === 0) return new Set<string>()
		return this.#readDatabase(async (database) => {
			const unique = [...new Set(keys)]
			const placeholders = unique.map(() => '?').join(', ')
			const rows = (await database
				.prepare(
					`SELECT DISTINCT artifact_key FROM transient_thumbnail_variants
						WHERE artifact_key IN (${placeholders})`,
				)
				.all(...unique)) as Array<{artifact_key: string}>
			return new Set(rows.map(({artifact_key}) => artifact_key))
		}, BACKGROUND_DATABASE_PRIORITY)
	}

	async #thumbnailIdentityIsTracked(identity: ThumbnailIdentity) {
		return this.#readDatabase(async (database) => {
			if (identity.kind === 'content') {
				return Boolean(
					await database
						.prepare(
							`SELECT 1 FROM thumbnail_variants
							JOIN contents ON contents.id = thumbnail_variants.content_id
							WHERE contents.blake3 = ? AND thumbnail_variants.variant = ?`,
						)
						.get(Buffer.from(identity.key, 'hex'), identity.variant),
				)
			}
			return Boolean(
				await database
					.prepare('SELECT 1 FROM transient_thumbnail_variants WHERE artifact_key = ? AND variant = ?')
					.get(identity.key, identity.variant),
			)
		}, BACKGROUND_DATABASE_PRIORITY)
	}
}

type EntryCandidateRow = {
	id: number
	device: string
	inode: string
	size: number
	modified_ns: string
	ctime_ns: string
	thumbnail_identity_kind: ThumbnailIdentityKind
	root_system_path: string
	relative_path: string
}

type ContentCandidateRow = Omit<EntryCandidateRow, 'id'> & {id: number; entry_id: number; hash: string}
type ContentThumbnailCandidateRow = ContentCandidateRow & {variant: ThumbnailVariant}

function entryCandidate(row: EntryCandidateRow): EntryCandidate {
	return {
		id: Number(row.id),
		device: row.device,
		inode: row.inode,
		size: Number(row.size),
		modifiedNs: row.modified_ns,
		ctimeNs: row.ctime_ns,
		thumbnailIdentityKind: row.thumbnail_identity_kind,
		systemPath: nodePath.join(row.root_system_path, ...row.relative_path.split('/')),
	}
}

function contentCandidate(row: ContentCandidateRow): ContentCandidate {
	return {
		id: Number(row.id),
		entryId: Number(row.entry_id),
		hash: row.hash.toLowerCase(),
		systemPath: nodePath.join(row.root_system_path, ...row.relative_path.split('/')),
		fingerprint: {
			inode: row.inode,
			size: Number(row.size),
			modifiedNs: row.modified_ns,
		},
	}
}

export async function hashFileRevision(systemPath: string, expected: ContentFingerprint) {
	const handle = await open(systemPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK)
	try {
		await assertHandleContentRevision(handle, expected)
		const hasher = new Blake3Hasher()
		for await (const chunk of handle.createReadStream({autoClose: false, highWaterMark: 1024 * 1024})) {
			hasher.update(chunk)
		}
		await assertHandleContentRevision(handle, expected)
		return hasher.digestBuffer()
	} finally {
		await handle.close()
	}
}

async function assertContentRevision(systemPath: string, expected: ContentFingerprint) {
	const handle = await openContentRevision(systemPath, expected)
	await handle.close()
}

async function openContentRevision(systemPath: string, expected: ContentFingerprint) {
	const handle = await open(systemPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK)
	try {
		await assertHandleContentRevision(handle, expected)
		return handle
	} catch (error) {
		await handle.close().catch(() => {})
		throw error
	}
}

export async function assertPublishedRevision(systemPath: string, expected: PublishedFileRevision) {
	const handle = await open(systemPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK)
	try {
		const stats = await handle.stat({bigint: true})
		if (
			!stats.isFile() ||
			stats.ino.toString() !== expected.inode ||
			Number(stats.size) !== expected.size ||
			stats.mtimeNs.toString() !== expected.modifiedNs ||
			stats.ctimeNs.toString() !== expected.ctimeNs
		) {
			throw new StaleFileRevisionError('Published upload revision no longer matches the file')
		}
	} finally {
		await handle.close()
	}
}

async function assertHandleContentRevision(handle: Awaited<ReturnType<typeof open>>, expected: ContentFingerprint) {
	const stats = await handle.stat({bigint: true})
	if (
		!stats.isFile() ||
		stats.ino.toString() !== expected.inode ||
		Number(stats.size) !== expected.size ||
		stats.mtimeNs.toString() !== expected.modifiedNs
	) {
		throw new StaleFileRevisionError('File revision no longer matches the index')
	}
}

function samePublishedRevision(left: EntryCandidate, right: PublishedFileRevision) {
	return (
		left.inode === right.inode &&
		left.size === right.size &&
		left.modifiedNs === right.modifiedNs &&
		left.ctimeNs === right.ctimeNs
	)
}

async function openTransientRevision(systemPath: string, expected: EntryCandidate) {
	const handle = await open(systemPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK)
	try {
		await assertHandleTransientRevision(handle, expected)
		return handle
	} catch (error) {
		await handle.close().catch(() => {})
		throw error
	}
}

async function assertHandleTransientRevision(handle: Awaited<ReturnType<typeof open>>, expected: EntryCandidate) {
	const stats = await handle.stat({bigint: true})
	if (
		!stats.isFile() ||
		stats.dev.toString() !== expected.device ||
		stats.ino.toString() !== expected.inode ||
		Number(stats.size) !== expected.size ||
		stats.mtimeNs.toString() !== expected.modifiedNs
	) {
		throw new StaleFileRevisionError('File revision no longer matches the index')
	}
}

async function contentReferenceFailure(error: unknown, content: ContentCandidate) {
	// Only our revision guard can classify the original error as stale. An
	// artifact-side ENOENT/EIO can otherwise look exactly like a missing source
	// and would be retried immediately without recording backoff.
	if (error instanceof StaleFileRevisionError) return 'stale'
	try {
		await assertContentRevision(content.systemPath, content.fingerprint)
	} catch (revisionError) {
		return referenceFailureKind(revisionError)
	}
}

function referenceFailureKind(error: unknown): 'stale' | 'unreadable' | undefined {
	if (error instanceof StaleFileRevisionError) return 'stale'
	const code = (error as NodeJS.ErrnoException | undefined)?.code
	if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ESTALE') return 'stale'
	if (code === 'EACCES' || code === 'EPERM' || code === 'EIO') return 'unreadable'
}

function persistedFailureMessage(error: unknown, referenceFailure: boolean) {
	return `${referenceFailure ? REFERENCE_FAILURE_PREFIX : ''}${errorMessage(error)}`
}

function referenceFailureMessage(message: string | null) {
	return message?.startsWith(REFERENCE_FAILURE_PREFIX) ?? false
}

export async function extractMediaMetadata(
	systemPath: string,
	sourceFileDescriptor?: number,
	onOptionalMetadataFailure?: (error: unknown) => void,
): Promise<MediaMetadata> {
	const kind = photoKind(systemPath)
	if (!kind) throw new Error('Unsupported media source')
	if (kind === 'video') return extractVideoMetadata(systemPath, sourceFileDescriptor, onOptionalMetadataFailure)
	return extractPhotoMetadata(systemPath, sourceFileDescriptor)
}

async function extractPhotoMetadata(systemPath: string, sourceFileDescriptor?: number): Promise<MediaMetadata> {
	const {metadata, imageWidth, imageHeight, orientation, spherical} = await extractExifMetadata(
		systemPath,
		sourceFileDescriptor,
	)
	if (imageWidth === undefined || imageHeight === undefined) throw new Error('Photo has no valid image dimensions')
	let width = imageWidth
	let height = imageHeight
	if ([5, 6, 7, 8].includes(orientation ?? 0)) [width, height] = [height, width]
	const subKind: PhotoSubKind | undefined = spherical
		? 'spherical'
		: width / Math.max(1, height) >= 2
			? 'panorama'
			: undefined
	return {
		kind: 'photo',
		...(subKind ? {subKind} : {}),
		width,
		height,
		...metadata,
	}
}

async function extractVideoMetadata(
	systemPath: string,
	sourceFileDescriptor?: number,
	onOptionalMetadataFailure?: (error: unknown) => void,
): Promise<MediaMetadata> {
	// FFprobe is authoritative only for the playable video stream. ExifTool owns
	// semantic metadata for every media type, but remains optional for videos: an
	// unusual vendor trailer must never make otherwise playable media disappear.
	const [{stdout}, exifMetadata] = await Promise.all([
		runBoundedMediaProcess(
			'ffprobe',
			[
				'-v',
				'error',
				'-show_entries',
				'stream=codec_type,width,height,duration:stream_tags=rotate:stream_side_data=rotation,crop_top,crop_bottom,crop_left,crop_right:format=duration',
				'-of',
				'json',
				mediaProcessInput(systemPath, sourceFileDescriptor),
			],
			sourceFileDescriptor,
		),
		extractExifMetadata(systemPath, sourceFileDescriptor).catch((error) => {
			onOptionalMetadataFailure?.(error)
			return {metadata: {}, spherical: false}
		}),
	])
	const probe = JSON.parse(stdout) as {
		streams?: Array<{
			codec_type?: string
			width?: number
			height?: number
			duration?: string
			tags?: Record<string, string>
			side_data_list?: Array<{
				rotation?: number | string
				crop_top?: number | string
				crop_bottom?: number | string
				crop_left?: number | string
				crop_right?: number | string
			}>
		}>
		format?: {duration?: string}
	}
	const stream = probe.streams?.find(({codec_type}) => codec_type === 'video')
	if (!stream?.width || !stream.height) throw new Error('Video has no decodable video stream')
	const sideDataRotation = stream.side_data_list?.map(({rotation}) => Number(rotation)).find(Number.isFinite)
	const rotation = sideDataRotation ?? Number(stream.tags?.rotate ?? 0)
	const cropLeft = sideDataValue(stream.side_data_list, 'crop_left') ?? 0
	const cropRight = sideDataValue(stream.side_data_list, 'crop_right') ?? 0
	const cropTop = sideDataValue(stream.side_data_list, 'crop_top') ?? 0
	const cropBottom = sideDataValue(stream.side_data_list, 'crop_bottom') ?? 0
	const croppedWidth = stream.width - cropLeft - cropRight
	const croppedHeight = stream.height - cropTop - cropBottom
	const displayWidth = croppedWidth > 0 ? croppedWidth : stream.width
	const displayHeight = croppedHeight > 0 ? croppedHeight : stream.height
	const rotated = Math.abs(rotation) % 180 === 90
	const width = rotated ? displayHeight : displayWidth
	const height = rotated ? displayWidth : displayHeight
	const durationSeconds = [stream.duration, probe.format?.duration].map(Number).find(Number.isFinite)
	return {
		kind: 'video',
		...(exifMetadata.spherical ? {subKind: 'spherical' as const} : {}),
		width,
		height,
		...(durationSeconds === undefined ? {} : {durationMs: Math.max(0, Math.round(durationSeconds * 1000))}),
		...exifMetadata.metadata,
	}
}

type ExtractedExifMetadata = {
	metadata: Omit<Partial<MediaMetadata>, 'kind' | 'subKind' | 'width' | 'height' | 'durationMs'>
	imageWidth?: number
	imageHeight?: number
	orientation?: number
	spherical: boolean
}

async function extractExifMetadata(systemPath: string, sourceFileDescriptor?: number): Promise<ExtractedExifMetadata> {
	const extension = nodePath.extname(systemPath).toLowerCase()
	const extractEmbedded = extension === '.insv'
	const cameraRaw = CAMERA_RAW_EXTENSIONS.has(extension)
	// A normal QuickTime scan must decode the Apple VideoKeys table before leaf
	// requests can select from it. Camera RAW also needs its full dependency scan
	// so Composite:ImageSize resolves the primary image rather than an IFD0 preview.
	// IgnoreTags=all remains useful for ordinary photos and the much larger INSV
	// embedded-document scan.
	const ignoreUnrequestedTags = (photoKind(systemPath) === 'photo' && !cameraRaw) || extractEmbedded
	const {stdout} = await runBoundedMediaProcess(
		'exiftool',
		[
			'-j',
			'-n',
			'-G1:2',
			'-a',
			'-api',
			'LargeFileSupport=1',
			...(ignoreUnrequestedTags ? ['-api', 'IgnoreTags=all'] : []),
			...(extractEmbedded ? ['-ee'] : []),
			'-ImageWidth',
			'-ImageHeight',
			'-ImageSize',
			'-Orientation',
			'-DateTimeOriginal',
			'-OffsetTimeOriginal',
			'-CreationDate',
			'-CreateDate',
			'-OffsetTimeDigitized',
			'-MediaCreateDate',
			'-ModifyDate',
			'-OffsetTime',
			'-Make',
			'-Model',
			'-AndroidMake',
			'-AndroidModel',
			'-Lens',
			'-LensModel',
			'-FocalLength',
			'-FocalLengthIn35mmFormat',
			'-FNumber',
			'-CameraLensIrisfnumber',
			'-ExposureTime',
			'-ISO',
			'-PhotographicSensitivity',
			'-GPSLatitude',
			'-GPSLongitude',
			'-GPSAltitude',
			'-GPSLatitudeRef',
			'-GPSLongitudeRef',
			'-GPSAltitudeRef',
			'-GPSCoordinates',
			'-ProjectionType',
			'-Spherical',
			'-ContentIdentifier',
			'-UserComment',
			mediaProcessInput(systemPath, sourceFileDescriptor),
		],
		sourceFileDescriptor,
	)
	const parsed = JSON.parse(stdout) as unknown
	if (!Array.isArray(parsed) || !isMetadataRecord(parsed[0])) return {metadata: {}, spherical: false}
	const tags = parsed[0]
	const takenDate = selectTakenDate([
		[metadataTag(tags, ['DateTimeOriginal']), metadataTag(tags, ['OffsetTimeOriginal'])],
		[metadataTag(tags, ['CreationDate']), undefined],
		[metadataTag(tags, ['CreateDate']), metadataTag(tags, ['OffsetTimeDigitized'])],
		[metadataTag(tags, ['MediaCreateDate']), undefined],
		[metadataTag(tags, ['ModifyDate']), metadataTag(tags, ['OffsetTime'])],
	])
	const cameraMake = cameraTag(tags, ['Make', 'AndroidMake'])
	const cameraModel = cameraTag(tags, ['Model', 'AndroidModel'])
	const lens = meaningfulLens(cameraTag(tags, ['LensModel', 'Lens'], true))
	const focalLength =
		meaningfulNumber(cameraTag(tags, ['FocalLength'], true)) ??
		meaningfulNumber(metadataTag(tags, ['FocalLengthIn35mmFormat']))
	const aperture =
		meaningfulNumber(cameraTag(tags, ['FNumber'], true)) ??
		meaningfulNumber(normalizeIrisFNumber(metadataTag(tags, ['CameraLensIrisfnumber'])))
	const exposure = meaningfulNumber(cameraTag(tags, ['ExposureTime'], true))
	const iso = optionalPositiveInteger(metadataTag(tags, ['PhotographicSensitivity', 'ISO'], ['Camera', 'Image']))
	const coordinates = parseGpsCoordinates(metadataTag(tags, ['GPSCoordinates']))
	const latitude = numericMetadataTag(tags, ['GPSLatitude'], ['Composite']) ?? coordinates?.latitude
	const longitude = numericMetadataTag(tags, ['GPSLongitude'], ['Composite']) ?? coordinates?.longitude
	// QuickTime's GPSAltitude composite is absolute even when GPSCoordinates
	// carries a signed below-sea-level value, so keep the tuple authoritative.
	const altitude = coordinates?.altitude ?? numericMetadataTag(tags, ['GPSAltitude'], ['Composite'])
	const hasLocation =
		latitude !== undefined &&
		longitude !== undefined &&
		Math.abs(latitude) <= 90 &&
		Math.abs(longitude) <= 180 &&
		(latitude !== 0 || longitude !== 0)
	const projection = metadataTag(tags, ['ProjectionType'])?.toLowerCase()
	const sphericalValue = metadataTag(tags, ['Spherical'])?.toLowerCase()
	const spherical =
		projection?.includes('equirect') === true ||
		matroskaEquirectangularProjection(tags) ||
		['1', 'true', 'yes', 'spherical'].includes(sphericalValue ?? '')
	const userComment = cleanUserComment(metadataTag(tags, ['UserComment']))
	const liveIdentifier = metadataTag(tags, ['ContentIdentifier'], ['Image', 'Other'])
	const imageSize = parseImageSize(metadataTag(tags, ['ImageSize'], ['Image'], ['Composite']))
	return {
		metadata: {
			...(takenDate ? {takenAt: takenDate.takenAt, createdAt: takenDate.takenAt} : {}),
			...(takenDate?.offsetMinutes === undefined ? {} : {takenAtOffsetMinutes: takenDate.offsetMinutes}),
			...(cameraMake ? {cameraMake} : {}),
			...(cameraModel ? {cameraModel} : {}),
			...(lens ? {lens} : {}),
			...(focalLength ? {focalLength: formatFocalLength(focalLength)} : {}),
			...(aperture ? {aperture: formatAperture(aperture)} : {}),
			...(exposure ? {exposure: formatExposure(exposure)} : {}),
			...(iso === undefined ? {} : {iso}),
			...(hasLocation ? {latitude, longitude} : {}),
			...(!hasLocation || altitude === undefined ? {} : {altitude}),
			...(userComment ? {userComment} : {}),
			...(liveIdentifier ? {liveIdentifier} : {}),
		},
		imageWidth:
			imageSize?.width ??
			optionalPositiveInteger(metadataTag(tags, ['ImageWidth'], undefined, ['File', 'IFD0', 'ExifIFD'])),
		imageHeight:
			imageSize?.height ??
			optionalPositiveInteger(metadataTag(tags, ['ImageHeight'], undefined, ['File', 'IFD0', 'ExifIFD'])),
		orientation: optionalPositiveInteger(metadataTag(tags, ['Orientation'])),
		spherical,
	}
}

function isMetadataRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function metadataTag(
	tags: Record<string, unknown>,
	names: string[],
	allowedFamily2?: string[],
	preferredFamily1?: string[],
) {
	for (const name of names) {
		const entries = Object.entries(tags).filter(([qualifiedName]) => qualifiedName.split(':').at(-1) === name)
		if (preferredFamily1) {
			const rank = (qualifiedName: string) => {
				const index = preferredFamily1.indexOf(qualifiedName.split(':')[0] ?? '')
				return index < 0 ? preferredFamily1.length : index
			}
			entries.sort(([left], [right]) => rank(left) - rank(right))
		}
		for (const [qualifiedName, value] of entries) {
			const [, family2, tagName] = qualifiedName.split(':')
			if (tagName !== name) continue
			if (allowedFamily2 && !allowedFamily2.includes(family2 ?? '')) continue
			if (typeof value !== 'string' && typeof value !== 'number') continue
			const cleaned = cleanMetadataValue(String(value))
			if (cleaned) return cleaned
		}
	}
}

function cameraTag(tags: Record<string, unknown>, names: string[], allowImageGroup = false) {
	for (const name of names) {
		for (const [qualifiedName, value] of Object.entries(tags)) {
			const [family1, family2, tagName] = qualifiedName.split(':')
			if (tagName !== name) continue
			const knownQuickTimeCameraTag =
				(family1 === 'Keys' && ['Make', 'Model', 'AndroidMake', 'AndroidModel'].includes(tagName)) ||
				(['ItemList', 'UserData'].includes(family1 ?? '') && ['Make', 'Model'].includes(tagName))
			if (family2 !== 'Camera' && !(allowImageGroup && family2 === 'Image') && !knownQuickTimeCameraTag) continue
			if (typeof value !== 'string' && typeof value !== 'number') continue
			const cleaned = cleanMetadataValue(String(value))
			if (cleaned) return cleaned
		}
	}
}

function numericMetadataTag(tags: Record<string, unknown>, names: string[], preferredFamily1?: string[]) {
	const value = Number(metadataTag(tags, names, undefined, preferredFamily1))
	return Number.isFinite(value) ? value : undefined
}

function parseImageSize(value: string | undefined) {
	const match = /^(\d+)\s*(?:x|\s)\s*(\d+)$/i.exec(value ?? '')
	if (!match) return
	const width = optionalPositiveInteger(match[1])
	const height = optionalPositiveInteger(match[2])
	return width === undefined || height === undefined ? undefined : {width, height}
}

function matroskaEquirectangularProjection(tags: Record<string, unknown>) {
	return Object.entries(tags).some(([qualifiedName, value]) => {
		const [family1, , tagName] = qualifiedName.split(':')
		return family1 === 'Matroska' && tagName === 'ProjectionType' && Number(value) === 1
	})
}

function cleanMetadataValue(value: string) {
	const cleaned = value.trim()
	return !cleaned || cleaned === 'undefined' ? undefined : cleaned
}

function optionalPositiveInteger(value: string | number | undefined) {
	const parsed = Math.round(Number(value))
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function parseOffsetMinutes(value: string | undefined) {
	const match = /^([+-])(\d{2}):(\d{2})$/.exec(value ?? '')
	if (!match) return
	const hours = Number(match[2])
	const minutePart = Number(match[3])
	if (hours > 23 || minutePart > 59) return
	const minutes = hours * 60 + minutePart
	return match[1] === '-' ? -minutes : minutes
}

function parseExifDate(value: string | undefined, offset: string | undefined) {
	const match = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$/.exec(
		value ?? '',
	)
	if (!match) return
	const [year, month, day, hour, minute, second] = match.slice(1).map(Number)
	const milliseconds = match[7] ? Math.floor(Number(`0.${match[7]}`) * 1000) : 0
	const localTime = Date.UTC(year!, month! - 1, day, hour, minute, second, milliseconds)
	const localDate = new Date(localTime)
	if (
		localDate.getUTCFullYear() !== year ||
		localDate.getUTCMonth() !== month! - 1 ||
		localDate.getUTCDate() !== day ||
		localDate.getUTCHours() !== hour ||
		localDate.getUTCMinutes() !== minute ||
		localDate.getUTCSeconds() !== second ||
		localDate.getUTCMilliseconds() !== milliseconds
	)
		return
	const inlineOffset = match[8]
	const offsetMinutes =
		parseOffsetMinutes(offset) ?? (inlineOffset?.toUpperCase() === 'Z' ? 0 : parseOffsetMinutes(inlineOffset))
	return {takenAt: localTime - (offsetMinutes ?? 0) * 60_000, offsetMinutes}
}

function selectTakenDate(candidates: Array<[string | undefined, string | undefined]>) {
	for (const [date, offset] of candidates) {
		const parsed = parseExifDate(date, offset)
		if (parsed) return parsed
	}
}

function parseRational(value: string | undefined) {
	if (!value) return
	const [numerator, denominator = '1'] = value.split('/')
	const parsed = Number(numerator) / Number(denominator)
	return Number.isFinite(parsed) ? parsed : undefined
}

function meaningfulLens(value: string | undefined) {
	if (!value || /^0(?:\.0+)?-0(?:\.0+)?mm\s+f\/0(?:\.0+)?-0(?:\.0+)?$/i.test(value)) return
	return value
}

function meaningfulNumber(value: string | undefined) {
	const parsed = parseRational(value)
	return parsed !== undefined && parsed > 0 ? value : undefined
}

function normalizeIrisFNumber(value: string | undefined) {
	return value?.replace(/^f\/?\s*/i, '')
}

function parseGpsCoordinates(value: string | undefined) {
	const parts = value
		?.trim()
		.split(/[,\s]+/)
		.map(Number)
	if (!parts || (parts.length !== 2 && parts.length !== 3) || parts.some((part) => !Number.isFinite(part))) return
	return {
		latitude: parts[0]!,
		longitude: parts[1]!,
		...(parts[2] === undefined ? {} : {altitude: parts[2]}),
	}
}

function cleanUserComment(value: string | undefined) {
	const normalized = value?.replace(/\0+$/u, '').normalize('NFC').trim()
	if (!normalized || normalized.includes('\0') || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized))
		return
	return normalized
}

function sideDataValue(
	sideData:
		| Array<{
				rotation?: number | string
				crop_top?: number | string
				crop_bottom?: number | string
				crop_left?: number | string
				crop_right?: number | string
		  }>
		| undefined,
	name: 'crop_top' | 'crop_bottom' | 'crop_left' | 'crop_right',
) {
	const value = sideData
		?.map((entry) => Number(entry[name]))
		.find((candidate) => Number.isFinite(candidate) && candidate >= 0)
	return value === undefined ? undefined : Math.round(value)
}

function formatFocalLength(value: string) {
	const parsed = parseRational(value)
	return parsed === undefined ? value : `${Number(parsed.toFixed(1))}mm`
}

function formatAperture(value: string) {
	const parsed = parseRational(value)
	return parsed === undefined ? value : `ƒ/${Number(parsed.toFixed(1))}`
}

function formatExposure(value: string) {
	const parsed = parseRational(value)
	if (parsed === undefined || parsed <= 0) return value
	if (parsed >= 1) return `${Number(parsed.toFixed(1))}s`
	return `1/${Math.round(1 / parsed)}`
}

export async function generateThumbnailFile(
	systemPath: string,
	destination: string,
	variant: ThumbnailVariant = FILES_THUMBNAIL_VARIANT,
	sourceFileDescriptor?: number,
) {
	return generateThumbnailFiles(systemPath, [{destination, variant}], sourceFileDescriptor)
}

export async function generateThumbnailFiles(
	systemPath: string,
	outputs: ThumbnailOutput[],
	sourceFileDescriptor?: number,
) {
	if (outputs.length === 0) return
	const arguments_ = [
		'-limit',
		'memory',
		String(THUMBNAIL_MEMORY_LIMIT_BYTES),
		'-limit',
		'map',
		String(THUMBNAIL_MAP_LIMIT_BYTES),
		'-limit',
		'disk',
		String(THUMBNAIL_DISK_LIMIT_BYTES),
		'-limit',
		'thread',
		String(THUMBNAIL_THREAD_LIMIT),
		'-limit',
		'time',
		String(Math.ceil(THUMBNAIL_GENERATION_TIMEOUT_MS / 1000)),
		`${escapeImageMagickInputPath(imageMagickMediaProcessInput(systemPath, sourceFileDescriptor))}[0]`,
		'-auto-orient',
	]
	for (const {destination, variant} of outputs) {
		const definition = THUMBNAIL_VARIANTS[variant]
		arguments_.push(
			'(',
			'+clone',
			'-thumbnail',
			`${definition.width}x${definition.height}^>`,
			'-quality',
			String(definition.quality),
			'-write',
			`${definition.format}:${destination}`,
			'+delete',
			')',
		)
	}
	arguments_.push('null:')
	await runBoundedMediaProcess('convert', arguments_, sourceFileDescriptor)
}

export async function extractThumbnailTint(thumbnailPath: string) {
	const {stdout} = await execa('convert', [
		escapeImageMagickInputPath(thumbnailPath),
		'-resize',
		'1x1!',
		'-format',
		'%[fx:round(255*r)],%[fx:round(255*g)],%[fx:round(255*b)]',
		'info:',
	])
	const channels = stdout.split(',').map(Number)
	if (channels.length !== 3 || channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
		throw new Error('ImageMagick returned an invalid thumbnail tint')
	}
	return (channels[0]! << 16) | (channels[1]! << 8) | channels[2]!
}

function escapeImageMagickInputPath(systemPath: string) {
	// ImageMagick expands these characters itself even though execa bypasses the
	// shell. Escape only the subprocess argument; the real filesystem path and
	// the intentional first-frame selector appended by the caller stay unchanged.
	// Backslashes are legal Linux filename characters and are preserved unless
	// they precede a glob character. In that case ImageMagick needs 2n+1
	// backslashes to represent n literal backslashes followed by an escaped glob.
	let escaped = ''
	let backslashes = 0
	for (const character of systemPath) {
		if (character === '\\') {
			backslashes++
			continue
		}
		if (character === '*' || character === '?' || character === '[' || character === ']') {
			escaped += `${'\\'.repeat(2 * backslashes + 1)}${character}`
		} else {
			escaped += `${'\\'.repeat(backslashes)}${character === '%' ? '%%' : character}`
		}
		backslashes = 0
	}
	return escaped + '\\'.repeat(backslashes)
}

function killProcessGroup(pid: number) {
	try {
		process.kill(-pid, 'SIGKILL')
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
	}
}

function mediaProcessInput(systemPath: string, sourceFileDescriptor?: number) {
	return sourceFileDescriptor === undefined ? systemPath : '/dev/fd/3'
}

function imageMagickMediaProcessInput(systemPath: string, sourceFileDescriptor?: number) {
	const input = mediaProcessInput(systemPath, sourceFileDescriptor)
	if (sourceFileDescriptor === undefined) return input
	// Most still-image formats can be sniffed from a pathless descriptor. Camera
	// RAW and video formats need an explicit coder to select the full decoder once
	// the filename extension is no longer present.
	const coder = IMAGE_MAGICK_MEDIA_CODERS.get(nodePath.extname(systemPath).toLowerCase())
	return `${coder ? `${coder}:` : ''}${input}`
}

async function runBoundedMediaProcess(command: string, arguments_: string[], sourceFileDescriptor?: number) {
	const process = execa(command, arguments_, {
		detached: true,
		timeout: THUMBNAIL_GENERATION_TIMEOUT_MS,
		killSignal: 'SIGKILL',
		...(sourceFileDescriptor === undefined ? {} : {stdio: ['ignore', 'pipe', 'pipe', sourceFileDescriptor]}),
	})
	try {
		return await process
	} catch (error) {
		if ((error as {timedOut?: boolean}).timedOut && process.pid !== undefined) killProcessGroup(process.pid)
		throw error
	}
}

async function thumbnailArtifactIsUsable(systemPath: string) {
	let handle: Awaited<ReturnType<typeof open>>
	try {
		handle = await open(systemPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP') return false
		throw error
	}
	try {
		const stats = await handle.stat()
		return stats.isFile() && stats.size > 0
	} finally {
		await handle.close()
	}
}

async function syncThumbnailArtifact(systemPath: string) {
	const handle = await open(systemPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
	try {
		const stats = await handle.stat()
		if (!stats.isFile() || stats.size === 0)
			throw new Error('Thumbnail generator produced an empty or invalid artifact')
		await handle.sync()
	} finally {
		await handle.close()
	}
}

async function syncDirectory(systemPath: string) {
	const handle = await open(systemPath, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY)
	try {
		await handle.sync()
	} finally {
		await handle.close()
	}
}

function retryDelay(base: number, failureCount: number) {
	return Math.min(base * 2 ** Math.max(0, failureCount - 1), MAX_RETRY_MS)
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

function contentIdentity(key: string, variant: ThumbnailVariant): ThumbnailIdentity {
	return {kind: 'content', key, variant}
}

function transientArtifactKey(candidate: EntryCandidate) {
	return createHash('sha256')
		.update(
			JSON.stringify([
				'transient-thumbnail-v1',
				candidate.device,
				candidate.inode,
				candidate.size,
				candidate.modifiedNs,
			]),
		)
		.digest('hex')
}

function transientIdentity(candidate: EntryCandidate, variant: ThumbnailVariant): ThumbnailIdentity {
	return {kind: 'transient', key: transientArtifactKey(candidate), variant}
}

function contentThumbnailReference(key: string, variant: ThumbnailVariant): ThumbnailReference {
	return {kind: 'content', key, variant, format: THUMBNAIL_FORMAT}
}

function transientThumbnailReference(key: string, variant: ThumbnailVariant): ThumbnailReference {
	return {kind: 'transient', key, variant, format: THUMBNAIL_FORMAT}
}

function storedThumbnailIdentity(thumbnailDirectory: string, systemPath: string): ThumbnailIdentity | undefined {
	const parts = nodePath.relative(thumbnailDirectory, systemPath).split(nodePath.sep)
	if (parts.length !== 4 || (parts[0] !== 'content' && parts[0] !== 'transient')) return
	if (!isThumbnailVariant(parts[1])) return
	const match = /^([a-f0-9]{64})\.webp$/.exec(parts[3])
	if (!match) return
	const key = match[1]
	if (parts[2] !== key.slice(0, 2)) return
	return {kind: parts[0], key, variant: parts[1]}
}

async function isRecentTemporaryArtifact(systemPath: string) {
	if (!nodePath.basename(systemPath).includes('.tmp-')) return false
	try {
		const stats = await fse.lstat(systemPath)
		return stats.isFile() && Date.now() - stats.mtimeMs < TEMPORARY_ARTIFACT_GRACE_MS
	} catch {
		return false
	}
}

async function* walkArtifactFiles(directoryPath: string, logger: FileIndexEnrichmentLogger): AsyncGenerator<string> {
	let directory: Awaited<ReturnType<typeof opendir>>
	try {
		directory = await opendir(directoryPath)
	} catch (error) {
		logger.error(`Failed to inspect thumbnail artifact directory '${directoryPath}'`, error)
		return
	}

	try {
		for await (const entry of directory) {
			const systemPath = nodePath.join(directoryPath, entry.name)
			if (entry.isDirectory() && !entry.isSymbolicLink()) {
				yield* walkArtifactFiles(systemPath, logger)
			} else {
				yield systemPath
			}
		}
	} catch (error) {
		logger.error(`Failed while inspecting thumbnail artifact directory '${directoryPath}'`, error)
	}
}

async function inConcurrentChunks<T>(items: T[], concurrency: number, operation: (item: T) => Promise<void>) {
	for (let index = 0; index < items.length; index += concurrency) {
		await Promise.all(items.slice(index, index + concurrency).map(operation))
	}
}
