import nodePath from 'node:path'
import {Worker, type WorkerOptions} from 'node:worker_threads'

import fse from 'fs-extra'

import {
	DEFAULT_WATCHER_BULK_THRESHOLD,
	type FileIndexLogger,
	type FileIndexRoot,
	type IndexedDirectorySize,
	type IndexedEntry,
	type SearchCandidate,
	type WatcherChange,
} from './file-index-engine.js'
import type {PublishedFileRevision, ThumbnailReference} from './file-index-enrichment.js'
import {PHOTOS_THUMBNAIL_VARIANTS, type ThumbnailVariant} from './thumbnail-support.js'
import type {
	PhotoAlbum,
	PhotoFilter,
	PhotoIndexingProgress,
	PhotoIndexingState,
	PhotoItem,
	PhotoItemDetail,
	PhotoScopeMode,
	PhotoSource,
	PhotoSummary,
} from '../photos/types.js'
import {
	deserializeError,
	type FileIndexNotificationMethod,
	type FileIndexRequestMethod,
	type FileIndexWorkerData,
	type FileIndexWorkerInboundMessage,
	type FileIndexWorkerOutboundMessage,
} from './file-index-worker-protocol.js'

const DEFAULT_WORKER_RESTART_DELAY_MS = 1000
const MAX_WORKER_RESTART_DELAY_MS = 60_000
// Opening the worker can include a transactional schema migration over every
// indexed entry. Keep startup bounded, but allow large existing indexes enough
// time to migrate on slower disks (1.1 million entries takes ~25 seconds).
const DEFAULT_WORKER_BOOT_TIMEOUT_MS = 10 * 60_000
const DEFAULT_WORKER_SHUTDOWN_TIMEOUT_MS = 30_000

type WorkerFactory = (url: URL, options: WorkerOptions) => Worker

export type FileIndexOptions = {
	dataDirectory: string
	logger: FileIndexLogger
	hiddenFiles: string[]
	hiddenExtensions: string[]
	reconciliationIntervalMs?: number
	recoveryRetryMs?: number
	watcherBulkThreshold?: number
	batchSize?: number
	onPhotosChange?: (accountIds: string[]) => void
	onPhotosIndexingProgress?: (progress: PhotoIndexingProgress[]) => void
}

export type FileIndexRuntime = {
	createWorker?: WorkerFactory
	workerRestartDelayMs?: number
	workerBootTimeoutMs?: number
	workerShutdownTimeoutMs?: number
}

type PendingRequest = {
	generation: number
	resolve: (result: unknown) => void
	reject: (error: unknown) => void
}

type ReadyWaiter = {
	generation: number
	resolve: () => void
	reject: (error: unknown) => void
}

export default class FileIndex {
	readonly logger: FileIndexLogger
	readonly databasePath: string

	#indexDirectory: string
	#thumbnailDirectory: string
	#workerData: FileIndexWorkerData
	#createWorker: WorkerFactory
	#workerRestartDelayMs: number
	#workerBootTimeoutMs: number
	#workerShutdownTimeoutMs: number
	#watcherBulkThreshold: number
	#worker?: Worker
	#workerGeneration = 0
	#workerThreadId?: number
	#workerReady = false
	#readyWaiter?: ReadyWaiter
	#launch?: Promise<void>
	#restartTimer?: ReturnType<typeof setTimeout>
	#restartAttempts = 0
	#nextRequestId = 1
	#pendingRequests = new Map<number, PendingRequest>()
	#roots = new Map<string, FileIndexRoot>()
	#available = false
	#started = false
	#stopping = false
	#backgroundReconciliationStarted = false
	#enabledThumbnailVariants = new Set<ThumbnailVariant>()
	#onPhotosChange?: (accountIds: string[]) => void
	#onPhotosIndexingProgress?: (progress: PhotoIndexingProgress[]) => void
	#rebuild?: Promise<void>

