/**
 * Note: ext4 Filesystem Directory Entry Limit
 * ------------------------------------------
 * The current ext4 filesystem in umbrelOS is created with the `dir_index` feature
 * enabled (for faster name lookups in large directories), but *without* the `large_dir`
 * feature enabled (which would increase the limit on the number of files per directory).
 * See https://man7.org/linux/man-pages/man5/ext4.5.html
 *
 * Without `large_dir`, the `dir_index` hash tree has a limited depth, restricting the number of entries
 * in a single directory. In testing, the limit is on the order of a few hundreds of thousands, but not millions, of files.
 *
 * Exceeding this limit will cause file creation/write errors, visible in `dmesg` as:
 *   `EXT4-fs warning ... ext4_dx_add_entry: Directory ... index full, reach max htree level`
 *   `EXT4-fs warning ... ext4_dx_add_entry: Large directory feature is not enabled...`
 * It stems from the `dir_index` htree reaching its maximum depth without `large_dir`.
 */

import nodePath from 'node:path'
import {createHash, randomUUID} from 'node:crypto'
import type {BigIntStats, Stats} from 'node:fs'
import {cp, constants, link, lstat, open, rename, unlink, type FileHandle} from 'node:fs/promises'

import fse from 'fs-extra'
import {$, execa} from 'execa'
import {minimatch} from 'minimatch'
import isValidFilename from 'valid-filename'
import pRetry from 'p-retry'
import PQueue from 'p-queue'

import {copyWithProgress} from '../utilities/copy-with-progress.js'
import getLiveDirectorySize from '../utilities/get-directory-size.js'

import {getDiskUsageByPath} from '../system/system.js'

import Watcher from './watcher.js'
import Recents from './recents.js'
import Favorites from './favorites.js'
import Archive from './archive.js'
import Thumbnails from './thumbnails.js'
import Samba from './samba.js'
import ExternalStorage from './external-storage.js'
import NetworkStorage from './network-storage.js'
import Search from './search.js'
import MemberShares from './member-shares.js'
import CloudManager, {
	cloudDestinationDetails,
	cloudDestinationPath,
	type SharedDestinationDeleteCandidate,
} from './cloud.js'
import {CLOUD_DESTINATION_MISSING_ERROR, isOsJunkBasename, type DestinationRef} from './cloud-types.js'
import FileIndex, {type FileIndexRoot} from './file-index.js'
import type {PublishedFileRevision} from './file-index-enrichment.js'
import {lookupMimeType} from './mime.js'

import type Umbreld from '../../index.js'
import {OWNER_USER_ID} from '../user/constants.js'

const ALL_OPERATIONS = [
	'copy',
	'move',
	'rename',
	'trash',
	'restore',
	'delete',
	'favorite',
	'unarchive',
	'share',
	'writable',
] as const

type FileOperation = (typeof ALL_OPERATIONS)[number]

export type File = {
	name: string
	path: string
	type: string
	size?: number
	modified: number
	operations: FileOperation[]
	thumbnail?: string
}

type DirectoryListing = File & {
	files: File[]
	truncatedAt?: number
}

export type AuthorizedReadFile = {
	handle: FileHandle
	stats: BigIntStats
	virtualPath: string
	systemPath: string
	name: string
}

type Trashmeta = {
	path: string
}

type TrashClaimManifest = {
	version: 1
	originalSystemPath: string
	revision: PublishedFileRevision
}

type RecoveredTrashClaim = {
	sourceSystemPath: string
	destinationSystemPath: string
	manifestSystemPath: string
}

type PublishedRevisionClaim = {
	claimSystemPath: string
	manifestSystemPath: string
}

const TRASH_CLAIM_SUFFIX = '.umbrel-trash'
const TRASH_CLAIM_MANIFEST_SUFFIX = `.json${TRASH_CLAIM_SUFFIX}`
const MAX_TRASH_CLAIM_MANIFEST_BYTES = 16 * 1024

type BaseDirectory = '/Home' | '/Trash' | '/Apps' | '/Machines' | '/External' | '/Backups' | '/Network'

export type ViewPreferences = {
	view: 'icons' | 'list'
	sortBy: 'name' | 'type' | 'modified' | 'size'
	sortOrder: 'ascending' | 'descending'
}

const DEFAULT_VIEW_PREFERENCES: ViewPreferences = {
	view: 'list',
	sortBy: 'name',
	sortOrder: 'ascending',
}

type OperationProgress = {
	id: string
	type: 'copy' | 'move'
	// The account that started the operation, so progress is only reported back to them
	userId: string
	file: File
	destinationPath: string
	appId?: string
	percent: number
	bytesPerSecond: number
	secondsRemaining?: number
}

export type OperationsInProgress = OperationProgress[]

export type RewindRestoreWorkItem = {
	path: string
	toDirectory: string
	collision: 'error' | 'replace' | 'keep-both'
}

