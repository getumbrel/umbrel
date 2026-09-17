import {createHash, randomBytes} from 'node:crypto'
import {constants as fsConstants} from 'node:fs'
import {lstat, open} from 'node:fs/promises'
import nodePath from 'node:path'

import fse from 'fs-extra'
import isValidFilename from 'valid-filename'

import type Umbreld from '../../index.js'
import type {Principal} from '../auth/auth.js'
import {Blake3Hasher} from '../files/blake3.js'
import {OWNER_USER_ID} from '../user/constants.js'

import type {PhotoFilter, PhotoScopeMode} from './types.js'
import {hashFileRevision, type PublishedFileRevision} from '../files/file-index-enrichment.js'

export type PhotoBackupSource = {
	id: string
	accountId: string
	name: string
	directoryName: string
	createdAt: number
	storageVersion?: 3
}

export type PhotoBackupSourceRemoval = {
	accountId: string
	sourceId: string
	keepItems: boolean
	createdAt: number
}

export type PhotoBackupResourceDescriptor = {
	resourceKey: string
	fileExtension: string
}

export type PhotoBackupResourceReceipt = {
	resourceKey: string
	bytes: number
}

export const PHOTO_BACKUP_SOURCE_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const PHOTO_RESOURCE_KEY_PATTERN = /^[0-9a-f]{64}$/
export const PHOTO_FILE_EXTENSION_PATTERN = /^[a-z0-9]{1,16}$/
export const PHOTO_ORIGINAL_FILENAME_MAX_BYTES = 255
const PHOTO_BACKUP_FILENAME_PATTERN = /^([0-9a-f]{64})\.([a-z0-9]{1,16})$/
const PHOTO_BACKUP_SHARD_PATTERN = /^[0-9a-f]{2}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const FILE_NAME_CHARACTER_PATTERN = /[<>:"/\\|?*\u0000-\u001f\u007f]/g

const normalizeBackupSourceId = (sourceId: string) => {
	const normalized = sourceId.toLowerCase()
	if (!PHOTO_BACKUP_SOURCE_ID_PATTERN.test(normalized)) throw new Error('Invalid photo backup source id')
	return normalized
}

const normalizeBackupSourceName = (sourceName: string) => {
	const normalized = sourceName.trim()
	if (!normalized || normalized.length > 100 || CONTROL_CHARACTER_PATTERN.test(normalized)) {
		throw new Error('Invalid photo backup source name')
	}
	return normalized
}

const validateAccountId = (accountId: string) => {
	// Account ids are server-issued, but keep the storage boundary safe without
	// duplicating the User module's naming policy.
	if (
		!accountId ||
		accountId === '.' ||
		accountId === '..' ||
		CONTROL_CHARACTER_PATTERN.test(accountId) ||
		nodePath.basename(accountId) !== accountId
	) {
		throw new Error('Invalid Photos account id')
	}
	return accountId
}

const backupLibrarySourceId = (accountId: string, sourceId: string) =>
	`iphone:${createHash('sha256').update(accountId).update('\0').update(sourceId).digest('hex')}`

const truncateUtf8 = (value: string, maxBytes: number) => {
	let result = ''
	let bytes = 0
	for (const character of value) {
		const characterBytes = Buffer.byteLength(character)
		if (bytes + characterBytes > maxBytes) break
		result += character
		bytes += characterBytes
	}
	return result
}

const backupDirectoryBaseName = (name: string, sourceId: string) => {
	const sanitized = truncateUtf8(
		name
			.replace(FILE_NAME_CHARACTER_PATTERN, '-')
			.replace(/\s+/g, ' ')
			.replace(/[ .]+$/g, '')
			.trim(),
		240,
	).replace(/[ .]+$/g, '')
	return isValidFilename(sanitized) ? sanitized : `iPhone ${sourceId.slice(0, 8)}`
}

const validateBackupDirectoryName = (name: string) => {
	if (!isValidFilename(name) || nodePath.posix.basename(name) !== name || CONTROL_CHARACTER_PATTERN.test(name)) {
		throw new Error('Invalid photo backup directory name')
	}
	return name
}

export default class Photos {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	#downloadTickets = new Map<string, {accountId: string; ids: string[]; expiresAt: number}>()
	#backupSourceLockTails = new Map<string, Promise<void>>()
	#backupShardLockTails = new Map<string, Promise<void>>()
	#durableBackupShards = new Set<string>()

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		this.logger = umbreld.logger.createChildLogger('photos')
	}

	get mediaDirectory() {
		return nodePath.join(this.#umbreld.dataDirectory, 'photos', 'media')
	}

	async start() {
		this.logger.log('Starting photos')
		await this.#umbreld.files.fileIndex.initializePhotos()
		for (const removal of (await this.#umbreld.store.get('photos.backupSourceRemovals')) ?? []) {
			try {
				await this.#withBackupSourceLock(removal.accountId, removal.sourceId, () =>
					this.#completeBackupSourceRemoval(removal),
				)
			} catch (error) {
				this.logger.error('Failed to resume Photos backup source removal', error)
			}
		}
		for (const source of (await this.#umbreld.store.get('photos.backupSources')) ?? []) {
			try {
				await this.registerBackupSource({
					accountId: source.accountId,
					sourceId: source.id,
					suggestedName: source.name,
				})
			} catch (error) {
				this.logger.error('Failed to restore Photos backup source', error)
			}
		}
	}

	async stop() {}

	async registerBackupSource({
		accountId,
		sourceId,
		suggestedName,
	}: {
		accountId: string
		sourceId: string
		suggestedName: string
	}): Promise<PhotoBackupSource> {
		accountId = validateAccountId(accountId)
		sourceId = normalizeBackupSourceId(sourceId)
		const name = normalizeBackupSourceName(suggestedName)
		return this.#withBackupSourceLock(accountId, sourceId, () =>
			this.#registerBackupSource({accountId, sourceId, name}),
		)
	}

	async createBackupGrant({
		principal,
		sourceId,
		suggestedName,
	}: {
		principal: Principal
		sourceId: string
		suggestedName: string
	}) {
		const accountId = validateAccountId(principal.accountId)
		sourceId = normalizeBackupSourceId(sourceId)
		const name = normalizeBackupSourceName(suggestedName)
		return this.#withBackupSourceLock(accountId, sourceId, async () => {
			const source = await this.#registerBackupSource({accountId, sourceId, name})
			const grant = await this.#umbreld.auth.issuePhotoBackupGrant(principal, source.id)
			return {token: grant.token, source}
		})
	}

	async #registerBackupSource({
		accountId,
		sourceId,
		name,
	}: {
		accountId: string
		sourceId: string
		name: string
	}): Promise<PhotoBackupSource> {
		const pendingRemoval = ((await this.#umbreld.store.get('photos.backupSourceRemovals')) ?? []).find(
			(removal) => removal.accountId === accountId && removal.sourceId === sourceId,
		)
		if (pendingRemoval) await this.#completeBackupSourceRemoval(pendingRemoval)
		let source!: PhotoBackupSource
		let created = false

		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const sources = (await get('photos.backupSources')) ?? []
			const existing = sources.find((candidate) => candidate.accountId === accountId && candidate.id === sourceId)
			if (existing) {
				if (existing.directoryName) {
					source = existing
					return
				}
				source = {
					...existing,
					directoryName: await this.#uniqueBackupDirectoryName(accountId, existing.name, sourceId, sources),
				}
				await set(
					'photos.backupSources',
					sources.map((candidate) =>
						candidate.accountId === accountId && candidate.id === sourceId ? source : candidate,
					),
				)
				return
			}
			source = {
				id: sourceId,
				accountId,
				name,
				directoryName: await this.#uniqueBackupDirectoryName(accountId, name, sourceId, sources),
				createdAt: Date.now(),
			}
			await set('photos.backupSources', [...sources, source])
			created = true
		})

		await this.#ensureBackupSourceDirectory(source!)
		await this.#upsertBackupSource(source!)
		if (source.storageVersion !== 3) {
			await this.#migrateLegacyBackupSource(source)
			source = {...source, storageVersion: 3}
			await this.#umbreld.store.getWriteLock(async ({get, set}) => {
				const sources = (await get('photos.backupSources')) ?? []
				await set(
					'photos.backupSources',
					sources.map((candidate) =>
						candidate.accountId === accountId && candidate.id === sourceId ? source : candidate,
					),
				)
			})
		}
		// A new phone in the sources list is a library change the UI should hear
		// about right away; re-registrations (re-auth, startup replay) change nothing
		if (created) this.#changed(accountId)
		return source
	}

	async deleteAccount(accountId: string) {
		accountId = validateAccountId(accountId)

		// New backups live in the account's Home and are removed by Files' account
		// lifecycle. Clean up the legacy private media directory as well.
		await fse.remove(this.#accountMediaDirectory(accountId))
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const sources = (await get('photos.backupSources')) ?? []
			const remaining = sources.filter((source) => source.accountId !== accountId)
			if (remaining.length !== sources.length) await set('photos.backupSources', remaining)
			const removals = (await get('photos.backupSourceRemovals')) ?? []
			const remainingRemovals = removals.filter((removal) => removal.accountId !== accountId)
			if (remainingRemovals.length !== removals.length) {
				await set('photos.backupSourceRemovals', remainingRemovals)
			}
		})
	}

	async confirmedBackupResources({
		accountId,
		sourceId,
		resources,
	}: {
		accountId: string
		sourceId: string
		resources: PhotoBackupResourceDescriptor[]
	}): Promise<PhotoBackupResourceReceipt[]> {
		accountId = validateAccountId(accountId)
		sourceId = normalizeBackupSourceId(sourceId)
		const unique = new Map<string, PhotoBackupResourceDescriptor>()
		for (const resource of resources) {
			const resourceKey = resource.resourceKey.toLowerCase()
			const fileExtension = resource.fileExtension.toLowerCase()
			if (!PHOTO_RESOURCE_KEY_PATTERN.test(resourceKey) || !PHOTO_FILE_EXTENSION_PATTERN.test(fileExtension)) {
				throw new Error('Invalid photo backup resource')
			}
			unique.set(resourceKey, {resourceKey, fileExtension})
		}
		const result = await this.withBackupSource(accountId, sourceId, async (source) => {
			const resources = await this.#umbreld.files.fileIndex.photosConfirmedBackupResources(
				accountId,
				backupLibrarySourceId(accountId, sourceId),
				[...unique.keys()],
			)
			const byKey = new Map(resources.map((resource) => [resource.resourceKey, resource]))
			const receipts: PhotoBackupResourceReceipt[] = []
			for (const descriptor of unique.values()) {
				const resource = byKey.get(descriptor.resourceKey)
				if (!resource) continue
				if (
					resource.path !== undefined &&
					resource.bytes !== undefined &&
					resource.revision !== undefined &&
					(await this.backupResourceRevisionIsCurrent(accountId, resource.path, resource.revision))
				) {
					receipts.push({resourceKey: resource.resourceKey, bytes: resource.bytes})
					continue
				}

				// Unsupported future PhotoKit formats are intentionally absent from
				// media enrichment. Confirm their deterministic upload location by
				// hashing the authorized file against the durable resource relation.
				const virtualPath = this.backupResourceVirtualPath(source, descriptor.resourceKey, descriptor.fileExtension)
				const uploaded = await this.#hashBackupFile(accountId, virtualPath).catch(() => undefined)
				if (uploaded?.hash.equals(resource.contentHash)) {
					receipts.push({resourceKey: resource.resourceKey, bytes: uploaded.revision.size})
				}
			}
			return receipts
		})
		return result.active ? result.value : []
	}

	async getBackupSource(accountId: string, sourceId: string) {
		accountId = validateAccountId(accountId)
		sourceId = normalizeBackupSourceId(sourceId)
		const sources = (await this.#umbreld.store.get('photos.backupSources')) ?? []
		return sources.find((candidate) => candidate.accountId === accountId && candidate.id === sourceId)
	}

	async withBackupSource<T>(
		accountId: string,
		sourceId: string,
		operation: (source: PhotoBackupSource) => Promise<T>,
	): Promise<{active: true; value: T} | {active: false}> {
		accountId = validateAccountId(accountId)
		sourceId = normalizeBackupSourceId(sourceId)
		return this.#withBackupSourceLock(accountId, sourceId, async () => {
			const pendingRemoval = ((await this.#umbreld.store.get('photos.backupSourceRemovals')) ?? []).some(
				(removal) => removal.accountId === accountId && removal.sourceId === sourceId,
			)
			if (pendingRemoval) return {active: false as const}
			const source = await this.getBackupSource(accountId, sourceId)
			if (!source) return {active: false as const}
			return {active: true as const, value: await operation(source)}
		})
	}

	backupSourceVirtualDirectory(source: Pick<PhotoBackupSource, 'accountId' | 'directoryName'>) {
		const accountId = validateAccountId(source.accountId)
		const directoryName = validateBackupDirectoryName(source.directoryName)
		const root = accountId === OWNER_USER_ID ? '/Home/Photos' : `/Users/${accountId}/Photos`
		return nodePath.posix.join(root, directoryName)
	}

	backupResourceVirtualPath(
		source: Pick<PhotoBackupSource, 'accountId' | 'directoryName'>,
		resourceKey: string,
		fileExtension: string,
	) {
		resourceKey = resourceKey.toLowerCase()
		fileExtension = fileExtension.toLowerCase()
		if (!PHOTO_RESOURCE_KEY_PATTERN.test(resourceKey) || !PHOTO_FILE_EXTENSION_PATTERN.test(fileExtension)) {
			throw new Error('Invalid photo backup resource')
		}
		return nodePath.posix.join(
			this.backupSourceVirtualDirectory(source),
			resourceKey.slice(0, 2),
			`${resourceKey}.${fileExtension}`,
		)
	}

	async prepareBackupResourcePath(source: PhotoBackupSource, resourceKey: string, fileExtension: string) {
		const virtualPath = this.backupResourceVirtualPath(source, resourceKey, fileExtension)
		const shardVirtualPath = nodePath.posix.dirname(virtualPath)
		const shardSystemPath = await this.#umbreld.files.virtualToSystemPath(shardVirtualPath, source.accountId)
		await this.#withBackupShardLock(shardSystemPath, async () => {
			const {created} = await this.#umbreld.files.createDirectory(shardVirtualPath, source.accountId)
			// Do not let a concurrent upload issue a receipt until the request that
			// created this shard has made its source-directory entry durable. Retrying
			// after a failed fsync must attempt the sync again even though mkdir now
			// reports an existing directory.
			if (created || !this.#durableBackupShards.has(shardSystemPath)) {
				await this.#syncDirectory(nodePath.dirname(shardSystemPath))
				this.#durableBackupShards.add(shardSystemPath)
			}
		})
		return virtualPath
	}

	async registerBackupResource(
		source: PhotoBackupSource,
		resourceKey: string,
		systemPath: string,
		hash: Buffer,
		revision: PublishedFileRevision,
		originalFilename?: string,
		sourceCreationDate?: number,
	) {
		const receipt = await this.#umbreld.files.fileIndex.photosRegisterBackupResource(
			source.accountId,
			backupLibrarySourceId(source.accountId, source.id),
			resourceKey,
			systemPath,
			hash,
			revision,
			originalFilename,
			sourceCreationDate,
		)
		this.#changed(source.accountId)
		return receipt
	}

	async registerMatchingBackupResource(
		source: PhotoBackupSource,
		resourceKey: string,
		virtualPath: string,
		hash: Buffer,
		originalFilename: string,
		sourceCreationDate?: number,
	) {
		// A changed resource is published with keep-both naming, so its current
		// path may no longer be the deterministic base path. Reuse the durable
		// relation first to keep later retries idempotent after edits and moves.
		const [registered] = await this.#umbreld.files.fileIndex.photosConfirmedBackupResources(
			source.accountId,
			backupLibrarySourceId(source.accountId, source.id),
			[resourceKey],
		)
		if (
			registered?.contentHash.equals(hash) &&
			registered.path !== undefined &&
			registered.bytes !== undefined &&
			registered.revision !== undefined &&
			(await this.backupResourceRevisionIsCurrent(source.accountId, registered.path, registered.revision))
		) {
			return {
				receipt: {resourceKey, path: registered.path, bytes: registered.bytes},
				revision: registered.revision,
			}
		}

		// Recover a deterministic-path file left behind if publication succeeded
		// but durable registration failed before the response was acknowledged.
		const uploaded = await this.#hashBackupFile(source.accountId, virtualPath).catch(() => undefined)
		if (!uploaded?.hash.equals(hash)) return
		const receipt = await this.registerBackupResource(
			source,
			resourceKey,
			uploaded.systemPath,
			uploaded.hash,
			uploaded.revision,
			originalFilename,
			sourceCreationDate,
		)
		return {receipt, revision: uploaded.revision}
	}

	async #migrateLegacyBackupSource(source: PhotoBackupSource) {
		const legacyDirectory = nodePath.join(this.#accountMediaDirectory(source.accountId), source.id)
		const targetVirtualDirectory = this.backupSourceVirtualDirectory(source)
		const targetSystemDirectory = await this.#umbreld.files.virtualToSystemPath(
			targetVirtualDirectory,
			source.accountId,
		)
		const legacyStats = await lstat(legacyDirectory).catch((error) => {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
			throw error
		})
		if (legacyStats && !legacyStats.isDirectory()) throw new Error('Invalid legacy photo backup directory')

		if (legacyStats) {
			for (const entry of await fse.readdir(legacyDirectory, {withFileTypes: true})) {
				if (!entry.isFile() || !PHOTO_BACKUP_FILENAME_PATTERN.test(entry.name)) continue
				await this.#moveBackupResourceIntoShardedLayout(
					source,
					nodePath.join(legacyDirectory, entry.name),
					legacyDirectory,
					entry.name,
				)
			}
		}

		// Storage v2 wrote resources directly inside the friendly source folder.
		// Move those files into the first-byte shard layout as part of the same
		// idempotent migration used for the older private directory.
		for (const entry of await fse.readdir(targetSystemDirectory, {withFileTypes: true})) {
			if (!entry.isFile() || !PHOTO_BACKUP_FILENAME_PATTERN.test(entry.name)) continue
			await this.#moveBackupResourceIntoShardedLayout(
				source,
				nodePath.join(targetSystemDirectory, entry.name),
				targetSystemDirectory,
				entry.name,
			)
		}

		// Recover a crash that moved a resource but stopped before committing its
		// durable relation. This scan runs once per upgraded source.
		for (const shard of await fse.readdir(targetSystemDirectory, {withFileTypes: true})) {
			if (!shard.isDirectory() || !PHOTO_BACKUP_SHARD_PATTERN.test(shard.name)) continue
			const shardVirtualDirectory = nodePath.posix.join(targetVirtualDirectory, shard.name)
			const shardSystemDirectory = nodePath.join(targetSystemDirectory, shard.name)
			for (const entry of await fse.readdir(shardSystemDirectory, {withFileTypes: true})) {
				if (!entry.isFile()) continue
				const match = PHOTO_BACKUP_FILENAME_PATTERN.exec(entry.name)
				if (!match || match[1]!.slice(0, 2) !== shard.name) continue
				const virtualPath = nodePath.posix.join(shardVirtualDirectory, entry.name)
				const uploaded = await this.#hashBackupFile(source.accountId, virtualPath)
				await this.registerBackupResource(source, match[1]!, uploaded.systemPath, uploaded.hash, uploaded.revision)
			}
		}

		if (legacyStats) {
			const removed = await fse.rmdir(legacyDirectory).then(
				() => true,
				(error) => {
					if ((error as NodeJS.ErrnoException).code === 'ENOTEMPTY') return false
					if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
					throw error
				},
			)
			if (removed) await this.#syncDirectory(nodePath.dirname(legacyDirectory))
		}
	}

	async #moveBackupResourceIntoShardedLayout(
		source: PhotoBackupSource,
		sourceSystemPath: string,
		sourceSystemDirectory: string,
		fileName: string,
	) {
		const match = PHOTO_BACKUP_FILENAME_PATTERN.exec(fileName)
		if (!match) return
		const targetVirtualPath = await this.prepareBackupResourcePath(source, match[1]!, match[2]!)
		const targetSystemPath = await this.#umbreld.files.virtualToSystemPath(targetVirtualPath, source.accountId)
		const targetStats = await lstat(targetSystemPath).catch((error) => {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
			throw error
		})
		if (targetStats) {
			const [sourceHash, target] = await Promise.all([
				this.#hashLegacyBackupFile(sourceSystemPath),
				this.#hashBackupFile(source.accountId, targetVirtualPath),
			])
			if (!sourceHash.equals(target.hash)) throw new Error(`Conflicting legacy photo backup resource '${fileName}'`)
			await fse.remove(sourceSystemPath)
			await this.#syncDirectory(sourceSystemDirectory)
			return
		}

		await fse.rename(sourceSystemPath, targetSystemPath)
		await this.#umbreld.files.chownSystemPath(targetSystemPath).catch(() => {})
		await Promise.all([
			this.#syncDirectory(sourceSystemDirectory),
			this.#syncDirectory(nodePath.dirname(targetSystemPath)),
		])
	}

	async #hashBackupFile(accountId: string, virtualPath: string) {
		const file = await this.#umbreld.files.openFileForRead(virtualPath, accountId)
		try {
			const hasher = new Blake3Hasher()
			for await (const chunk of file.handle.createReadStream({autoClose: false, highWaterMark: 1024 * 1024})) {
				hasher.update(chunk)
			}
			const current = await file.handle.stat({bigint: true})
			if (
				current.dev !== file.stats.dev ||
				current.ino !== file.stats.ino ||
				current.size !== file.stats.size ||
				current.mtimeNs !== file.stats.mtimeNs ||
				current.ctimeNs !== file.stats.ctimeNs
			) {
				throw new Error('Photo backup file changed while hashing')
			}
			return {
				hash: hasher.digestBuffer(),
				systemPath: file.systemPath,
				revision: {
					inode: current.ino.toString(),
					size: Number(current.size),
					modifiedNs: current.mtimeNs.toString(),
					ctimeNs: current.ctimeNs.toString(),
				} satisfies PublishedFileRevision,
			}
		} finally {
			await file.handle.close().catch(() => {})
		}
	}

	async backupResourceRevisionIsCurrent(
		accountId: string,
		virtualPath: string,
		revision: {device?: string; inode: string; size: number; modifiedNs: string; ctimeNs: string},
	) {
		const file = await this.#umbreld.files.openFileForRead(virtualPath, accountId).catch(() => undefined)
		if (!file) return false
		try {
			return (
				(revision.device === undefined || file.stats.dev.toString() === revision.device) &&
				file.stats.ino.toString() === revision.inode &&
				Number(file.stats.size) === revision.size &&
				file.stats.mtimeNs.toString() === revision.modifiedNs &&
				file.stats.ctimeNs.toString() === revision.ctimeNs
			)
		} finally {
			await file.handle.close().catch(() => {})
		}
	}

	async #hashLegacyBackupFile(systemPath: string) {
		const stats = await lstat(systemPath, {bigint: true})
		if (!stats.isFile()) throw new Error('Invalid legacy photo backup resource')
		return hashFileRevision(systemPath, {
			inode: stats.ino.toString(),
			size: Number(stats.size),
			modifiedNs: stats.mtimeNs.toString(),
		})
	}

	async #syncDirectory(systemPath: string) {
		const handle = await open(systemPath, fsConstants.O_RDONLY)
		try {
			await handle.sync()
		} finally {
			await handle.close()
		}
	}

	#accountMediaDirectory(accountId: string) {
		return nodePath.join(this.mediaDirectory, validateAccountId(accountId))
	}

	async #upsertBackupSource(source: PhotoBackupSource) {
		await this.#umbreld.files.fileIndex.photosUpsertBackupSource(
			source.accountId,
			backupLibrarySourceId(source.accountId, source.id),
			source.name,
			source.createdAt,
		)
	}

	async #ensureBackupSourceDirectory(source: PhotoBackupSource) {
		const virtualPath = this.backupSourceVirtualDirectory(source)
		const parentVirtualPath = nodePath.posix.dirname(virtualPath)
		await this.#umbreld.files.createDirectory(parentVirtualPath, source.accountId)
		const parentSystemPath = await this.#umbreld.files.virtualToSystemPath(parentVirtualPath, source.accountId)
		// Persist both newly created directory entries before an upload receipt can
		// make the source durable. Keep this internal-storage durability policy out
		// of Files.createDirectory, which also serves filesystems without dir fsync.
		await this.#syncDirectory(nodePath.dirname(parentSystemPath))
		await this.#umbreld.files.createDirectory(virtualPath, source.accountId)
		await this.#syncDirectory(parentSystemPath)
	}

	async #uniqueBackupDirectoryName(accountId: string, name: string, sourceId: string, sources: PhotoBackupSource[]) {
		const baseName = backupDirectoryBaseName(name, sourceId)
		const usedNames = new Set(
			sources
				.filter((source) => source.accountId === accountId)
				.map((source) => source.directoryName)
				.filter(Boolean),
		)
		const root = accountId === OWNER_USER_ID ? '/Home/Photos' : `/Users/${accountId}/Photos`
		for (let index = 1; index <= 1000; index++) {
			const candidate = index === 1 ? baseName : `${baseName} (${index})`
			if (usedNames.has(candidate)) continue
			const systemPath = await this.#umbreld.files.virtualToSystemPath(nodePath.posix.join(root, candidate), accountId)
			if (!(await fse.pathExists(systemPath))) return candidate
		}
		throw new Error('Could not allocate photo backup directory')
	}

	async createDownloadTicket(accountId: string, ids: string[]) {
		const uniqueIds = [...new Set(ids)]
		const resolved = await this.#umbreld.files.fileIndex.photosResolveItems(accountId, uniqueIds)
		if (resolved.length !== uniqueIds.length) throw new Error('[photos-item-not-found]')
		const now = Date.now()
		for (const [ticket, value] of this.#downloadTickets) {
			if (value.expiresAt <= now) this.#downloadTickets.delete(ticket)
		}
		const ticket = randomBytes(24).toString('base64url')
		this.#downloadTickets.set(ticket, {accountId, ids: uniqueIds, expiresAt: now + 60_000})
		return ticket
	}

	consumeDownloadTicket(accountId: string, ticket: string) {
		const value = this.#downloadTickets.get(ticket)
		if (!value || value.accountId !== accountId) return
		this.#downloadTickets.delete(ticket)
		if (value.expiresAt <= Date.now()) return
		return value.ids
	}

	summary(accountId: string) {
		return this.#umbreld.files.fileIndex.photosSummary(accountId)
	}

	indexingState(accountId: string) {
		return this.#umbreld.files.fileIndex.photosIndexingState(accountId)
	}

	listItems(accountId: string, filter: PhotoFilter, cursor: string | undefined, limit: number) {
		return this.#umbreld.files.fileIndex.photosListItems(accountId, filter, cursor, limit)
	}

	getItem(accountId: string, id: string, deleted = false) {
		return this.#umbreld.files.fileIndex.photosGetItem(accountId, id, deleted)
	}

	neighbors(accountId: string, id: string, filter: PhotoFilter) {
		return this.#umbreld.files.fileIndex.photosNeighbors(accountId, id, filter)
	}

	async setFavorite(accountId: string, ids: string[], favorite: boolean) {
		const changes = await this.#umbreld.files.fileIndex.photosSetFavorite(accountId, ids, favorite)
		if (changes) this.#changed(accountId)
		return changes
	}

	async deleteItems(accountId: string, ids: string[]) {
		const items = await this.#umbreld.files.fileIndex.photosResolveItemFiles(accountId, ids, 'home')
		for (const item of items) await this.#umbreld.files.trash(item.path, accountId, item.revision)
		if (items.length) this.#changed(accountId)
		return items.length
	}

	async restoreItems(accountId: string, ids: string[]) {
		const items = await this.#umbreld.files.fileIndex.photosResolveItemFiles(accountId, ids, 'trash')
		for (const item of items) await this.#umbreld.files.restore(item.path, {userId: accountId, waitForIndex: true})
		if (items.length) this.#changed(accountId)
		return items.length
	}

	async deletePermanently(accountId: string, ids?: string[]) {
		const items = await this.#umbreld.files.fileIndex.photosResolveItemFiles(accountId, ids, 'trash')
		if (items.length === 0) return 0
		const paths = [...new Set(items.map(({path}) => path))]
		const expectedRevisions = new Map(items.map(({path, revision}) => [path, revision]))
		const results = await this.#umbreld.files.deleteMany(paths, accountId, {waitForIndex: true, expectedRevisions})
		if (results.some((deleted) => !deleted)) throw new Error('[photos-delete-failed]')
		this.#changed(accountId)
		return results.length
	}

	listAlbums(accountId: string) {
		return this.#umbreld.files.fileIndex.photosListAlbums(accountId)
	}

	async createAlbum(accountId: string, name: string, ids?: string[]) {
		const album = await this.#umbreld.files.fileIndex.photosCreateAlbum(accountId, name, ids)
		this.#changed(accountId)
		return album
	}

	async renameAlbum(accountId: string, id: string, name: string) {
		const changes = await this.#umbreld.files.fileIndex.photosRenameAlbum(accountId, id, name)
		if (changes) this.#changed(accountId)
		return changes
	}

	async setAlbumCover(accountId: string, id: string, itemId?: string) {
		const changes = await this.#umbreld.files.fileIndex.photosSetAlbumCover(accountId, id, itemId)
		if (changes) this.#changed(accountId)
		return changes
	}

	async deleteAlbum(accountId: string, id: string) {
		const changes = await this.#umbreld.files.fileIndex.photosDeleteAlbum(accountId, id)
		if (changes) this.#changed(accountId)
		return changes
	}

	async addAlbumItems(accountId: string, id: string, ids: string[]) {
		const changes = await this.#umbreld.files.fileIndex.photosAddAlbumItems(accountId, id, ids)
		if (changes) this.#changed(accountId)
		return changes
	}

	async removeAlbumItems(accountId: string, id: string, ids: string[]) {
		const changes = await this.#umbreld.files.fileIndex.photosRemoveAlbumItems(accountId, id, ids)
		if (changes) this.#changed(accountId)
		return changes
	}

	listSources(accountId: string) {
		return this.#umbreld.files.fileIndex.photosListSources(accountId)
	}

	async renameSource(accountId: string, id: string, name: string) {
		accountId = validateAccountId(accountId)
		name = normalizeBackupSourceName(name)
		const sources = (await this.#umbreld.store.get('photos.backupSources')) ?? []
		const source = sources.find(
			(candidate) => candidate.accountId === accountId && backupLibrarySourceId(accountId, candidate.id) === id,
		)
		if (!source) return false

		return this.#withBackupSourceLock(accountId, source.id, async () => {
			let renamed: PhotoBackupSource | undefined
			await this.#umbreld.store.getWriteLock(async ({get, set}) => {
				const sources = (await get('photos.backupSources')) ?? []
				const current = sources.find((candidate) => candidate.accountId === accountId && candidate.id === source.id)
				const removals = (await get('photos.backupSourceRemovals')) ?? []
				if (!current || removals.some((removal) => removal.accountId === accountId && removal.sourceId === source.id)) {
					return
				}

				// Persist the display name first so reconnects and restarts retain it.
				// The folder and source identity stay unchanged, including for queued uploads.
				const updated = {...current, name}
				await set(
					'photos.backupSources',
					sources.map((candidate) => (candidate === current ? updated : candidate)),
				)
				renamed = updated
			})
			if (!renamed) return false
			await this.#upsertBackupSource(renamed)
			this.#changed(accountId)
			return true
		})
	}

	async updateSource(accountId: string, id: string, scope?: {mode: PhotoScopeMode; paths: string[]}) {
		const source = await this.#umbreld.files.fileIndex.photosUpdateSource(accountId, id, scope)
		if (source) {
			this.#changed(accountId)
			await this.#indexingProgress(accountId)
		}
		return source
	}

	async removeSource(accountId: string, id: string, keepItems: boolean) {
		accountId = validateAccountId(accountId)
		const sources = (await this.#umbreld.store.get('photos.backupSources')) ?? []
		const removals = (await this.#umbreld.store.get('photos.backupSourceRemovals')) ?? []
		const source = sources.find(
			(candidate) => candidate.accountId === accountId && backupLibrarySourceId(accountId, candidate.id) === id,
		)
		const pending = removals.find(
			(candidate) => candidate.accountId === accountId && backupLibrarySourceId(accountId, candidate.sourceId) === id,
		)
		if (!source && !pending) {
			const removed = await this.#umbreld.files.fileIndex.photosRemoveSource(accountId, id, keepItems)
			if (removed) {
				this.#changed(accountId)
				await this.#indexingProgress(accountId)
			}
			return removed
		}

		const sourceId = source?.id ?? pending!.sourceId
		return this.#withBackupSourceLock(accountId, sourceId, async () => {
			let removal = ((await this.#umbreld.store.get('photos.backupSourceRemovals')) ?? []).find(
				(candidate) => candidate.accountId === accountId && candidate.sourceId === sourceId,
			)
			if (!removal) {
				removal = {accountId, sourceId, keepItems, createdAt: Date.now()}
				await this.#umbreld.store.getWriteLock(async ({get, set}) => {
					const current = (await get('photos.backupSourceRemovals')) ?? []
					if (!current.some((candidate) => candidate.accountId === accountId && candidate.sourceId === sourceId)) {
						await set('photos.backupSourceRemovals', [...current, removal!])
					}
				})
			}
			await this.#completeBackupSourceRemoval(removal)
			this.#changed(accountId)
			await this.#indexingProgress(accountId)
			return true
		})
	}

	async resolveItem(accountId: string, id: string) {
		return (await this.#umbreld.files.fileIndex.photosResolveItems(accountId, [id]))[0]
	}

	resolveLiveCompanion(accountId: string, id: string) {
		return this.#umbreld.files.fileIndex.photosResolveLiveCompanion(accountId, id)
	}

	async prepareUpload(accountId: string, hash: Buffer, albumId?: string) {
		const result = await this.#umbreld.files.fileIndex.photosPrepareUpload(accountId, hash, albumId)
		if (result.status === 'duplicate') this.#changed(accountId)
		return result.status
	}

	async registerUpload(
		accountId: string,
		systemPath: string,
		hash: Buffer,
		revision: PublishedFileRevision,
		albumId?: string,
	) {
		const result = await this.#umbreld.files.fileIndex.photosRegisterUpload(
			accountId,
			systemPath,
			hash,
			revision,
			albumId,
		)
		this.#changed(accountId)
		return result.status
	}

	async #completeBackupSourceRemoval(removal: PhotoBackupSourceRemoval) {
		const {accountId, sourceId, keepItems} = removal
		await this.#umbreld.auth.revokePhotoBackupGrantsForSource(accountId, sourceId)
		const librarySourceId = backupLibrarySourceId(accountId, sourceId)
		if (!keepItems) {
			const files = await this.#umbreld.files.fileIndex.photosSourceRemovalFiles(accountId, librarySourceId)
			for (const file of files) await this.#umbreld.files.trash(file.path, accountId, file.revision)
		}
		await this.#umbreld.files.fileIndex.photosRemoveSource(accountId, librarySourceId, keepItems)
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const sources = (await get('photos.backupSources')) ?? []
			const remainingSources = sources.filter((source) => source.accountId !== accountId || source.id !== sourceId)
			if (remainingSources.length !== sources.length) await set('photos.backupSources', remainingSources)

			// Clear the intent only after the active source record is durably gone.
			// A crash between these writes leaves a replayable tombstone.
			const removals = (await get('photos.backupSourceRemovals')) ?? []
			const remainingRemovals = removals.filter(
				(candidate) => candidate.accountId !== accountId || candidate.sourceId !== sourceId,
			)
			if (remainingRemovals.length !== removals.length) {
				await set('photos.backupSourceRemovals', remainingRemovals)
			}
		})
	}

	async #acquireBackupSourceLock(accountId: string, sourceId: string) {
		const key = `${accountId}\0${sourceId}`
		const previous = this.#backupSourceLockTails.get(key) ?? Promise.resolve()
		let releaseGate!: () => void
		const gate = new Promise<void>((resolve) => (releaseGate = resolve))
		const tail = previous.catch(() => {}).then(() => gate)
		this.#backupSourceLockTails.set(key, tail)
		await previous.catch(() => {})

		let released = false
		return () => {
			if (released) return
			released = true
			releaseGate()
			if (this.#backupSourceLockTails.get(key) === tail) this.#backupSourceLockTails.delete(key)
		}
	}

	async #withBackupSourceLock<T>(accountId: string, sourceId: string, operation: () => Promise<T>) {
		const release = await this.#acquireBackupSourceLock(accountId, sourceId)
		try {
			return await operation()
		} finally {
			release()
		}
	}

	async #withBackupShardLock<T>(key: string, operation: () => Promise<T>) {
		const previous = this.#backupShardLockTails.get(key) ?? Promise.resolve()
		let releaseGate!: () => void
		const gate = new Promise<void>((resolve) => (releaseGate = resolve))
		const tail = previous.catch(() => {}).then(() => gate)
		this.#backupShardLockTails.set(key, tail)
		await previous.catch(() => {})
		try {
			return await operation()
		} finally {
			releaseGate()
			if (this.#backupShardLockTails.get(key) === tail) this.#backupShardLockTails.delete(key)
		}
	}

	#changed(accountId: string) {
		this.#umbreld.eventBus.emit('photos:change', {accountIds: [accountId]})
	}

	async #indexingProgress(accountId: string) {
		try {
			const state = await this.indexingState(accountId)
			await this.#umbreld.eventBus.emit('photos:indexing-progress', {accountId, state})
		} catch (error) {
			// A progress notification is best-effort and must not turn a completed
			// source mutation into an API failure during file-index startup/recovery.
			this.logger.error('Failed to report Photos indexing progress', error)
		}
	}
}