	constructor(
		{
			dataDirectory,
			logger,
			hiddenFiles,
			hiddenExtensions,
			reconciliationIntervalMs,
			recoveryRetryMs,
			watcherBulkThreshold = DEFAULT_WATCHER_BULK_THRESHOLD,
			batchSize,
			onPhotosChange,
			onPhotosIndexingProgress,
		}: FileIndexOptions,
		{
			createWorker = (url, options) => new Worker(url, options),
			workerRestartDelayMs = DEFAULT_WORKER_RESTART_DELAY_MS,
			workerBootTimeoutMs = DEFAULT_WORKER_BOOT_TIMEOUT_MS,
			workerShutdownTimeoutMs = DEFAULT_WORKER_SHUTDOWN_TIMEOUT_MS,
		}: FileIndexRuntime = {},
	) {
		this.logger = logger
		this.#indexDirectory = nodePath.join(dataDirectory, 'file-index')
		this.#thumbnailDirectory = nodePath.join(dataDirectory, 'thumbnails')
		this.databasePath = nodePath.join(this.#indexDirectory, 'index.db')
		this.#workerData = {
			dataDirectory,
			hiddenFiles: [...hiddenFiles],
			hiddenExtensions: [...hiddenExtensions],
			reconciliationIntervalMs,
			recoveryRetryMs,
			watcherBulkThreshold,
			batchSize,
		}
		this.#createWorker = createWorker
		this.#workerRestartDelayMs = workerRestartDelayMs
		this.#workerBootTimeoutMs = workerBootTimeoutMs
		this.#workerShutdownTimeoutMs = workerShutdownTimeoutMs
		this.#watcherBulkThreshold = watcherBulkThreshold
		this.#onPhotosChange = onPhotosChange
		this.#onPhotosIndexingProgress = onPhotosIndexingProgress
	}

	get available() {
		return this.#available
	}

	get workerThreadId() {
		return this.#workerThreadId
	}

	async start() {
		if (this.#started) return this.#launch
		this.#started = true
		this.#stopping = false
		await this.#launchWorker()
	}

	async #launchWorker() {
		if (this.#launch) return this.#launch
		const launch = this.#bootWorker().catch((error) => {
			if (!this.#stopping) {
				this.logger.error('Failed to start file index worker', error)
				this.#scheduleRestart()
			}
		})
		this.#launch = launch
		try {
			await launch
		} finally {
			if (this.#launch === launch) this.#launch = undefined
		}
	}