export default class Files {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	baseDirectories: Map<string, string>
	trashMetaDirectory: string
	fileOwner = {userId: 1000, groupId: 1000}
	maxDirectoryListing = 10000
	// Files visibility is intentionally narrower than Cloud's OS-junk filter.
	hiddenFiles = ['.DS_Store', '.directory', '.umbrel-watcher-health-check']
	hiddenExtensions = ['.umbrel-upload', '.umbrel-trash']
	operationsInProgress: OperationsInProgress = []
	#trashClaimQueue = new PQueue({concurrency: 1})
	fileIndex: FileIndex
	watcher: Watcher
	recents: Recents
	favorites: Favorites
	archive: Archive
	thumbnails: Thumbnails
	samba: Samba
	externalStorage: ExternalStorage
	networkStorage: NetworkStorage
	search: Search
	memberShares: MemberShares
	cloud: CloudManager

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())

		this.baseDirectories = new Map<BaseDirectory, string>([
			['/Home', `${umbreld.dataDirectory}/home`],
			['/Trash', `${umbreld.dataDirectory}/trash`],
			['/Apps', `${umbreld.dataDirectory}/app-data`],
			['/Machines', `${umbreld.dataDirectory}/machines`],
			['/External', `${umbreld.dataDirectory}/external`],
			['/Backups', `${umbreld.dataDirectory}/backups`],
			['/Network', `${umbreld.dataDirectory}/network`],
		])

		this.fileIndex = new FileIndex({
			dataDirectory: umbreld.dataDirectory,
			logger: umbreld.logger.createChildLogger('files:file-index'),
			hiddenFiles: this.hiddenFiles,
			hiddenExtensions: this.hiddenExtensions,
			onPhotosChange: (accountIds) => this.#umbreld.eventBus.emit('photos:change', {accountIds}),
			onPhotosIndexingProgress: (progress) => {
				for (const update of progress) this.#umbreld.eventBus.emit('photos:indexing-progress', update)
			},
		})
		this.watcher = new Watcher(umbreld, {
			paths: this.#staticIndexRoots()
				.filter(({scanEnabled}) => scanEnabled !== false)
				.map(({virtualPath}) => virtualPath),
			onChangeBatch: (virtualPath, events) => this.fileIndex.noteWatcherChanges(virtualPath, events),
			onRestart: () => this.fileIndex.scheduleFullReconciliation('watcher-restarted'),
		})
		this.recents = new Recents(umbreld)
		this.favorites = new Favorites(umbreld)
		this.archive = new Archive(umbreld)
		this.thumbnails = new Thumbnails(umbreld)
		this.samba = new Samba(umbreld)
		this.externalStorage = new ExternalStorage(umbreld)
		this.networkStorage = new NetworkStorage(umbreld)
		this.search = new Search(umbreld)
		this.memberShares = new MemberShares(umbreld)
		this.cloud = new CloudManager({
			umbreld,
			resolveDestination: (destination, userId, options) =>
				this.resolveStorageDestination(destination, userId, options),
			onActivity: (userId, activity) => this.#umbreld.eventBus.emit('files:cloud-progress', {userId, activity}),
		})

		// TODO: This should really be in a proper DB, refactor this once we've moved to SQLite
		this.trashMetaDirectory = `${umbreld.dataDirectory}/trash-meta`
	}

	async start() {
		this.logger.log('Starting files')

		// Ensure all base directories exist. Create them on their system paths
		// directly rather than via createDirectory(): the /External, /Backups and
		// /Network roots are read-only in the virtual filesystem, so its
		// permission checks would refuse to create them.
		await Promise.all(
			[...this.baseDirectories].map(async ([virtualPath, systemPath]) => {
				try {
					await fse.ensureDir(systemPath)
					await this.chownSystemPath(systemPath).catch(() => {})
				} catch (error) {
					this.logger.error(`Failed to ensure directory '${virtualPath}' exists`, error)
				}
			}),
		)

		// Ensure the trash meta directory exists
		await fse.ensureDir(this.trashMetaDirectory).catch((error) => {
			this.logger.error(`Failed to ensure directory ${this.trashMetaDirectory} exists`, error)
		})
		await this.chownSystemPath(this.trashMetaDirectory)

		// Do any required one time setup tasks.
		await this.firstRun()

		// FileIndex and Watcher share one root model so their scopes cannot drift.
		const memberRoots = (await this.#umbreld.user.listMembers()).flatMap(({id}) => this.#memberIndexRoots(id))
		await this.fileIndex.setRoots([...this.#staticIndexRoots(), ...memberRoots])
		for (const {virtualPath} of memberRoots) await this.watcher.addPath(virtualPath)

		await this.fileIndex.start()
		void this.recoverTrashClaims().catch((error) =>
			this.logger.error('Failed to recover interrupted revision-checked file operations', error),
		)

		// Start submodules
		await this.watcher.start().catch((error) => this.logger.error(`Failed to start watcher`, error))
		this.fileIndex.startBackgroundReconciliation()
		await this.samba.start().catch((error) => this.logger.error(`Failed to start samba`, error))
		await this.memberShares.start().catch((error) => this.logger.error(`Failed to start member shares`, error))
		await this.externalStorage.start().catch((error) => this.logger.error(`Failed to start external storage`, error))
		await this.networkStorage.start().catch((error) => this.logger.error(`Failed to start network storage`, error))
		await this.favorites.start().catch((error) => this.logger.error(`Failed to start favorites`, error))
		await this.thumbnails.start().catch((error) => this.logger.error(`Failed to start thumbnails`, error))
		await this.cloud.start({background: true}).catch((error) => this.logger.error(`Failed to start cloud`, error))
	}

	async firstRun() {
		// Check if we've already setup favorites
		const isFavoritesInitialized = (await this.#umbreld.store.get('files.favorites')) === undefined
		if (!isFavoritesInitialized) return

		// Initialize default favorites
		const defaultFavourites = ['/Home/Downloads', '/Home/Documents', '/Home/Photos', '/Home/Videos']
		for (const favorite of defaultFavourites) {
			await this.createDirectory(favorite).catch((error) =>
				this.logger.error(`Failed to ensure directory '${favorite}' exists`, error),
			)
			await this.favorites
				.addFavorite(favorite)
				.catch((error) => this.logger.error(`Failed to initialize favorite '${favorite}'`, error))
		}
	}

	async stop() {
		this.logger.log('Stopping files')

		// Stop submodules
		await this.cloud.stop().catch((error) => this.logger.error(`Failed to stop cloud`, error))
		await this.favorites.stop().catch((error) => this.logger.error(`Failed to stop favorites`, error))
		await this.thumbnails.stop().catch((error) => this.logger.error(`Failed to stop thumbnails`, error))
		await this.externalStorage.stop().catch((error) => this.logger.error(`Failed to stop external storage`, error))
		await this.networkStorage.stop().catch((error) => this.logger.error(`Failed to stop network storage`, error))
		await this.memberShares.stop().catch((error) => this.logger.error(`Failed to stop member shares`, error))
		await this.samba.stop().catch((error) => this.logger.error(`Failed to stop samba`, error))
		await this.watcher.stop().catch((error) => this.logger.error(`Failed to stop watcher`, error))
		await this.fileIndex.stop().catch((error) => this.logger.error(`Failed to stop file index`, error))
	}

	// The trash metadata directory for a given user
	trashMetaDirectoryForUser(userId: string): string {
		if (userId === OWNER_USER_ID) return this.trashMetaDirectory
		return `${this.#umbreld.dataDirectory}/members/${userId}/trash-meta`
	}

	// The virtual trash root for a given user (owner: /Trash, member: /Users/<slug>/Trash)
	trashRootForUser(userId: string): string {
		return userId === OWNER_USER_ID ? '/Trash' : `/Users/${userId}/Trash`
	}

	// Create a member's home + trash directories with the default skeleton.
	// Operates on physical paths directly since this is trusted setup code.
	async createMemberDirectories(slug: string) {
		if (slug === OWNER_USER_ID) throw new Error('Refusing to create member directories for the owner')
		const home = this.#memberHomeDirectory(slug)
		const trash = this.#memberTrashDirectory(slug)
		const trashMeta = this.trashMetaDirectoryForUser(slug)
		const skeleton = ['Downloads', 'Documents', 'Photos', 'Videos'].map((folder) => nodePath.join(home, folder))
		for (const directory of [home, trash, trashMeta, ...skeleton]) {
			await fse.ensureDir(directory)
			await this.chownSystemPath(directory).catch(() => {})
		}
		for (const root of this.#memberIndexRoots(slug)) {
			await this.watcher.addPath(root.virtualPath)
			await this.fileIndex
				.addRoot(root)
				.catch((error) => this.logger.error(`Failed to index member root '${root.virtualPath}'`, error))
		}
	}

	// Delete a member's entire directory tree (called on user deletion)
	async deleteMemberDirectories(slug: string) {
		if (slug === OWNER_USER_ID) throw new Error('Refusing to delete member directories for the owner')
		for (const {virtualPath} of this.#memberIndexRoots(slug)) {
			await this.watcher.removePath(virtualPath)
			await this.fileIndex
				.removeRoot(virtualPath)
				.catch((error) => this.logger.error(`Failed to remove member root '${virtualPath}' from the index`, error))
		}
		await fse.remove(`${this.#umbreld.dataDirectory}/members/${slug}`)
	}

	#staticIndexRoots(): FileIndexRoot[] {
		return [
			{
				virtualPath: '/Home',
				systemPath: this.getBaseDirectory('/Home'),
				ownerId: OWNER_USER_ID,
				kind: 'home',
				searchEnabled: true,
			},
			{
				virtualPath: '/Trash',
				systemPath: this.getBaseDirectory('/Trash'),
				ownerId: OWNER_USER_ID,
				kind: 'trash',
				searchEnabled: false,
			},
			{
				virtualPath: '/Apps',
				systemPath: this.getBaseDirectory('/Apps'),
				ownerId: OWNER_USER_ID,
				kind: 'apps',
				searchEnabled: false,
				// App runtimes can contain millions of rapidly changing entries.
				// Keep only on-demand thumbnail entries, as for external storage.
				scanEnabled: false,
			},
			{
				virtualPath: '/Machines',
				systemPath: this.getBaseDirectory('/Machines'),
				ownerId: OWNER_USER_ID,
				kind: 'machines',
				searchEnabled: false,
			},
			{
				virtualPath: '/External',
				systemPath: this.getBaseDirectory('/External'),
				ownerId: OWNER_USER_ID,
				kind: 'apps',
				searchEnabled: false,
				scanEnabled: false,
			},
			{
				virtualPath: '/Backups',
				systemPath: this.getBaseDirectory('/Backups'),
				ownerId: OWNER_USER_ID,
				kind: 'apps',
				searchEnabled: false,
				scanEnabled: false,
			},
			{
				virtualPath: '/Network',
				systemPath: this.getBaseDirectory('/Network'),
				ownerId: OWNER_USER_ID,
				kind: 'apps',
				searchEnabled: false,
				scanEnabled: false,
			},
		]
	}

	#memberIndexRoots(slug: string): FileIndexRoot[] {
		return [
			{
				virtualPath: `/Users/${slug}`,
				systemPath: this.#memberHomeDirectory(slug),
				ownerId: slug,
				kind: 'home',
				searchEnabled: true,
			},
			{
				virtualPath: `/Users/${slug}/Trash`,
				systemPath: this.#memberTrashDirectory(slug),
				ownerId: slug,
				kind: 'trash',
				searchEnabled: false,
			},
		]
	}

	// Typesafe wrapper to get the system path of an owner base directory
	getBaseDirectory(virtualPath: BaseDirectory) {
		const path = this.baseDirectories.get(virtualPath)
		if (!path) throw new Error(`[base-directory-not-found] ${virtualPath}`)
		return path
	}

	isCloudPathOverlap(virtualPath: string) {
		const path = normalizePath(virtualPath)
		return this.cloud.getDestinationPaths().some((destinationPath) => pathsOverlap(path, destinationPath))
	}

	isCloudDestinationOrDescendant(virtualPath: string) {
		const path = normalizePath(virtualPath)
		return this.cloud
			.getDestinationPaths()
			.some((destinationPath) => path === destinationPath || path.startsWith(`${destinationPath}/`))
	}

	// Cloud destinations are indexed across every account, so request paths must
	// be authorized before consulting that index. Otherwise a Cloud-specific
	// response would reveal that another account configured the supplied path.
	async assertCloudMutablePath(virtualPath: string, userId: string) {
		await this.virtualToSystemPath(virtualPath, userId)
		if (this.isCloudPathOverlap(virtualPath)) throw new Error('[cloud-read-only]')
	}

	// Resolve a user-selected Files path into a stable storage reference. The
	// filesystem/share identity lets long-lived features distinguish a mounted
	// destination from the stale directory left behind when storage is removed.
	async getStorageDestination(virtualPath: string, userId: string): Promise<DestinationRef> {
		const path = normalizePath(virtualPath)
		await this.virtualToSystemPath(path, userId)

		const ownerId = this.ownerOfPath(path)
		if (ownerId === userId) {
			const homeRoot = userId === OWNER_USER_ID ? '/Home' : `/Users/${userId}`
			const memberTrashRoot = `${homeRoot}/Trash`
			if (
				path.startsWith(`${homeRoot}/`) &&
				(userId === OWNER_USER_ID || (path !== memberTrashRoot && !path.startsWith(`${memberTrashRoot}/`)))
			) {
				return {path}
			}
		}

		if (path.startsWith('/External/')) {
			const partitions = (await this.externalStorage.getMountedExternalDevices()).flatMap((device) => device.partitions)
			const partition = partitions.find(({mountpoints}) =>
				mountpoints.some((mountPath) => path === mountPath || path.startsWith(`${mountPath}/`)),
			)
			if (partition?.filesystemUuid) {
				const destination = {path, filesystemUuid: partition.filesystemUuid}
				cloudDestinationPath(destination, userId)
				return destination
			}
		}

		if (path.startsWith('/Network/')) {
			const share = (await this.networkStorage.getShareInfo()).find(
				(candidate) =>
					candidate.isMounted && (path === candidate.mountPath || path.startsWith(`${candidate.mountPath}/`)),
			)
			if (share) {
				const destination = {
					path,
					host: share.host,
					share: share.share,
				}
				cloudDestinationPath(destination, userId)
				return destination
			}
		}

		throw new Error('[cloud-invalid-destination]')
	}

	// Resolve filesystem support by stable UUID rather than a user-facing mount
	// path. A drive reconnect can reclaim the same label, while the UUID proves
	// that this is still the partition selected for the app-data move.
	async getExternalStorageFilesystemType(filesystemUuid: string) {
		const partitions = (await this.externalStorage.getMountedExternalDevices()).flatMap((device) => device.partitions)
		return partitions.find((partition) => partition.filesystemUuid === filesystemUuid)?.filesystemType.toLowerCase()
	}

	async resolveStorageDestination(
		destination: DestinationRef,
		userId: string,
		{
			requireEmpty = false,
			allowMissing = false,
		}: {
			requireEmpty?: boolean
			allowMissing?: boolean
			checkOnly?: boolean
		} = {},
	) {
		const details = cloudDestinationDetails(destination, userId)
		const virtualPath = details.path
		let virtualMountPath: string | undefined

		if (details.kind === 'external') {
			virtualMountPath = details.mountPath
			const systemMountPath = this.virtualToSystemPathUnsafe(virtualMountPath)
			if (!(await isExternalFilesystemMountedAt(details.filesystemUuid, systemMountPath))) {
				throw new Error(CLOUD_DESTINATION_MISSING_ERROR)
			}
		} else if (details.kind === 'network') {
			virtualMountPath = details.mountPath
			const share = (await this.networkStorage.getShareInfo()).find(
				(candidate) =>
					candidate.mountPath === details.mountPath &&
					candidate.host === details.host &&
					candidate.share === details.share &&
					candidate.isMounted,
			)
			if (!share) throw new Error(CLOUD_DESTINATION_MISSING_ERROR)
			if (!(await isMountpoint(this.virtualToSystemPathUnsafe(virtualMountPath)))) {
				throw new Error(CLOUD_DESTINATION_MISSING_ERROR)
			}
		}

		const systemPath = await this.virtualToSystemPath(virtualPath, userId)
		let destinationStats: Stats
		try {
			destinationStats = await fse.lstat(systemPath)
		} catch (error) {
			if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return systemPath
			throw new Error(CLOUD_DESTINATION_MISSING_ERROR)
		}
		if (!destinationStats.isDirectory()) throw new Error('[cloud-invalid-destination]')

		const canonicalPath = await fse.realpath(systemPath).catch(() => {
			throw new Error('[cloud-invalid-destination]')
		})
		if (canonicalPath !== nodePath.resolve(systemPath)) throw new Error('[cloud-invalid-destination]')

		if (virtualMountPath) {
			try {
				const mountStats = await fse.lstat(this.virtualToSystemPathUnsafe(virtualMountPath))
				const dataDirectoryStats = await fse.lstat(this.#umbreld.dataDirectory)
				if (mountStats.dev !== destinationStats.dev || destinationStats.dev === dataDirectoryStats.dev) {
					throw new Error(CLOUD_DESTINATION_MISSING_ERROR)
				}
			} catch {
				throw new Error(CLOUD_DESTINATION_MISSING_ERROR)
			}
		}

		if (requireEmpty && (await fse.readdir(systemPath)).some((name) => !isOsJunkBasename(name))) {
			throw new Error('[cloud-destination-not-empty]')
		}
		if (requireEmpty) {
			const probePath = nodePath.join(systemPath, `.umbrel-cloud-probe-${randomUUID()}`)
			try {
				await execa('mkdir', ['--', probePath], {uid: this.fileOwner.userId, gid: this.fileOwner.groupId})
				await execa('rmdir', ['--', probePath], {uid: this.fileOwner.userId, gid: this.fileOwner.groupId})
			} catch {
				await fse.rmdir(probePath).catch(() => {})
				throw new Error('[cloud-destination-not-writable]')
			}
		}
		return systemPath
	}

	// Creates a new directory at the given virtual path and reports whether this
	// exact call created it.
	async createDirectory(virtualPath: string, userId: string = OWNER_USER_ID) {
		virtualPath = normalizePath(virtualPath)
		if (isMemberTrashRoot(virtualPath)) throw new Error('[operation-not-allowed]')
		const path = await this.virtualToSystemPath(virtualPath, userId)
		if ((await fse.lstat(path).catch(() => undefined))?.isDirectory()) return {created: false as const}
		if (this.isCloudPathOverlap(virtualPath)) throw new Error('[cloud-read-only]')

		// Check if operation is allowed
		const targetAllowedOperations = await this.getAllowedOperations(virtualPath, userId)
		if (!targetAllowedOperations.includes('writable')) throw new Error('[operation-not-allowed]')

		const containingDirectory = nodePath.dirname(virtualPath)
		const containingDirectoryAllowedOperations = await this.getAllowedOperations(containingDirectory, userId)
		if (!containingDirectoryAllowedOperations.includes('writable')) throw new Error('[operation-not-allowed]')

		// Create the directory
		try {
			await fse.mkdir(path)
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code
			if (code === 'EEXIST' && (await fse.lstat(path).catch(() => undefined))?.isDirectory()) {
				return {created: false as const}
			}
			if (code === 'ENOENT') throw new Error('[parent-not-exist]')
			if (code === 'ENOTDIR') throw new Error('[parent-not-directory]')
			throw new Error(`[mkdir-failed] ${(error as Error)?.message}`)
		}

		// Set owner to the umbrel user
		// We do nothing on fail because this isn't supported on all filesystems.
		// e.g this is expected to throw on external exFAT drives.
		await this.chownSystemPath(path).catch(() => {})

		const {dev: device, ino: inode, birthtimeMs} = await fse.lstat(path)
		this.#updateFileIndex(`create '${path}'`, () => this.fileIndex.reconcilePath(path))
		return {created: true as const, identity: {device, inode, birthtimeMs}}
	}

	// Removes a directory only when it is still the empty directory created by
	// the caller's earlier createDirectory() request.
	async cleanupCreatedDirectory(
		virtualPath: string,
		identity: {device: number; inode: number; birthtimeMs: number},
		userId: string = OWNER_USER_ID,
	) {
		virtualPath = normalizePath(virtualPath)
		await this.assertCloudMutablePath(virtualPath, userId)

		const allowedOperations = await this.getAllowedOperations(virtualPath, userId)
		if (!allowedOperations.includes('trash') && !allowedOperations.includes('delete')) {
			throw new Error('[operation-not-allowed]')
		}

		const path = await this.virtualToSystemPath(virtualPath, userId)
		try {
			const stats = await fse.lstat(path)
			if (
				!stats.isDirectory() ||
				stats.dev !== identity.device ||
				stats.ino !== identity.inode ||
				stats.birthtimeMs !== identity.birthtimeMs
			) {
				return false
			}
			await fse.rmdir(path)
			this.#updateFileIndex(`remove '${path}'`, () => this.fileIndex.removePath(path))
			return true
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code
			if (code === 'ENOENT' || code === 'ENOTEMPTY' || code === 'EEXIST') return false
			throw error
		}
	}

	// Set owner of system path to umbrel user
	async chownSystemPath(systemPath: string) {
		await fse.chown(systemPath, this.fileOwner.userId, this.fileOwner.groupId)
	}

	// Gets file status given a system path.
	// We use a system path here because everywhere we call this
	// we already have a system path so we know it's safe. Also
	// converting a system path back into a virtual path for the
	// return value is cheap but converting a virtual path into a
	// system path is expensive and we call this on every file in
	// a directory.
	async status(
		systemPath: string,
		userId: string = OWNER_USER_ID,
		{includeIndexedDirectorySize = true}: {includeIndexedDirectorySize?: boolean} = {},
	): Promise<File> {
		// Get the path and filename
		const path = this.systemToVirtualPath(systemPath)
		const name = nodePath.basename(path)

		// Get stats, operations, and thumbnail concurrently
		// This will ensure that we complete these as fast as the slowest operation
		const [stats, operations, thumbnail] = await Promise.all([
			// We use lstat to ensure we don't follow symlinks
			fse.lstat(systemPath),

			// Get the allowed operations for the requesting user
			this.getAllowedOperations(path, userId),

			// Get the thumbnail for supported file types only if the thumbnail already exists (does not generate a missing thumbnail)
			this.thumbnails.getExistingThumbnail(systemPath).catch(() => undefined),
		])

		// Get the type
		let type
		if (stats.isDirectory()) type = 'directory'
		else if (stats.isSymbolicLink()) type = 'symbolic-link'
		else if (stats.isSocket()) type = 'socket'
		else if (stats.isBlockDevice()) type = 'block-device'
		else if (stats.isCharacterDevice()) type = 'character-device'
		else if (stats.isFIFO()) type = 'fifo'
		else type = lookupMimeType(name) || 'application/octet-stream'

		// Get the size in bytes
		let size: number | undefined = stats.size
		if (type === 'directory') {
			size = undefined
			if (includeIndexedDirectorySize) {
				const [indexed] = await this.fileIndex.directorySizes([path]).catch(() => [])
				if (indexed?.virtualPath === path) size = indexed.size
			}
		}

		// Get the modified time
		const modified = stats.mtime.getTime()

		return {
			name,
			path,
			type,
			size,
			modified,
			operations,
			thumbnail,
		}
	}

	async annotateIndexedDirectorySizes(files: readonly File[]) {
		// Listing metadata is allowed to use the index only. An omitted path stays
		// undefined instead of turning a fast listing into a recursive filesystem walk.
		const directoryPaths = files.filter(({type}) => type === 'directory').map(({path}) => path)
		if (directoryPaths.length === 0) return [...files]
		const indexedSizes = await this.fileIndex.directorySizes(directoryPaths).catch(() => [])
		const sizesByPath = new Map(indexedSizes.map(({virtualPath, size}) => [virtualPath, size]))
		return files.map((file) => {
			const size = sizesByPath.get(file.path)
			return size === undefined ? file : {...file, size}
		})
	}

	// Revoke references to a removed path and its descendants. Call before
	// replacing content so the new directory cannot inherit the old access.
	async removeReferencesWithin(virtualPath: string) {
		virtualPath = normalizePath(virtualPath)
		await this.memberShares.removeWithin(virtualPath)
		// App paths have no recursive watcher. Files mutations and app uninstall
		// clean these up directly; daily checks handle changes made elsewhere.
		if (virtualPath.startsWith('/Apps/')) {
			await this.samba.removeSharesWithin(virtualPath)
			await this.favorites.removeWithin(virtualPath)
		}
		await this.#umbreld.mcp.removeFileGrantsWithin(virtualPath)
	}

	async getStorageUsage() {
		// External, Network, and Backups are deliberately absent: these aggregates
		// account only for owner/member Files roots stored on indexed device storage.
		const memberPaths = (await this.#umbreld.user.listMembers()).flatMap(({id}) => [
			`/Users/${id}`,
			`/Users/${id}/Trash`,
		])
		const virtualPaths = ['/Home', '/Trash', ...memberPaths]
		const indexedSizes = await this.fileIndex.directorySizes(virtualPaths).catch(() => [])
		const sizesByPath = new Map(indexedSizes.map(({virtualPath, size}) => [virtualPath, size]))
		const usages = await Promise.all(
			virtualPaths.map((virtualPath) => {
				const indexedSize = sizesByPath.get(virtualPath)
				if (indexedSize !== undefined) return indexedSize
				return pRetry(() => getLiveDirectorySize(this.virtualToSystemPathUnsafe(virtualPath)), {retries: 2}).catch(
					() => 0,
				)
			}),
		)
		const thumbnails = await pRetry(() => getLiveDirectorySize(this.thumbnails.thumbnailDirectory), {
			retries: 2,
		}).catch(() => 0)
		return [...usages, thumbnails].reduce((total, usage) => total + usage, 0)
	}

	// Checks if a filename is hidden
	isHidden(filename: string) {
		return (
			this.hiddenFiles.includes(filename) ||
			this.hiddenExtensions.some((extension) => filename.endsWith(extension)) ||
			/^\.(?:data|[A-Za-z0-9_-]+)-moving-[0-9a-f-]+(?:\.tmp)?$/.test(filename)
		)
	}

	// Lists the contents of the root directory.
	// This is a special case since the root directory doesn't map to a system path.
	async #listRoot() {
		const statuses = await Promise.all(
			[...this.baseDirectories.values()].map((systemPath) =>
				this.status(systemPath, OWNER_USER_ID, {includeIndexedDirectorySize: false}),
			),
		)
		const files = await this.annotateIndexedDirectorySizes(statuses)
		return {
			name: '',
			path: '/',
			type: 'directory',
			size: undefined,
			modified: 0,
			operations: [],
			files,
		}
	}

	// Lists the contents of a directory given a virtual path.
	// Will return all files in the directory up to this.maxDirectoryListing
	// We safely stream the directory to avoid blowing up Node.js if the directory is large.
	async list(virtualPath: string, userId: string = OWNER_USER_ID): Promise<DirectoryListing> {
		virtualPath = normalizePath(virtualPath)

		// Special handling for the root directory since it doesn't map to a system path.
		// Only the owner has a root listing (their base directories); members browse
		// from their own /Users/<slug> home.
		if (virtualPath === '/') {
			if (userId !== OWNER_USER_ID) throw new Error('[forbidden] /')
			return this.#listRoot()
		}

		// Members may traverse the ancestors of paths shared with them, seeing
		// only the whitelisted entries leading down to their shares
		if (userId !== OWNER_USER_ID && this.ownerOfPath(virtualPath) !== userId) {
			const share = await this.memberShares.shareGrantFor(virtualPath, userId)
			if (!share) {
				const visibleChildren = await this.memberShares.visibleChildrenFor(virtualPath, userId)
				if (!visibleChildren) throw new Error(`[forbidden] '${virtualPath}'`)
				return this.#listSharedAncestor(virtualPath, visibleChildren, userId)
			}
		}

		// Get the system path and directory details
		const systemPath = await this.virtualToSystemPath(virtualPath, userId)
		const directoryDetails = await this.status(systemPath, userId).catch((error) => {
			if (error?.message?.includes('ENOENT')) throw new Error('[does-not-exist]')
			throw error
		})

		// List the contents of the directory
		const fileJobs = []
		let truncatedAt: number | undefined = undefined
		// We open an async iterator to the directory so we can safely stream a large directory
		// and exit if it gets too big.
		// Iterate over the directory contents
		let count = 0
		for await (const fileSystemPath of getDirectoryStream(systemPath)) {
			// Skip hidden files
			if (this.isHidden(nodePath.basename(fileSystemPath))) continue

			// Push the file details job to the queue to limit concurrency
			fileJobs.push(
				this.status(fileSystemPath, userId, {includeIndexedDirectorySize: false}).catch((error) => {
					this.logger.error(`Failed to get status for '${fileSystemPath}'`, error)
					return undefined
				}),
			)
			count++
			// If we've reached the maximum number of files, set the truncatedAt property
			// and break out of the loop.
			if (count >= this.maxDirectoryListing) {
				truncatedAt = this.maxDirectoryListing
				break
			}
		}

		// Filter out any files that failed to get status
		const statuses = (await Promise.all(fileJobs)).filter((file) => file !== undefined) as File[]
		const files = await this.annotateIndexedDirectorySizes(statuses)

		return {
			...directoryDetails,
			files,
			truncatedAt,
		}
	}

	// A filtered listing of a directory a member may only traverse on the way
	// down to paths shared with them: just the whitelisted entries, and no
	// operations on entries that aren't themselves covered by a grant.
	async #listSharedAncestor(virtualPath: string, childNames: string[], userId: string): Promise<DirectoryListing> {
		const systemPath = this.virtualToSystemPathUnsafe(virtualPath)
		const directoryDetails = await this.status(systemPath, userId, {includeIndexedDirectorySize: false}).catch(
			(error) => {
				if (error?.message?.includes('ENOENT')) throw new Error('[does-not-exist]')
				throw error
			},
		)

		const files: File[] = []
		for (const childName of childNames) {
			const file = await this.status(nodePath.join(systemPath, childName), userId, {
				includeIndexedDirectorySize: false,
			}).catch(() => undefined)
			if (file) files.push(file)
		}

		// Intermediate ancestors can contain owner data outside the member's
		// grants, so exposing their aggregate size would disclose that hidden
		// content. Only annotate children whose complete subtree is covered by a
		// share; deeper traversal-only ancestors retain the default zero size.
		const sharedFiles = (
			await Promise.all(
				files.map(async (file) => ((await this.memberShares.shareGrantFor(file.path, userId)) ? file : undefined)),
			)
		).filter((file): file is File => file !== undefined)
		const annotatedSharedFiles = await this.annotateIndexedDirectorySizes(sharedFiles)
		const annotatedByPath = new Map(annotatedSharedFiles.map((file) => [file.path, file]))
		const annotatedFiles = files.map((file) => annotatedByPath.get(file.path) ?? file)

		return {
			...directoryDetails,
			files: annotatedFiles,
			truncatedAt: undefined,
		}
	}

	// Recursively stream the contents of a virtual directory
	async *streamContents(virtualPath: string, userId: string = OWNER_USER_ID) {
		virtualPath = normalizePath(virtualPath)
		const systemPath = await this.virtualToSystemPath(virtualPath, userId)
		const directoryStream = getDirectoryStream(systemPath, {recursive: true})
		for await (const systemPath of directoryStream) yield systemPath
	}

	// Track a copy/move in operationsInProgress so it shows in the floating
	// operations island, run it, then clear it.
	async trackOperation(
		{
			type,
			sourceSystemPath,
			destinationSystemPath,
			destinationVirtualPath,
			appId,
			userId = OWNER_USER_ID,
		}: {
			type: 'copy' | 'move'
			sourceSystemPath: string
			destinationSystemPath: string
			destinationVirtualPath?: string
			appId?: string
			userId?: string
		},
		run: (
			onProgress: (progress: {progress: number; bytesPerSecond: number; secondsRemaining?: number}) => void,
		) => Promise<void>,
	) {
		const operationProgress: OperationProgress = {
			id: randomUUID(),
			type,
			userId,
			file: await this.status(sourceSystemPath),
			destinationPath: destinationVirtualPath ?? this.systemToVirtualPath(destinationSystemPath),
			appId,
			percent: 0,
			bytesPerSecond: 0,
		}
		this.operationsInProgress.push(operationProgress)
		this.#umbreld.eventBus.emit('files:operation-progress', this.operationsInProgress)

		try {
			await run((progress) => {
				operationProgress.percent = progress.progress
				operationProgress.bytesPerSecond = progress.bytesPerSecond
				operationProgress.secondsRemaining = progress.secondsRemaining
				this.#umbreld.eventBus.emit('files:operation-progress', this.operationsInProgress)
			})
		} finally {
			this.operationsInProgress = this.operationsInProgress.filter((operation) => operation !== operationProgress)
			this.#umbreld.eventBus.emit('files:operation-progress', this.operationsInProgress)
		}
	}

	async #copyWithProgress(
		sourceSystemPath: string,
		destinationSystemPath: string,
		{move = false, userId = OWNER_USER_ID}: {move?: boolean; userId?: string} = {},
	) {
		// Error handling consistent with fse.copy and move
		const destinationExists = await fse.exists(destinationSystemPath)
		if (destinationExists) throw new Error('[destination-already-exists]')
		if (destinationSystemPath.startsWith(sourceSystemPath)) throw new Error('[subdir-of-self]')

		await this.trackOperation(
			{type: move ? 'move' : 'copy', sourceSystemPath, destinationSystemPath, userId},
			async (onProgress) => {
				// Attempt instant copy via reflink on supported filesystems (e.g. zfs)
				try {
					await cp(sourceSystemPath, destinationSystemPath, {
						recursive: true,
						preserveTimestamps: true,
						mode: constants.COPYFILE_FICLONE_FORCE,
					})
					onProgress({progress: 100, bytesPerSecond: 0})
				} catch {
					// Reflink not supported, fall back to rsync with progress tracking
					await copyWithProgress(sourceSystemPath, destinationSystemPath, onProgress)
				}
			},
		)

		// If we're moving, delete the source file or directory on completion
		if (move) await fse.remove(sourceSystemPath)
	}
	// Copies a file or directory from one virtual path to another.
	async copy(
		sourceVirtualPath: string,
		destinationVirtualDirectory: string,
		{
			collision = 'error',
			userId = OWNER_USER_ID,
			rewindRestoreToken,
		}: {collision?: string; userId?: string; rewindRestoreToken?: symbol} = {},
	) {
		sourceVirtualPath = normalizePath(sourceVirtualPath)
		destinationVirtualDirectory = normalizePath(destinationVirtualDirectory)

		// Authorize every caller-supplied path before consulting advisory
		// operations, which include the global Cloud destination policy.
		let sourceSystemPath = await this.virtualToSystemPath(sourceVirtualPath, userId)
		const destinationSystemDirectory = await this.virtualToSystemPath(destinationVirtualDirectory, userId)

		// Check if operation is allowed
		const allowedOperations = await this.getAllowedOperations(destinationVirtualDirectory, userId, {
			rewindRestoreToken,
		})
		if (!allowedOperations.includes('writable')) {
			await this.assertCloudMutablePath(destinationVirtualDirectory, userId)
			throw new Error('[operation-not-allowed]')
		}

		// Error if the source doesn't exist
		const sourceExists = await fse.exists(sourceSystemPath)
		if (!sourceExists) throw new Error('[source-not-exists]')

		// Error if the destination directory doesn't exist
		const targetExists = await fse.exists(destinationSystemDirectory)
		if (!targetExists) throw new Error(`[destination-not-exist]`)

		// Check we have enough free space on the destination
		const sourceStats = await fse.stat(sourceSystemPath)
		const diskUsage = await getDiskUsageByPath(destinationSystemDirectory)
		const buffer = 1024 * 1024 * 1024 * 1 // 1GB
		const neededSpace = sourceStats.size + buffer
		if (diskUsage.available < neededSpace) throw new Error('[not-enough-space]')

		// Add trailing slash to source path if it's a directoryso we only copy the contents
		if (sourceStats.isDirectory()) sourceSystemPath = `${sourceSystemPath}/`

		// Build absolute destination path
		let destinationSystemPath = nodePath.join(destinationSystemDirectory, nodePath.basename(sourceSystemPath))
		const rewindRestoreTarget = this.systemToVirtualPath(destinationSystemPath)

		// Always use 'keep-both' collision handling for same directory copies
		const isSameDirectory = nodePath.dirname(sourceVirtualPath) === destinationVirtualDirectory
		if (isSameDirectory) collision = 'keep-both'

		// Handle name collisions
		if (collision === 'error') {
			const destinationExists = await fse.pathExists(destinationSystemPath)
			if (destinationExists) throw new Error('[destination-already-exists]')
		} else if (collision === 'keep-both') {
			destinationSystemPath = await this.getUniqueName(destinationSystemPath)
		}

		// Collision handling can change the target path. Authorize the final path,
		// and require permission to remove it before replacing existing content.
		destinationSystemPath = await this.authorizeDestinationSystemPath(destinationSystemPath, userId, {
			replace: collision === 'replace',
			rewindRestoreToken,
			rewindRestoreTarget,
		})

		if (collision === 'replace') {
			// Remove the destination file/directory so that in the case of a directory, the contents are fully replaced
			// This entire fse.remove and subsequent fse.copy action is not atomic. If the copy fails, the original destination content will not be restored.
			await this.removeReferencesWithin(this.systemToVirtualPath(destinationSystemPath))
			await fse.remove(destinationSystemPath)
		}

		// Perform the copy operation
		await this.#copyWithProgress(sourceSystemPath, destinationSystemPath, {userId})
		// A replacement may leave stale descendants from the old destination.
		// Clear them only after the filesystem copy so index scheduling cannot
		// delay the actual operation.
		if (collision === 'replace') {
			this.#updateFileIndex(`clear replaced destination '${destinationSystemPath}'`, () =>
				this.fileIndex.removePath(destinationSystemPath),
			)
		}
		this.#updateFileIndex(`copy to '${destinationSystemPath}'`, () =>
			this.fileIndex.reconcilePath(destinationSystemPath),
		)

		// Return the virtual path of the new copy
		return this.systemToVirtualPath(destinationSystemPath)
	}

	async restoreFromRewind(
		workItems: RewindRestoreWorkItem[],
		confirmedSyncIds: string[],
		userId: string = OWNER_USER_ID,
	) {
		if (workItems.length === 0) throw new Error('[operation-not-allowed]')
		const normalizedItems = workItems.map((item) => {
			const sourcePath = normalizePath(item.path)
			const components = sourcePath.split('/').filter(Boolean)
			if (components[0] !== 'Backups' || !['Home', 'Apps'].includes(components[2])) {
				throw new Error('[operation-not-allowed]')
			}
			return {
				...item,
				path: sourcePath,
				toDirectory: normalizePath(item.toDirectory),
			}
		})
		const targetPaths = normalizedItems.map(({path, toDirectory}) =>
			normalizePath(`${toDirectory}/${nodePath.basename(path)}`),
		)

		await this.cloud.restoreForRewind({
			userId,
			confirmedSyncIds,
			targetPaths,
			restore: async (rewindRestoreToken) => {
				for (const item of normalizedItems) {
					await this.copy(item.path, item.toDirectory, {
						collision: item.collision,
						userId,
						rewindRestoreToken,
					})
				}
			},
		})
		return true
	}

	// Moves a file or directory from one virtual path to another.
	async move(
		sourceVirtualPath: string,
		destinationVirtualDirectory: string,
		{collision = 'error', userId = OWNER_USER_ID}: {collision?: string; userId?: string} = {},
	) {
		sourceVirtualPath = normalizePath(sourceVirtualPath)
		destinationVirtualDirectory = normalizePath(destinationVirtualDirectory)

		// Authorize every caller-supplied path before consulting advisory
		// operations, which include the global Cloud destination policy.
		let sourceSystemPath: string
		try {
			sourceSystemPath = await this.virtualToSystemPath(sourceVirtualPath, userId)
		} catch (error) {
			// Preserve the public behavior for traversal outside a Files base:
			// source paths are protected operations, not addressable locations.
			if ((error as Error).message.startsWith('[invalid-base]')) throw new Error('[operation-not-allowed]')
			throw error
		}
		const destinationSystemDirectory = await this.virtualToSystemPath(destinationVirtualDirectory, userId)

		// If the destination is the current containing folder then the file is already in the correct location
		// so we don't need to do anything.
		if (nodePath.dirname(sourceVirtualPath) === destinationVirtualDirectory) return sourceVirtualPath

		// Check if operation is allowed on source
		const allowedSourceOperations = await this.getAllowedOperations(sourceVirtualPath, userId)
		if (!allowedSourceOperations.includes('move')) {
			await this.assertCloudMutablePath(sourceVirtualPath, userId)
			throw new Error('[operation-not-allowed]')
		}

		// Check if operation is allowed on destination
		const allowedDestinationOperations = await this.getAllowedOperations(destinationVirtualDirectory, userId)
		if (!allowedDestinationOperations.includes('writable')) {
			await this.assertCloudMutablePath(destinationVirtualDirectory, userId)
			throw new Error('[operation-not-allowed]')
		}

		// Error if the source doesn't exist
		const sourceStats = await fse.stat(sourceSystemPath).catch(() => {
			throw new Error('[source-not-exists]')
		})

		// Error if the destination directory doesn't exist
		const targetDirectoryStats = await fse.stat(destinationSystemDirectory).catch(() => {
			throw new Error('[destination-not-exist]')
		})

		// Add trailing slash to source path if it's a directoryso we only copy the contents
		if ((await fse.lstat(sourceSystemPath)).isDirectory()) sourceSystemPath = `${sourceSystemPath}/`

		// Build absolute destination path
		let destinationSystemPath = nodePath.join(destinationSystemDirectory, nodePath.basename(sourceSystemPath))

		// Handle name collisions
		if (collision === 'keep-both') destinationSystemPath = await this.getUniqueName(destinationSystemPath)

		// Collision handling can change the target path. Authorize the final path,
		// and require permission to remove it before replacing existing content.
		destinationSystemPath = await this.authorizeDestinationSystemPath(destinationSystemPath, userId, {
			replace: collision === 'replace',
		})

		if (collision === 'replace') {
			await this.removeReferencesWithin(this.systemToVirtualPath(destinationSystemPath))
			await fse.remove(destinationSystemPath)
		}

		// Toggle move operation based on for cross fs moves.
		// Also allow overriding this so we can test both variants in the test suite.
		const forceSlowMoveWithProgress = process.env.UMBRELD_FORCE_SLOW_MOVE_WITH_PROGRESS === 'true'
		const isMovingAcrossFilesystems = sourceStats.dev !== targetDirectoryStats.dev
		if (isMovingAcrossFilesystems || forceSlowMoveWithProgress) {
			// If we're moving across filesystems there will be a slow copy and delete so
			// we'll use our own implementation that reports progress.
			await this.#copyWithProgress(sourceSystemPath, destinationSystemPath, {move: true, userId})
		} else {
			// Otherwise we can use native system move for instant atomic move on the same filesystem.
			await move(sourceSystemPath, destinationSystemPath)
		}
		await this.removeReferencesWithin(sourceVirtualPath)
		if (collision === 'replace') {
			this.#updateFileIndex(`clear replaced destination '${destinationSystemPath}'`, () =>
				this.fileIndex.removePath(destinationSystemPath),
			)
		}
		this.#updateFileIndex(`move '${sourceSystemPath}' to '${destinationSystemPath}'`, () =>
			this.fileIndex.movePath(sourceSystemPath, destinationSystemPath),
		)

		// Return the virtual path of the new location
		return this.systemToVirtualPath(destinationSystemPath)
	}

	// Rename a file or directory
	async rename(sourceVirtualPath: string, newName: string, userId: string = OWNER_USER_ID): Promise<string> {
		sourceVirtualPath = normalizePath(sourceVirtualPath)

		// Authorize before consulting Cloud-aware advisory operations.
		const sourceSystemPath = await this.virtualToSystemPath(sourceVirtualPath, userId)

		// Check if operation is allowed.
		const allowedOperations = await this.getAllowedOperations(sourceVirtualPath, userId)
		if (!allowedOperations.includes('rename')) {
			await this.assertCloudMutablePath(sourceVirtualPath, userId)
			throw new Error(`[operation-not-allowed]`)
		}

		// Ensure that a new name is valid.
		if (!isValidFilename(newName)) throw new Error(`[invalid-filename] Invalid filename: '${newName}'`)

		// If the new name is identical to the current base name, do nothing.
		const currentName = nodePath.basename(sourceSystemPath)
		if (currentName === newName) return sourceVirtualPath

		// Determine the parent directory (system path) and compute the new candidate system path.
		const parentDirectory = nodePath.dirname(sourceSystemPath)
		const targetSystemPath = await this.authorizeDestinationSystemPath(nodePath.join(parentDirectory, newName), userId)

		// Perform the renaming operation by moving the file/directory.
		await move(sourceSystemPath, targetSystemPath)
		await this.removeReferencesWithin(sourceVirtualPath)
		this.#updateFileIndex(`rename '${sourceSystemPath}' to '${targetSystemPath}'`, () =>
			this.fileIndex.movePath(sourceSystemPath, targetSystemPath),
		)

		// Convert the target system path back into a virtual path and return it.
		return this.systemToVirtualPath(targetSystemPath)
	}

	// Trash a file or directory
	async trash(virtualPath: string, userId: string = OWNER_USER_ID, expectedRevision?: PublishedFileRevision) {
		const operation = () => this.#trash(virtualPath, userId, expectedRevision)
		if (!expectedRevision) return operation()
		return (await this.#trashClaimQueue.add(operation))!
	}

	async #trash(virtualPath: string, userId: string, expectedRevision?: PublishedFileRevision) {
		virtualPath = normalizePath(virtualPath)

		// Authorize before consulting Cloud-aware advisory operations.
		const systemPath = await this.virtualToSystemPath(virtualPath, userId)

		// Check if operation is allowed
		const allowedOperations = await this.getAllowedOperations(virtualPath, userId)
		if (!allowedOperations.includes('trash')) {
			await this.assertCloudMutablePath(virtualPath, userId)
			throw new Error('[operation-not-allowed]')
		}

		// Calculate the target trash system path (the user's own trash)
		const trashSystemRoot = await this.virtualToSystemPath(this.trashRootForUser(userId), userId)
		const trashSystemPath = await nodePath.join(trashSystemRoot, nodePath.basename(systemPath))
		let claimedSystemPath = systemPath
		let revisionClaim: PublishedRevisionClaim | undefined

		if (expectedRevision) {
			revisionClaim = await this.#claimPublishedRevision(systemPath, userId, expectedRevision)
			claimedSystemPath = revisionClaim.claimSystemPath
		}

		// Retry on error to work around collision race condition
		// TODO: Add better handling in getUniqueName() for this.
		let uniqueTrashSystemPath = ''
		try {
			await pRetry(
				async () => {
					// Get a unique trash system path
					uniqueTrashSystemPath = await this.getUniqueName(trashSystemPath, {maxIndex: 1000})

					// Move the atomically-claimed revision, or the ordinary pathname for
					// Files calls that do not carry an expected revision.
					await move(claimedSystemPath, uniqueTrashSystemPath)
				},
				{
					retries: 10,
					minTimeout: 100,
					maxTimeout: 100,
					shouldRetry: (error) => error.message === '[destination-already-exists]',
				},
			)
		} catch (error) {
			if (revisionClaim && (await fse.pathExists(revisionClaim.claimSystemPath))) {
				await this.#restoreQuarantinedTrashSource(revisionClaim.claimSystemPath, systemPath)
			}
			if (revisionClaim) await this.#removeTrashClaimManifest(revisionClaim.manifestSystemPath)
			throw error
		}
		if (revisionClaim) await this.#syncDirectory(trashSystemRoot)
		if (revisionClaim) await this.#removeTrashClaimManifest(revisionClaim.manifestSystemPath)
		// Write the meta data for the trashed file or directory
		// TODO: Migrate this to SQLite
		const trashMetaDirectory = this.trashMetaDirectoryForUser(userId)
		await fse.ensureDir(trashMetaDirectory).catch(() => {})
		const trashMetaSystemPath = nodePath.join(trashMetaDirectory, `${nodePath.basename(uniqueTrashSystemPath)}.json`)
		await fse.writeFile(trashMetaSystemPath, JSON.stringify({path: virtualPath} satisfies Trashmeta))

		await this.removeReferencesWithin(virtualPath)
		const indexUpdate = this.#updateFileIndex(`trash '${systemPath}' as '${uniqueTrashSystemPath}'`, () =>
			this.fileIndex.movePath(systemPath, uniqueTrashSystemPath),
		)
		if (expectedRevision) await indexUpdate

		// Return the virtual path of the trashed file or directory
		return this.systemToVirtualPath(uniqueTrashSystemPath)
	}

	// Recover a revision claim left by a stopped revision-checked trash move. The
	// journal is scoped to the authorized source directory and restoration uses
	// link() so it can never replace a newer pathname.
	async recoverTrashClaim(virtualPath: string, userId: string = OWNER_USER_ID) {
		return (
			(await this.#trashClaimQueue.add(async () => {
				virtualPath = normalizePath(virtualPath)
				const systemPath = await this.virtualToSystemPath(virtualPath, userId)
				const recovered = await this.#recoverTrashClaim(systemPath, userId)
				if (!recovered) return false
				await this.#finishTrashClaimRecovery(recovered)
				return true
			})) ?? false
		)
	}

	// Recover every interrupted revision claim in a boot-time background sweep. Claims can
	// be left in Home by a Photos delete or in Trash by a Photos permanent delete;
	// scanning both account-owned roots makes the journal useful after a reboot,
	// not only when an operation happens to retry the same visible pathname.
	async recoverTrashClaims() {
		const memberRoots = (await this.#umbreld.user.listMembers()).flatMap(({id}) => this.#memberIndexRoots(id))
		const roots = [...this.#staticIndexRoots(), ...memberRoots].filter(
			(root) => root.kind === 'home' || root.kind === 'trash',
		)
		for (const root of roots) {
			for await (const manifestSystemPath of walkTrashClaimManifests(root.systemPath)) {
				await this.#trashClaimQueue.add(async () => {
					const manifest = await this.#readTrashClaimManifest(manifestSystemPath)
					if (!manifest) {
						if (await fse.pathExists(manifestSystemPath)) {
							this.logger.error(`Ignoring invalid trash claim manifest '${manifestSystemPath}'`)
						}
						return
					}
					if (
						!isPathInsideOrEqual(root.systemPath, manifest.originalSystemPath) ||
						trashClaimPaths(manifest.originalSystemPath).manifestSystemPath !== manifestSystemPath
					) {
						this.logger.error(`Ignoring invalid trash claim manifest '${manifestSystemPath}'`)
						return
					}
					const recovered = await this.#recoverTrashClaim(manifest.originalSystemPath, root.ownerId)
					if (recovered) await this.#finishTrashClaimRecovery(recovered)
				})
			}
		}
	}

	async #claimPublishedRevision(
		systemPath: string,
		userId: string,
		expectedRevision: PublishedFileRevision,
	): Promise<PublishedRevisionClaim> {
		// A stopped earlier attempt may have left its atomically-claimed entry
		// hidden beside this path. Recover it before starting another claim; the
		// caller retries after the index observes the restored pathname.
		const recoveredClaim = await this.#recoverTrashClaim(systemPath, userId)
		if (recoveredClaim) {
			await this.#finishTrashClaimRecovery(recoveredClaim)
			throw new Error('[trash-claim-recovered]')
		}

		// Atomically take this directory entry out of the visible namespace, then
		// inspect the object we actually claimed. A check followed by a separate
		// move or unlink could act on a replacement installed between those calls.
		const claimDirectory = nodePath.dirname(systemPath)
		const claim = trashClaimPaths(systemPath)
		await this.#writeTrashClaimManifest(claim.manifestSystemPath, {
			version: 1,
			originalSystemPath: systemPath,
			revision: expectedRevision,
		})
		await rename(systemPath, claim.claimSystemPath).catch(async (error) => {
			await this.#removeTrashClaimManifest(claim.manifestSystemPath).catch((cleanupError) =>
				this.logger.error(`Failed to remove unused trash claim '${claim.manifestSystemPath}'`, cleanupError),
			)
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('[source-not-exists]')
			throw error
		})
		await this.#syncDirectory(claimDirectory).catch(async (error) => {
			await this.#restoreQuarantinedTrashSource(claim.claimSystemPath, systemPath)
			await this.#removeTrashClaimManifest(claim.manifestSystemPath)
			throw error
		})
		const stats = await lstat(claim.claimSystemPath, {bigint: true}).catch(() => undefined)
		if (!matchesPublishedRevision(stats, expectedRevision)) {
			await this.#restoreQuarantinedTrashSource(claim.claimSystemPath, systemPath)
			await this.#removeTrashClaimManifest(claim.manifestSystemPath)
			throw new Error('[source-changed]')
		}
		return claim
	}

	async #recoverTrashClaim(systemPath: string, userId: string): Promise<RecoveredTrashClaim | undefined> {
		const {claimSystemPath, manifestSystemPath} = trashClaimPaths(systemPath)
		const manifest = await this.#readTrashClaimManifest(manifestSystemPath)
		if (!manifest || manifest.originalSystemPath !== systemPath) {
			if (!(await fse.pathExists(manifestSystemPath))) return
			if (await fse.pathExists(claimSystemPath)) throw new Error('[invalid-trash-claim]')
			await this.#removeTrashClaimManifest(manifestSystemPath)
			return
		}
		if (!(await fse.pathExists(claimSystemPath))) {
			// Recovery may have durably restored the original pathname before the
			// worker/index update completed. Keep the journal until that update is
			// repeated so a retry cannot discard Photos state for a visible file.
			const originalStats = await lstat(systemPath, {bigint: true}).catch(() => undefined)
			if (matchesPublishedRevision(originalStats, manifest.revision)) {
				return {sourceSystemPath: claimSystemPath, destinationSystemPath: systemPath, manifestSystemPath}
			}
			// The claimed revision was already moved away and a different file now
			// owns its former name. Never reconcile or trash that replacement.
			await this.#removeTrashClaimManifest(manifestSystemPath)
			return
		}
		let destinationSystemPath = systemPath
		const [claimStats, originalStats] = await Promise.all([
			lstat(claimSystemPath, {bigint: true}),
			lstat(systemPath, {bigint: true}).catch(() => undefined),
		])
		if (originalStats && claimStats.dev === originalStats.dev && claimStats.ino === originalStats.ino) {
			// A stopped recovery may have created the original hard link but not yet
			// removed the hidden claim. Complete that same recovery idempotently.
			await unlink(claimSystemPath)
			await this.#syncDirectory(nodePath.dirname(systemPath))
		} else if (originalStats) {
			// A newer file now owns the original pathname. Keep both revisions by
			// exposing the interrupted claim in Trash instead of overwriting either.
			const originalVirtualPath = this.systemToVirtualPath(systemPath)
			const trashRoot = this.trashRootForUser(userId)
			const trashSystemRoot = this.virtualToSystemPathUnsafe(trashRoot)
			const recoveredTrashPath = await this.getUniqueName(
				nodePath.join(trashSystemRoot, nodePath.basename(systemPath)),
				{maxIndex: 1000},
			)
			await move(claimSystemPath, recoveredTrashPath)
			destinationSystemPath = recoveredTrashPath
			await this.#syncDirectory(trashSystemRoot)
			const trashMetaDirectory = this.trashMetaDirectoryForUser(userId)
			await fse.ensureDir(trashMetaDirectory)
			await fse.writeFile(
				nodePath.join(trashMetaDirectory, `${nodePath.basename(recoveredTrashPath)}.json`),
				JSON.stringify({path: originalVirtualPath} satisfies Trashmeta),
			)
		} else {
			await link(claimSystemPath, systemPath)
			await unlink(claimSystemPath)
			await this.#syncDirectory(nodePath.dirname(systemPath))
		}
		return {sourceSystemPath: claimSystemPath, destinationSystemPath, manifestSystemPath}
	}

	async #finishTrashClaimRecovery(recovered: RecoveredTrashClaim) {
		await this.fileIndex.movePathRequired(recovered.sourceSystemPath, recovered.destinationSystemPath)
		await this.#removeTrashClaimManifest(recovered.manifestSystemPath)
	}

	async #writeTrashClaimManifest(systemPath: string, manifest: TrashClaimManifest) {
		const temporarySystemPath = trashClaimManifestTemporaryPath(systemPath)
		await fse.remove(temporarySystemPath)
		const handle = await open(temporarySystemPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
		try {
			await handle.writeFile(JSON.stringify(manifest))
			await handle.sync()
		} catch (error) {
			await fse.remove(temporarySystemPath).catch(() => {})
			throw error
		} finally {
			await handle.close()
		}
		try {
			await link(temporarySystemPath, systemPath)
			await unlink(temporarySystemPath)
			await this.#syncDirectory(nodePath.dirname(systemPath))
		} catch (error) {
			await fse.remove(temporarySystemPath).catch(() => {})
			throw error
		}
	}

	async #readTrashClaimManifest(systemPath: string): Promise<TrashClaimManifest | undefined> {
		try {
			const stats = await lstat(systemPath)
			if (!stats.isFile() || stats.size > MAX_TRASH_CLAIM_MANIFEST_BYTES) return
			const value = JSON.parse(await fse.readFile(systemPath, 'utf8')) as unknown
			if (!isTrashClaimManifest(value)) return
			return value
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
			this.logger.error(`Failed to read trash claim manifest '${systemPath}'`, error)
			return
		}
	}

	async #removeTrashClaimManifest(systemPath: string) {
		await Promise.all([fse.remove(systemPath), fse.remove(trashClaimManifestTemporaryPath(systemPath))])
		await this.#syncDirectory(nodePath.dirname(systemPath))
	}

	async #syncDirectory(systemPath: string) {
		const handle = await open(systemPath, constants.O_RDONLY)
		try {
			await handle.sync()
		} finally {
			await handle.close()
		}
	}

	async #restoreQuarantinedTrashSource(quarantineSystemPath: string, systemPath: string) {
		try {
			// Both names are in the same directory. link() claims the original name
			// without replacing anything a concurrent writer may have put there;
			// unlinking the quarantine then completes an identity-preserving restore.
			await link(quarantineSystemPath, systemPath)
			await unlink(quarantineSystemPath)
		} catch (error) {
			this.logger.error(`Failed to restore a revision-mismatched trash source '${quarantineSystemPath}'`, error)
			throw new Error('[trash-restore-failed]')
		}
	}

	// Restore a file or directory from the trash
	async restore(
		trashVirtualPath: string,
		{
			collision = 'error',
			userId = OWNER_USER_ID,
			waitForIndex = false,
		}: {collision?: string; userId?: string; waitForIndex?: boolean} = {},
	) {
		trashVirtualPath = normalizePath(trashVirtualPath)

		// Authorize before consulting Cloud-aware advisory operations.
		const trashSystemPath = await this.virtualToSystemPath(trashVirtualPath, userId)

		// Check if operation is allowed
		const allowedOperations = await this.getAllowedOperations(trashVirtualPath, userId)
		if (!allowedOperations.includes('restore')) throw new Error('[operation-not-allowed]')

		if (!(await fse.pathExists(trashSystemPath))) throw new Error('[source-not-exists]')

		// Read the meta data for the trashed file or directory. The trashed item's
		// name is the segment right after the user's trash root (which is 1 segment
		// deep for the owner, 3 for a member: /Users/<slug>/Trash).
		const trashRootDepth = this.trashRootForUser(userId).split('/').filter(Boolean).length
		const pathSegments = trashVirtualPath.split('/').filter(Boolean)
		const itemName = pathSegments[trashRootDepth]
		const isChild = pathSegments.length > trashRootDepth + 1
		const trashMetaSystemPath = nodePath.join(this.trashMetaDirectoryForUser(userId), `${itemName}.json`)
		let targetSystemPath: string
		try {
			const trashMeta = (await fse.readJson(trashMetaSystemPath)) as Trashmeta
			targetSystemPath = await this.virtualToSystemPath(trashMeta.path, userId)
			// Calculate full path if we're recovering a child file or directory
			if (isChild) targetSystemPath = nodePath.join(targetSystemPath, pathSegments.slice(trashRootDepth + 1).join('/'))
		} catch (error) {
			if ((error as Error)?.message?.includes('ENOENT')) throw new Error('[trash-meta-not-exists]')
			throw error
		}

		// Handle name conflicts
		if (collision === 'keep-both') targetSystemPath = await this.getUniqueName(targetSystemPath)
		targetSystemPath = await this.authorizeDestinationSystemPath(targetSystemPath, userId, {
			replace: collision === 'replace',
		})
		const moveOptions = collision === 'replace' ? {overwrite: true} : {}

		// Move the file or directory to the new location
		if (collision === 'replace') await this.removeReferencesWithin(this.systemToVirtualPath(targetSystemPath))
		await move(trashSystemPath, targetSystemPath, moveOptions)

		// Delete the meta data if we're recovering a root file or directory.
		// This is part of the real trash operation, so finish it before waiting
		// for the derived index to catch up.
		if (!isChild) await fse.remove(trashMetaSystemPath)

		// An overwrite may replace a directory subtree. Clear its old derived
		// rows after the filesystem move, then index the authoritative result.
		if (collision === 'replace') {
			this.#updateFileIndex(`clear replaced destination '${targetSystemPath}'`, () =>
				this.fileIndex.removePath(targetSystemPath),
			)
		}
		const indexUpdate = this.#updateFileIndex(`restore '${trashSystemPath}' to '${targetSystemPath}'`, () =>
			this.fileIndex.movePath(trashSystemPath, targetSystemPath),
		)
		if (waitForIndex) await indexUpdate

		// Return the virtual path of the restored file or directory
		return this.systemToVirtualPath(targetSystemPath)
	}

	// Empty the trash
	async emptyTrash(userId: string = OWNER_USER_ID) {
		let success = true
		const trashRoot = this.trashRootForUser(userId)
		await this.assertCloudMutablePath(trashRoot, userId)

		// Get the system path for the trash directory (the user's own trash)
		const trashDirectory = await this.virtualToSystemPath(trashRoot, userId)

		// Stream the trash directory contents
		for await (const systemPath of getDirectoryStream(trashDirectory)) {
			await fse.remove(systemPath).catch((error) => {
				this.logger.error(`Failed to remove '${nodePath.basename(systemPath)}' from trash`, error)
				success = false
			})
		}
		const trashMetaDirectory = this.trashMetaDirectoryForUser(userId)
		if (await fse.pathExists(trashMetaDirectory)) {
			for await (const systemPath of getDirectoryStream(trashMetaDirectory)) {
				await fse.remove(systemPath).catch((error) => {
					this.logger.error(`Failed to remove '${nodePath.basename(systemPath)}' from trash meta`, error)
					success = false
				})
			}
		}
		this.#updateFileIndex(`reconcile emptied trash '${trashDirectory}'`, () =>
			this.fileIndex.reconcilePath(trashDirectory),
		)

		return success
	}

	// Permanently delete a file or directory
	async delete(virtualPath: string, userId: string = OWNER_USER_ID) {
		return (await this.deleteMany([virtualPath], userId))[0]
	}

	// Permanently delete a batch, resolving any member-owned Cloud roots once
	// before processing individual filesystem entries.
	async deleteMany(
		virtualPaths: string[],
		userId: string = OWNER_USER_ID,
		{
			waitForIndex = false,
			expectedRevisions,
		}: {waitForIndex?: boolean; expectedRevisions?: Map<string, PublishedFileRevision>} = {},
	) {
		const paths = virtualPaths.map(normalizePath)
		const revisions = expectedRevisions
			? new Map([...expectedRevisions].map(([path, revision]) => [normalizePath(path), revision]))
			: undefined
		// Shared-destination resolution consults the global Cloud index, so all
		// request paths must pass authorization before it runs.
		await Promise.all(paths.map((path) => this.virtualToSystemPath(path, userId)))
		const cloudCandidates = await this.cloud.resolveSharedDestinationDeletesAsOwner(userId, paths)
		const deletions = new Map<string, Promise<boolean>>()
		for (const path of paths) {
			if (!deletions.has(path)) {
				const expectedRevision = revisions?.get(path)
				const operation = () => this.deleteOne(path, userId, cloudCandidates.get(path), waitForIndex, expectedRevision)
				deletions.set(
					path,
					expectedRevision ? this.#trashClaimQueue.add(operation).then((result) => result!) : operation(),
				)
			}
		}
		return Promise.all(paths.map((path) => deletions.get(path)!))
	}

	private async deleteOne(
		virtualPath: string,
		userId: string,
		cloudCandidate: SharedDestinationDeleteCandidate | undefined,
		waitForIndex: boolean,
		expectedRevision?: PublishedFileRevision,
	) {
		// Check if operation is allowed
		const allowedOperations = await this.getAllowedOperations(virtualPath, userId)
		if (!allowedOperations.includes('delete')) {
			await this.assertCloudMutablePath(virtualPath, userId)
			throw new Error('[operation-not-allowed]')
		}

		// Get the system path
		const systemPath = await this.virtualToSystemPath(virtualPath, userId)

		// If deleting from /External, remove any shares for this path or its children
		// (External paths aren't covered by the file watcher, so we handle it here)
		if (virtualPath.startsWith('/External/')) {
			await this.samba.removeSharesWithin(virtualPath)
		}

		// Delete the file or directory. Photos supplies the indexed revision for
		// permanent deletion, so atomically claim and validate that exact file before
		// unlinking it. A reboot before the unlink restores the visible Trash entry.
		let revisionClaim: PublishedRevisionClaim | undefined
		let deletionSystemPath = systemPath
		try {
			if (expectedRevision) {
				revisionClaim = await this.#claimPublishedRevision(systemPath, userId, expectedRevision)
				deletionSystemPath = revisionClaim.claimSystemPath
			}
			if (cloudCandidate) {
				await this.cloud.deleteSharedDestinationAsOwner(userId, cloudCandidate, () => fse.remove(deletionSystemPath))
			} else {
				await fse.remove(deletionSystemPath)
			}
			if (revisionClaim) {
				await this.#syncDirectory(nodePath.dirname(deletionSystemPath))
				await this.#removeTrashClaimManifest(revisionClaim.manifestSystemPath)
			}
			await this.removeReferencesWithin(virtualPath)
			const indexUpdate = this.#updateFileIndex(`delete '${systemPath}'`, () => this.fileIndex.removePath(systemPath))
			if (waitForIndex) await indexUpdate
			return true
		} catch (error) {
			if (revisionClaim && (await fse.pathExists(revisionClaim.claimSystemPath))) {
				try {
					await this.#restoreQuarantinedTrashSource(revisionClaim.claimSystemPath, systemPath)
					await this.#removeTrashClaimManifest(revisionClaim.manifestSystemPath)
				} catch (restoreError) {
					// Keep the journal if a replacement owns the original pathname (or
					// restoration otherwise fails) so startup recovery can preserve both.
					this.logger.error(`Failed to restore revision claim for '${systemPath}'`, restoreError)
				}
			}
			this.logger.error(`Failed to delete '${systemPath}'`, error)
			return false
		}
	}

	#updateFileIndex(description: string, update: () => Promise<void>): Promise<void> {
		try {
			return update().catch((error) => this.logger.error(`Failed to update file index after ${description}`, error))
		} catch (error) {
			this.logger.error(`Failed to update file index after ${description}`, error)
			return Promise.resolve()
		}
	}

	// Get allowed operations for a given path. Advisory (the actual operations
	// authorize via virtualToSystemPath), pass the requesting user so member
	// share grants are reflected in the advertised operations.
	async getAllowedOperations(
		virtualPath: string,
		userId: string = OWNER_USER_ID,
		{rewindRestoreToken, rewindRestoreTarget}: {rewindRestoreToken?: symbol; rewindRestoreTarget?: string} = {},
	): Promise<FileOperation[]> {
		virtualPath = normalizePath(virtualPath)

		// Get file status. Uses the unsafe resolver since this is advisory and the
		// caller authorizes the actual operation via virtualToSystemPath.
		let isFile = false
		let isDirectory = false
		try {
			const file = await fse.lstat(this.virtualToSystemPathUnsafe(virtualPath))
			isFile = file.isFile()
			isDirectory = file.isDirectory()
		} catch {}

		// Start with all operations
		const operations = new Set(ALL_OPERATIONS)

		// Remove non-default operations
		operations.delete('restore')
		operations.delete('delete')
		operations.delete('favorite')
		operations.delete('unarchive')
		operations.delete('share')

		// Add file specific operations
		if (isFile) {
			if (this.archive.isUnarchiveable(virtualPath)) operations.add('unarchive')
		}

		// Add directory specific operations
		if (isDirectory) {
			operations.add('favorite')
			operations.add('share')
		}

		// Apply the operation rules against the owner-namespace form of the path so
		// members get the same protections (a member's /Users/<slug>/Trash behaves
		// like the owner's /Trash, their home like /Home).
		const rulePath = this.#operationRulePath(virtualPath)

		// Disable creating files in readonly directories
		const isReadonly =
			rulePath === '/External' ||
			match(rulePath, ['/Network', '/Network/*']) ||
			rulePath === '/Backups' ||
			rulePath.startsWith('/Backups/')
		if (isReadonly) operations.delete('writable')

		// Remove destructive operations if the path is protected
		// Note only the exact paths are protected, not necessarily the children.
		// e.g /Home/Downloads is protected but /Home/Downloads/file.txt is not.
		// Children could be protected with /Home/Downloads/**
		let isProtected = match(rulePath, [
			'/*',
			'/Home/Downloads',
			'/External/*',
			'/Network/*',
			'/Network/*/*',
			'/Backups',
			'/Backups/**',
		])

		// For /Apps/* paths, only protect if the app id is installed
		if (match(rulePath, ['/Apps/*'])) {
			const appId = nodePath.basename(rulePath)
			isProtected = await this.#umbreld.apps.isInstalled(appId)
		}

		// Every descendant of an installed machine directory is canonical runtime
		// state. Expose it read-only for inspection/copying; lifecycle changes must
		// go through Machines so disks, firmware and definitions cannot be moved or
		// replaced underneath a running guest. Orphaned directories remain mutable.
		const machinePath = /^\/Machines\/([^/]+)(?:\/.*)?$/.exec(rulePath)
		if (machinePath && (await this.#umbreld.machines.exists(machinePath[1]))) {
			isProtected = true
			operations.delete('writable')
		}

		const dataRootRelation = this.#umbreld.apps.getDataRootPathRelation(rulePath)
		if (
			dataRootRelation === 'active-root' ||
			dataRootRelation === 'contains-root' ||
			dataRootRelation === 'contains-active-root' ||
			dataRootRelation === 'inside-active-root'
		) {
			isProtected = true
		}
		if (dataRootRelation === 'active-root' || dataRootRelation === 'inside-active-root') {
			operations.delete('writable')
		}

		const folderAccessRelation = this.#umbreld.apps.getFolderAccessPathRelation(rulePath)
		if (folderAccessRelation === 'folder-root' || folderAccessRelation === 'contains-folder-root') {
			isProtected = true
		}

		if (isProtected) {
			operations.delete('move')
			operations.delete('rename')
			operations.delete('trash')
			operations.delete('delete')
		}

		// Unshareable paths
		const isUnshareable = match(rulePath, [
			'/Trash',
			'/Apps',
			'/Apps/*',
			'/Machines',
			'/Machines/**',
			'/External',
			'/Network',
			'/Network/**',
			'/Backups',
			'/Backups/**',
		])
		if (isUnshareable || dataRootRelation) operations.delete('share')

		// External files (not external root or top level mount points)
		const isExternal = match(rulePath, ['/External/*/**'])
		const isNetwork = match(rulePath, ['/Network/*/*/**'])
		if (isExternal || isNetwork) {
			// Only allow hard delete so we don't copy to internal storage
			operations.delete('trash')
			if (!isProtected) operations.add('delete')
		}

		// Add trash specific operations
		const isTrash = match(rulePath, ['/Trash/**'])
		if (isTrash) {
			operations.delete('unarchive')
			operations.delete('share')
			operations.delete('favorite')
			operations.delete('trash')
			operations.add('restore')
			operations.add('delete')
		}

		// Members may create SMB exports only from their own private Home.
		// Favorites are account-scoped and remain available on granted paths.
		if (userId !== OWNER_USER_ID && this.ownerOfPath(virtualPath) !== userId) operations.delete('share')

		// Paths a member doesn't own are governed by the owner's share grants
		if (userId !== OWNER_USER_ID && this.ownerOfPath(virtualPath) !== userId) {
			const share = await this.memberShares.shareGrantFor(virtualPath, userId)

			// No grant covering this path: nothing is allowed. (Ancestors of shared
			// paths are traversable via list() but their entries expose no operations.)
			if (!share) return []

			// The same rules as the owner apply (protected and read-only paths
			// stay protected), minus SMB sharing and trashing, which would strand the
			// owner's files in the member's private trash, so members hard delete
			// from shares instead
			operations.delete('share')
			if (operations.has('trash')) {
				operations.delete('trash')
				operations.add('delete')
			}
		}

		// Apply the Cloud policy last so storage- and Trash-specific rules
		// cannot add a forbidden operation back.
		if (
			this.isCloudPathOverlap(virtualPath) &&
			!this.cloud.allowsRewindRestore(rewindRestoreToken, virtualPath, rewindRestoreTarget)
		) {
			for (const operation of ['move', 'rename', 'trash', 'restore', 'delete', 'unarchive'] as const) {
				operations.delete(operation)
			}
			if (this.isCloudDestinationOrDescendant(virtualPath)) operations.delete('writable')

			// The device owner may remove the exact root of a member-owned Cloud
			// download on shared storage. It is presented as an ordinary hard
			// delete; the Cloud manager stops and forgets the job atomically around
			// the filesystem removal without exposing its metadata.
			const destination = this.cloud.getDestinationAtPath(virtualPath)
			if (
				userId === OWNER_USER_ID &&
				destination?.userId !== undefined &&
				destination.userId !== OWNER_USER_ID &&
				(virtualPath.startsWith('/External/') || virtualPath.startsWith('/Network/'))
			) {
				operations.add('delete')
			}
		}

		return Array.from(operations)
	}

	// Split the extension from the file name
	// Handles complex extensions like archive.tar.gz and file.txt.gz
	splitExtension(path: string) {
		// TODO: Handle complex extensions like .tar.gz
		let extension = nodePath.extname(path)
		let name = nodePath.basename(path)
		if (extension) name = name.slice(0, -extension.length)

		// Handle tar.* extensions
		const tar = '.tar'
		if (name.endsWith(tar)) {
			name = name.slice(0, -tar.length)
			extension = `${tar}${extension}`
		}

		return {name, extension}
	}

	// Get unique name for a file or directory
	// If the path doesn't exist we return the original path.
	// If the path exists we will append a number to the end of the file name
	// until we find a unique name.
	// Note that if two operations call this soon after each other with the
	// the same path before the first one has created the file at the unique path
	// it's possible that we will return the same "unique" name for both calls.
	// We could implement some kind of cache to avoid this but it's unlikely to be an issue.
	async getUniqueName(systemPath: string, {maxIndex = 100} = {}) {
		// TODO: Handle complex extensions like .tar.gz
		const {name, extension} = this.splitExtension(systemPath)
		const path = nodePath.dirname(systemPath)

		let index = 2
		let uniquePath = systemPath
		while (await pathEntryExists(uniquePath)) {
			if (index > maxIndex) throw new Error(`[unique-name-index-exceeded]`)
			uniquePath = nodePath.join(path, `${name} (${index})${extension ? extension : ''}`)
			index++
		}

		return uniquePath
	}

	// Re-authorize a computed destination after collision handling. A member's
	// grant may cover the requested path but not a keep-both sibling, and replacing
	// existing content must respect protected-path delete rules.
	async authorizeDestinationSystemPath(
		systemPath: string,
		userId: string,
		{
			replace = false,
			rewindRestoreToken,
			rewindRestoreTarget,
		}: {replace?: boolean; rewindRestoreToken?: symbol; rewindRestoreTarget?: string} = {},
	) {
		const virtualPath = this.systemToVirtualPath(systemPath)
		const authorizedSystemPath = await this.virtualToSystemPath(virtualPath, userId)
		// Computed destinations must round-trip to the same physical path. In
		// particular, members reserve /Users/<slug>/Trash for their separate
		// physical trash root, so a home child named Trash is not addressable.
		if (nodePath.resolve(authorizedSystemPath) !== nodePath.resolve(systemPath)) {
			throw new Error('[operation-not-allowed]')
		}
		if (!this.cloud.allowsRewindRestore(rewindRestoreToken, virtualPath, rewindRestoreTarget)) {
			await this.assertCloudMutablePath(virtualPath, userId)
		}

		if (replace && (await fse.pathExists(authorizedSystemPath))) {
			const operations = await this.getAllowedOperations(virtualPath, userId, {
				rewindRestoreToken,
				rewindRestoreTarget,
			})
			if (!operations.includes('trash') && !operations.includes('delete')) {
				throw new Error('[operation-not-allowed]')
			}
		}

		return authorizedSystemPath
	}

	// Authorize a computed destination and require its nearest existing parent
	// to be a writable directory. Uploads may create missing parent directories,
	// so checking only the immediate parent would let paths such as
	// /External/fake-drive/file.txt bypass the read-only /External root.
	async authorizeWritableDestinationSystemPath(
		systemPath: string,
		userId: string,
		{replace = false}: {replace?: boolean} = {},
	) {
		const authorizedSystemPath = await this.authorizeDestinationSystemPath(systemPath, userId, {replace})

		let existingParentSystemPath = nodePath.dirname(authorizedSystemPath)
		while (!(await pathEntryExists(existingParentSystemPath))) {
			const parentSystemPath = nodePath.dirname(existingParentSystemPath)
			if (parentSystemPath === existingParentSystemPath) throw new Error('[operation-not-allowed]')
			existingParentSystemPath = parentSystemPath
		}

		const parentStatus = await fse.stat(existingParentSystemPath)
		if (!parentStatus.isDirectory()) throw new Error('[operation-not-allowed]')

		const existingParentVirtualPath = this.systemToVirtualPath(existingParentSystemPath)
		const operations = await this.getAllowedOperations(existingParentVirtualPath, userId)
		if (!operations.includes('writable')) throw new Error('[operation-not-allowed]')

		return authorizedSystemPath
	}

	// Virtual paths are globally unique and self-contained: the owner's live under
	// the top level base directories (/Home, /Trash, /Apps, ...) and each member's
	// live under /Users/<slug> (home) and /Users/<slug>/Trash. Because the path
	// fully determines its physical location, resolution needs no ambient user id
	// and a stored path can never be orphaned from its owner. Authorization (who
	// may touch a path) is a separate concern, see ownerOfPath / virtualToSystemPath.

	// The physical directory holding a member's home / trash
	#memberHomeDirectory(slug: string) {
		return `${this.#umbreld.dataDirectory}/members/${slug}/home`
	}

	#memberTrashDirectory(slug: string) {
		return `${this.#umbreld.dataDirectory}/members/${slug}/trash`
	}

	// The physical base directory a virtual path resolves under (for containment checks)
	#physicalBaseOf(virtualPath: string): string {
		const segments = normalizePath(virtualPath).split('/').filter(Boolean)
		if (segments[0] === 'Users') {
			const slug = segments[1]
			if (!slug || !isValidSlug(slug)) throw new Error(`[invalid-base] ${virtualPath}`)
			return segments[2] === 'Trash' ? this.#memberTrashDirectory(slug) : this.#memberHomeDirectory(slug)
		}
		const basePath = this.baseDirectories.get(`/${segments[0]}`)
		if (!basePath) throw new Error(`[invalid-base] No valid base directory found for path: ${virtualPath}`)
		return basePath
	}

	// Which user owns a virtual path. Pure: /Users/<slug>/... belongs to <slug>,
	// everything else (the top level bases) belongs to the owner.
	ownerOfPath(virtualPath: string): string {
		const segments = normalizePath(virtualPath).split('/').filter(Boolean)
		if (segments[0] === 'Users' && segments[1]) return segments[1]
		return OWNER_USER_ID
	}

	// Normalize a virtual path (resolve traversal, trim trailing slash) without
	// resolving it. For modules that need to compare virtual paths safely.
	normalizeVirtualPath(virtualPath: string): string {
		return normalizePath(virtualPath)
	}

	// External and network paths write to their own mounted filesystems. Every
	// other valid Files path consumes internal storage and must share the system
	// disk upload reserve. Defaulting new base directories to internal keeps
	// upload admission fail-safe as the Files namespace grows.
	isInternalStorageVirtualPath(virtualPath: string) {
		const normalizedPath = normalizePath(virtualPath)
		this.virtualToSystemPathUnsafe(normalizedPath)

		const [base] = normalizedPath.split('/').filter(Boolean)
		return base !== 'External' && base !== 'Network'
	}

	// Map a virtual path onto the owner namespace so the same operation rules
	// (protected/readonly/trash detection) apply to members. A member's home
	// /Users/<slug> behaves like the owner's /Home and /Users/<slug>/Trash like
	// /Trash.
	#operationRulePath(virtualPath: string): string {
		const path = normalizePath(virtualPath)
		const segments = path.split('/').filter(Boolean)
		if (segments[0] !== 'Users') return path
		const rest = segments.slice(2) // drop 'Users' and the slug
		if (rest[0] === 'Trash') return `/${rest.join('/')}`
		return rest.length ? `/Home/${rest.join('/')}` : '/Home'
	}

	// Resolve a virtual path to a system path without any authorization or fs
	// validation. Sync and pure. Only for trusted internal callers (system
	// services, migrations) that operate on known paths, never on request input.
	virtualToSystemPathUnsafe(virtualPath: string) {
		// Normalize first so directory traversal can't sneak through
		// e.g: /Home/../../../../etc/passwd normalizes to /etc/passwd which has no valid base.
		virtualPath = normalizePath(virtualPath)
		if (!nodePath.posix.isAbsolute(virtualPath)) throw new Error(`[path-not-absolute]`)

		const segments = virtualPath.split('/').filter(Boolean)

		// Member paths: /Users/<slug>[/Trash]/...
		if (segments[0] === 'Users') {
			const slug = segments[1]
			if (!slug || !isValidSlug(slug)) throw new Error(`[invalid-base] ${virtualPath}`)
			if (segments[2] === 'Trash') return nodePath.join(this.#memberTrashDirectory(slug), ...segments.slice(3))
			return nodePath.join(this.#memberHomeDirectory(slug), ...segments.slice(2))
		}

		// Owner base directories
		const basePath = this.baseDirectories.get(`/${segments[0]}`)
		if (!basePath) throw new Error(`[invalid-base] No valid base directory found for path: ${virtualPath}`)
		return nodePath.join(basePath, ...segments.slice(1))
	}

	// Resolve a virtual path to a system path for a request made by `userId`.
	// Enforces authorization (the user owns the path, or the owner shared it
	// with them) and that the resolved path doesn't escape its containment base
	// via symlinks. `userId` is required so a request handler can't accidentally
	// skip the authorization check.
	async virtualToSystemPath(virtualPath: string, userId: string) {
		virtualPath = normalizePath(virtualPath)
		const systemPath = this.virtualToSystemPathUnsafe(virtualPath)

		let basePath: string
		if (this.ownerOfPath(virtualPath) === userId) {
			// The user's own path: contained to its base directory
			basePath = this.#physicalBaseOf(virtualPath)
		} else {
			// Not their path: members may access paths the owner shared with them
			const share = await this.memberShares.shareGrantFor(virtualPath, userId)
			if (!share) throw new Error(`[forbidden] '${virtualPath}'`)

			// Contain to the physical shared subtree so a symlink inside the
			// share can't lead outside of it. Re-validate the share root first
			// because the filesystem may have changed since the share was saved.
			try {
				const shareSystemPath = this.virtualToSystemPathUnsafe(share.path)
				await assertSystemPathInsideBase(shareSystemPath, this.#physicalBaseOf(share.path), {
					virtualPath: share.path,
					baseLabel: this.#physicalBaseOf(share.path),
				})
				basePath = await fse.realpath(shareSystemPath)
			} catch {
				throw new Error(`[forbidden] '${virtualPath}'`)
			}
		}

		await assertSystemPathInsideBase(systemPath, basePath, {virtualPath, baseLabel: basePath})

		// Return the system path as-passed (not the realpath) so we don't resolve
		// symlinks in the path itself, which would change copy/move semantics.
		return systemPath
	}

	// Authorize and open one immutable file identity for streaming. Path-based
	// authorization alone leaves a small gap in which a parent can be swapped
	// before sendFile/open resolves it. We validate that the held descriptor is
	// the same inode as the canonical, currently-authorized target and then let
	// callers stream only from that descriptor.
	async openFileForRead(virtualPath: string, userId: string): Promise<AuthorizedReadFile> {
		virtualPath = normalizePath(virtualPath)
		const systemPath = await this.virtualToSystemPath(virtualPath, userId)
		const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
		const handle = await open(systemPath, flags)
		try {
			const stats = await handle.stat({bigint: true})
			if (!stats.isFile()) throw new Error('[not-a-file]')

			const canonicalPath = await fse.realpath(systemPath)
			const reauthorizedSystemPath = await this.virtualToSystemPath(virtualPath, userId)
			const reauthorizedCanonicalPath = await fse.realpath(reauthorizedSystemPath)
			if (nodePath.resolve(reauthorizedCanonicalPath) !== nodePath.resolve(canonicalPath)) {
				throw new Error('[forbidden]')
			}

			const validationHandle = await open(reauthorizedCanonicalPath, flags)
			try {
				const canonicalStats = await validationHandle.stat({bigint: true})
				if (canonicalStats.dev !== stats.dev || canonicalStats.ino !== stats.ino) throw new Error('[file-changed]')
			} finally {
				await validationHandle.close()
			}

			return {handle, stats, virtualPath, systemPath, name: nodePath.basename(systemPath)}
		} catch (error) {
			await handle.close().catch(() => {})
			throw error
		}
	}

	// Convert a system path back to its virtual path. Pure and self-contained.
	systemToVirtualPath(systemPath: string) {
		systemPath = normalizePath(systemPath)

		// Member paths: <data>/members/<slug>/home|trash/...
		const membersRoot = `${this.#umbreld.dataDirectory}/members/`
		if (systemPath.startsWith(membersRoot)) {
			const [slug, kind, ...tail] = systemPath.slice(membersRoot.length).split('/')
			const rest = tail.join('/')
			if (kind === 'trash') return normalizePath(`/Users/${slug}/Trash/${rest}`)
			if (kind === 'home') return normalizePath(`/Users/${slug}/${rest}`)
		}

		// Owner base directories
		for (const [baseDirectory, basePath] of this.baseDirectories) {
			if (isPathInsideOrEqual(basePath, systemPath)) {
				const relativePath = nodePath.relative(basePath, systemPath).split(nodePath.sep).join('/')
				return normalizePath(nodePath.posix.join(baseDirectory, relativePath))
			}
		}

		throw new Error(`[invalid-path] Path '${systemPath}' is not within any base directory`)
	}

	// Get view preferences. Scoped per account so a member changing their sort
	// order or view doesn't affect the owner (or other members).
	async getViewPreferences(userId: string = OWNER_USER_ID): Promise<ViewPreferences> {
		const viewPreferences = await this.#umbreld.user.getAccountViewPreferences(userId)
		return {...DEFAULT_VIEW_PREFERENCES, ...viewPreferences}
	}

	// Update view preferences for an account
	async updateViewPreferences(
		newViewPreferences: Partial<ViewPreferences>,
		userId: string = OWNER_USER_ID,
	): Promise<ViewPreferences> {
		const currentViewPreferences = await this.getViewPreferences(userId)
		const updatedViewPreferences = {...currentViewPreferences, ...newViewPreferences}
		// Save the new preferences to the account-scoped store
		await this.#umbreld.user.setAccountViewPreferences(userId, updatedViewPreferences)
		return updatedViewPreferences
	}
}

