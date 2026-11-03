import {createHash, randomBytes} from 'node:crypto'
import {constants as fsConstants} from 'node:fs'
import {lookup} from 'node:dns/promises'
import {lstat, open} from 'node:fs/promises'
import nodePath from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'

import fse from 'fs-extra'
import isValidFilename from 'valid-filename'

import type Umbreld from '../../index.ts'
import type {Principal} from '../auth/auth.ts'
import {Blake3Hasher} from '../files/blake3.ts'
import {OWNER_USER_ID} from '../user/constants.ts'

import MapTiles, {UMBREL_MAP_URL, umbrelPlanet} from './map-tiles.ts'
import type {PhotoBackupCloudIdentity, PhotoBackupLocation, PhotoFilter, PhotoScopeMode} from './types.ts'
import {hashFileRevision, type PublishedFileRevision} from '../files/file-index-enrichment.ts'

export type PhotoBackupSource = {
	id: string
	accountId: string
	name: string
	directoryName: string
	createdAt: number
	// Epoch ms the phone last asked for an upload grant
	lastSeenAt?: number
	storageVersion?: 3
	// The platform the phone's app reported at its latest grant, such as 'ios' or
	// 'android'. Sources from before platforms were recorded have none until then.
	platform?: string
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

// Without a cloud identity (both fields or neither) a resource is only
// confirmed by its own key
export type PhotoBackupResourceClaim = PhotoBackupResourceDescriptor & Partial<PhotoBackupCloudIdentity>

// What this server's backup routes do beyond 2.0.0's, for clients deciding
// which requests to send. A server without `photos.backupSources` has none.
// `continue-source`: a restored phone can carry on a listed source and claim the
// resources it already has, and a source never stores the same bytes twice.
export const PHOTO_BACKUP_CAPABILITIES = ['continue-source'] as const

export const PHOTO_BACKUP_SOURCE_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const PHOTO_RESOURCE_KEY_PATTERN = /^[0-9a-f]{64}$/
export const PHOTO_FILE_EXTENSION_PATTERN = /^[a-z0-9]{1,16}$/
export const PHOTO_ORIGINAL_FILENAME_MAX_BYTES = 255
export const PHOTO_CLOUD_IDENTIFIER_MAX_BYTES = 1024
export const PHOTO_RESOURCE_ROLE_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/
const PHOTO_BACKUP_FILENAME_PATTERN = /^([0-9a-f]{64})\.([a-z0-9]{1,16})$/
const PHOTO_BACKUP_SHARD_PATTERN = /^[0-9a-f]{2}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const FILE_NAME_CHARACTER_PATTERN = /[<>:"/\\|?*\u0000-\u001f\u007f]/g
// When the Map view's basemap is first looked at, after umbreld starts, and
// how long it waits for the network, a look every half minute for ten minutes
const MAP_WARM_DELAY_MS = 10_000
const MAP_WARM_RETRY_MS = 30_000
const MAP_WARM_ATTEMPTS = 20

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

export const isPhotoCloudIdentifier = (cloudIdentifier: string) =>
	cloudIdentifier.length > 0 &&
	Buffer.byteLength(cloudIdentifier) <= PHOTO_CLOUD_IDENTIFIER_MAX_BYTES &&
	!CONTROL_CHARACTER_PATTERN.test(cloudIdentifier)

const validateCloudIdentity = ({cloudIdentifier, role}: PhotoBackupCloudIdentity) => {
	if (!isPhotoCloudIdentifier(cloudIdentifier) || !PHOTO_RESOURCE_ROLE_PATTERN.test(role)) {
		throw new Error('Invalid photo backup cloud identity')
	}
	return {cloudIdentifier, role}
}

const cloudIdentityKey = ({cloudIdentifier, role}: PhotoBackupCloudIdentity) => `${cloudIdentifier}\0${role}`

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

// Every phone's id starts with iphone:, Android phones too (see migration v10). The iOS
// app derives this id itself to find its own source in sources.list, so changing it
// strands released apps (rename-source.unit.test.ts pins it)
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

const backupDirectoryBaseName = (name: string, sourceId: string, platform?: string) => {
	const sanitized = truncateUtf8(
		name
			.replace(FILE_NAME_CHARACTER_PATTERN, '-')
			.replace(/\s+/g, ' ')
			.replace(/[ .]+$/g, '')
			.trim(),
		240,
	).replace(/[ .]+$/g, '')
	if (isValidFilename(sanitized)) return sanitized
	return `${platform === 'android' ? 'Android' : 'iPhone'} ${sourceId.slice(0, 8)}`
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

	#map: MapTiles | undefined
	#mapWarming?: AbortController

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		this.logger = umbreld.logger.createChildLogger('photos')
	}

	// The Map view's basemap (see map-tiles.ts): fetched as it is looked at
	// from the planet Umbrel hosts, and first asked about as umbreld starts
	get map() {
		return (this.#map ??= new MapTiles(umbrelPlanet()))
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
		this.#warmMap()
	}

	async stop() {
		this.#mapWarming?.abort()
	}

	// The Map view's first look at its basemap (see MapTiles.status), taken a
	// little after umbreld starts, so the first map opened finds the answer in
	// rather than waiting on the planet's host. Not before the network can
	// find that host: a device just started may not have one yet, and a look
	// at the planet that fails holds up the next for a minute.
	#warmMap() {
		const warming = (this.#mapWarming = new AbortController())
		const options = {signal: warming.signal, ref: false}
		const host = new URL(UMBREL_MAP_URL).hostname
		const online = async () => Boolean(await lookup(host).catch(() => undefined))
		;(async () => {
			await sleep(MAP_WARM_DELAY_MS, undefined, options)
			for (let attempt = 0; attempt < MAP_WARM_ATTEMPTS; attempt++) {
				if (await online()) return await this.map.warm()
				await sleep(MAP_WARM_RETRY_MS, undefined, options)
			}
		})().catch(() => {})
	}

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
		platform,
		continuing,
	}: {
		principal: Principal
		sourceId: string
		suggestedName: string
		platform?: string
		continuing?: boolean
	}) {
		const accountId = validateAccountId(principal.accountId)
		sourceId = normalizeBackupSourceId(sourceId)
		const name = normalizeBackupSourceName(suggestedName)
		return this.#withBackupSourceLock(accountId, sourceId, async () => {
			const registered = await this.#registerBackupSource({accountId, sourceId, name, platform})
			// A phone taking this backup over from another names it after itself, so it
			// isn't mistaken for the old phone's backup and removed
			if (continuing && registered.name !== name) await this.#renameBackupSource(accountId, sourceId, name)
			const source = await this.#markBackupSourceSeen(accountId, sourceId)
			const grant = await this.#umbreld.auth.issuePhotoBackupGrant(principal, source.id)
			return {token: grant.token, source}
		})
	}

	async #markBackupSourceSeen(accountId: string, sourceId: string) {
		let source!: PhotoBackupSource
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const sources = (await get('photos.backupSources')) ?? []
			const current = sources.find((candidate) => candidate.accountId === accountId && candidate.id === sourceId)
			if (!current) throw new Error('Photo backup source was not registered')
			source = {...current, lastSeenAt: Date.now()}
			await set(
				'photos.backupSources',
				sources.map((candidate) => (candidate === current ? source : candidate)),
			)
		})
		return source
	}

	async #registerBackupSource({
		accountId,
		sourceId,
		name,
		platform,
	}: {
		accountId: string
		sourceId: string
		name: string
		platform?: string
	}): Promise<PhotoBackupSource> {
		const pendingRemoval = ((await this.#umbreld.store.get('photos.backupSourceRemovals')) ?? []).find(
			(removal) => removal.accountId === accountId && removal.sourceId === sourceId,
		)
		if (pendingRemoval) await this.#completeBackupSourceRemoval(pendingRemoval)
		let source!: PhotoBackupSource
		let created = false
		let platformChanged = false

		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const sources = (await get('photos.backupSources')) ?? []
			const existing = sources.find((candidate) => candidate.accountId === accountId && candidate.id === sourceId)
			if (existing) {
				// A grant records the platform its app reported; startup replay reports none
				// and keeps the recorded one.
				const recorded = platform && existing.platform !== platform ? {...existing, platform} : existing
				platformChanged = recorded !== existing
				if (recorded.directoryName && !platformChanged) {
					source = existing
					return
				}
				source = recorded.directoryName
					? recorded
					: {
							...recorded,
							directoryName: await this.#uniqueBackupDirectoryName(
								accountId,
								recorded.name,
								sourceId,
								sources,
								recorded.platform,
							),
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
				directoryName: await this.#uniqueBackupDirectoryName(accountId, name, sourceId, sources, platform),
				createdAt: Date.now(),
				...(platform ? {platform} : {}),
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
		// A new phone in the sources list, or a phone now known to run Android, is a
		// library change the UI should hear about right away; other re-registrations
		// (re-auth, startup replay) change nothing
		if (created || platformChanged) this.#changed(accountId)
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
		const result = await this.withBackupSource(accountId, sourceId, (source) =>
			this.#confirmBackupResources(source, [...unique.values()]),
		)
		return result.active ? result.value : []
	}

	// Marks resources backed up without an upload, only ever from this source's own
	// receipts. A resource with a receipt here is confirmed by its key, and learns its
	// cloud identity. Otherwise it matches another receipt here with the same cloud
	// identifier and role, as when a phone restored from another continues its backup.
	// Anything absent from the answer must be uploaded. Undefined when the source is
	// removed or isn't the one created at createdAt, so a request authenticated before
	// removal can't claim into a later source that reuses the id.
	async claimBackupResources({
		accountId,
		sourceId,
		createdAt,
		resources,
	}: {
		accountId: string
		sourceId: string
		createdAt: number
		resources: PhotoBackupResourceClaim[]
	}): Promise<PhotoBackupResourceReceipt[] | undefined> {
		accountId = validateAccountId(accountId)
		sourceId = normalizeBackupSourceId(sourceId)
		const unique = new Map<string, PhotoBackupResourceClaim>()
		for (const resource of resources) {
			const resourceKey = resource.resourceKey.toLowerCase()
			const fileExtension = resource.fileExtension.toLowerCase()
			if (!PHOTO_RESOURCE_KEY_PATTERN.test(resourceKey) || !PHOTO_FILE_EXTENSION_PATTERN.test(fileExtension)) {
				throw new Error('Invalid photo backup resource')
			}
			const hasIdentity = resource.cloudIdentifier !== undefined || resource.role !== undefined
			unique.set(resourceKey, {
				resourceKey,
				fileExtension,
				...(hasIdentity
					? validateCloudIdentity({cloudIdentifier: resource.cloudIdentifier ?? '', role: resource.role ?? ''})
					: {}),
			})
		}
		const result = await this.withBackupSource(accountId, sourceId, async (source) => {
			if (source.createdAt !== createdAt) return
			const fileIndex = this.#umbreld.files.fileIndex
			const librarySourceId = backupLibrarySourceId(accountId, sourceId)
			const receipts = await this.#confirmBackupResources(source, [...unique.values()])
			const confirmed = new Set(receipts.map(({resourceKey}) => resourceKey))
			const identified = [...unique.values()].filter(
				(resource): resource is PhotoBackupResourceDescriptor & PhotoBackupCloudIdentity =>
					resource.cloudIdentifier !== undefined,
			)
			const named = identified.filter(({resourceKey}) => confirmed.has(resourceKey))
			if (named.length > 0) {
				await fileIndex.photosAttachBackupCloudIdentities(
					accountId,
					librarySourceId,
					named.map(({resourceKey, cloudIdentifier, role}) => ({resourceKey, cloudIdentifier, role})),
				)
			}

			const unclaimed = identified.filter(({resourceKey}) => !confirmed.has(resourceKey))
			if (unclaimed.length === 0) return receipts
			const identities = new Map(
				unclaimed.map(({cloudIdentifier, role}) => [
					cloudIdentityKey({cloudIdentifier, role}),
					{cloudIdentifier, role},
				]),
			)
			const matches = new Map<string, {contentHash: Buffer; originalFilename?: string; location: PhotoBackupLocation}>()
			for (const match of await fileIndex.photosBackupCloudIdentityMatches(accountId, librarySourceId, [
				...identities.values(),
			])) {
				const location = await this.#currentBackupLocation(accountId, match.locations)
				if (location) matches.set(cloudIdentityKey(match), {...match, location})
			}
			const claimed = new Map<string, PhotoBackupResourceReceipt>()
			const claims = []
			for (const resource of unclaimed) {
				const match = matches.get(cloudIdentityKey(resource))
				if (!match) continue
				claimed.set(resource.resourceKey, {resourceKey: resource.resourceKey, bytes: match.location.bytes})
				claims.push({
					resourceKey: resource.resourceKey,
					hash: match.contentHash,
					originalFilename: match.originalFilename,
					cloud: {cloudIdentifier: resource.cloudIdentifier, role: resource.role},
				})
			}
			if (claims.length === 0) return receipts
			const recorded = await fileIndex.photosRecordMatchedBackupResources(accountId, librarySourceId, claims)
			if (recorded.length > 0) this.#changed(accountId)
			return [...receipts, ...recorded.map((resourceKey) => claimed.get(resourceKey)!)]
		})
		return result.active ? result.value : undefined
	}

	// Every backup source in the account with its library counts, and what the
	// backup routes support. A new or restored phone uses it to continue an
	// existing source, and to learn whether to send cloud identifiers.
	async backupSources(accountId: string) {
		accountId = validateAccountId(accountId)
		const sources = await this.#accountBackupSources(accountId)
		const library = new Map((await this.listSources(accountId)).map((source) => [source.id, source]))
		return {
			capabilities: [...PHOTO_BACKUP_CAPABILITIES],
			sources: sources.map((source) => {
				const listed = library.get(backupLibrarySourceId(accountId, source.id))
				return {
					id: source.id,
					name: source.name,
					createdAt: source.createdAt,
					...(listed?.lastImportAt === undefined ? {} : {lastImportAt: listed.lastImportAt}),
					...(source.lastSeenAt === undefined ? {} : {lastSeenAt: source.lastSeenAt}),
					// So a phone is only offered backups made on its own platform
					...(source.platform === undefined ? {} : {platform: source.platform}),
					stats: listed?.stats ?? {photos: 0, videos: 0, sizeBytes: 0},
				}
			}),
		}
	}

	// The account's backup sources, without any being removed
	async #accountBackupSources(accountId: string) {
		const removals = (await this.#umbreld.store.get('photos.backupSourceRemovals')) ?? []
		return ((await this.#umbreld.store.get('photos.backupSources')) ?? []).filter(
			(source) =>
				source.accountId === accountId &&
				!removals.some((removal) => removal.accountId === accountId && removal.sourceId === source.id),
		)
	}

	// A receipt is satisfied by any visible Home file with its bytes: the one
	// this source uploaded, wherever the user moved it, or another source's copy.
	// Trash never counts.
	async #confirmBackupResources(source: PhotoBackupSource, descriptors: PhotoBackupResourceDescriptor[]) {
		const rows = await this.#umbreld.files.fileIndex.photosConfirmedBackupResources(
			source.accountId,
			backupLibrarySourceId(source.accountId, source.id),
			descriptors.map(({resourceKey}) => resourceKey),
		)
		const byKey = new Map<string, typeof rows>()
		for (const row of rows) byKey.set(row.resourceKey, [...(byKey.get(row.resourceKey) ?? []), row])
		const receipts: PhotoBackupResourceReceipt[] = []
		for (const descriptor of descriptors) {
			const resource = byKey.get(descriptor.resourceKey)
			if (!resource) continue
			const locations = resource.flatMap(({path, bytes, revision}) =>
				path === undefined || bytes === undefined || revision === undefined ? [] : [{path, bytes, revision}],
			)
			const location = await this.#currentBackupLocation(source.accountId, locations)
			if (location) {
				receipts.push({resourceKey: descriptor.resourceKey, bytes: location.bytes})
				continue
			}

			// Unsupported future PhotoKit formats are intentionally absent from
			// media enrichment, and an index row can lag a change on disk. Confirm
			// by hashing the deterministic upload location and each indexed one
			// against the durable resource relation.
			const contentHash = resource[0]!.contentHash
			const paths = new Set([
				this.backupResourceVirtualPath(source, descriptor.resourceKey, descriptor.fileExtension),
				...locations.map(({path}) => path),
			])
			for (const path of paths) {
				const uploaded = await this.#hashBackupFile(source.accountId, path).catch(() => undefined)
				if (uploaded?.hash.equals(contentHash)) {
					receipts.push({resourceKey: descriptor.resourceKey, bytes: uploaded.revision.size})
					break
				}
			}
		}
		return receipts
	}

	async #currentBackupLocation(accountId: string, locations: PhotoBackupLocation[]) {
		for (const location of locations) {
			if (await this.backupResourceRevisionIsCurrent(accountId, location.path, location.revision)) return location
		}
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
		cloud?: PhotoBackupCloudIdentity,
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
			cloud && validateCloudIdentity(cloud),
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
		cloud?: PhotoBackupCloudIdentity,
	) {
		// A changed resource is published with keep-both naming, so its current
		// path may no longer be the deterministic base path. Reuse the durable
		// relation first to keep later retries idempotent after edits and moves.
		const registered = await this.#umbreld.files.fileIndex.photosConfirmedBackupResources(
			source.accountId,
			backupLibrarySourceId(source.accountId, source.id),
			[resourceKey],
		)
		if (registered[0] && hash.equals(registered[0].contentHash)) {
			const location = await this.#currentBackupLocation(
				source.accountId,
				registered.flatMap(({path, bytes, revision}) =>
					path === undefined || bytes === undefined || revision === undefined ? [] : [{path, bytes, revision}],
				),
			)
			if (location) {
				return {receipt: {resourceKey, path: location.path, bytes: location.bytes}, revision: location.revision}
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
			cloud,
		)
		return {receipt, revision: uploaded.revision}
	}

	// Bytes this source already has under another resource key satisfy a new
	// receipt without storing a second copy: a phone that took over this source
	// sending a photo the old phone sent, or two phones on one source sending
	// the same one. The caller still checks the revision before it skips
	// publishing.
	async registerSourceDuplicateBackupResource(
		source: PhotoBackupSource,
		resourceKey: string,
		hash: Buffer,
		originalFilename: string,
		sourceCreationDate?: number,
		cloud?: PhotoBackupCloudIdentity,
	) {
		const fileIndex = this.#umbreld.files.fileIndex
		const librarySourceId = backupLibrarySourceId(source.accountId, source.id)
		const locations = await fileIndex.photosBackupSourceContentLocations(source.accountId, librarySourceId, hash)
		const location = await this.#currentBackupLocation(source.accountId, locations)
		if (!location) return
		const [recorded] = await fileIndex.photosRecordMatchedBackupResources(source.accountId, librarySourceId, [
			{resourceKey, hash, originalFilename, sourceCreationDate, cloud: cloud && validateCloudIdentity(cloud)},
		])
		if (!recorded) return
		this.#changed(source.accountId)
		return {receipt: {resourceKey, path: location.path, bytes: location.bytes}, revision: location.revision}
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
			source.platform,
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

	async #uniqueBackupDirectoryName(
		accountId: string,
		name: string,
		sourceId: string,
		sources: PhotoBackupSource[],
		platform?: string,
	) {
		const baseName = backupDirectoryBaseName(name, sourceId, platform)
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

	mapPoints(accountId: string, filter: PhotoFilter) {
		return this.#umbreld.files.fileIndex.photosMapPoints(accountId, filter)
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

		return this.#withBackupSourceLock(accountId, source.id, () => this.#renameBackupSource(accountId, source.id, name))
	}

	// Under the source's lock
	async #renameBackupSource(accountId: string, sourceId: string, name: string) {
		let renamed: PhotoBackupSource | undefined
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const sources = (await get('photos.backupSources')) ?? []
			const current = sources.find((candidate) => candidate.accountId === accountId && candidate.id === sourceId)
			const removals = (await get('photos.backupSourceRemovals')) ?? []
			if (!current || removals.some((removal) => removal.accountId === accountId && removal.sourceId === sourceId)) {
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
	}

	async updateSource(accountId: string, id: string, scope?: {mode: PhotoScopeMode; paths: string[]}) {
		const source = await this.#umbreld.files.fileIndex.photosUpdateSource(accountId, id, scope)
		if (source) {
			this.#changed(accountId)
			await this.#indexingProgress(accountId)
		}
		return source
	}

	// How many of a phone's items removing its backup with its items moves to
	// Trash: the ones nowhere else on the Umbrel. Undefined when the account has no
	// such backup.
	async sourceRemovalItemCount(accountId: string, id: string) {
		accountId = validateAccountId(accountId)
		const sources = await this.#accountBackupSources(accountId)
		if (!sources.some((source) => backupLibrarySourceId(accountId, source.id) === id)) return undefined
		return this.#umbreld.files.fileIndex.photosSourceRemovalItemCount(accountId, id)
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
