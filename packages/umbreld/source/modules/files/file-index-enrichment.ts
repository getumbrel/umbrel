import {constants as fsConstants, fstat, read} from 'node:fs'
import {mkdir, open, opendir, readFile, writeFile} from 'node:fs/promises'
import {availableParallelism as nodeAvailableParallelism} from 'node:os'
import nodePath from 'node:path'
import {createHash, randomUUID} from 'node:crypto'
import {promisify} from 'node:util'

import type DatabaseTypes from 'better-sqlite3'
import {$, type ExecaChildProcess, type Options as ExecaOptions} from 'execa'
import fse from 'fs-extra'
import PQueue from 'p-queue'

import {photoKind, type PhotoKind, type PhotoSubKind} from '../photos/types.ts'
import {GiB, sandboxed} from '../utilities/sandbox.ts'
import {readDatabase, type ReadDatabase, type ReadLane, type ReadSql} from './file-index/read-database.ts'
import {BACKGROUND_DATABASE_PRIORITY, ON_DEMAND_DATABASE_PRIORITY} from './file-index/database-priority.ts'
import {Blake3Hasher} from './blake3.ts'
import {embeddingsDatabasePath, openEmbeddingsStore, type StoredPassage} from './embeddings-store.ts'
import type EmbeddingsStore from './embeddings-store.ts'
import ModelDownloads, {modelsDirectory} from './models.ts'
import {memoryRoom} from './memory-room.ts'
import {places} from './places.ts'
import {DOCUMENT_TEXT_SCRIPT, passages, readableKind, plainText, spokenPassages} from './readable.ts'
import {
	embedImage,
	embedPassage,
	searchModelOn,
	embeddingsAvailable,
	EmbeddingsUnavailableError,
	findFaces,
	ModelWentAwayError,
	readText,
	transcribe,
	videoMoments,
	type FoundFace,
	type VideoMoment,
} from './embeddings.ts'
import {foldSearchName} from './file-index/migrations.ts'
import {
	FILES_THUMBNAIL_VARIANT,
	PHOTOS_THUMBNAIL_VARIANTS,
	SUPPORTED_THUMBNAIL_EXTENSIONS,
	THUMBNAIL_FORMAT,
	THUMBNAIL_VARIANTS,
	isThumbnailVariant,
	thumbnailSystemPath,
	type ThumbnailIdentity,
	type ThumbnailIdentityKind,
	type ThumbnailVariant,
} from './thumbnail-support.ts'

type Database = DatabaseTypes.Database

const HASH_RETRY_BASE_MS = 30_000
const THUMBNAIL_RETRY_BASE_MS = 60_000
const MAX_RETRY_MS = 24 * 60 * 60 * 1000
// Content that fails to decode is retried after a minute, an hour and a day,
// then left alone until its bytes change or umbreld is updated. Unreadable
// sources keep the open-ended backoff because they cost no decoding.
const CONTENT_RETRY_DELAYS_MS = [60_000, 60 * 60 * 1000, 24 * 60 * 60 * 1000]
const MAX_CONTENT_FAILURES = CONTENT_RETRY_DELAYS_MS.length + 1
const RELEASE_RETRY_SPREAD_MS = 24 * 60 * 60 * 1000
const IDLE_RECHECK_MS = 60_000
const INFRASTRUCTURE_RETRY_MS = 60_000
const REFERENCE_FAILURE_PREFIX = '[source-reference] '
// What the models read: what a photo or video shows, the faces in it, the
// text in a photo or document, and what is said in a video or recording.
//
// What a picture shows is read from the smallest preview Photos keeps, and a
// video's frames at the same size. Faces and text are looked for in the
// largest: a face in a crowd, or small print, is lost in anything less.
const MODEL_WORK = {
	embedding: {variant: 'preview-512-webp-v2', size: 512},
	text: {variant: 'preview-1280-webp-v2', size: 1280},
	faces: {variant: 'preview-1280-webp-v2', size: 1280},
	speech: undefined,
} as const satisfies Record<string, {variant: ThumbnailVariant; size: number} | undefined>
export type ModelWork = keyof typeof MODEL_WORK
// ... in the order they go in wherever they cannot all read at once: one
// model at a time, or the ones that share the CPU (see #afterOnCpu). What
// search finds most by first, then the faces People is made of, then text,
// and speech, the slowest to write down, last.
const MODEL_ORDER: ModelWork[] = ['embedding', 'faces', 'text', 'speech']
// Faces are looked for in this many frames of a video, spread through it
const VIDEO_FACE_FRAMES = 6
// A frame takes FFmpeg a quarter of a second to cut and a model on the CPU
// a second or two to read a photo. This many frames are cut in one turn in
// the background queue, so that a turn is worth as much to a video as to a
// photo: cut one to a turn, a long video kept every photo behind it waiting
// twenty minutes for the model on the GPU, which had nothing to read.
const VIDEO_FRAMES_A_TURN = 8
// Plain text is read up to this much of
const TEXT_FILE_BYTES = 1024 * 1024
// A recording is listened to this much at a time: about 10 MB of sound
const SPEECH_WINDOW_SECONDS = 300
// A video longer than this that is only in Downloads, where the apps that
// fetch films and episodes put them, is not written down: a collection of
// them is days of speech that nobody looks for by what is said
const FETCHED_FILM_MS = 18 * 60_000
// Where an entry is, for that: anywhere but in an account's Downloads, a
// folder in it, or the Trash
const OUTSIDE_DOWNLOADS_SQL = `index_roots.kind != 'trash'
	AND NOT (index_roots.kind = 'home' AND entries.relative_path GLOB 'Downloads/*')`
// How often the films left unwritten are looked at again, in case one is
// somewhere else by now
const FETCHED_FILMS_LOOK_AGAIN_MS = 60 * 60_000
// A model that goes away this many times running on one content is taken to
// be brought down by it
const MODEL_WENT_AWAY_LIMIT = 3
// A still of a moment is the frame that is cheap to read when it is this close
const STILL_REACH_MS = 250
// ... and no further into one than a day
const SPEECH_MAX_WINDOWS = 288
// A document larger than this is not read
const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024
// ... and no more than this many of the pages of a scanned one, which take a
// second or two each to read
const MAX_SCANNED_PAGES = 100
// An entry that is a photo or video by its name
const THUMBNAIL_ENTRY_SQL = `(${[...SUPPORTED_THUMBNAIL_EXTENSIONS]
	.map((extension) => `entries.name LIKE '%${extension}'`)
	.join(' OR ')})`
const ALL_THUMBNAIL_VARIANTS = Object.keys(THUMBNAIL_VARIANTS) as ThumbnailVariant[]
const PHOTOS_ONLY_VARIANT_SET = new Set<ThumbnailVariant>(
	PHOTOS_THUMBNAIL_VARIANTS.filter((variant) => variant !== FILES_THUMBNAIL_VARIANT),
)
const CAMERA_RAW_EXTENSIONS = new Set(['.arw', '.cr2', '.cr3', '.dng', '.nef', '.orf', '.raf', '.rw2'])
// Every scan-enabled root is indexed, but proactive content I/O is limited to
// personal Home and Trash roots. Other roots are enriched by Files only when browsed.
const BACKGROUND_ENRICHMENT_ROOT_SQL = "index_roots.kind IN ('home', 'trash')"
// Extracts the first frame of a video and pipes it to the command that follows.
// These are the arguments ImageMagick's own ffmpeg delegate uses, so the frame
// is the same. The delegate itself can't be used: ImageMagick hands it a path
// to open, and a sandboxed tool only has the descriptor it was given.
//
// The decoder gets one thread. Left to choose, it takes one per core and holds
// a frame in memory for each before it gives up the first, which gains no time
// and on a device with many cores takes an 8K video past the memory limit.
const VIDEO_FRAME_PIPELINE =
	'ffmpeg -nostdin -loglevel error -threads 1 -i fd: -an -f rawvideo -vframes 1 -vcodec webp -lossless 1 - | exec "$@"'
const ARTIFACT_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000
const ARTIFACT_MAINTENANCE_BATCH_SIZE = 256
const ORPHAN_SWEEP_BATCH_SIZE = 256
const ARTIFACT_IO_CONCURRENCY = 16
export const BACKGROUND_QUIET_PERIOD_MS = 1_000
// A file must sit unchanged for about as long as hashing it would take before
// the background hashes it, so one that's still being written isn't read over
// and over. The rate is roughly a Raspberry Pi 4 reading from a USB disk.
const HASH_SETTLE_BYTES_PER_MS = 100_000
const MAX_HASH_SETTLE_MS = 15 * 60 * 1000

export function hashNotBefore(size: number, changedMs: number, now = Date.now()) {
	const settle = Math.min(Math.max(BACKGROUND_QUIET_PERIOD_MS, size / HASH_SETTLE_BYTES_PER_MS), MAX_HASH_SETTLE_MS)
	return Math.ceil(Math.min(changedMs, now) + settle)
}
// Each job has one core. The slowest decode measured, a 26 megapixel Fuji RAW
// photo on a Raspberry Pi 4, takes 77 seconds of it.
export const THUMBNAIL_GENERATION_TIMEOUT_MS = 180_000
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
	// A photo's embedding was made, or could not be
	onModelWorkSettled?: (contentId: number, work: ModelWork, hash: Buffer) => void
	onHashFailure?: (entryId: number) => Promise<void>
	onContentFailure?: (contentId: number) => Promise<void>
}

// How the models are asked (see embeddings.ts)
type ModelClients = {
	available: typeof embeddingsAvailable
	embedImage: typeof embedImage
	embedPassage: typeof embedPassage
	searchModelOn: typeof searchModelOn
	findFaces: typeof findFaces
	readText: typeof readText
	transcribe: typeof transcribe
}

// Whether the models are on the device yet, and a way to have them fetched (see models.ts)
type ModelFiles = Pick<ModelDownloads, 'installed' | 'ensure' | 'stop'> & Partial<Pick<ModelDownloads, 'shortOfRoom'>>

export type FileIndexEnrichmentRuntime = {
	hashFile?: typeof hashFileRevision
	generateThumbnail?: typeof generateThumbnailFile
	generateThumbnails?: typeof generateThumbnailFiles
	extractMediaMetadata?: typeof extractMediaMetadata
	extractThumbnailTint?: typeof extractThumbnailTint
	thumbnailIsUsable?: typeof thumbnailArtifactIsUsable
	embeddings?: ModelClients
	models?: ModelFiles
	remove?: typeof fse.remove
	orphanGcMaxDeferralMs?: number
	availableParallelism?: number
}