// Match a path against a list of glob patterns
function match(path: string, patterns: string[]) {
	// TODO: Cache Regex creation if perf becomes an issue
	return patterns.some((pattern) => minimatch(path, pattern, {dot: true}))
}

// Resolve traversals and always trim trailing trash
// Member user id slugs are safe single path segments: start with a letter, then
// letters/digits/dashes. Usable as a directory name and can't contain traversal.
export function isValidSlug(slug: string): boolean {
	return /^[A-Za-z][A-Za-z0-9-]*$/.test(slug)
}

export function isPathInsideOrEqual(basePath: string, candidatePath: string): boolean {
	const relativePath = nodePath.relative(basePath, candidatePath)
	return relativePath === '' || (!relativePath.startsWith('..') && !nodePath.isAbsolute(relativePath))
}

export async function resolveRealPathForValidation(systemPath: string): Promise<string> {
	const absolutePath = nodePath.resolve(systemPath)
	const deepestExistingPath = await getDeepestExistingPath(absolutePath)
	const deepestExistingRealPath = await fse.realpath(deepestExistingPath)
	const missingTail = nodePath.relative(deepestExistingPath, absolutePath)
	return nodePath.resolve(deepestExistingRealPath, missingTail)
}

export async function assertSystemPathInsideBase(
	systemPath: string,
	basePath: string,
	{virtualPath = systemPath, baseLabel = basePath}: {virtualPath?: string; baseLabel?: string} = {},
) {
	const [baseRealPath, candidateRealPath] = await Promise.all([
		resolveRealPathForValidation(basePath),
		resolveRealPathForValidation(systemPath),
	])
	if (!isPathInsideOrEqual(baseRealPath, candidateRealPath)) {
		throw new Error(`[escapes-base] '${virtualPath}' escapes '${baseLabel}'`)
	}
	return {baseRealPath, candidateRealPath}
}

