import {parentPort, threadId, workerData} from 'node:worker_threads'

import type {PhotoFilter, PhotoScopeMode} from '../photos/types.js'
import FileIndexEngine, {type FileIndexRoot, type WatcherChange} from './file-index-engine.js'
import {
	isFileIndexRoot,
	serializeError,
	type FileIndexNotificationMethod,
	type FileIndexRequestMethod,
	type FileIndexWorkerData,
	type FileIndexWorkerInboundMessage,
	type FileIndexWorkerOutboundMessage,
} from './file-index-worker-protocol.js'
import {isThumbnailVariant, type ThumbnailVariant} from './thumbnail-support.js'
import type {PublishedFileRevision} from './file-index-enrichment.js'

if (!parentPort) throw new Error('File index worker requires a parent port')

const port = parentPort
const options = workerData as FileIndexWorkerData
const post = (message: FileIndexWorkerOutboundMessage) => port.postMessage(message)
const logger = {
	log: (message = '') => post({type: 'log', level: 'log', message}),
	verbose: (message: string) => post({type: 'log', level: 'verbose', message}),
	error: (message: string, error?: unknown) =>
		post({type: 'log', level: 'error', message, ...(error === undefined ? {} : {error: serializeError(error)})}),
}
const isHidden = (name: string) =>
	options.hiddenFiles.includes(name) || options.hiddenExtensions.some((extension) => name.endsWith(extension))

const index = new FileIndexEngine({
	dataDirectory: options.dataDirectory,
	logger,
	isHidden,
	onAvailabilityChange: (available) => post({type: 'availability', available}),
	onPhotosChange: (accountIds) => post({type: 'photos-change', accountIds}),
	onPhotosIndexingProgress: (progress) => post({type: 'photos-indexing-progress', progress}),
	reconciliationIntervalMs: options.reconciliationIntervalMs,
	recoveryRetryMs: options.recoveryRetryMs,
	watcherBulkThreshold: options.watcherBulkThreshold,
	batchSize: options.batchSize,
})

function rootsArg(args: unknown[]) {
	const roots = args[0]
	if (!Array.isArray(roots) || !roots.every(isFileIndexRoot)) throw new TypeError('Expected file index roots')
	return roots
}

function rootArg(args: unknown[], index = 0): FileIndexRoot {
	const root = args[index]
	if (!isFileIndexRoot(root)) throw new TypeError('Expected file index root')
	return root
}

function stringArg(args: unknown[], index = 0) {
	const value = args[index]
	if (typeof value !== 'string') throw new TypeError(`Expected string argument ${index}`)
	return value
}