// What the models hold, in megabytes, measured on a device whose GPU shares
// its memory (an Intel N300), where what the GPU holds of a model is the
// device's memory too: the most that is loaded at once with a model on the
// GPU beside one on the CPU, and each lane's models on the CPU (see
// #modelRoom). The most is the model that reads photos, 2,000 after hours of
// work, with the one that reads text, 500, and the one that embeds what it
// read, 200. Speech on the GPU is 1,350.
const MODELS_TOGETHER_MB = 2800
const NARROW_MEMORY_MB: Record<ModelWork, number> = {embedding: 600, faces: 600, text: 800, speech: 800}
// What is left to the device over and above what the models take, and what is
// left of swap over and above what they may displace
const MEMORY_RESERVE_MB = 1000
const SWAP_RESERVE_MB = 1000
// The share of a minute the device spends held up for memory, in percent,
// at which the models stop. A device with many apps that is swapping to keep
// going but is no worse to use stays under 4; one that is stalling for
// seconds at a time is over 20.
const MEMORY_PRESSURE_TO_STOP = 10
// How long a device that was short of room for more models has to have had
// it before they are loaded
const MEMORY_ROOM_LASTS_MS = 5 * 60_000
// What a device reads back from swap, in megabytes a minute (see memoryRoom).
// Under the first it is at rest, and its file cache and what swap has room
// for count as room for more models: a device with two virtual machines and
// 22 apps read back 2, and 35 at most with every model loaded on top. A
// device with 31 apps that are busy reads back 110. From the second, with
// models loaded on the strength of that room, something in use has been
// pushed out for them: 200 and more over what the device read back before,
// wherever that was measured.
const SWAP_IN_AT_REST_MB_A_MINUTE = 50
const SWAP_IN_TO_NARROW_MB_A_MINUTE = 200
const SWAP_IN_OVER_MS = 60_000
// The share of the last ten seconds the device spends held up for memory, in
// percent, that says the same sooner: with something in use pushed out it was
// near 30 within half a minute, and it stayed under 15 wherever what was
// pushed out was not in use
const FOUND_ROOM_PRESSURE_TO_NARROW = 20
// How long room that turned out not to be room is not counted again: twice as
// long each time
const FOUND_ROOM_HELD_BACK_MS = 60 * 60_000
const FOUND_ROOM_LONGEST_HELD_BACK_MS = 24 * 60 * 60_000
// How often the log says how far along the models are, while they are at work
const PROGRESS_SAID_EVERY_MS = 30 * 60_000
// How often a lane with no room looks again, and how long the models stay
// stopped once the device was held up with them at work: twice as long each
// time it happens again
const MEMORY_LOOK_AGAIN_MS = 30_000
const MEMORY_BACK_OFF_MS = 5 * 60_000
const MEMORY_LONGEST_BACK_OFF_MS = 60 * 60_000
// How long after no photo was left for the model that reads photos to read,
// with videos still waiting, before one is looked for again
const NO_PHOTOS_LOOKED_AGAIN_MS = 60_000
// How many things a lane reads before it lets a lane that matters more and
// is waiting for its room go: enough that loading a model, which takes
// seconds, is a small part of the turn
const MODEL_TURN_ITEMS = 128
// Where the service of the model that reads photos is told what to read on
const SEARCH_MODEL_ENVIRONMENT = '/run/umbrel-embeddings-index.env'
// How long the model that reads photos stays loaded with nothing to read: its
// service exits by itself after as long (see its unit)
const SEARCH_MODEL_HELD_MS = 5 * 60_000
// How long systemd is given to stop a model's service
const MODEL_STOP_TIMEOUT_MS = 10_000
// How long a model on the CPU has the cores background work has to itself
// (see #withEveryCore)
const CPU_TURN_ALONE_MS = 10_000
// The services each lane's work is sent to
const MODEL_SERVICES: Record<ModelWork, string[]> = {
	embedding: ['index'],
	faces: ['faces'],
	text: ['text', 'passages'],
	speech: ['speech', 'passages'],
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
	#onModelWorkSettled?: (contentId: number, work: ModelWork, hash: Buffer) => void
	#onHashFailure?: (entryId: number) => Promise<void>
	#onContentFailure?: (contentId: number) => Promise<void>
	#hashFile: typeof hashFileRevision
	#generateThumbnail: typeof generateThumbnailFile
	#generateThumbnails: typeof generateThumbnailFiles
	#extractMediaMetadata: typeof extractMediaMetadata
	#extractThumbnailTint: typeof extractThumbnailTint
	#thumbnailIsUsable: typeof thumbnailArtifactIsUsable
	#embeddings: ModelClients
	#models: ModelFiles
	// Photos being embedded, one after another, for as long as any are waiting
	#modelWork = new Map<ModelWork, Promise<void>>()
	#modelWorkRetryAt = new Map<ModelWork, number>()
	// The content each model last went away on, and how many times running
	#modelWentAway = new Map<ModelWork, {contentId: number; times: number}>()
	// The models that run on the CPU take turns at the cores background work
	// has (see #onEveryCore)
	#cpuTurnTaken = false
	#cpuWaiting: Array<{orGpu: boolean; take: (turn: boolean) => void}> = []
	// Which of its two steps speech is at, one lane at a time (see #speechStepIs)
	#speechStep?: 'writing' | 'meaning'
	// The passage the model that reads what speech means last went away at, and how many times running
	#meaningWentAway?: {passage: number; times: number}
	// When the films left unwritten were last looked at again (see #queueMovedFilms)
	#filmsLookedAt = 0
	// Whether speech is written down on a GPU when one is free (see #hear)
	#speechOnGpu = true
	// Whether speech has written anything down on the GPU in this turn of its
	// lane, and so has models loaded for it
	#speechHeardOnGpu = false
	#speechGpuWentAway = 0
	#embeddingsDatabasePath: string
	#embeddingsStore?: EmbeddingsStore
	#embeddingsStoreCreated = false
	#embeddingAbort = new AbortController()
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
			onModelWorkSettled,
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
			embeddings = {
				available: embeddingsAvailable,
				embedImage,
				embedPassage,
				searchModelOn,
				findFaces,
				readText,
				transcribe,
			},
			models = new ModelDownloads({
				directory: modelsDirectory(dataDirectory),
				logger,
				onInstalled: () => this.kick(),
			}),
			remove = fse.remove,
			orphanGcMaxDeferralMs = ORPHAN_GC_MAX_DEFERRAL_MS,
			availableParallelism = nodeAvailableParallelism(),
		}: FileIndexEnrichmentRuntime = {},
	) {
		const concurrency = enrichmentQueueConcurrency(availableParallelism)
		this.thumbnailDirectory = nodePath.join(dataDirectory, 'thumbnails')
		this.#embeddingsDatabasePath = embeddingsDatabasePath(dataDirectory)
		this.logger = logger
		this.#withDatabase = withDatabase
		this.#readSql = readSql
		this.#photosAvailable = photosAvailable
		this.#onStalePath = onStalePath
		this.#onContentAttached = onContentAttached
		this.#onMediaMetadataReady = onMediaMetadataReady
		this.#onThumbnailReady = onThumbnailReady
		this.#onModelWorkSettled = onModelWorkSettled
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
		this.#embeddings = embeddings
		this.#models = models
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
		this.#embeddingAbort = new AbortController()
		// The device is not known to have room for every model until it has
		// had it a while. As umbrelOS starts its apps are still starting, and
		// what is free is about to be theirs.
		this.#shortForAllAt = Date.now()
		this.#roomForAllSaid = undefined
		this.#progressSaidAt = 0
		this.#progressSaid.clear()
		if (this.#embeddings.available()) {
			this.#embeddingsStore = openEmbeddingsStore(this.#embeddingsDatabasePath, this.logger)
			this.#embeddingsStoreCreated = this.#embeddingsStore?.created ?? false
		}
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

	// Whether the models read the library at all: its owner can have them
	// leave it alone (see Search's indexing). What they have read stays, and
	// is still searched. A lane stops after what it is reading, or at the next
	// stretch of a long recording, and what its models hold is let go.
	#modelsEnabled = true
	setModelsEnabled(enabled: boolean) {
		if (this.#modelsEnabled === enabled) return
		this.#modelsEnabled = enabled
		if (enabled) return this.kick()
		// Nothing is waiting for memory that is not to read at all
		this.#keptFromWork(false)
		for (const {look} of [...this.#modelTurnWaiting]) look()
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
					-- Documents and recordings are told by their content too, and have no thumbnail
					AND ${THUMBNAIL_ENTRY_SQL}
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
		// What the models read is their work, in processes of their own, so it
		// goes on beside the steps below, not in turn with them: a photo can be
		// searched for soon after its preview is made.
		for (const work of MODEL_ORDER) {
			if (this.#modelWork.has(work)) continue
			this.#modelWork.set(
				work,
				this.#doModelWork(work)
					.catch((error) => this.logger.error(`Reading photos for ${work} failed`, error))
					.finally(() => {
						this.#modelWork.delete(work)
						// Speech may have been waiting for this to be done
						this.#giveCpuTurn()
					}),
			)
		}
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
		this.#embeddingAbort.abort()
		await this.#models.stop()
		// Nobody waits for a turn any more
		this.#giveCpuTurn()
		this.#backgroundEnabled = false
		for (const {look} of [...this.#modelTurnWaiting]) look()
		if (this.#timer) clearTimeout(this.#timer)
		this.#timer = undefined
		this.#wakeRequested = false
		await Promise.all([this.#backgroundQueue.onIdle(), this.#onDemandQueue.onIdle(), ...this.#modelWork.values()])
		await this.#artifactFiles?.return(undefined)
		this.#artifactFiles = undefined
		this.#embeddingsStore?.close()
		this.#embeddingsStore = undefined
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

		const refresh = await this.#nextContentNeedingMetadataRefresh()
		if (refresh) {
			const retryDelay = await this.#backgroundMediaStep(refresh, true)
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

	async #doModelWork(work: ModelWork) {
		try {
			while (!this.#stopping && this.#backgroundEnabled && this.#modelsEnabled && (await this.#doNextModelWork(work))) {
				await this.#passModelTurn(work)
			}
		} finally {
			// A lane that read all there was shows the models are not being kept
			// from their work, unless another lane still is. Not one that had no
			// turn, or left off because its model went away.
			const readAll =
				this.#modelTurns.has(work) && !this.#stopping && Date.now() >= (this.#modelWorkRetryAt.get(work) ?? 0)
			await this.#endModelTurn(work)
			if (readAll && !this.#modelTurnWaiting.some((waiting) => waiting.forMemory)) this.#keptFromWork(false)
			// Told to leave the library alone, the models are not kept loaded
			if (!this.#modelsEnabled && !this.#stopping) await this.#stopModelServices(work)
		}
	}

	// The models take memory only where there is room.
	//
	// A lane with something to read is at work while it has a turn. How many
	// lanes may have one at once goes by the room there is (see memoryRoom):
	//
	//   together  a model on the GPU beside one on the CPU, as fast as the
	//             device goes. The GPU has the model that reads photos, and
	//             once that has read them all, speech. The lanes that read
	//             on the CPU go one after the other in MODEL_ORDER, each to
	//             the end of what it has (see #afterOnCpu). Only what has a
	//             turn is loaded (see #endModelTurn): MODELS_TOGETHER_MB at
	//             most.
	//   narrow    one lane at a time, each stopping its models before the
	//             next starts, and everything on the CPU, where a model takes
	//             a fraction of what it does on a GPU that shares the device's
	//             memory: NARROW_MEMORY_MB at most. The model that reads
	//             photos too: on the GPU it took a tenth off the time, and
	//             three times the memory.
	//             It is how the models run wherever there is not room for all
	//             of them but swap has room for what they displace: the kernel
	//             makes room by moving what apps have not touched in hours to
	//             swap, which costs little while that is not wanted back.
	//   waiting   swap has no room for that either, or the device is being
	//             held up for want of memory (see memoryRoom for pressure):
	//             the lanes wait and look again. When it is held up with them
	//             at work they stop, for longer each time it happens again.
	//
	// One at a time, the lanes go in MODEL_ORDER, and a lane reads all there is
	// for it before the next has its turn: a library is found by what its
	// photos show before anything else is known of it, and a model is loaded
	// once. A lane with new things to read that matters more than the one at
	// work is let go after MODEL_TURN_ITEMS things, and by speech after each
	// thing it writes down: a recording takes as long as a hundred photos
	// (see #onEveryCore).
	//
	// Since when each lane at work has had its turn, and how much it has read in it
	#modelTurns = new Map<ModelWork, {since: number; read: number}>()
	// The lanes with something to read that have no turn: because another lane
	// has it, or because there is no memory for their models
	#modelTurnWaiting: Array<{work: ModelWork; forMemory: boolean; look: () => void}> = []
	#modelsNarrow = false
	// What the service of the model that reads photos was last told to read
	// on. Not known until then: it may still have what an umbreld before this
	// one told it.
	#noPhotosToReadUntil = 0
	#searchModelOn?: 'gpu' | 'cpu'
	// ... and where it last said it reads: on the CPU whatever it was told,
	// on a device with no GPU it can use
	#searchModelReadsOn?: 'gpu' | 'cpu'
	// When it last gave its turn up with room to stay on the GPU. One from
	// before umbreld started may still be there.
	#searchModelHeldSince = Date.now()
	// Since when the models have been kept from their work by memory. Until a
	// lane has next read for a while, not until one next has a turn: a device
	// that is short all the time reads a thing or two each time it looks.
	#waitingForMemorySince?: number
	// When the models were last stopped for being short of memory, how long
	// they are left stopped for, and until when
	#memoryBackOffMs = MEMORY_BACK_OFF_MS
	#memoryBackOffUntil = 0
	// When there was last found not to be room for all the models together
	// (see start)
	#shortForAllAt = 0
	// What the device has read back from swap, when last looked at; whether
	// it was at rest, last measured with nothing loaded on the strength of
	// room that can be found; whether something is loaded on that strength
	// now, and since when; and how long such room is held back once it has
	// turned out not to be room, and until when
	#swappedIn?: {at: number; mb: number}
	#readBackMbAMinute?: number
	#atRest = false
	#onFoundRoomSince?: number
	#foundRoomHeldBackMs = FOUND_ROOM_HELD_BACK_MS
	#foundRoomHeldBackUntil = 0
	// What the log last said: whether there was room for every model, and
	// when it last said how far along the models are and how far that was
	#roomForAllSaid?: boolean
	#progressSaidAt = 0
	#progressSaid = new Map<string, number>()

	// Whether the models are not fetched because the device has no room for them
	get modelsShortOfRoom() {
		return this.#models.shortOfRoom === true
	}

	// Whether the models have things to read that memory is keeping them
	// from: since when, and whether none of them is reading right now
	get modelsWaitingForMemory() {
		this.#noteModelsReading()
		if (this.#waitingForMemorySince === undefined) return undefined
		return {since: this.#waitingForMemorySince, now: this.#modelTurns.size === 0}
	}

	// A lane that has read a batch, or has had its turn for a while since the
	// models were last stopped for memory, has not been stopped for it in that
	// time (it asks after each thing it reads): the models are no longer kept
	// from their work, and the next wait is as short as the first
	#noteModelsReading(batch = false) {
		const now = Date.now()
		if (now < this.#memoryBackOffUntil) return
		const lasting = ({since}: {since: number}) =>
			now - Math.max(since, this.#memoryBackOffUntil) >= MEMORY_ROOM_LASTS_MS
		if (!batch && ![...this.#modelTurns.values()].some(lasting)) return
		this.#keptFromWork(false)
		this.#memoryBackOffMs = MEMORY_BACK_OFF_MS
	}

	// Whether memory is keeping the models from their work (see #waitingForMemorySince)
	#keptFromWork(kept: boolean) {
		const since = this.#waitingForMemorySince
		if (kept === (since !== undefined)) return
		this.#waitingForMemorySince = kept ? Date.now() : undefined
		this.logger.log(
			kept
				? 'The models that read the library are waiting for memory'
				: `The models that read the library are no longer kept waiting for memory, after ${inMinutes(Date.now() - since!)} minutes`,
		)
	}

	// Says how far along each kind of work is, and how much it has read since
	// it last said: now and then while the models are at work
	async #sayProgress() {
		const now = Date.now()
		const since = now - this.#progressSaidAt
		this.#progressSaidAt = now
		const counted = (await this.#selectDatabase(
			async (database) =>
				database
					.prepare(
						`SELECT model, COUNT(*) AS total, SUM(state = 'ready') AS ready, SUM(state = 'failed') AS failed
						FROM model_work GROUP BY model`,
					)
					.all(),
			BACKGROUND_DATABASE_PRIORITY,
		)) as Array<{model: string; total: number; ready: number; failed: number}>
		const kinds = counted.map(({model, total, ready, failed}) => {
			const before = this.#progressSaid.get(model)
			this.#progressSaid.set(model, ready)
			const read = before === undefined ? '' : ` (${ready - before} in ${inMinutes(since)} minutes)`
			return `${model} ${ready} of ${total}${failed > 0 ? `, ${failed} failed` : ''}${read}`
		})
		const atWork = [...this.#modelTurns.keys()]
		const how = this.#modelsNarrow ? 'one model at a time' : 'two models at once'
		const on = this.#searchModelOn ? `, the search model on the ${this.#searchModelOn.toUpperCase()}` : ''
		this.logger.log(
			`Search indexing: ${kinds.join('; ')}. At work: ${atWork.length > 0 ? `${atWork.join(', ')}, ${how}${on}` : 'none'}`,
		)
	}

	// How many lanes may be at work, as far as this lane is concerned: all of
	// them, one, or none. A lane at work asks after each thing it reads, a lane
	// that is waiting each time it looks.
	#modelRoom(work: ModelWork, atWork = false) {
		const now = Date.now()
		if (now < this.#memoryBackOffUntil) return 0
		const memory = memoryRoom()
		if (!memory) return Number.POSITIVE_INFINITY
		const {freeMb, cacheMb, swapRoomMb, swappedInMb, pressure, pressureNow} = memory
		// Something in use was pushed out for models loaded on the strength
		// of what the device could give up: that room is not counted again
		// for a while, longer each time
		const holdFoundRoomBack = (sign: string) => {
			this.logger.log(
				`${sign}: the models that read the library keep to what is free for ${this.#foundRoomHeldBackMs / 60_000} minutes`,
			)
			this.#foundRoomHeldBackUntil = now + this.#foundRoomHeldBackMs
			this.#foundRoomHeldBackMs = Math.min(FOUND_ROOM_LONGEST_HELD_BACK_MS, this.#foundRoomHeldBackMs * 2)
		}
		const trusting = this.#onFoundRoomSince !== undefined && now >= this.#foundRoomHeldBackUntil
		if (trusting && pressureNow >= FOUND_ROOM_PRESSURE_TO_NARROW) {
			holdFoundRoomBack(`Held up for memory ${Math.round(pressureNow)}% of the last ten seconds`)
		}
		// The device is held up for want of memory. With the models at work
		// they all stop, for longer each time it happens again. With none at
		// work it is short without them, and they wait for it to pass: for
		// half of what stops them, or a device that sits at that would have
		// them start and stop.
		if (pressure >= (atWork ? MEMORY_PRESSURE_TO_STOP : MEMORY_PRESSURE_TO_STOP / 2)) {
			if (atWork) {
				this.logger.log(
					`Short of memory: the models that read the library wait ${this.#memoryBackOffMs / 60_000} minutes`,
				)
				this.#memoryBackOffUntil = now + this.#memoryBackOffMs
				this.#memoryBackOffMs = Math.min(MEMORY_LONGEST_BACK_OFF_MS, this.#memoryBackOffMs * 2)
			}
			this.#shortForAllAt = Math.max(now, this.#memoryBackOffUntil)
			return 0
		}
		// How much the device has read back from swap since it was last
		// looked at, a minute or more ago
		if (!this.#swappedIn) this.#swappedIn = {at: now, mb: swappedInMb}
		else if (now - this.#swappedIn.at >= SWAP_IN_OVER_MS) {
			const aMinute = ((swappedInMb - this.#swappedIn.mb) * 60_000) / (now - this.#swappedIn.at)
			this.#swappedIn = {at: now, mb: swappedInMb}
			this.#readBackMbAMinute = aMinute
			if (this.#onFoundRoomSince === undefined) this.#atRest = aMinute < SWAP_IN_AT_REST_MB_A_MINUTE
			else if (aMinute >= SWAP_IN_TO_NARROW_MB_A_MINUTE) {
				if (now >= this.#foundRoomHeldBackUntil) {
					holdFoundRoomBack(`Reading ${Math.round(aMinute)} MB a minute back from swap`)
				}
			} else if (
				now - this.#onFoundRoomSince >= FOUND_ROOM_HELD_BACK_MS &&
				this.#foundRoomHeldBackMs !== FOUND_ROOM_HELD_BACK_MS
			) {
				this.#foundRoomHeldBackMs = FOUND_ROOM_HELD_BACK_MS
				this.logger.log(
					`Found room has lasted ${FOUND_ROOM_HELD_BACK_MS / 60_000} minutes: should it be held back again, it is for that long`,
				)
			}
		}
		// What is free, and on a device at rest what can be found: its file
		// cache, and what swap has room for of what its apps have forgotten
		const free = freeMb - MEMORY_RESERVE_MB
		const found =
			this.#atRest && now >= this.#foundRoomHeldBackUntil ? cacheMb + Math.max(0, swapRoomMb - SWAP_RESERVE_MB) : 0
		const room = free + found
		// Room for more than the narrow way is taken at once on a device that
		// has not been short. On one that has, it has to have been there at
		// every look for a while: what is free the moment the models stop is
		// what they pushed aside, which is on its way back. Taken for room,
		// everything was loaded at once into a device just found short.
		if (room < MODELS_TOGETHER_MB) this.#shortForAllAt = now
		const all = now - this.#shortForAllAt >= MEMORY_ROOM_LASTS_MS
		if (all !== this.#roomForAllSaid) {
			this.#roomForAllSaid = all
			// What room there is, and what is not counted as room and why
			const notFound =
				now < this.#foundRoomHeldBackUntil
					? `, file cache and swap not counted for another ${inMinutes(this.#foundRoomHeldBackUntil - now)} minutes`
					: !this.#atRest
						? `, file cache and swap not counted while the device reads ${this.#readBackMbAMinute === undefined ? 'an unknown amount' : `${Math.round(this.#readBackMbAMinute)} MB a minute`} back from swap`
						: ''
			const lasting = room >= MODELS_TOGETHER_MB ? `, room has to last ${MEMORY_ROOM_LASTS_MS / 60_000} minutes` : ''
			this.logger.log(
				`Room for ${all ? 'two models at once' : 'one model at a time'}: ${Math.round(free)} MB free over the reserve, ${Math.round(found)} MB found${all ? '' : `${notFound}${lasting}`}`,
			)
		}
		// Whether more is loaded than fits in what is free: from here on, what
		// is read back from swap says whether that was room (see above)
		const onFoundRoom = all && MODELS_TOGETHER_MB > free
		if (onFoundRoom !== (this.#onFoundRoomSince !== undefined)) {
			this.#onFoundRoomSince = onFoundRoom ? now : undefined
			this.#swappedIn = {at: now, mb: swappedInMb}
		}
		if (all) return Number.POSITIVE_INFINITY
		// One lane's models on the CPU, where there is room for them, or swap
		// has room for what they displace and some to spare
		return room >= NARROW_MEMORY_MB[work] || swapRoomMb >= NARROW_MEMORY_MB[work] + SWAP_RESERVE_MB ? 1 : 0
	}

	// Waits for a lane's turn. Resolves to whether it has it: not when there
	// is no more background work to do.
	async #modelTurn(work: ModelWork) {
		while (!this.#stopping && this.#backgroundEnabled && this.#modelsEnabled) {
			const lanes = this.#modelRoom(work)
			const afterOthers = lanes === 1 ? this.#waitedForBefore(work) : this.#afterOnCpu(work)
			if (this.#modelTurns.size < lanes && !afterOthers) {
				this.#modelTurns.set(work, {since: Date.now(), read: 0})
				this.#modelsNarrow = lanes === 1
				this.logger.verbose(`Reading for ${work} takes a turn at the models${lanes === 1 ? ', one at a time' : ''}`)
				if (work === 'embedding') await this.#haveSearchModelOn(lanes > 1 ? 'gpu' : 'cpu')
				return true
			}
			const forMemory = lanes === 0
			if (forMemory && this.#modelTurns.size === 0) this.#keptFromWork(true)
			// Until a lane gives its turn up, or it is worth looking again
			await new Promise<void>((look) => {
				const again = setTimeout(look, MEMORY_LOOK_AGAIN_MS).unref()
				this.#modelTurnWaiting.push({work, forMemory, look: () => (clearTimeout(again), look())})
			})
			this.#modelTurnWaiting = this.#modelTurnWaiting.filter((waiting) => waiting.work !== work)
		}
		return false
	}

	// Whether a lane that comes before this one (see MODEL_ORDER) is waiting
	// for a turn it could take
	#waitedForBefore(work: ModelWork) {
		const before = MODEL_ORDER.slice(0, MODEL_ORDER.indexOf(work))
		return this.#modelTurnWaiting.some((waiting) => !waiting.forMemory && before.includes(waiting.work))
	}

	// With room for more than one model, the ones that read on the CPU still go
	// one after the other, in MODEL_ORDER: each has the cores to itself, so the
	// faces People is made of are all found before any text is read, and only
	// the model at work is loaded. Whether a lane that comes before this one
	// on the CPU has things to read: is at work, or waiting for its turn.
	//
	// The model that reads photos is not one of them where it reads on a GPU,
	// beside everything else. Nor is speech while the GPU is its to use.
	#afterOnCpu(work: ModelWork) {
		const onCpu = (lane: ModelWork) =>
			lane === 'embedding' ? this.#searchModelReadsOn === 'cpu' : lane !== 'speech' || !this.#gpuForSpeech()
		if (!onCpu(work)) return false
		return MODEL_ORDER.slice(0, MODEL_ORDER.indexOf(work))
			.filter(onCpu)
			.some(
				(lane) =>
					this.#modelTurns.has(lane) ||
					this.#modelTurnWaiting.some((waiting) => waiting.work === lane && !waiting.forMemory),
			)
	}

	// After each thing a lane reads: whether it keeps its turn. Not when there
	// is no longer room for as many lanes as are at work; nor, one at a time,
	// when a lane that comes before it is waiting and it has read its share;
	// nor, on the CPU, once a lane that comes before it has things to read.
	async #passModelTurn(work: ModelWork) {
		const turn = this.#modelTurns.get(work)
		if (!turn) return
		const batch = ++turn.read % MODEL_TURN_ITEMS === 0
		if (Date.now() - this.#progressSaidAt >= PROGRESS_SAID_EVERY_MS) {
			void this.#sayProgress().catch((error) =>
				this.logger.verbose(`Could not count the models' work: ${errorMessage(error)}`),
			)
		}
		const lanes = this.#modelRoom(work, true)
		if (lanes > 0) this.#noteModelsReading(batch)
		const over =
			lanes === 1 ? this.#waitedForBefore(work) && (batch || work === 'speech') : lanes > 1 && this.#afterOnCpu(work)
		if (this.#modelTurns.size > lanes || over) return this.#endModelTurn(work, lanes <= 1)
		this.#modelsNarrow = lanes === 1
		if (work === 'embedding') await this.#haveSearchModelOn(lanes > 1 ? 'gpu' : 'cpu')
	}

	// Asked between the frames of a video, the pages of a document and the
	// stretches of a recording, which can take minutes or hours to read:
	// whether the lane is to leave off because the device is short of memory.
	// It gives its turn up, and comes back to what it was reading.
	async #leftOffForMemory(work: ModelWork) {
		if (this.#stopping || !this.#modelsEnabled) return true
		if (!this.#modelTurns.has(work) || this.#modelRoom(work, true) > 0) return false
		await this.#endModelTurn(work, true)
		return true
	}

	// Gives a lane's turn up, and stops what it loaded, which would be held on
	// to for five minutes otherwise: only the models with something to read are
	// in memory, and the turn is not free until its models are stopped.
	//
	// But for the model that reads photos where there is room for it on a GPU
	// (not `narrow`). It is the one that takes longest to load, five seconds
	// on an Intel N300, and most days a library gets its photos a few at a
	// time. So it is left to the five minutes, and speech does not have the
	// GPU until they are over (see #gpuForSpeech).
	async #endModelTurn(work: ModelWork, narrow = this.#modelsNarrow) {
		const turn = this.#modelTurns.get(work)
		if (!turn) return
		this.logger.verbose(
			`Reading for ${work} gives its turn up after ${turn.read} in ${inMinutes(Date.now() - turn.since)} minutes`,
		)
		if (narrow) this.#modelsNarrow = true
		const held = work === 'embedding' && !narrow && this.#searchModelReadsOn === 'gpu'
		if (held) this.#searchModelHeldSince = Date.now()
		else if (!this.#stopping) await this.#stopModelServices(work)
		this.#modelTurns.delete(work)
		if (work === 'speech') {
			this.#speechStep = undefined
			this.#speechHeardOnGpu = false
		}
		for (const {look} of [...this.#modelTurnWaiting]) look()
		// Speech may have been waiting for the GPU or the cores (see #hear). It
		// is looked to once the lanes above have taken their turns: the cores
		// are theirs before they are its.
		queueMicrotask(() => this.#giveCpuTurn())
	}

	// Stops what a lane has loaded, but for what another lane at work may be
	// in the middle of using. Not waited for for long: systemd stops these
	// after umbreld, so while umbreld itself is being stopped it gives no
	// answer until umbreld is gone.
	async #stopModelServices(work: ModelWork, loaded = MODEL_SERVICES[work]) {
		const others = [...this.#modelTurns.keys()].filter((lane) => lane !== work)
		const inUse = new Set(others.flatMap((lane) => MODEL_SERVICES[lane]))
		const services = loaded
			.filter((service) => !inUse.has(service))
			.map((service) => `umbrel-embeddings-${service}.service`)
		if (services.length > 0) await $({timeout: MODEL_STOP_TIMEOUT_MS})`systemctl stop ${services}`.catch(() => {})
	}

	// Has systemd listen for a lane's models again, where it has stopped.
	//
	// A model's service is started by whoever connects to its socket. When it
	// cannot start (a model file gone, a crash as it loads, its start condition
	// not met) systemd tries again for as long as that connection waits, and
	// after a few tries in a row gives the socket up for good: from then on
	// nothing of that kind is read until the device restarts, and all umbreld
	// sees is that nobody is listening. So where nobody is, the socket is
	// started again, as often as the work is tried again, a minute apart.
	async #listenAgain(work: ModelWork, error: unknown) {
		// Refused: the socket is there and nobody listens on it. One that is not
		// there at all is a model this device does not run.
		if (((error as Error).cause as {code?: string} | undefined)?.code !== 'ECONNREFUSED') return
		const units = (kind: string) => MODEL_SERVICES[work].map((service) => `umbrel-embeddings-${service}.${kind}`)
		const systemctl = $({timeout: MODEL_STOP_TIMEOUT_MS})
		await systemctl`systemctl reset-failed ${[...units('socket'), ...units('service')]}`.catch(() => {})
		await systemctl`systemctl start ${units('socket')}`.catch(() => {})
	}

	// Has the model that reads photos read on the GPU or on the CPU from here
	// on: its service is told which as it starts (see its unit)
	async #haveSearchModelOn(on: 'gpu' | 'cpu') {
		if (this.#searchModelOn === on) return
		const tell = (on: 'gpu' | 'cpu') =>
			writeFile(SEARCH_MODEL_ENVIRONMENT, on === 'cpu' ? 'UMBREL_SEARCH_MODEL_ON=cpu\n' : '')
		// Only restarted when it was told otherwise
		const told =
			this.#searchModelOn ??
			((await readFile(SEARCH_MODEL_ENVIRONMENT, 'utf8').catch(() => '')).includes('=cpu') ? 'cpu' : 'gpu')
		try {
			if (told !== on) {
				await tell(on)
				await $({timeout: MODEL_STOP_TIMEOUT_MS})`systemctl stop umbrel-embeddings-index.service`
				this.logger.log(`The search model reads on the ${on.toUpperCase()} from here on`)
			}
			this.#searchModelOn = on
		} catch (error) {
			// It reads on what it was last told to, and is told again next time
			await tell(told).catch(() => {})
			this.logger.verbose(`Could not tell the search model what to read on: ${errorMessage(error)}`)
		}
	}

	// Has a model read one photo or video: what it shows, so it can be found by
	// describing it (see embeddings.ts), or the faces in it, for People. A photo
	// is read from a preview Photos already made of it, a video from frames
	// taken through its length. The one added most recently goes first: one
	// that has just arrived is not left waiting behind a library that is still
	// being worked through. Resolves to whether there was one to read.
	async #doNextModelWork(work: ModelWork): Promise<boolean> {
		const store = this.#embeddingsStore
		if (Date.now() < (this.#modelWorkRetryAt.get(work) ?? 0) || !store || !this.#modelsEnabled) return false
		// The models are fetched once a library has anything for them to read,
		// and it is read once they are here. One they have read all of still
		// has searches for them to answer.
		if (!this.#models.installed()) {
			const something = await this.#selectDatabase(
				async (database) => database.prepare('SELECT 1 FROM model_work LIMIT 1').get(),
				BACKGROUND_DATABASE_PRIORITY,
			)
			if (something) this.#models.ensure()
			return false
		}
		if (this.#embeddingsStoreCreated) {
			// What the models made is gone, or was made by other models: whatever
			// the file index has down as read is to be read again
			this.#embeddingsStoreCreated = false
			await this.#withDatabase((database) => {
				database
					.prepare(
						`UPDATE model_work SET state = 'pending', failure_count = 0, retry_at = NULL, last_error = NULL
						WHERE state != 'pending'`,
					)
					.run()
			}, BACKGROUND_DATABASE_PRIORITY)
		}
		// The latest first. What is said is written down shortest first: a long
		// recording takes as long as a hundred short ones, which would all wait
		// behind it. A video's length is known; a recording's is taken from its
		// size, at the 128 kbit/s most are kept at.
		const soonest = work === 'speech' ? 'COALESCE(media_metadata.duration_ms, contents.size / 16), ' : ''
		// What photos show is read before what videos do: a video is a frame
		// for every few seconds of it, and a run of them kept every photo
		// added before them waiting for hours. Looking for a photo goes past
		// every video that waits, so once there are none left it is not done
		// again for a while.
		const photosFirst = work === 'embedding' && Date.now() >= this.#noPhotosToReadUntil
		const content = await this.#selectDatabase(async (database) => {
			const next = (state: 'pending' | 'failed', photos = false) =>
				database.prepare(
					`SELECT model_work.content_id AS id, lower(hex(contents.blake3)) AS hash,
						model_work.state, model_work.failure_count, model_work.retry_at,
						media_metadata.kind, media_metadata.duration_ms AS durationMs
					FROM model_work INDEXED BY model_work_${state}
					JOIN contents ON contents.id = model_work.content_id
					LEFT JOIN media_metadata ON media_metadata.content_id = model_work.content_id
					WHERE model_work.model = ? AND model_work.state = '${state}'
						${state === 'failed' ? 'AND model_work.retry_at <= ?' : ''}
						-- A photo or video waits until it is known how long it is and
						-- it is in its library, or until that has been given up on
						AND (media_metadata.content_id IS NULL OR media_metadata.state = 'ready'
							OR (media_metadata.state = 'failed' AND media_metadata.retry_at IS NULL))
						${photos ? "AND media_metadata.kind IS NOT 'video'" : ''}
					ORDER BY ${state === 'failed' ? 'model_work.retry_at' : `${soonest}model_work.content_id DESC`}
					LIMIT 1`,
				)
			const photo = photosFirst ? await next('pending', true).get(work) : undefined
			const pending = photo ?? (await next('pending').get(work))
			// Only with a video waiting: with nothing waiting at all, the next
			// photo to arrive is still looked for first
			if (photosFirst && !photo && pending) this.#noPhotosToReadUntil = Date.now() + NO_PHOTOS_LOOKED_AGAIN_MS
			return (pending ?? (await next('failed').get(work, Date.now()))) as
				| (FailureState & {id: number; hash: string; kind: PhotoKind | null; durationMs: number | null})
				| undefined
		}, BACKGROUND_DATABASE_PRIORITY)
		// With nothing left to write down, what was said is read for what it
		// means, and a film that has left Downloads is written down after all
		if (!content) {
			if (work !== 'speech') return false
			return (await this.#readNextMeaning(store)) || this.#queueMovedFilms(store)
		}
		// With something to read, the lane has its turn at the models first
		// (see #modelRoom). What is next is looked for again once it has: the
		// wait can be a long one.
		if (!this.#modelTurns.has(work)) return (await this.#modelTurn(work)) ? this.#doNextModelWork(work) : false
		// A content's id can be given to other content once it is gone, so the
		// row is only written while it still belongs to this one
		const current = '(SELECT id FROM contents WHERE id = ? AND blake3 = ?)'
		const hash = Buffer.from(content.hash, 'hex')
		const moments = content.kind === 'video' ? videoMoments(content.durationMs ?? 0) : undefined
		// What is already there, when the file index has been rebuilt since, is
		// not read again
		const there =
			work === 'embedding' ? !moments && store.has(hash) : store.wasRead(hash, work === 'faces' ? 'faces' : work)
		try {
			if (there) {
				// Nothing to do
			} else if (work === 'embedding') {
				if (moments) {
					if (!(await this.#embedVideo(store, content.id, hash, moments))) return false
				} else {
					const preview = await this.#preview(content.hash, work)
					store.set(
						hash,
						await this.#onSearchModel(() => this.#embeddings.embedImage(preview, this.#embeddingAbort.signal)),
					)
				}
			} else if (work === 'faces') {
				if (moments) {
					if (!(await this.#findVideoFaces(store, content.id, hash, moments))) return false
				} else {
					const preview = await this.#preview(content.hash, work)
					store.setFaces(
						hash,
						await this.#onEveryCore(() => this.#embeddings.findFaces(preview, this.#embeddingAbort.signal)),
					)
				}
			} else if (work === 'speech') {
				const film = await this.#isFetchedFilm(content)
				if (!film && !(await this.#writeDownSpeech(store, content.id, hash))) return false
			} else if (content.kind === 'photo') {
				const preview = await this.#preview(content.hash, work)
				store.setPassages(
					hash,
					'picture',
					await this.#onEveryCore(() => this.#embeddings.readText(preview, this.#embeddingAbort.signal)),
				)
			} else {
				if (!(await this.#readDocument(store, content.id, hash))) return false
			}
			await this.#withDatabase((database) => {
				database
					.prepare(
						`UPDATE model_work SET state = 'ready', failure_count = 0, retry_at = NULL, last_error = NULL
						WHERE model = ? AND content_id = ${current}`,
					)
					.run(work, content.id, hash)
			}, BACKGROUND_DATABASE_PRIORITY)
		} catch (error) {
			if (this.#stopping) return false
			// A model that goes away each time it is sent the same content is
			// brought down by it. Until then there is nothing to hold against
			// the content: it is still due when the model is back.
			const before = this.#modelWentAway.get(work)
			const wentAway =
				error instanceof ModelWentAwayError ? (before?.contentId === content.id ? before.times + 1 : 1) : 0
			if (wentAway > 0) {
				this.#modelWentAway.set(work, {contentId: content.id, times: wentAway})
				// One that gave no answer still has the question in hand, and
				// would be asked the next behind it
				await this.#stopModelServices(work)
			}
			if (error instanceof EmbeddingsUnavailableError && wentAway < MODEL_WENT_AWAY_LIMIT) {
				this.#modelWorkRetryAt.set(work, Date.now() + INFRASTRUCTURE_RETRY_MS)
				this.logger.verbose(`Reading photos for ${work} is waiting for the model: ${errorMessage(error)}`)
				await this.#listenAgain(work, error)
				return false
			}
			const {failureCount, retryAt} = nextFailureState(content, error, false)
			await this.#withDatabase((database) => {
				database
					.prepare(
						`UPDATE model_work SET state = 'failed', failure_count = ?, retry_at = ?, last_error = ?
						WHERE model = ? AND content_id = ${current}`,
					)
					.run(failureCount, retryAt, persistedFailureMessage(error, false), work, content.id, hash)
			}, BACKGROUND_DATABASE_PRIORITY)
			this.logger.error(`Failed to read '${content.hash}' for ${work}`, error)
		}
		this.#onModelWorkSettled?.(content.id, work, hash)
		return true
	}

	// Background work has a quarter of the device's cores (see
	// enrichmentQueueConcurrency): that many steps at once, each of one core.
	// What the models' lanes do on the CPU comes out of the same quarter.
	//
	// A tool they run (FFmpeg for a frame or for sound, Poppler for a
	// document) uses one core, and takes a place in the queue like any step.
	#onOneCore<T>(task: () => Promise<T>) {
		return this.#backgroundQueue.add(task) as Promise<T>
	}

	// A model that runs on the CPU uses all of them: its server takes that many
	// threads (see faces.py). So the queue starts nothing new while a model is
	// at work, and the model waits for what the queue has running to finish:
	// steps and models take turns at the whole quarter. One model at a time.
	// Whoever has waited longest goes first, but for a stretch of speech
	// (`orGpu`): it takes as long as a hundred photos, and taking turns with
	// them one for one it would have a library's photos wait for its videos to
	// be listened to. So one only goes while no photos are being read.
	async #onEveryCore<T>(task: () => Promise<T>) {
		await this.#cpuTurn()
		return this.#withEveryCore(task)
	}

	// The model that reads pictures for search reads beside everything else on
	// a GPU. On the CPU, where the device has no GPU it can use (a Raspberry Pi
	// 5's is not one) or is short of memory, it takes its turn at the cores like
	// the other models.
	async #onSearchModel<T>(read: () => Promise<T>) {
		this.#searchModelReadsOn = await this.#embeddings.searchModelOn(this.#embeddingAbort.signal)
		return this.#searchModelReadsOn === 'gpu' ? read() : this.#onEveryCore(read)
	}

	// Waits for a model's turn at the cores. Resolves to whether it has it:
	// what can be written down on the GPU instead (`orGpu`) is let go without,
	// to the GPU, when that comes free first. Nothing else is: it would read
	// on the cores without its turn at them.
	#cpuTurn(orGpu = false) {
		return new Promise<boolean>((take) => {
			this.#cpuWaiting.push({orGpu, take})
			this.#giveCpuTurn()
		})
	}

	async #withEveryCore<T>(task: () => Promise<T>) {
		this.#backgroundQueue.pause()
		// A model reads in a second or two with the cores to itself. One that
		// takes longer is not getting them: it runs beneath everything else on
		// the device (see umbrelbackground.slice in packages/os). The queue's
		// steps, which do not, are then not kept waiting for it.
		let alone: ReturnType<typeof setTimeout> | undefined
		try {
			while (this.#backgroundQueue.pending > 0 && !this.#stopping) {
				await new Promise((resolve) => this.#backgroundQueue.once('next', resolve))
			}
			alone = setTimeout(() => this.#backgroundQueue.start(), CPU_TURN_ALONE_MS)
			return await task()
		} finally {
			clearTimeout(alone)
			this.#backgroundQueue.start()
			this.#cpuTurnTaken = false
			this.#giveCpuTurn()
		}
	}

	#giveCpuTurn() {
		if (this.#gpuForSpeech()) {
			const waiting = this.#cpuWaiting.findIndex(({orGpu}) => orGpu)
			if (waiting !== -1) this.#cpuWaiting.splice(waiting, 1)[0]!.take(false)
		}
		while (this.#stopping || !this.#cpuTurnTaken) {
			const speechWaits = !this.#stopping && (this.#modelTurns.has('faces') || this.#modelTurns.has('text'))
			const next = this.#cpuWaiting.findIndex(({orGpu}) => !orGpu || !speechWaits)
			if (next === -1) return
			this.#cpuTurnTaken = true
			this.#cpuWaiting.splice(next, 1)[0]!.take(true)
		}
	}

	// The preview of a photo that a model reads
	#preview(hash: string, work: Exclude<ModelWork, 'speech'>) {
		return fse.readFile(this.#previewPath(hash, work))
	}

	#previewPath(hash: string, work: Exclude<ModelWork, 'speech'>) {
		return thumbnailSystemPath(this.thumbnailDirectory, contentIdentity(hash, MODEL_WORK[work].variant))
	}

	// Has `read` go through a file with this content, which is checked to still
	// be that content when it is opened and once more when `read` is done
	async #readContent<T>(contentId: number, read: (sourceFileDescriptor: number, systemPath: string) => Promise<T>) {
		const file = await this.#nextContentReference(contentId, new Set(), BACKGROUND_DATABASE_PRIORITY, true)
		if (!file) throw new Error('No file with this content is left to read')
		const source = await openContentRevision(file.systemPath, file.fingerprint)
		try {
			const result = await read(source.fd, file.systemPath)
			await assertHandleContentRevision(source, file.fingerprint)
			return result
		} finally {
			await source.close().catch(() => {})
		}
	}

	// Reads a document's text and embeds it a passage at a time. Resolves to
	// whether it got through it all.
	async #readDocument(store: EmbeddingsStore, contentId: number, hash: Buffer) {
		const read: Array<Omit<StoredPassage, 'kind'>> = []
		const finished = await this.#readContent(contentId, async (source, systemPath) => {
			if (readableKind(systemPath) !== 'document') return true
			// A document this large is seldom words, and the tools hold all of one in memory
			if ((await promisify(fstat)(source)).size > MAX_DOCUMENT_BYTES) return true
			const title = nodePath.basename(systemPath)
			const pages = await this.#onOneCore(() => readDocumentText(source, systemPath))
			// A scanned document is a picture of each page, with no text to take
			// out of it. Such a page is read as a picture is, by the same models.
			if (nodePath.extname(systemPath).toLowerCase() === '.pdf') {
				const scanned = pages.flatMap((text, index) => (/[\p{L}\p{N}]/u.test(text) ? [] : [index]))
				for (const index of scanned.slice(0, MAX_SCANNED_PAGES)) {
					if (await this.#leftOffForMemory('text')) return false
					try {
						const picture = await this.#onOneCore(() => renderDocumentPage(source, index + 1))
						const lines = await this.#onEveryCore(() => this.#embeddings.readText(picture, this.#embeddingAbort.signal))
						pages[index] = lines.map(({text}) => text).join('\n')
					} catch (error) {
						// The models not being there is no fault of the page's. Anything
						// else is, and the rest of the document is still read.
						if (error instanceof EmbeddingsUnavailableError) throw error
					}
				}
			}
			for (const {page, text, context} of passages(pages)) {
				if (this.#stopping) return false
				read.push({
					page,
					text,
					embedding: await this.#onEveryCore(() =>
						this.#embeddings.embedPassage(context, title, this.#embeddingAbort.signal),
					),
				})
			}
			return true
		})
		if (finished) store.setPassages(hash, 'document', read)
		return finished
	}

	// Writes down what is said in a video or recording, a few minutes of it at
	// a time, and embeds it a passage at a time so that it is found by what it
	// means (see spokenPassages). Resolves to whether it got to the end.
	//
	// One lane at a time, the embedding is left for later (see #speechStepIs):
	// it is found by its words from here on, and by what it means once every
	// recording has been written down.
	async #writeDownSpeech(store: EmbeddingsStore, contentId: number, hash: Buffer) {
		const said: Array<Omit<StoredPassage, 'kind'> & {atMs: number; endMs: number}> = []
		const written: string[] = []
		await this.#speechStepIs('writing')
		const finished = await this.#readContent(contentId, async (source, systemPath) => {
			const {signal} = this.#embeddingAbort
			// Asked for what comes after the end of a recording, FFmpeg gives the
			// end of some kinds again, so it is only asked for what there is
			const seconds = await this.#onOneCore(() => soundSeconds(source))
			for (let window = 0; window < SPEECH_MAX_WINDOWS && window * SPEECH_WINDOW_SECONDS < seconds; window++) {
				if (await this.#leftOffForMemory('speech')) return false
				const sound = await this.#onOneCore(() =>
					extractSound(source, window * SPEECH_WINDOW_SECONDS, SPEECH_WINDOW_SECONDS),
				)
				// Nothing this far in is the end of it. A stretch can come back a
				// little short of what was asked for anywhere in a recording.
				if (sound.length === 0) break
				const offsetMs = window * SPEECH_WINDOW_SECONDS * 1000
				const spoken = await this.#hear(sound, signal)
				for (const {startMs, endMs, text, original} of spoken) {
					said.push({atMs: offsetMs + startMs, endMs: offsetMs + endMs, text, romanised: original !== undefined})
					written.push(original ?? text)
				}
			}
			// What it means is read from what the model wrote, in the script it was said in
			const title = nodePath.basename(systemPath)
			for (const {first, text} of spokenPassages(
				said.map((sentence, index) => ({...sentence, text: written[index]!})),
			)) {
				if (this.#stopping) return false
				if (this.#modelsNarrow) said[first]!.toEmbed = {title, text}
				else {
					said[first]!.embedding = await this.#onEveryCore(() => this.#embeddings.embedPassage(text, title, signal))
				}
			}
			return true
		})
		if (finished) store.setPassages(hash, 'speech', said)
		return finished
	}

	// Whether a video is a film or an episode an app fetched: a long one (see
	// FETCHED_FILM_MS) that is nowhere but in an account's Downloads, or a
	// folder in it, or the Trash. Its frames and faces are read like any
	// other video's.
	async #isFetchedFilm({id, kind, durationMs}: {id: number; kind: PhotoKind | null; durationMs: number | null}) {
		if (kind !== 'video' || (durationMs ?? 0) <= FETCHED_FILM_MS) return false
		const elsewhere = await this.#selectDatabase(
			async (database) =>
				database
					.prepare(
						`SELECT 1 FROM entries JOIN index_roots ON index_roots.id = entries.root_id
						WHERE entries.content_id = ? AND ${OUTSIDE_DOWNLOADS_SQL}
						LIMIT 1`,
					)
					.get(id),
			BACKGROUND_DATABASE_PRIORITY,
		)
		return !elsewhere
	}

	// A film that was left unwritten and is somewhere other than Downloads now
	// is queued to be written down after all. Looked for now and then while
	// there is nothing else to write down: one read of the index, and a look in
	// the store for each long video. Resolves to whether any was queued.
	async #queueMovedFilms(store: EmbeddingsStore) {
		if (Date.now() - this.#filmsLookedAt < FETCHED_FILMS_LOOK_AGAIN_MS) return false
		this.#filmsLookedAt = Date.now()
		// The long videos somewhere else whose speech is down as done ...
		const done = (await this.#selectDatabase(
			async (database) =>
				database
					.prepare(
						`SELECT model_work.content_id AS id, lower(hex(contents.blake3)) AS hash
						FROM media_metadata
						JOIN model_work ON model_work.content_id = media_metadata.content_id
							AND model_work.model = 'speech' AND model_work.state = 'ready'
						JOIN contents ON contents.id = media_metadata.content_id
						WHERE media_metadata.kind = 'video' AND media_metadata.duration_ms > ?
							AND EXISTS (
								SELECT 1 FROM entries JOIN index_roots ON index_roots.id = entries.root_id
								WHERE entries.content_id = media_metadata.content_id AND ${OUTSIDE_DOWNLOADS_SQL}
							)`,
					)
					.all(FETCHED_FILM_MS),
			BACKGROUND_DATABASE_PRIORITY,
		)) as Array<{id: number; hash: string}>
		// ... of which the ones nothing was written down of were left as films
		const moved = done.filter(({hash}) => !store.wasRead(Buffer.from(hash, 'hex'), 'speech'))
		if (moved.length === 0) return false
		await this.#withDatabase((database) => {
			const queue = database.prepare(
				`UPDATE model_work SET state = 'pending' WHERE model = 'speech' AND state = 'ready'
				AND content_id = (SELECT id FROM contents WHERE id = ? AND blake3 = ?)`,
			)
			for (const {id, hash} of moved) queue.run(id, Buffer.from(hash, 'hex'))
		}, BACKGROUND_DATABASE_PRIORITY)
		return true
	}

	// One lane at a time, the models that write speech down and the one that
	// reads what it means are never loaded together: every recording is
	// written down, then every passage of what was said is embedded. Four
	// recordings on an Intel N150 held 1,024 MB with both loaded and 874 MB
	// this way, and took as long.
	//
	// Says which step speech is at, and stops what the other step loaded.
	async #speechStepIs(step: 'writing' | 'meaning') {
		if (!this.#modelsNarrow) this.#speechStep = undefined
		if (!this.#modelsNarrow || this.#speechStep === step) return
		this.#speechStep = step
		await this.#stopModelServices('speech', step === 'writing' ? ['passages'] : ['speech'])
	}

	// Embeds the next passage of speech that was written down with that left
	// for later. Resolves to whether there was one.
	async #readNextMeaning(store: EmbeddingsStore): Promise<boolean> {
		const next = store.nextUnembedded()
		if (!next) return false
		if (!this.#modelTurns.has('speech')) {
			return (await this.#modelTurn('speech')) ? this.#doNextModelWork('speech') : false
		}
		await this.#speechStepIs('meaning')
		try {
			const {signal} = this.#embeddingAbort
			store.setPassageEmbedding(
				next.id,
				await this.#onEveryCore(() => this.#embeddings.embedPassage(next.text, next.title, signal)),
			)
		} catch (error) {
			if (this.#stopping) return false
			// As with anything else a model reads (see #doNextModelWork): one that
			// goes away at the same passage each time is brought down by it
			const before = this.#meaningWentAway
			const wentAway = error instanceof ModelWentAwayError ? (before?.passage === next.id ? before.times + 1 : 1) : 0
			this.#meaningWentAway = wentAway > 0 ? {passage: next.id, times: wentAway} : undefined
			if (error instanceof EmbeddingsUnavailableError && wentAway < MODEL_WENT_AWAY_LIMIT) {
				this.#modelWorkRetryAt.set('speech', Date.now() + INFRASTRUCTURE_RETRY_MS)
				this.logger.verbose(`Reading what speech means is waiting for the model: ${errorMessage(error)}`)
				await this.#listenAgain('speech', error)
				return false
			}
			// It is still found by its words
			store.setPassageEmbedding(next.id)
			this.logger.error('Failed to read what a passage of speech means', error)
		}
		return true
	}

	// What is said in a stretch of sound. Written down on a GPU once the model
	// that reads photos has left it, where there is one the speech models
	// trust: it takes seconds, and one core. Otherwise on the CPU, in
	// speech's turn (see #onEveryCore), a stretch at a time so that a long
	// recording holds nobody up; and should the GPU come free while it waits
	// for that, on the GPU after all.
	async #hear(sound: Buffer, signal: AbortSignal) {
		for (;;) {
			if (this.#gpuForSpeech()) {
				try {
					const spoken = await this.#onOneCore(() => this.#embeddings.transcribe(sound, 'gpu', signal))
					this.#speechGpuWentAway = 0
					if (spoken) {
						this.#speechHeardOnGpu = true
						return spoken
					}
					this.#speechOnGpu = false
				} catch (error) {
					// A driver that brings the models down with it: once says
					// nothing (they are also stopped at shutdown), twice running
					// and the GPU is left alone
					if (!(error instanceof ModelWentAwayError)) throw error
					if (++this.#speechGpuWentAway > 1) this.#speechOnGpu = false
				}
			} else {
				// Speech does not hold its models while it waits, part of the way
				// through a recording: for the cores, while the lanes before it
				// have photos to read (see #giveCpuTurn), nor with what it loaded
				// for the GPU once the model that reads photos has that back
				const waits = this.#modelTurns.has('faces') || this.#modelTurns.has('text')
				if ((waits || this.#speechHeardOnGpu) && !this.#stopping) {
					this.#speechHeardOnGpu = false
					await this.#stopModelServices('speech', ['speech'])
				}
				if (await this.#cpuTurn(true)) {
					return this.#withEveryCore(() => this.#embeddings.transcribe(sound, 'cpu', signal))
				}
			}
		}
	}

	#gpuForSpeech() {
		// A GPU that shares the device's memory has one model on it at a time.
		// It is free of the model that reads photos once that has had no turn
		// for as long as it is held on to, and has gone: sooner, and a library
		// whose photos arrive a few at a time would have the two load and stop
		// in turn, every few seconds on an Intel N300.
		// Short of memory, speech is written down on the CPU, where its models
		// take a third of what they do on a GPU that shares the device's memory.
		return (
			this.#speechOnGpu &&
			!this.#stopping &&
			!this.#modelsNarrow &&
			!this.#modelTurns.has('embedding') &&
			Date.now() - this.#searchModelHeldSince >= SEARCH_MODEL_HELD_MS
		)
	}

	// Embeds the frames of a video that aren't embedded yet, in order, so one
	// that was interrupted carries on from where it stopped. Resolves to
	// whether it got through them all.
	async #embedVideo(store: EmbeddingsStore, contentId: number, hash: Buffer, moments: VideoMoment[]) {
		if (store.count(hash) >= moments.length) return true
		try {
			return await this.#readContent(contentId, async (source) => {
				const missing = [...moments.entries()].filter(([frame]) => !store.has(hash, frame))
				// Several frames to a turn in the queue (see #onOneCore): the model
				// on the GPU reads them while it waits for the next
				for (let first = 0; first < missing.length; first += VIDEO_FRAMES_A_TURN) {
					if (await this.#leftOffForMemory('embedding')) return false
					const turn = missing.slice(first, first + VIDEO_FRAMES_A_TURN)
					const images = await this.#videoFrames(
						source,
						turn.map(([, moment]) => moment),
						MODEL_WORK.embedding.size,
					)
					// A frame at a time: on the CPU each is a turn of its own, so that
					// the other models' turns come between them
					for (const [index, {image, atMs}] of images.entries()) {
						const embedding = await this.#onSearchModel(() =>
							this.#embeddings.embedImage(image, this.#embeddingAbort.signal),
						)
						store.set(hash, embedding, turn[index]![0], atMs)
					}
				}
				return true
			})
		} catch (error) {
			// What was read may not be of this content any more
			if (!(error instanceof EmbeddingsUnavailableError)) store.deleteVectors(hash)
			throw error
		}
	}

	// A few frames of a video, cut one after another in one turn in the queue
	#videoFrames(sourceFileDescriptor: number, moments: VideoMoment[], size: number) {
		return this.#onOneCore(async () => {
			const frames: Array<Awaited<ReturnType<typeof extractVideoFrame>>> = []
			for (const moment of moments) frames.push(await extractVideoFrame(sourceFileDescriptor, moment, size))
			return frames
		})
	}

	// Finds the faces in a few frames of a video, spread through it. Resolves
	// to whether it got through them all.
	async #findVideoFaces(store: EmbeddingsStore, contentId: number, hash: Buffer, moments: VideoMoment[]) {
		const frames = Math.min(VIDEO_FACE_FRAMES, moments.length)
		const looks = Array.from({length: frames}, (_, index) => moments[Math.floor((index * moments.length) / frames)]!)
		const faces: Array<FoundFace & {atMs: number}> = []
		const finished = await this.#readContent(contentId, async (source) => {
			for (const {image, atMs} of await this.#videoFrames(source, looks, MODEL_WORK.faces.size)) {
				if (await this.#leftOffForMemory('faces')) return false
				const found = await this.#onEveryCore(() => this.#embeddings.findFaces(image, this.#embeddingAbort.signal))
				for (const face of found) faces.push({...face, atMs})
			}
			return true
		})
		if (finished) store.setFaces(hash, faces)
		return finished
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

	async #nextContentNeedingMetadataRefresh() {
		return this.#selectDatabase(async (database) => {
			const excluded = [...this.#activeMediaContents]
			const exclusion =
				excluded.length > 0
					? `AND media_metadata_refresh.content_id NOT IN (${excluded.map(() => '?').join(', ')})`
					: ''
			// The refresh queue is usually empty, so start from it. Left to choose,
			// SQLite walks every entry by content to satisfy the ORDER BY, which
			// costs a full pass over a large index on every background step.
			const row = (await database
				.prepare(
					`SELECT contents.id, entries.id AS entry_id, hex(contents.blake3) AS hash,
						entries.device, entries.inode, entries.size, entries.modified_ns,
						entries.ctime_ns, entries.thumbnail_identity_kind,
						index_roots.system_path AS root_system_path, entries.relative_path
					FROM media_metadata_refresh
					CROSS JOIN contents ON contents.id = media_metadata_refresh.content_id
					CROSS JOIN entries INDEXED BY entries_by_content ON entries.content_id = media_metadata_refresh.content_id
					JOIN index_roots ON index_roots.id = entries.root_id
					WHERE ${BACKGROUND_ENRICHMENT_ROOT_SQL}
						${exclusion}
					ORDER BY media_metadata_refresh.content_id, entries.id
					LIMIT 1`,
				)
				.get(...excluded)) as ContentCandidateRow | undefined
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
					.prepare(
						`SELECT state, retry_at, last_error, width, height,
							EXISTS (SELECT 1 FROM media_metadata_refresh WHERE content_id = media_metadata.content_id) AS refresh
						FROM media_metadata WHERE content_id = ?`,
					)
					.get(content.id)) as
					| {
							state: 'pending' | 'ready' | 'failed'
							retry_at: number | null
							last_error: string | null
							width: number | null
							height: number | null
							refresh: number
					  }
					| undefined,
			priority,
		)
		if (!current) return
		// A background refresh re-extracts ready metadata in place, so the item
		// stays visible meanwhile and keeps its last good values if it fails.
		const refreshing = current.state === 'ready' && !onDemand && Boolean(current.refresh)
		if (current.state === 'ready' && !refreshing) return
		if (
			current.state === 'failed' &&
			(current.retry_at === null || (!onDemand && current.retry_at > Date.now())) &&
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
				// Where it was taken, by name (see places.ts)
				const place =
					metadata.latitude === undefined || metadata.longitude === undefined
						? undefined
						: places().at(metadata.latitude, metadata.longitude)
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
								place_city = ?, place_region = ?, place_country = ?, failure_count = 0, retry_at = NULL,
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
								...[place?.city ?? null, place?.region ?? null, place?.country ?? null],
								Date.now(),
								content.id,
							)
						database.prepare('DELETE FROM media_metadata_refresh WHERE content_id = ?').run(content.id)
						return this.#onMediaMetadataReady?.(database, content.id)
					})
					return persist.immediate()
				}, priority)
				afterCommit?.()
				// Renditions take the display shape recorded here. When re-extraction
				// corrects that shape, rebuild them instead of keeping old proportions.
				if (
					current.width !== null &&
					current.height !== null &&
					(Number(current.width) !== metadata.width || Number(current.height) !== metadata.height)
				) {
					await this.#discardContentThumbnails(content, priority).catch((error) =>
						this.logger.error(`Failed to discard outdated renditions of '${content.systemPath}'`, error),
					)
				}
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
				if (refreshing) {
					await this.#withDatabase((database) => {
						database.prepare('DELETE FROM media_metadata_refresh WHERE content_id = ?').run(content.id)
					}, priority)
					throw new PersistedEnrichmentFailure(error)
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
				.prepare('SELECT state, failure_count, retry_at FROM media_metadata WHERE content_id = ?')
				.get(contentId) as FailureState | undefined
			if (!current) return
			const {failureCount, retryAt} = nextFailureState(current, error, referenceFailure)
			database
				.prepare(
					`UPDATE media_metadata SET state = 'failed', failure_count = ?, retry_at = ?, last_error = ?, updated_at = ?
					WHERE content_id = ?`,
				)
				.run(failureCount, retryAt, persistedFailureMessage(error, referenceFailure), Date.now(), contentId)
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
							WHERE variant IN (${variants.map(() => '?').join(', ')}) AND state = 'failed' AND retry_at IS NOT NULL
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
							WHERE state = 'failed' AND retry_at IS NOT NULL
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
				// A document or recording has no preview to wait for: the models can
				// read it as soon as its content is known
				const readable = backgroundEntry && this.#embeddings.available() && readableKind(candidate.systemPath)
				if (readable)
					database
						.prepare(
							`INSERT INTO model_work(content_id, model, state) VALUES (?, ?, 'pending')
						ON CONFLICT DO NOTHING`,
						)
						.run(content.id, readable === 'document' ? 'text' : 'speech')
				// Another hash of this revision (for example, an upload's move being
				// indexed) may have attached the same content concurrently. Only
				// different content means the file changed.
				const result = database
					.prepare(
						`UPDATE entries SET
							content_id = ?,
							hash_failure_count = 0, hash_retry_at = NULL, hash_error = NULL
						WHERE id = ? AND thumbnail_identity_kind = 'content' AND (content_id IS NULL OR content_id = ?)
							AND inode = ? AND size = ? AND modified_ns = ?
							${expectedRevision ? 'AND ctime_ns = ?' : ''}`,
					)
					.run(
						content.id,
						candidate.id,
						content.id,
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
					((row.retry_at !== null && row.retry_at <= now) ||
						(freshReference && referenceFailureMessage(row.last_error))))
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
						existing?.state === 'failed' &&
						(existing.retry_at === null || (!onDemand && existing.retry_at > Date.now())) &&
						!(freshReference && referenceFailureMessage(existing.last_error))
					) {
						// Opening a folder must not restart decoding that has given up.
						if (onDemand && candidate === variant) {
							throw new PersistedEnrichmentFailure(new Error(existing.last_error ?? 'Thumbnail generation failed'))
						}
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
							`SELECT artifact_key, state, retry_at, last_error FROM transient_thumbnail_variants
							WHERE entry_id = ? AND variant = ?`,
						)
						.get(candidate.id, variant)) as
						| {
								artifact_key: string
								state: 'pending' | 'ready' | 'failed'
								retry_at: number | null
								last_error: string | null
						  }
						| undefined,
				ON_DEMAND_DATABASE_PRIORITY,
			)
			if (
				existing?.artifact_key === identity.key &&
				existing.state === 'ready' &&
				(await this.#thumbnailIsUsable(destination))
			) {
				return
			}
			// Transient thumbnails are only made on demand, so this is what stops
			// every folder view decoding the same broken file again.
			if (existing?.artifact_key === identity.key && existing.state === 'failed' && existing.retry_at === null) {
				throw new PersistedEnrichmentFailure(new Error(existing.last_error ?? 'Thumbnail generation failed'))
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
						`SELECT state, failure_count, retry_at FROM transient_thumbnail_variants
						WHERE entry_id = ? AND variant = ? AND artifact_key = ?`,
					)
					.get(candidate.id, variant, artifactKey) as FailureState | undefined
				const {failureCount, retryAt} = nextFailureState(existing, error, false)
				database
					.prepare(
						`INSERT INTO transient_thumbnail_variants(
							entry_id, variant, artifact_key, state, failure_count, retry_at, last_error, updated_at
						) VALUES (?, ?, ?, 'failed', ?, ?, ?, ?)
						ON CONFLICT(entry_id, variant) DO UPDATE SET
							artifact_key = excluded.artifact_key, state = 'failed',
							failure_count = excluded.failure_count, retry_at = excluded.retry_at,
							last_error = excluded.last_error, updated_at = excluded.updated_at`,
					)
					.run(candidate.id, variant, artifactKey, failureCount, retryAt, errorMessage(error), Date.now())
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
				.prepare('SELECT state, failure_count, retry_at FROM thumbnail_variants WHERE content_id = ? AND variant = ?')
				.get(contentId, variant) as FailureState | undefined
			const {failureCount, retryAt} = nextFailureState(existing, error, referenceFailure)
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
				.run(contentId, variant, failureCount, retryAt, persistedFailureMessage(error, referenceFailure), Date.now())
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
			// What the model made of the content goes with its thumbnails
			if (!(await this.#trackedContentHashes([orphan.key])).has(orphan.key)) {
				this.#embeddingsStore?.delete(Buffer.from(orphan.key, 'hex'))
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

	async #discardContentThumbnails(content: ContentCandidate, priority: number) {
		for (const variant of ALL_THUMBNAIL_VARIANTS) {
			await this.#remove(thumbnailSystemPath(this.thumbnailDirectory, contentIdentity(content.hash, variant)))
		}
		await this.#markThumbnailPending(
			ALL_THUMBNAIL_VARIANTS.map((variant) => ({contentId: content.id, variant})),
			priority,
		)
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
		// Stop as soon as the file changes. Reading on to the end of a file that
		// is still being written throws away the whole read.
		for await (const chunk of handle.createReadStream({autoClose: false, highWaterMark: 1024 * 1024})) {
			hasher.update(chunk)
			await assertHandleContentRevision(handle, expected)
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
	sourceFileDescriptor: number,
	onOptionalMetadataFailure?: (error: unknown) => void,
): Promise<MediaMetadata> {
	const kind = photoKind(systemPath)
	if (!kind) throw new Error('Unsupported media source')
	if (kind === 'video') return extractVideoMetadata(systemPath, sourceFileDescriptor, onOptionalMetadataFailure)
	return extractPhotoMetadata(systemPath, sourceFileDescriptor)
}

async function extractPhotoMetadata(systemPath: string, sourceFileDescriptor: number): Promise<MediaMetadata> {
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
	sourceFileDescriptor: number,
	onOptionalMetadataFailure?: (error: unknown) => void,
): Promise<MediaMetadata> {
	// FFprobe is authoritative only for the playable video stream. ExifTool owns
	// semantic metadata for every media type, but remains optional for videos: an
	// unusual vendor trailer must never make otherwise playable media disappear.
	// Both are waited for even when the probe fails. Each run reopens the held
	// descriptor when it starts, so the caller must not close it, and let its
	// number be reused, while a run has yet to start.
	const [probe, exif] = await Promise.allSettled([
		probeVideoStream(sourceFileDescriptor),
		extractExifMetadata(systemPath, sourceFileDescriptor),
	])
	if (probe.status === 'rejected') throw probe.reason
	const video = probe.value
	let exifMetadata: ExtractedExifMetadata = {metadata: {}, spherical: false}
	if (exif.status === 'fulfilled') exifMetadata = exif.value
	else onOptionalMetadataFailure?.(exif.reason)
	return {
		kind: 'video',
		...(exifMetadata.spherical ? {subKind: 'spherical' as const} : {}),
		width: video.width,
		height: video.height,
		...(video.durationMs === undefined ? {} : {durationMs: video.durationMs}),
		...exifMetadata.metadata,
	}
}

// One frame of a video for a model to read, as a JPEG no larger than `size`
// either way, and when in the video it is: the first frame from `fromMs` that
// can be decoded on its own. Such a frame costs one frame to decode, where
// the frame at an exact moment costs every frame since the one before it that
// can, which is most of what reading a frame of a 4K video takes. Where the
// video has none before `toMs`, the frame at `middleMs` exactly: the next one
// that can be decoded on its own may be a long way on, and is another
// moment's to read.
async function extractVideoFrame(sourceFileDescriptor: number, {fromMs, middleMs, toMs}: VideoMoment, size: number) {
	const frame = async (atMs: number, standalone: boolean) => {
		const {stdout, stderr} = await runMediaTool(
			'ffmpeg',
			[
				// Told to say what it does, FFmpeg says when the frame it wrote is
				...['-nostdin', '-hide_banner', '-nostats', '-loglevel', standalone ? 'info' : 'error', '-threads', '1'],
				...(standalone ? ['-skip_frame', 'nokey'] : []),
				// Before the input, so FFmpeg jumps there instead of decoding its way
				...['-ss', (atMs / 1000).toFixed(3), '-i', 'fd:', '-an', '-frames:v', '1'],
				...['-vf', `scale=${size}:${size}:force_original_aspect_ratio=decrease${standalone ? ',showinfo' : ''}`],
				// The JPEG encoder only takes full-range colour, and refuses a frame
				// in any other unless it is told to convert it
				...['-pix_fmt', 'yuvj420p', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '4', '-'],
			],
			sourceFileDescriptor,
			[],
			{binary: true},
		)
		// When the frame is, counted from the moment asked for
		const after = Number(/Parsed_showinfo.*?pts_time:\s*(-?[\d.]+)/.exec(String(stderr))?.[1]) * 1000
		return {image: stdout as unknown as Buffer, atMs: Math.round(atMs + after)}
	}
	// Past the last such frame FFmpeg writes nothing, or fails for want of one
	const standalone = await frame(fromMs, true).catch(() => undefined)
	if (standalone && standalone.image.length > 0 && standalone.atMs < toMs) return standalone
	const exact = await frame(middleMs, false)
	if (exact.image.length > 0) return {image: exact.image, atMs: middleMs}
	// A video of a frame or two has nothing that far in
	const first = await frame(0, false)
	if (first.image.length === 0) throw new Error('FFmpeg found no frame to read')
	return {image: first.image, atMs: 0}
}

// A still of a video at about a moment in it, as a JPEG no larger than `size`
// either way, for showing where in a video a search found something
export async function videoStill(sourceFileDescriptor: number, atMs: number, size: number) {
	// The frame a search found there, when it is one that is cheap to read
	const moment = {fromMs: atMs, middleMs: atMs, toMs: atMs + STILL_REACH_MS}
	return (await extractVideoFrame(sourceFileDescriptor, moment, size)).image
}

// The text of a document, a page (slide, sheet) at a time
async function readDocumentText(sourceFileDescriptor: number, systemPath: string) {
	const extension = nodePath.extname(systemPath).toLowerCase()
	let text: string
	if (extension === '.pdf') {
		// Poppler is given the descriptor on standard input by name
		text = (await runMediaTool('pdftotext', ['-enc', 'UTF-8', 'fd://0', '-'], sourceFileDescriptor)).stdout
		// Every page ends with a form feed: there is no page after the last
		text = text.replace(/\f$/, '')
	} else if (['.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods', '.rtf', '.html', '.htm'].includes(extension)) {
		text = (await runMediaTool('python3', ['-I', '-c', DOCUMENT_TEXT_SCRIPT, extension], sourceFileDescriptor)).stdout
	} else {
		const start = Buffer.alloc(TEXT_FILE_BYTES)
		const {bytesRead} = await promisify(read)(sourceFileDescriptor, start, 0, start.length, 0)
		text = plainText(start.subarray(0, bytesRead))
	}
	return text.split('\f')
}

// One page of a PDF as a picture, at a size its print can be read at: a page
// of A4 comes out about as large as the previews photos are read from
const PAGE_DPI = 150
// ... and no larger than a page of A0 comes out at that. A page can say it is
// any size, and a picture of a very large one takes gigabytes to make and to
// read: of one that comes out 16,000 pixels square, 1 GB and then 1.5 GB. A
// larger page is made whole, at the resolution it fits at. Lines of text are
// looked for in a picture shrunk to 1,280 pixels whatever its size (see
// text.py in packages/os), so none is found in a larger picture that is not
// found in this one.
const PAGE_MOST_PIXELS = 7022

// The resolution a page is made a picture at, from what pdfinfo says of its
// boxes: of the one Poppler makes the picture of, which is not always the one
// a page is shown by
export function pageDpi(boxes: string) {
	const [, left, bottom, right, top] =
		/^Page\s+\d+\s+MediaBox:\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/m.exec(boxes) ?? []
	// In points, of which there are 72 to an inch
	const longest = Math.max(Math.abs(Number(right) - Number(left)), Math.abs(Number(top) - Number(bottom)))
	return longest > 0 ? Math.max(1, Math.min(PAGE_DPI, Math.floor((PAGE_MOST_PIXELS * 72) / longest))) : PAGE_DPI
}

async function renderDocumentPage(sourceFileDescriptor: number, page: number) {
	const which = ['-f', String(page), '-l', String(page)]
	const dpi = await runMediaTool('pdfinfo', ['-box', ...which, 'fd://0'], sourceFileDescriptor).then(
		({stdout}) => pageDpi(stdout),
		() => PAGE_DPI,
	)
	// No more of a picture than that either way, whatever the page turns out to be
	const most = ['-x', '0', '-y', '0', '-W', String(PAGE_MOST_PIXELS), '-H', String(PAGE_MOST_PIXELS)]
	const {stdout} = await runMediaTool(
		'pdftoppm',
		[...which, '-r', String(dpi), ...most, '-jpeg', 'fd://0'],
		sourceFileDescriptor,
		[],
		{binary: true},
	)
	return stdout as unknown as Buffer
}

// A stretch of the sound of a video or recording, as 16 kHz mono 16-bit
// samples. Nothing where it has no sound, or none that far in.
async function extractSound(sourceFileDescriptor: number, startSeconds: number, seconds: number) {
	try {
		const {stdout} = await runMediaTool(
			'ffmpeg',
			[
				...['-nostdin', '-loglevel', 'error', '-threads', '1'],
				...['-ss', String(startSeconds), '-t', String(seconds), '-i', 'fd:'],
				// The first sound track, when there is one, with silence wherever
				// it has nothing (often its first moments), so that a moment of
				// what comes out is the same moment of the recording
				...['-map', '0:a:0?', '-vn', '-af', 'aresample=async=1:first_pts=0'],
				...['-ac', '1', '-ar', '16000', '-f', 's16le', '-'],
			],
			sourceFileDescriptor,
			[],
			{binary: true},
		)
		return stdout as unknown as Buffer
	} catch (error) {
		// With no sound track there is no output to write, which FFmpeg calls a failure
		if (/does not contain any stream|matches no streams/.test(String((error as {stderr?: unknown}).stderr))) {
			return Buffer.alloc(0)
		}
		throw error
	}
}

// How long a video or recording is by its own account, in seconds. Where it
// gives none, it is as long as there is sound in it.
async function soundSeconds(sourceFileDescriptor: number) {
	const {stdout} = await runMediaTool(
		'ffprobe',
		['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', 'fd:'],
		sourceFileDescriptor,
	)
	const seconds = Number.parseFloat(stdout)
	return Number.isFinite(seconds) ? seconds : Number.POSITIVE_INFINITY
}

async function probeVideoStream(sourceFileDescriptor: number) {
	const {stdout} = await runMediaTool(
		'ffprobe',
		[
			'-v',
			'error',
			'-show_entries',
			'stream=codec_type,width,height,sample_aspect_ratio,duration:stream_tags=rotate:stream_side_data=rotation,crop_top,crop_bottom,crop_left,crop_right:format=duration',
			'-of',
			'json',
			// The descriptor on standard input, which FFmpeg can seek in
			'fd:',
		],
		sourceFileDescriptor,
	)
	const probe = JSON.parse(stdout) as {
		streams?: Array<{
			codec_type?: string
			width?: number
			height?: number
			sample_aspect_ratio?: string
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
	// Anamorphic video stores non-square pixels: players stretch each stored
	// row by the sample aspect ratio, so 352x576 at 24:11 displays as 768x576.
	// The stretch is horizontal in stored pixels and so turns with rotation.
	const sampleAspectRatio = parseRational(stream.sample_aspect_ratio?.replace(':', '/'))
	const pixelAspectRatio = sampleAspectRatio && sampleAspectRatio > 0 ? sampleAspectRatio : 1
	const displayWidth = Math.round((croppedWidth > 0 ? croppedWidth : stream.width) * pixelAspectRatio)
	const displayHeight = croppedHeight > 0 ? croppedHeight : stream.height
	const rotated = Math.abs(rotation) % 180 === 90
	const durationSeconds = [stream.duration, probe.format?.duration].map(Number).find(Number.isFinite)
	return {
		width: rotated ? displayHeight : displayWidth,
		height: rotated ? displayWidth : displayHeight,
		rotated,
		pixelAspectRatio,
		...(durationSeconds === undefined ? {} : {durationMs: Math.max(0, Math.round(durationSeconds * 1000))}),
	}
}

type ExtractedExifMetadata = {
	metadata: Omit<Partial<MediaMetadata>, 'kind' | 'subKind' | 'width' | 'height' | 'durationMs'>
	imageWidth?: number
	imageHeight?: number
	orientation?: number
	spherical: boolean
}

async function extractExifMetadata(systemPath: string, sourceFileDescriptor: number): Promise<ExtractedExifMetadata> {
	const extension = nodePath.extname(systemPath).toLowerCase()
	const extractEmbedded = extension === '.insv'
	const cameraRaw = CAMERA_RAW_EXTENSIONS.has(extension)
	// A normal QuickTime scan must decode the Apple VideoKeys table before leaf
	// requests can select from it. Camera RAW also needs its full dependency scan
	// so Composite:ImageSize resolves the primary image rather than an IFD0 preview.
	// IgnoreTags=all remains useful for ordinary photos and the much larger INSV
	// embedded-document scan.
	const ignoreUnrequestedTags = (photoKind(systemPath) === 'photo' && !cameraRaw) || extractEmbedded
	const {stdout} = await runMediaTool(
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
			SOURCE_PATH,
		],
		sourceFileDescriptor,
		[],
		{sourceAtPath: true},
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
	variant: ThumbnailVariant,
	sourceFileDescriptor: number,
) {
	return generateThumbnailFiles(systemPath, [{destination, variant}], sourceFileDescriptor)
}

export async function generateThumbnailFiles(
	systemPath: string,
	outputs: ThumbnailOutput[],
	sourceFileDescriptor: number,
) {
	if (outputs.length === 0) return
	const video = photoKind(systemPath) === 'video'
	const extension = nodePath.extname(systemPath).toLowerCase()
	// ImageMagick reads the source from standard input, where there is no
	// filename extension.
	let source: string
	if (video) {
		// The WebP frame FFmpeg extracted, arriving on a pipe
		source = 'webp:-[0]'
	} else if (CAMERA_RAW_EXTENSIONS.has(extension)) {
		// Camera RAW needs an explicit coder because its container can be
		// mistaken for TIFF, or only expose a small embedded preview
		source = `${extension.slice(1).toUpperCase()}:-[0]`
	} else {
		// Told the format, ImageMagick decodes these straight from the
		// descriptor. Left to work the format out itself, it first copies the
		// whole source to its temporary directory, which is memory in the
		// sandbox. That remains for the formats whose decoders need a file to
		// open: camera RAW above, and HEIC and AVIF.
		const coder = await streamableImageCoder(sourceFileDescriptor)
		source = coder ? `${coder}:fd:0[0]` : '-[0]'
	}
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
		source,
		'-auto-orient',
	]
	// FFmpeg hands ImageMagick an anamorphic frame in its stored, non-square
	// pixels (already rotated). Stretch it to the shape players display. The
	// probe only refines the frame, so a failed one leaves it as decoded.
	if (video) {
		const {rotated, pixelAspectRatio} = await probeVideoStream(sourceFileDescriptor).catch(() => ({
			rotated: false,
			pixelAspectRatio: 1,
		}))
		if (pixelAspectRatio !== 1) {
			const stretch = `${pixelAspectRatio * 100}%`
			arguments_.push('-resize', rotated ? `100%x${stretch}` : `${stretch}x100%`)
		}
	}
	// A sandboxed tool can't open the destinations, so open them here and have
	// ImageMagick write each rendition to the descriptor it inherits, from 3 up.
	const destinations: Array<Awaited<ReturnType<typeof open>>> = []
	try {
		for (const {destination, variant} of outputs) {
			const definition = THUMBNAIL_VARIANTS[variant]
			destinations.push(await open(destination, 'w'))
			arguments_.push(
				'(',
				'+clone',
				'-thumbnail',
				`${definition.width}x${definition.height}^>`,
				'-quality',
				String(definition.quality),
				'-write',
				`${definition.format}:fd:${2 + destinations.length}`,
				'+delete',
				')',
			)
		}
		arguments_.push('null:')
		const outputFileDescriptors = destinations.map((destination) => destination.fd)
		if (video) {
			await runMediaTool(
				'sh',
				['-c', VIDEO_FRAME_PIPELINE, 'sh', 'convert', ...arguments_],
				sourceFileDescriptor,
				outputFileDescriptors,
			)
		} else {
			await runMediaTool('convert', arguments_, sourceFileDescriptor, outputFileDescriptors)
		}
	} finally {
		await Promise.all(destinations.map((destination) => destination.close()))
	}
}

// The ImageMagick coder for a still image that can be decoded from a
// descriptor without a temporary copy, told from its first bytes the way
// ImageMagick itself tells formats apart
export async function streamableImageCoder(sourceFileDescriptor: number) {
	const header = Buffer.alloc(12)
	// A positional read, which leaves the descriptor's offset alone
	const {bytesRead} = await promisify(read)(sourceFileDescriptor, header, 0, header.length, 0)
	const starts = (bytes: string, offset = 0) =>
		bytesRead >= offset + bytes.length && header.toString('latin1', offset, offset + bytes.length) === bytes
	if (starts('\xff\xd8\xff')) return 'JPEG'
	if (starts('\x89PNG\r\n\x1a\n')) return 'PNG'
	if (starts('GIF87a') || starts('GIF89a')) return 'GIF'
	if (starts('RIFF') && starts('WEBP', 8)) return 'WEBP'
	if (starts('II*\0') || starts('MM\0*')) return 'TIFF'
	if (starts('BM')) return 'BMP'
}

export async function extractThumbnailTint(thumbnailPath: string) {
	const thumbnail = await open(thumbnailPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
	try {
		const {stdout} = await runMediaTool(
			'convert',
			['webp:-', '-resize', '1x1!', '-format', '%[fx:round(255*r)],%[fx:round(255*g)],%[fx:round(255*b)]', 'info:'],
			thumbnail.fd,
		)
		const channels = stdout.split(',').map(Number)
		if (
			channels.length !== 3 ||
			channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)
		) {
			throw new Error('ImageMagick returned an invalid thumbnail tint')
		}
		return (channels[0]! << 16) | (channels[1]! << 8) | channels[2]!
	} finally {
		await thumbnail.close()
	}
}

function killProcessGroup(pid: number) {
	try {
		process.kill(-pid, 'SIGKILL')
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
	}
}

// Where a tool that has to open its source by path finds it
const SOURCE_PATH = '/source'

// Runs a media tool in the sandbox (see utilities/sandbox.ts). The tool can't
// open any path, so it reads the source from standard input and writes each
// output to a descriptor from 3 up. It reads exactly the file umbreld opened,
// whoever owns that file and whatever is at its path by now.
//
// ExifTool can't work that way. It keeps all it reads from standard input in
// memory, which for a video is the whole file, and only moves around in a
// file it opened itself. So it is shown the same open file at SOURCE_PATH,
// and runs as root to be able to open it whoever owns it.
async function runMediaTool(
	command: string,
	arguments_: string[],
	sourceFileDescriptor: number,
	outputFileDescriptors: number[] = [],
	{sourceAtPath = false, binary = false}: {sourceAtPath?: boolean; binary?: boolean} = {},
) {
	// Reopen the held descriptor so this run has a read offset of its own.
	// Several tools read the same source, sometimes at the same time, and each
	// must start from the beginning of the file, not where another left off.
	const source = await open(`/dev/fd/${sourceFileDescriptor}`, fsConstants.O_RDONLY)
	let process: ExecaChildProcess | undefined
	try {
		// No network, no GPU and no path: only the descriptors handed over.
		// The memory is twice what the largest decode measured needs, an 8K
		// video frame at just under 2 GiB. The queues run as many of these at
		// once as the device has cores to spare for them, which counts on
		// each using one core. ImageMagick is told to; the RAW decoder starts
		// a thread per core unless the limit tells it otherwise.
		const sandbox = {
			network: false,
			gpu: false,
			readablePaths: [],
			writablePaths: [],
			memoryLimit: 4 * GiB,
			cpuLimit: 1,
			...(sourceAtPath ? {user: 'root' as const, readableFile: {descriptor: 3, path: SOURCE_PATH}} : {}),
		}
		process = sandboxed(command, arguments_, sandbox, {
			detached: true,
			timeout: THUMBNAIL_GENERATION_TIMEOUT_MS,
			killSignal: 'SIGKILL',
			stdio: sourceAtPath
				? ['ignore', 'pipe', 'pipe', source.fd]
				: [source.fd, 'pipe', 'pipe', ...outputFileDescriptors],
			// What the tool writes is a file's bytes, not text
			...(binary ? {encoding: null} : {}),
		} as ExecaOptions)
		return await process
	} catch (error) {
		if ((error as {timedOut?: boolean}).timedOut && process?.pid !== undefined) killProcessGroup(process.pid)
		throw error
	} finally {
		await source.close()
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

type FailureState = {state: 'pending' | 'ready' | 'failed'; failure_count: number; retry_at: number | null}

// The failure count and next attempt after a failed thumbnail or metadata
// extraction, with a null retry once it has given up. A failure while a retry
// is still pending (an on-demand request) doesn't advance the schedule, so
// giving up always takes a minute, an hour and a day.
function nextFailureState(existing: FailureState | undefined, error: unknown, referenceFailure: boolean) {
	const now = Date.now()
	if (existing?.state === 'failed' && existing.retry_at !== null && existing.retry_at > now) {
		return {failureCount: Number(existing.failure_count), retryAt: existing.retry_at}
	}
	const failureCount = Number(existing?.failure_count ?? 0) + 1
	if (referenceFailure || !isDecodeFailure(error)) {
		return {failureCount, retryAt: now + retryDelay(THUMBNAIL_RETRY_BASE_MS, failureCount)}
	}
	const delay = CONTENT_RETRY_DELAYS_MS[failureCount - 1]
	return {failureCount, retryAt: delay === undefined ? null : now + delay}
}

// Whether a decoder ran and rejected the file. System errors (a full disk, an
// unreadable file), SQLite errors, timeouts and killed processes say nothing
// about the content, so they never give up.
function isDecodeFailure(error: unknown) {
	if (!(error instanceof Error)) return true
	const {code, timedOut, signal} = error as {code?: unknown; timedOut?: boolean; signal?: unknown}
	if (typeof code === 'string' || timedOut || signal) return false
	return !/time limit exceeded/i.test(error.message)
}

// A release may fix what made content undecodable (a newer ImageMagick,
// ExifTool or FFmpeg, or a pipeline fix), so each umbreld version gives
// content that gave up one more attempt. Attempts are spread over a day so an
// update doesn't start with a burst of decoding. Each content's slot comes from
// its id, so its thumbnail sizes and metadata are retried together and the
// sizes share one decode.
export function retryGivenUpEnrichmentAfterUpdate(database: Database, release: string) {
	const stored = database.prepare(`SELECT value FROM index_state WHERE key = 'enrichment_release'`).get() as
		| {value: string}
		| undefined
	if (stored?.value === release) return
	const retry = database.transaction(() => {
		const now = Date.now()
		let rows = 0
		for (const table of ['thumbnail_variants', 'media_metadata']) {
			rows += database
				.prepare(
					`UPDATE ${table} SET failure_count = ?, retry_at = ? + (content_id * 2654435761) % ?
					WHERE state = 'failed' AND retry_at IS NULL`,
				)
				.run(MAX_CONTENT_FAILURES - 1, now, RELEASE_RETRY_SPREAD_MS).changes
		}
		// Transient thumbnails are only made on demand, so the next view retries.
		rows += database
			.prepare(
				`UPDATE transient_thumbnail_variants SET failure_count = ?, retry_at = ?
				WHERE state = 'failed' AND retry_at IS NULL`,
			)
			.run(MAX_CONTENT_FAILURES - 1, now).changes
		database
			.prepare(
				`INSERT INTO index_state(key, value) VALUES ('enrichment_release', ?)
				ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
			)
			.run(release)
		return rows
	})
	return {previous: stored?.value, rows: retry.immediate()}
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

// A while, in whole minutes, for the log
function inMinutes(ms: number) {
	return Math.round(ms / 60_000)
}