export function pathsOverlap(first: string, second: string) {
	return first === second || first.startsWith(`${second}/`) || second.startsWith(`${first}/`)
}

async function isMountpoint(systemPath: string) {
	return (await $({reject: false})`mountpoint -q ${systemPath}`).exitCode === 0
}

async function isExternalFilesystemMountedAt(filesystemUuid: string, systemMountPath: string) {
	const result = await $({reject: false})`findmnt --noheadings --output UUID --target ${systemMountPath}`
	return result.exitCode === 0 && result.stdout.trim() === filesystemUuid
}

export function normalizePath(path: string) {
	// Reduce `.`, `..` and multiple slashes to their canonical form
	const normalized = nodePath.posix.normalize(path)

	// Trim trailing slash, except for the root directory
	if (normalized === '/') return normalized
	return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
}

function isTrashClaimManifest(value: unknown): value is TrashClaimManifest {
	if (!value || typeof value !== 'object') return false
	const manifest = value as Record<string, unknown>
	if (manifest.version !== 1 || typeof manifest.originalSystemPath !== 'string') return false
	const revision = manifest.revision
	if (!revision || typeof revision !== 'object') return false
	const fields = revision as Record<string, unknown>
	return (
		typeof fields.inode === 'string' &&
		typeof fields.size === 'number' &&
		Number.isSafeInteger(fields.size) &&
		fields.size >= 0 &&
		typeof fields.modifiedNs === 'string' &&
		typeof fields.ctimeNs === 'string'
	)
}