	async #bootWorker() {
		if (!this.#started || this.#stopping || this.#worker) return
		const generation = ++this.#workerGeneration
		const worker = this.#createWorker(new URL('./file-index-worker-bootstrap.js', import.meta.url), {
			workerData: this.#workerData,
			execArgv: [],
			name: 'file-index',
		})
		this.#worker = worker
		this.#workerReady = false
		worker.on('message', (message: FileIndexWorkerOutboundMessage) => this.#handleMessage(worker, generation, message))
		worker.on('error', (error) => {
			if (this.#worker === worker && !this.#stopping) this.logger.error('File index worker error', error)
		})
		worker.once('exit', (code) => this.#handleExit(worker, generation, code))

		try {
			await withTimeout(
				(async () => {
					await new Promise<void>((resolve, reject) => {
						this.#readyWaiter = {generation, resolve, reject}
					})
					await this.#requestFor(worker, generation, 'setRoots', [[...this.#roots.values()]])
					await this.#requestFor(worker, generation, 'start', [])
					if (this.#enabledThumbnailVariants.size > 0) {
						await this.#requestFor(worker, generation, 'enableThumbnailVariants', [[...this.#enabledThumbnailVariants]])
					}
				})(),
				this.#workerBootTimeoutMs,
				'File index worker startup timed out',
			)
			if (this.#backgroundReconciliationStarted) {
				this.#notifyFor(worker, generation, 'startBackgroundReconciliation', [])
			}
			this.#workerReady = true
			this.#restartAttempts = 0
			this.logger.log(`Started file index worker thread ${this.#workerThreadId}`)
		} catch (error) {
			if (this.#detachWorker(worker, generation, error)) {
				await worker.terminate().catch(() => {})
			}
			throw error
		}
	}

	#handleMessage(worker: Worker, generation: number, message: FileIndexWorkerOutboundMessage) {
		if (this.#worker !== worker || this.#workerGeneration !== generation) return
		switch (message.type) {
			case 'ready':
				this.#workerThreadId = message.threadId
				if (this.#readyWaiter?.generation === generation) {
					this.#readyWaiter.resolve()
					this.#readyWaiter = undefined
				}
				return
			case 'availability':
				this.#available = message.available
				return
			case 'photos-change':
				this.#onPhotosChange?.(message.accountIds)
				return
			case 'photos-indexing-progress':
				this.#onPhotosIndexingProgress?.(message.progress)
				return
			case 'response': {
				const pending = this.#pendingRequests.get(message.id)
				if (!pending || pending.generation !== generation) return
				this.#pendingRequests.delete(message.id)
				if ('error' in message) pending.reject(deserializeError(message.error))
				else pending.resolve(message.result)
				return
			}
			case 'log': {
				const error = message.error ? deserializeError(message.error) : undefined
				if (message.level === 'error') this.logger.error(message.message ?? '', error)
				else if (message.level === 'verbose') this.logger.verbose(message.message ?? '')
				else this.logger.log(message.message)
			}
		}
	}

	#handleExit(worker: Worker, generation: number, code: number) {
		const error = new Error(`File index worker exited with code ${code}`)
		if (!this.#detachWorker(worker, generation, error)) return
		if (!this.#stopping) {
			this.logger.error('File index worker stopped unexpectedly', error)
			this.#scheduleRestart()
		}
	}

	#detachWorker(worker: Worker, generation: number, error: unknown) {
		if (this.#worker !== worker || this.#workerGeneration !== generation) return false
		this.#worker = undefined
		this.#workerThreadId = undefined
		this.#workerReady = false
		this.#available = false
		if (this.#readyWaiter?.generation === generation) {
			this.#readyWaiter.reject(error)
			this.#readyWaiter = undefined
		}
		for (const [id, pending] of this.#pendingRequests) {
			if (pending.generation !== generation) continue
			this.#pendingRequests.delete(id)
			pending.reject(error)
		}
		return true
	}

	#scheduleRestart() {
		if (!this.#started || this.#stopping || this.#worker || this.#restartTimer) return
		const delay = Math.min(this.#workerRestartDelayMs * 2 ** this.#restartAttempts, MAX_WORKER_RESTART_DELAY_MS)
		this.#restartAttempts++
		this.#restartTimer = setTimeout(() => {
			this.#restartTimer = undefined
			void this.#launchWorker()
		}, delay)
	}

	#request<T>(method: FileIndexRequestMethod, args: unknown[]): Promise<T> {
		const worker = this.#worker
		if (!worker || !this.#workerReady) return Promise.reject(new Error('File index worker is unavailable'))
		return this.#requestFor(worker, this.#workerGeneration, method, args) as Promise<T>
	}

	#requestFor(worker: Worker, generation: number, method: FileIndexRequestMethod, args: unknown[]) {
		if (this.#worker !== worker || this.#workerGeneration !== generation) {
			return Promise.reject(new Error('File index worker is unavailable'))
		}
		const id = this.#nextRequestId++
		const message: FileIndexWorkerInboundMessage = {type: 'request', id, method, args}
		return new Promise<unknown>((resolve, reject) => {
			this.#pendingRequests.set(id, {generation, resolve, reject})
			try {
				worker.postMessage(message)
			} catch (error) {
				this.#pendingRequests.delete(id)
				reject(error)
			}
		})
	}

	#notify(method: FileIndexNotificationMethod, args: unknown[]) {
		const worker = this.#worker
		if (worker && this.#workerReady) this.#notifyFor(worker, this.#workerGeneration, method, args)
	}

	#notifyFor(worker: Worker, generation: number, method: FileIndexNotificationMethod, args: unknown[]) {
		if (this.#worker !== worker || this.#workerGeneration !== generation) return
		const message: FileIndexWorkerInboundMessage = {type: 'notification', method, args}
		try {
			worker.postMessage(message)
		} catch (error) {
			this.logger.error(`Failed to notify file index worker about '${method}'`, error)
		}
	}

	async setRoots(roots: FileIndexRoot[]) {
		this.#roots = new Map(roots.map((root) => [root.virtualPath, {...root}]))
		if (this.#workerReady) await this.#request('setRoots', [[...this.#roots.values()]])
	}

	async addRoot(root: FileIndexRoot) {
		this.#roots.set(root.virtualPath, {...root})
		if (this.#workerReady) await this.#request('addRoot', [root])
	}

	async removeRoot(virtualPath: string) {
		this.#roots.delete(virtualPath)
		if (this.#workerReady) await this.#request('removeRoot', [virtualPath])
	}

	startBackgroundReconciliation() {
		this.#backgroundReconciliationStarted = true
		this.#notify('startBackgroundReconciliation', [])
	}

	scheduleFullReconciliation(reason: string) {
		this.#notify('scheduleFullReconciliation', [reason])
	}

	async reconcileAll(reason: string) {
		if (!this.#workerReady) return
		await this.#request('reconcileAll', [reason])
	}

	async reconcileRoot(virtualPath: string, reason: string) {
		if (!this.#workerReady) return
		await this.#request('reconcileRoot', [virtualPath, reason])
	}

	async ensureThumbnail(systemPath: string, variant?: ThumbnailVariant) {
		return this.#request<ThumbnailReference>('ensureThumbnail', [systemPath, variant])
	}

	async photosRegisterUpload(
		accountId: string,
		systemPath: string,
		hash: Buffer,
		expectedRevision: PublishedFileRevision,
		albumId?: string,
	) {
		return this.#request<{status: 'imported'; itemId: string; uploadedItemId: string}>('photosRegisterUpload', [
			accountId,
			systemPath,
			hash,
			expectedRevision,
			albumId,
		])
	}

	async photosUpsertBackupSource(accountId: string, sourceId: string, name: string, createdAt: number) {
		return this.#request<boolean>('photosUpsertBackupSource', [accountId, sourceId, name, createdAt])
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
		return this.#request<{resourceKey: string; path: string; bytes: number}>('photosRegisterBackupResource', [
			accountId,
			sourceId,
			resourceKey,
			systemPath,
			hash,
			expectedRevision,
			originalFilename,
			sourceCreationDate,
		])
	}

	async photosConfirmedBackupResources(accountId: string, sourceId: string, resourceKeys: string[]) {
		return this.#request<
			Array<{
				resourceKey: string
				contentHash: Buffer
				path?: string
				bytes?: number
				revision?: {device: string; inode: string; size: number; modifiedNs: string; ctimeNs: string}
			}>
		>('photosConfirmedBackupResources', [accountId, sourceId, resourceKeys])
	}

	async photosPrepareUpload(accountId: string, hash: Buffer, albumId?: string) {
		return this.#request<{status: 'new'} | {status: 'duplicate'; itemId: string}>('photosPrepareUpload', [
			accountId,
			hash,
			albumId,
		])
	}

	async getExistingThumbnail(systemPath: string, variant?: ThumbnailVariant) {
		if (!this.#workerReady) return
		return this.#request<ThumbnailReference | undefined>('getExistingThumbnail', [systemPath, variant])
	}

	async enableThumbnailVariants(variants: ThumbnailVariant[]) {
		for (const variant of variants) this.#enabledThumbnailVariants.add(variant)
		if (!this.#workerReady) return
		await this.#request('enableThumbnailVariants', [variants])
	}

	async initializePhotos(accountId?: string) {
		for (const variant of PHOTOS_THUMBNAIL_VARIANTS) this.#enabledThumbnailVariants.add(variant)
		return this.#request<boolean>('initializePhotos', [accountId])
	}

	async photosSummary(accountId: string) {
		return this.#request<PhotoSummary>('photosSummary', [accountId])
	}

	async photosIndexingState(accountId: string) {
		return this.#request<PhotoIndexingState>('photosIndexingState', [accountId])
	}

	async photosListItems(accountId: string, filter: PhotoFilter, cursor: string | undefined, limit: number) {
		return this.#request<{items: PhotoItem[]; total?: number; nextCursor?: string}>('photosListItems', [
			accountId,
			filter,
			cursor,
			limit,
		])
	}

	async photosGetItem(accountId: string, id: string, deleted = false) {
		return this.#request<PhotoItemDetail | undefined>('photosGetItem', [accountId, id, deleted])
	}

	async photosNeighbors(accountId: string, id: string, filter: PhotoFilter) {
		return this.#request<{prevId?: string; nextId?: string} | undefined>('photosNeighbors', [accountId, id, filter])
	}

	async photosSetFavorite(accountId: string, ids: string[], favorite: boolean) {
		return this.#request<number>('photosSetFavorite', [accountId, ids, favorite])
	}

	async photosResolveItems(accountId: string, ids: string[]) {
		return this.#request<Array<{id: string; path: string}>>('photosResolveItems', [accountId, ids])
	}

	async photosResolveItemFiles(accountId: string, ids: string[] | undefined, rootKind: 'home' | 'trash') {
		return this.#request<Array<{id: string; path: string; revision: PublishedFileRevision}>>('photosResolveItemFiles', [
			accountId,
			ids,
			rootKind,
		])
	}

	async photosResolveLiveCompanion(accountId: string, id: string) {
		return this.#request<{id: string; path: string} | undefined>('photosResolveLiveCompanion', [accountId, id])
	}

	async photosListAlbums(accountId: string) {
		return this.#request<PhotoAlbum[]>('photosListAlbums', [accountId])
	}

	async photosCreateAlbum(accountId: string, name: string, ids?: string[]) {
		return this.#request<PhotoAlbum>('photosCreateAlbum', [accountId, name, ids])
	}

	async photosRenameAlbum(accountId: string, id: string, name: string) {
		return this.#request<number>('photosRenameAlbum', [accountId, id, name])
	}

	async photosSetAlbumCover(accountId: string, id: string, itemId?: string) {
		return this.#request<number>('photosSetAlbumCover', [accountId, id, itemId])
	}

	async photosDeleteAlbum(accountId: string, id: string) {
		return this.#request<number>('photosDeleteAlbum', [accountId, id])
	}

	async photosAddAlbumItems(accountId: string, id: string, ids: string[]) {
		return this.#request<number>('photosAddAlbumItems', [accountId, id, ids])
	}

	async photosRemoveAlbumItems(accountId: string, id: string, ids: string[]) {
		return this.#request<number>('photosRemoveAlbumItems', [accountId, id, ids])
	}

	async photosListSources(accountId: string) {
		return this.#request<PhotoSource[]>('photosListSources', [accountId])
	}

	async photosUpdateSource(accountId: string, id: string, scope?: {mode: PhotoScopeMode; paths: string[]}) {
		return this.#request<PhotoSource | undefined>('photosUpdateSource', [accountId, id, scope])
	}

	async photosSourceRemovalFiles(accountId: string, id: string) {
		return this.#request<Array<{id: string; path: string; revision: PublishedFileRevision}>>(
			'photosSourceRemovalFiles',
			[accountId, id],
		)
	}

	async photosRemoveSource(accountId: string, id: string, keepItems: boolean) {
		return this.#request<boolean>('photosRemoveSource', [accountId, id, keepItems])
	}

	async matchesThumbnail(systemPath: string, kind: string, key: string, variant: string) {
		if (!this.#workerReady) return false
		return this.#request<boolean>('matchesThumbnail', [systemPath, kind, key, variant])
	}

	noteWatcherChanges(virtualPath: string, events: readonly WatcherChange[]) {
		if (!this.#started || !this.#workerReady || events.length === 0) return
		if (events.length >= this.#watcherBulkThreshold) {
			this.#notify('noteWatcherBurst', [virtualPath])
			return
		}
		this.#notify('noteWatcherChanges', [virtualPath, events])
	}

	async reconcilePath(systemPath: string) {
		if (!this.#workerReady) return
		await this.#request('reconcilePath', [systemPath])
	}

	async removePath(systemPath: string) {
		if (!this.#workerReady) return
		await this.#request('removePath', [systemPath])
	}

	async movePath(sourceSystemPath: string, destinationSystemPath: string) {
		if (!this.#workerReady) return
		await this.#request('movePath', [sourceSystemPath, destinationSystemPath])
	}

	async movePathRequired(sourceSystemPath: string, destinationSystemPath: string) {
		if (!this.#workerReady) throw new Error('[file-index-unavailable]')
		await this.#request('movePath', [sourceSystemPath, destinationSystemPath])
	}

	async createUmbrelDatabaseBackup(destinationPath: string) {
		await this.#request('createUmbrelDatabaseBackup', [destinationPath])
	}

	async getEntryByVirtualPath(virtualPath: string) {
		if (!this.#workerReady) return undefined
		return this.#request<IndexedEntry | undefined>('getEntryByVirtualPath', [virtualPath])
	}

	async getEntryBySystemPath(systemPath: string) {
		if (!this.#workerReady) return undefined
		return this.#request<IndexedEntry | undefined>('getEntryBySystemPath', [systemPath])
	}

	async searchCandidates(virtualRoot: string, query: string, maxResults: number) {
		return this.#request<SearchCandidate[]>('searchCandidates', [virtualRoot, query, maxResults])
	}

	async recentCandidates(virtualRoot: string, maxResults: number, excludedDirectoryNames: readonly string[] = []) {
		return this.#request<SearchCandidate[]>('recentCandidates', [virtualRoot, maxResults, excludedDirectoryNames])
	}

	async directorySizes(virtualPaths: readonly string[]) {
		if (!this.#workerReady) return []
		return this.#request<IndexedDirectorySize[]>('directorySizes', [virtualPaths])
	}

	async status() {
		if (!this.#workerReady) {
			return {
				available: false,
				readers: {threadIds: [] as number[], active: 0, queued: 0},
				schemaVersion: 0,
				entryCount: 0,
				enrichment: {
					eligibleEntries: 0,
					hashedEntries: 0,
					pendingHashes: 0,
					hashFailures: 0,
					uniqueContents: 0,
					readyThumbnails: 0,
					thumbnailFailures: 0,
				},
				roots: [],
				workerThreadId: undefined,
			}
		}
		const status = await this.#request<{
			available: boolean
			schemaVersion: number
			readers: {threadIds: number[]; active: number; queued: number}
			entryCount: number
			enrichment: {
				eligibleEntries: number
				hashedEntries: number
				pendingHashes: number
				hashFailures: number
				uniqueContents: number
				readyThumbnails: number
				thumbnailFailures: number
			}
			roots: Array<{
				virtualPath: string
				state: 'warming' | 'ready' | 'degraded'
				scanGeneration: number
				lastSuccessfulScanAt?: number
				lastError?: string
			}>
		}>('status', [])
		return {...status, workerThreadId: this.#workerThreadId}
	}

	async rebuild() {
		if (this.#rebuild) return this.#rebuild
		const rebuild = this.#performRebuild()
		this.#rebuild = rebuild
		try {
			await rebuild
		} finally {
			if (this.#rebuild === rebuild) this.#rebuild = undefined
		}
	}

	async #performRebuild() {
		this.logger.log('Rebuilding file index and enrichment artifacts')
		await this.stop()
		try {
			await Promise.all([fse.remove(this.#indexDirectory), fse.remove(this.#thumbnailDirectory)])
		} finally {
			// Do not leave the index offline if either disposable directory could
			// not be removed. A regular reconciliation can still repair stale state.
			await this.start()
			this.startBackgroundReconciliation()
		}
		this.logger.log('Recreated file index; full reconciliation and enrichment started')
	}

	async stop() {
		if (!this.#started) return
		this.#stopping = true
		this.#started = false
		this.#available = false
		if (this.#restartTimer) clearTimeout(this.#restartTimer)
		this.#restartTimer = undefined
		const launch = this.#launch
		if (launch) {
			const worker = this.#worker
			if (worker) {
				const generation = this.#workerGeneration
				this.#detachWorker(worker, generation, new Error('File index worker stopped during startup'))
				await worker.terminate().catch(() => {})
			}
			await launch
		}
		const worker = this.#worker
		if (worker) {
			const generation = this.#workerGeneration
			await withTimeout(
				this.#requestFor(worker, generation, 'stop', []),
				this.#workerShutdownTimeoutMs,
				'File index worker shutdown timed out',
			).catch((error) => {
				this.logger.error('Failed to stop file index worker cleanly', error)
			})
			await worker.terminate().catch((error) => {
				this.logger.error('Failed to terminate file index worker', error)
			})
			this.#detachWorker(worker, generation, new Error('File index worker stopped'))
		}
		this.#worker = undefined
		this.#workerThreadId = undefined
		this.#workerReady = false
		this.#backgroundReconciliationStarted = false
	}
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
	let timeout: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
			}),
		])
	} finally {
		if (timeout) clearTimeout(timeout)
	}
}

export type {FileIndexRoot, IndexedEntry, SearchCandidate} from './file-index-engine.js'