function numberArg(args: unknown[], index = 0) {
	const value = args[index]
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Expected number argument ${index}`)
	return value
}

function optionalStringArg(args: unknown[], index: number) {
	const value = args[index]
	if (value === undefined) return
	if (typeof value !== 'string') throw new TypeError(`Expected optional string argument ${index}`)
	return value
}

function optionalNumberArg(args: unknown[], index: number) {
	const value = args[index]
	if (value === undefined) return
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new TypeError(`Expected optional number argument ${index}`)
	}
	return value
}

function booleanArg(args: unknown[], index: number) {
	const value = args[index]
	if (typeof value !== 'boolean') throw new TypeError(`Expected boolean argument ${index}`)
	return value
}

function stringsArg(args: unknown[], index: number) {
	const value = args[index]
	if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
		throw new TypeError(`Expected string array argument ${index}`)
	}
	return value
}

function optionalStringsArg(args: unknown[], index: number) {
	return args[index] === undefined ? undefined : stringsArg(args, index)
}

function thumbnailVariantArg(args: unknown[], index: number): ThumbnailVariant | undefined {
	const value = args[index]
	if (value === undefined) return
	if (typeof value !== 'string' || !isThumbnailVariant(value)) {
		throw new TypeError(`Expected thumbnail variant argument ${index}`)
	}
	return value
}

function bufferArg(args: unknown[], index: number) {
	const value = args[index]
	if (!(value instanceof Uint8Array)) throw new TypeError(`Expected byte array argument ${index}`)
	return Buffer.from(value)
}

function contentFingerprintArg(args: unknown[], index: number): PublishedFileRevision {
	const value = args[index] as Partial<PublishedFileRevision> | undefined
	if (
		!value ||
		typeof value !== 'object' ||
		typeof value.inode !== 'string' ||
		typeof value.size !== 'number' ||
		!Number.isFinite(value.size) ||
		typeof value.modifiedNs !== 'string' ||
		typeof value.ctimeNs !== 'string'
	) {
		throw new TypeError(`Expected content fingerprint argument ${index}`)
	}
	return value as PublishedFileRevision
}

function objectArg<T>(args: unknown[], index: number): T {
	const value = args[index]
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new TypeError(`Expected object argument ${index}`)
	return value as T
}

function watcherChangesArg(args: unknown[], index = 1): WatcherChange[] {
	const changes = args[index]
	if (
		!Array.isArray(changes) ||
		!changes.every((change) => {
			if (!change || typeof change !== 'object') return false
			const candidate = change as Partial<WatcherChange>
			return typeof candidate.path === 'string' && ['create', 'update', 'delete'].includes(candidate.type ?? '')
		})
	) {
		throw new TypeError('Expected watcher changes')
	}
	return changes as WatcherChange[]
}

async function request(method: FileIndexRequestMethod, args: unknown[]) {
	switch (method) {
		case 'start':
			return index.start()
		case 'stop':
			return index.stop()
		case 'setRoots':
			return index.setRoots(rootsArg(args))
		case 'addRoot':
			return index.addRoot(rootArg(args))
		case 'removeRoot':
			return index.removeRoot(stringArg(args))
		case 'reconcileAll':
			return index.reconcileAll(stringArg(args))
		case 'reconcileRoot':
			return index.reconcileRoot(stringArg(args), stringArg(args, 1))
		case 'reconcilePath':
			return index.reconcilePath(stringArg(args))
		case 'removePath':
			return index.removePath(stringArg(args))
		case 'movePath':
			return index.movePath(stringArg(args), stringArg(args, 1))
		case 'createUmbrelDatabaseBackup':
			return index.createUmbrelDatabaseBackup(stringArg(args))
		case 'getEntryByVirtualPath':
			return index.getEntryByVirtualPath(stringArg(args))
		case 'getEntryBySystemPath':
			return index.getEntryBySystemPath(stringArg(args))
		case 'ensureThumbnail':
			return index.ensureThumbnail(stringArg(args), thumbnailVariantArg(args, 1))
		case 'photosPrepareUpload':
			return index.photosPrepareUpload(
				stringArg(args),
				bufferArg(args, 1),
				optionalStringArg(args, 2),
				optionalNumberArg(args, 3),
			)
		case 'photosRegisterUpload':
			return index.photosRegisterUpload(
				stringArg(args),
				stringArg(args, 1),
				bufferArg(args, 2),
				contentFingerprintArg(args, 3),
				optionalStringArg(args, 4),
				optionalNumberArg(args, 5),
			)
		case 'photosUpsertBackupSource':
			return index.photosUpsertBackupSource(stringArg(args), stringArg(args, 1), stringArg(args, 2), numberArg(args, 3))
		case 'photosRegisterBackupResource':
			return index.photosRegisterBackupResource(
				stringArg(args),
				stringArg(args, 1),
				stringArg(args, 2),
				stringArg(args, 3),
				bufferArg(args, 4),
				contentFingerprintArg(args, 5),
				optionalStringArg(args, 6),
				optionalNumberArg(args, 7),
			)
		case 'photosConfirmedBackupResources':
			return index.photosConfirmedBackupResources(stringArg(args), stringArg(args, 1), stringsArg(args, 2))
		case 'getExistingThumbnail':
			return index.getExistingThumbnail(stringArg(args), thumbnailVariantArg(args, 1))
		case 'enableThumbnailVariants': {
			const variants = stringsArg(args, 0)
			if (!variants.every(isThumbnailVariant)) throw new TypeError('Expected thumbnail variants')
			return index.enableThumbnailVariants(variants)
		}
		case 'initializePhotos':
			return index.initializePhotos(optionalStringArg(args, 0))
		case 'photosSummary':
			return index.photosSummary(stringArg(args))
		case 'photosIndexingState':
			return index.photosIndexingState(stringArg(args))
		case 'photosListItems':
			return index.photosListItems(
				stringArg(args),
				objectArg<PhotoFilter>(args, 1),
				optionalStringArg(args, 2),
				numberArg(args, 3),
			)
		case 'photosGetItem':
			return index.photosGetItem(stringArg(args), stringArg(args, 1), booleanArg(args, 2))
		case 'photosNeighbors':
			return index.photosNeighbors(stringArg(args), stringArg(args, 1), objectArg<PhotoFilter>(args, 2))
		case 'photosSetFavorite':
			return index.photosSetFavorite(stringArg(args), stringsArg(args, 1), booleanArg(args, 2))
		case 'photosResolveItems':
			return index.photosResolveItems(stringArg(args), stringsArg(args, 1))
		case 'photosResolveItemFiles': {
			const rootKind = stringArg(args, 2)
			if (rootKind !== 'home' && rootKind !== 'trash') throw new TypeError('Expected a Photos root kind')
			return index.photosResolveItemFiles(stringArg(args), optionalStringsArg(args, 1), rootKind)
		}
		case 'photosResolveLiveCompanion':
			return index.photosResolveLiveCompanion(stringArg(args), stringArg(args, 1))
		case 'photosListAlbums':
			return index.photosListAlbums(stringArg(args))
		case 'photosCreateAlbum':
			return index.photosCreateAlbum(stringArg(args), stringArg(args, 1), optionalStringsArg(args, 2))
		case 'photosRenameAlbum':
			return index.photosRenameAlbum(stringArg(args), stringArg(args, 1), stringArg(args, 2))
		case 'photosSetAlbumCover':
			return index.photosSetAlbumCover(stringArg(args), stringArg(args, 1), optionalStringArg(args, 2))
		case 'photosDeleteAlbum':
			return index.photosDeleteAlbum(stringArg(args), stringArg(args, 1))
		case 'photosAddAlbumItems':
			return index.photosAddAlbumItems(stringArg(args), stringArg(args, 1), stringsArg(args, 2))
		case 'photosRemoveAlbumItems':
			return index.photosRemoveAlbumItems(stringArg(args), stringArg(args, 1), stringsArg(args, 2))
		case 'photosListSources':
			return index.photosListSources(stringArg(args))
		case 'photosUpdateSource':
			return index.photosUpdateSource(
				stringArg(args),
				stringArg(args, 1),
				args[2] === undefined ? undefined : objectArg<{mode: PhotoScopeMode; paths: string[]}>(args, 2),
			)
		case 'photosSourceRemovalFiles':
			return index.photosSourceRemovalFiles(stringArg(args), stringArg(args, 1))
		case 'photosRemoveSource':
			return index.photosRemoveSource(stringArg(args), stringArg(args, 1), booleanArg(args, 2))
		case 'matchesThumbnail':
			return index.matchesThumbnail(stringArg(args), stringArg(args, 1), stringArg(args, 2), stringArg(args, 3))
		case 'recentCandidates':
			return index.recentCandidates(stringArg(args), numberArg(args, 1), stringsArg(args, 2))
		case 'directorySizes':
			return index.directorySizes(stringsArg(args, 0))
		case 'searchCandidates':
			return index.searchCandidates(stringArg(args), stringArg(args, 1), numberArg(args, 2))
		case 'status':
			return index.status()
	}
	throw new TypeError(`Unsupported file index request '${method}'`)
}

function notification(method: FileIndexNotificationMethod, args: unknown[]) {
	switch (method) {
		case 'noteWatcherChanges': {
			index.noteWatcherChanges(stringArg(args), watcherChangesArg(args))
			return
		}
		case 'noteWatcherBurst':
			index.noteWatcherBurst(stringArg(args))
			return
		case 'startBackgroundReconciliation':
			index.startBackgroundReconciliation()
			return
		case 'scheduleFullReconciliation':
			index.scheduleFullReconciliation(stringArg(args))
	}
}

port.on('message', (message: FileIndexWorkerInboundMessage) => {
	if (message.type === 'notification') {
		try {
			notification(message.method, message.args)
		} catch (error) {
			logger.error(`Rejected file index notification '${message.method}'`, error)
		}
		return
	}

	void request(message.method, message.args).then(
		(result) => post({type: 'response', id: message.id, result}),
		(error) => post({type: 'response', id: message.id, error: serializeError(error)}),
	)
})

post({type: 'ready', threadId})