function trashClaimPaths(systemPath: string) {
	const claimId = createHash('sha256').update(systemPath).digest('hex').slice(0, 32)
	const directory = nodePath.dirname(systemPath)
	return {
		claimSystemPath: nodePath.join(directory, `.${claimId}${TRASH_CLAIM_SUFFIX}`),
		manifestSystemPath: nodePath.join(directory, `.${claimId}${TRASH_CLAIM_MANIFEST_SUFFIX}`),
	}
}

function trashClaimManifestTemporaryPath(manifestSystemPath: string) {
	return `${manifestSystemPath}.tmp${TRASH_CLAIM_SUFFIX}`
}

async function* walkTrashClaimManifests(rootSystemPath: string): AsyncGenerator<string> {
	const directories = [rootSystemPath]
	while (directories.length > 0) {
		const directory = directories.pop()!
		let handle
		try {
			handle = await fse.opendir(directory)
		} catch {
			continue
		}
		try {
			for await (const entry of handle) {
				const systemPath = nodePath.join(directory, entry.name)
				if (entry.isDirectory()) directories.push(systemPath)
				else if (entry.isFile() && entry.name.endsWith(TRASH_CLAIM_MANIFEST_SUFFIX)) yield systemPath
			}
		} catch {
			// A disappearing or unreadable subtree cannot invalidate claims in other
			// directories. Leave it for the next startup sweep and keep walking.
		}
	}
}

