import type {FileIndexRoot} from './file-index-engine.ts'
import type {PhotoIndexingProgress} from '../photos/types.ts'

export type FileIndexWorkerData = {
	dataDirectory: string
	hiddenFiles: string[]
	hiddenExtensions: string[]
	reconciliationIntervalMs?: number
	recoveryRetryMs?: number
	watcherBulkThreshold?: number
	batchSize?: number
	release?: string
}

export type FileIndexRequestMethod =
	| 'start'
	| 'stop'
	| 'setRoots'
	| 'addRoot'
	| 'removeRoot'
	| 'reconcileAll'
	| 'reconcileRoot'
	| 'reconcilePath'
	| 'removePath'
	| 'movePath'
	| 'createUmbrelDatabaseBackup'
	| 'getEntryByVirtualPath'
	| 'getEntryBySystemPath'
	| 'ensureThumbnail'
	| 'photosPrepareUpload'
	| 'photosRegisterUpload'
	| 'photosUpsertBackupSource'
	| 'photosRegisterBackupResource'
	| 'photosConfirmedBackupResources'
	| 'photosRecordMatchedBackupResources'
	| 'photosBackupSourceContentLocations'
	| 'photosBackupCloudIdentityMatches'
	| 'photosAttachBackupCloudIdentities'
	| 'getExistingThumbnail'
	| 'enableThumbnailVariants'
	| 'matchesThumbnail'
	| 'initializePhotos'
	| 'photosSummary'
	| 'photosIndexingState'
	| 'photosListItems'
	| 'photosMapPoints'
	| 'photosGetItem'
	| 'photosNeighbors'
	| 'photosSetFavorite'
	| 'photosResolveItems'
	| 'photosResolveItemFiles'
	| 'photosResolveLiveCompanion'
	| 'photosListAlbums'
	| 'photosCreateAlbum'
	| 'photosRenameAlbum'
	| 'photosSetAlbumCover'
	| 'photosDeleteAlbum'
	| 'photosAddAlbumItems'
	| 'photosRemoveAlbumItems'
	| 'photosListSources'
	| 'photosUpdateSource'
	| 'photosSourceRemovalFiles'
	| 'photosSourceRemovalItemCount'
	| 'photosRemoveSource'
	| 'recentCandidates'
	| 'directorySizes'
	| 'searchCandidates'
	| 'status'

export type FileIndexNotificationMethod =
	| 'noteWatcherChanges'
	| 'noteWatcherBurst'
	| 'startBackgroundReconciliation'
	| 'scheduleFullReconciliation'

export type FileIndexWorkerRequest = {
	type: 'request'
	id: number
	method: FileIndexRequestMethod
	args: unknown[]
}

export type FileIndexWorkerNotification = {
	type: 'notification'
	method: FileIndexNotificationMethod
	args: unknown[]
}

export type FileIndexWorkerInboundMessage = FileIndexWorkerRequest | FileIndexWorkerNotification

export type SerializedError = {
	name: string
	message: string
	stack?: string
	code?: string
}

export type FileIndexWorkerOutboundMessage =
	| {type: 'ready'; threadId: number}
	| {type: 'availability'; available: boolean}
	| {type: 'photos-change'; accountIds: string[]}
	| {type: 'photos-indexing-progress'; progress: PhotoIndexingProgress[]}
	| {type: 'response'; id: number; result: unknown}
	| {type: 'response'; id: number; error: SerializedError}
	| {type: 'log'; level: 'log' | 'verbose' | 'error'; message?: string; error?: SerializedError}

export function serializeError(error: unknown): SerializedError {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
			...('code' in error && typeof error.code === 'string' ? {code: error.code} : {}),
		}
	}
	return {name: 'Error', message: String(error)}
}

export function deserializeError(error: SerializedError) {
	const deserialized = new Error(error.message)
	deserialized.name = error.name
	deserialized.stack = error.stack
	if (error.code) Object.assign(deserialized, {code: error.code})
	return deserialized
}

export function isFileIndexRoot(value: unknown): value is FileIndexRoot {
	if (!value || typeof value !== 'object') return false
	const root = value as Partial<FileIndexRoot>
	return (
		typeof root.virtualPath === 'string' &&
		typeof root.systemPath === 'string' &&
		typeof root.ownerId === 'string' &&
		['home', 'trash', 'apps', 'machines'].includes(root.kind ?? '') &&
		typeof root.searchEnabled === 'boolean' &&
		(root.scanEnabled === undefined || typeof root.scanEnabled === 'boolean')
	)
}