function matchesPublishedRevision(stats: BigIntStats | undefined, revision: PublishedFileRevision) {
	return (
		stats?.isFile() === true &&
		stats.ino.toString() === revision.inode &&
		Number(stats.size) === revision.size &&
		stats.mtimeNs.toString() === revision.modifiedNs
	)
}

function isMemberTrashRoot(virtualPath: string) {
	const segments = virtualPath.split('/').filter(Boolean)
	return segments.length === 3 && segments[0] === 'Users' && isValidSlug(segments[1]) && segments[2] === 'Trash'
}

// Unlike fs-extra's pathExists(), lstat sees dangling symlinks. A dangling
// symlink still occupies its directory entry and must never be offered as a
// unique destination that a later write could follow.
async function pathEntryExists(path: string) {
	try {
		await fse.lstat(path)
		return true
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
		throw error
	}
}

// Given a file path will return the deepest existing path.
async function getDeepestExistingPath(path: string) {
	// Resolve the input to an absolute path
	let currentPath = nodePath.resolve(path)

	while (true) {
		// Check if the current path exists
		if (await fse.pathExists(currentPath)) return currentPath

		// Move up one level in the path hierarchy
		const parentPath = nodePath.dirname(currentPath)

		// If we're at the root and it doesn't exist, throw an error cos
		// something really bad has happened and we're gonna infinite loop.
		if (parentPath === currentPath) throw new Error(`[cant-find-root] Can't validate path if entire tree doesn't exist`)

		currentPath = parentPath
	}
}

// Wrap with our own method with nicer error handling
async function move(sourceSystemPath: string, targetSystemPath: string, {overwrite = false} = {}) {
	return fse.move(sourceSystemPath, targetSystemPath, {overwrite}).catch((error) => {
		const message = error?.message || ''
		if (message.includes('ENOENT')) throw new Error('[source-not-exists]')
		if (message.includes('dest already exists')) throw new Error('[destination-already-exists]')
		if (message.includes('subdirectory of itself')) throw new Error('[subdir-of-self]')
		throw new Error(`[move-failed] ${error?.message}`)
	})
}

// Stream the contents of a directory
// Optionally recurse into subdirectories
export async function* getDirectoryStream(directory: string, options?: {recursive?: boolean}) {
	// We have to use any here because @tsconfig/node22 types are incorrect and don't recognise options.recursive
	const directoryListing = await fse.opendir(directory, options as any)
	try {
		// Again we need any due to incorrect types
		for await (const file of directoryListing) yield nodePath.join((file as any).parentPath, file.name)
	} finally {
		// Ensure the directory is closed if we error
		directoryListing.close().catch(() => {})
	}
}
