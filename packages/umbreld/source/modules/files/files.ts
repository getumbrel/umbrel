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

import mime from 'mime-types'
import fse from 'fs-extra'
import {minimatch} from 'minimatch'
import isValidFilename from 'valid-filename'
import pRetry from 'p-retry'

import {copyWithProgress} from '../utilities/copy-with-progress.js'

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

import type Umbreld from '../../index.js'

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

type File = {
	name: string
	path: string
	type: string
	size: number
	modified: number
	operations: FileOperation[]
	thumbnail?: string
}

type DirectoryListing = File & {
	files: File[]
	truncatedAt?: number
}

type Trashmeta = {
	path: string
}

type BaseDirectory = '/Home' | '/Trash' | '/Apps' | '/External' | '/Backups' | '/Network'

type ViewPreferences = {
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
	type: 'copy' | 'move'
	file: File
	destinationPath: string
	percent: number
	bytesPerSecond: number
	secondsRemaining?: number
}

export type OperationsInProgress = OperationProgress[]

export default class Files {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	baseDirectories: Map<string, string>
	trashMetaDirectory: string
	fileOwner = {userId: 1000, groupId: 1000}
	maxDirectoryListing = 10000
	// Prevent loads of .DS_Store (macOS) and .directory (KDE Dolphin) results
	hiddenFiles = ['.DS_Store', '.directory']
	hiddenExtensions = ['.umbrel-upload']
	operationsInProgress: OperationsInProgress = []
	watcher: Watcher
	recents: Recents
	favorites: Favorites
	archive: Archive
	thumbnails: Thumbnails
	samba: Samba
	externalStorage: ExternalStorage
	networkStorage: NetworkStorage
	search: Search

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())

		this.baseDirectories = new Map<BaseDirectory, string>([
			['/Home', `${umbreld.dataDirectory}/home`],
			['/Trash', `${umbreld.dataDirectory}/trash`],
			['/Apps', `${umbreld.dataDirectory}/app-data`],
			['/External', `${umbreld.dataDirectory}/external`],
			['/Backups', `${umbreld.dataDirectory}/backups`],
			['/Network', `${umbreld.dataDirectory}/network`],
		])

		this.watcher = new Watcher(umbreld, {paths: ['/Home', '/Trash', '/Apps']})
		this.recents = new Recents(umbreld, {paths: ['/Home']})
		this.favorites = new Favorites(umbreld)
		this.archive = new Archive(umbreld)
		this.thumbnails = new Thumbnails(umbreld)
		this.samba = new Samba(umbreld)
		this.externalStorage = new ExternalStorage(umbreld)
		this.networkStorage = new NetworkStorage(umbreld)
		this.search = new Search(umbreld)

		// TODO: This should really be in a proper DB, refactor this once we've moved to SQLite
		this.trashMetaDirectory = `${umbreld.dataDirectory}/trash-meta`
	}

	async start() {
		this.logger.log('Starting files')

		// Ensure all base directories exist
		await Promise.all(
			[...this.baseDirectories.keys()].map((baseDirectory) =>
				this.createDirectory(baseDirectory).catch((error) => {
					this.logger.error(`Failed to ensure directory '${baseDirectory}' exists`, error)
				}),
			),
		)

		// Ensure the trash meta directory exists
		await fse.ensureDir(this.trashMetaDirectory).catch((error) => {
			this.logger.error(`Failed to ensure directory ${this.trashMetaDirectory} exists`, error)
		})
		await this.chownSystemPath(this.trashMetaDirectory)

		// Do any required one time setup tasks.
		await this.firstRun()

		// Start submodules
		await this.watcher.start().catch((error) => this.logger.error(`Failed to start watcher`, error))
		await this.samba.start().catch((error) => this.logger.error(`Failed to start samba`, error))
		await this.externalStorage.start().catch((error) => this.logger.error(`Failed to start external storage`, error))
		await this.networkStorage.start().catch((error) => this.logger.error(`Failed to start network storage`, error))
		await this.recents.start().catch((error) => this.logger.error(`Failed to start recents`, error))
		await this.favorites.start().catch((error) => this.logger.error(`Failed to start favorites`, error))
		await this.thumbnails.start().catch((error) => this.logger.error(`Failed to start thumbnails`, error))
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
		await this.recents.stop().catch((error) => this.logger.error(`Failed to stop recents`, error))
		await this.favorites.stop().catch((error) => this.logger.error(`Failed to stop favorites`, error))
		await this.thumbnails.stop().catch((error) => this.logger.error(`Failed to stop thumbnails`, error))
		await this.externalStorage.stop().catch((error) => this.logger.error(`Failed to stop external storage`, error))
		await this.networkStorage.stop().catch((error) => this.logger.error(`Failed to stop network storage`, error))
		await this.samba.stop().catch((error) => this.logger.error(`Failed to stop samba`, error))
		await this.watcher.stop().catch((error) => this.logger.error(`Failed to stop watcher`, error))
	}

	// Typesafe wrapper to get the system path of a base directory
	getBaseDirectory(virtualPath: BaseDirectory) {
		const path = this.baseDirectories.get(virtualPath)
		if (!path) throw new Error(`[base-directory-not-found] ${virtualPath}`)
		return path
	}

	// Creates a new directory at the given virtual path.
	// Returns true if the directory already exists.
	async createDirectory(virtualPath: string) {
		// Check if operation is allowed
		const containingDirectory = nodePath.dirname(virtualPath)
		const containingDirectoryAllowedOperations = await this.getAllowedOperations(containingDirectory)
		if (!containingDirectoryAllowedOperations.includes('writable')) throw new Error('[operation-not-allowed]')

		// Get system path
		const path = await this.virtualToSystemPath(virtualPath)

		// Check if the directory already exists
		if (await fse.pathExists(path)) return true

		// Create the directory
		await fse.mkdir(path).catch((error) => {
			if (error?.message?.includes('ENOENT')) throw new Error('[parent-not-exist]')
			if (error?.message?.includes('ENOTDIR')) throw new Error('[parent-not-directory]')
			throw new Error(`[mkdir-failed] ${error?.message}`)
		})

		// Set owner to the umbrel user
		// We do nothing on fail because this isn't supported on all filesystems.
		// e.g this is expected to throw on external exFAT drives.
		await this.chownSystemPath(path).catch(() => {})

		return true
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
	async status(systemPath: string): Promise<File> {
		// Get the path and filename
		const path = this.systemToVirtualPath(systemPath)
		const name = nodePath.basename(path)

		// Get stats, operations, and thumbnail concurrently
		// This will ensure that we complete these as fast as the slowest operation
		const [stats, operations, thumbnail] = await Promise.all([
			// We use lstat to ensure we don't follow symlinks
			fse.lstat(systemPath),

			// Get the allowed operations
			this.getAllowedOperations(path),

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
		else type = mime.lookup(name) || 'application/octet-stream'

		// Get the size in bytes
		let size = stats.size
		// Set dir size to zero for now
		// TODO: Implement directory size index for efficient lookups
		if (type === 'directory') size = 0

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

	// Checks if a filename is hidden
	isHidden(filename: string) {
		return (
			this.hiddenFiles.includes(filename) || this.hiddenExtensions.some((extension) => filename.endsWith(extension))
		)
	}

	// Lists the contents of the root directory.
	// This is a special case since the root directory doesn't map to a system path.
	async #listRoot() {
		const files = await Promise.all([...this.baseDirectories.values()].map((systemPath) => this.status(systemPath)))
		return {
			name: '',
			path: '/',
			type: 'directory',
			size: 0,
			modified: 0,
			operations: [],
			files,
		}
	}

	// Lists the contents of a directory given a virtual path.
	// Will return all files in the directory up to this.maxDirectoryListing
	// We safely stream the directory to avoid blowing up Node.js if the directory is large.
	async list(virtualPath: string): Promise<DirectoryListing> {
		virtualPath = normalizePath(virtualPath)

		// Special handling for the root directory since it doesn't map to a system parth
		if (virtualPath === '/') return this.#listRoot()

		// Get the system path and directory details
		const systemPath = await this.virtualToSystemPath(virtualPath)
		const directoryDetails = await this.status(systemPath).catch((error) => {
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
				this.status(fileSystemPath).catch((error) => {
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
		const files = (await Promise.all(fileJobs)).filter((file) => file !== undefined) as File[]

		return {
			...directoryDetails,
			files,
			truncatedAt,
		}
	}

	// Recursively stream the contents of a virtual directory
	async *streamContents(virtualPath: string) {
		const systemPath = await this.virtualToSystemPath(virtualPath)
		const directoryStream = getDirectoryStream(systemPath, {recursive: true})
		for await (const systemPath of directoryStream) yield systemPath
	}

	// Internal utility to copy (or copy and delete (psuedo-move)) a file or directory using rsync and report progress
	async #copyWithProgress(sourceSystemPath: string, destinationSystemPath: string, {move = false} = {}) {
		// Error handling consistent with fse.copy and move
		const destinationExists = await fse.exists(destinationSystemPath)
		if (destinationExists) throw new Error('[destination-already-exists]')
		if (destinationSystemPath.startsWith(sourceSystemPath)) throw new Error('[subdir-of-self]')

		// Create initial progress tracker and emit operation progress event
		const operationProgress: OperationProgress = {
			type: move ? 'move' : 'copy',
			file: await this.status(sourceSystemPath),
			destinationPath: this.systemToVirtualPath(destinationSystemPath),
			percent: 0,
			bytesPerSecond: 0,
		}
		this.operationsInProgress.push(operationProgress)
		this.#umbreld.eventBus.emit('files:operation-progress', this.operationsInProgress)

		try {
			// Wait for copy to finish and throw if copy fails
			await copyWithProgress(sourceSystemPath, destinationSystemPath, (progress) => {
				operationProgress.percent = progress.progress
				operationProgress.bytesPerSecond = progress.bytesPerSecond
				operationProgress.secondsRemaining = progress.secondsRemaining
				this.#umbreld.eventBus.emit('files:operation-progress', this.operationsInProgress)
			})

			// If we're moving, delete the source file or directory on completion
			if (move) await fse.remove(sourceSystemPath)
		} finally {
			// Remove the progress tracker and emit operation progress event
			this.operationsInProgress = this.operationsInProgress.filter((operation) => operation !== operationProgress)
			this.#umbreld.eventBus.emit('files:operation-progress', this.operationsInProgress)
		}
	}
	// Copies a file or directory from one virtual path to another.
	async copy(sourceVirtualPath: string, destinationVirtualDirectory: string, {collision = 'error'} = {}) {
		// Check if operation is allowed
		const allowedOperations = await this.getAllowedOperations(destinationVirtualDirectory)
		if (!allowedOperations.includes('writable')) throw new Error('[operation-not-allowed]')

		// Get the system paths
		let sourceSystemPath = await this.virtualToSystemPath(sourceVirtualPath)
		const destinationSystemDirectory = await this.virtualToSystemPath(destinationVirtualDirectory)

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

		// Always use 'keep-both' collision handling for same directory copies
		const isSameDirectory = nodePath.dirname(sourceVirtualPath) === destinationVirtualDirectory
		if (isSameDirectory) collision = 'keep-both'

		// Handle name collisions
		if (collision === 'error') {
			const destinationExists = await fse.pathExists(destinationSystemPath)
			if (destinationExists) throw new Error('[destination-already-exists]')
		} else if (collision === 'keep-both') {
			destinationSystemPath = await this.getUniqueName(destinationSystemPath)
		} else if (collision === 'replace') {
			// Remove the destination file/directory so that in the case of a directory, the contents are fully replaced
			// This entire fse.remove and subsequent fse.copy action is not atomic. If the copy fails, the original destination content will not be restored.
			await fse.remove(destinationSystemPath)
		}

		// Perform the copy operation
		await this.#copyWithProgress(sourceSystemPath, destinationSystemPath)

		// Return the virtual path of the new copy
		return this.systemToVirtualPath(destinationSystemPath)
	}

	// Moves a file or directory from one virtual path to another.
	async move(sourceVirtualPath: string, destinationVirtualDirectory: string, {collision = 'error'} = {}) {
		// If the destination is the current containing folder then the file is already in the correct location
		// so we don't need to do anything.
		if (nodePath.dirname(sourceVirtualPath) === destinationVirtualDirectory) return sourceVirtualPath

		// Check if operation is allowed on source
		const allowedSourceOperations = await this.getAllowedOperations(sourceVirtualPath)
		if (!allowedSourceOperations.includes('move')) throw new Error('[operation-not-allowed]')

		// Check if operation is allowed on destination
		const allowedDestinationOperations = await this.getAllowedOperations(destinationVirtualDirectory)
		if (!allowedDestinationOperations.includes('writable')) throw new Error('[operation-not-allowed]')

		// Get the system paths
		let sourceSystemPath = await this.virtualToSystemPath(sourceVirtualPath)
		const destinationSystemDirectory = await this.virtualToSystemPath(destinationVirtualDirectory)

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
		if (collision === 'replace') await fse.remove(destinationSystemPath)

		// Toggle move operation based on for cross fs moves.
		// Also allow overriding this so we can test both variants in the test suite.
		const forceSlowMoveWithProgress = process.env.UMBRELD_FORCE_SLOW_MOVE_WITH_PROGRESS === 'true'
		const isMovingAcrossFilesystems = sourceStats.dev !== targetDirectoryStats.dev
		if (isMovingAcrossFilesystems || forceSlowMoveWithProgress) {
			// If we're moving across filesystems there will be a slow copy and delete so
			// we'll use our own implementation that reports progress.
			await this.#copyWithProgress(sourceSystemPath, destinationSystemPath, {move: true})
		} else {
			// Otherwise we can use native system move for instant atomic move on the same filesystem.
			await move(sourceSystemPath, destinationSystemPath)
		}

		// Return the virtual path of the new location
		return this.systemToVirtualPath(destinationSystemPath)
	}

	// Rename a file or directory
	async rename(sourceVirtualPath: string, newName: string): Promise<string> {
		// Check if operation is allowed.
		const allowedOperations = await this.getAllowedOperations(sourceVirtualPath)
		if (!allowedOperations.includes('rename')) throw new Error(`[operation-not-allowed]`)

		// Ensure that a new name is valid.
		if (!isValidFilename(newName)) throw new Error(`[invalid-filename] Invalid filename: '${newName}'`)

		// Convert the source virtual path into a system path.
		const sourceSystemPath = await this.virtualToSystemPath(sourceVirtualPath)

		// If the new name is identical to the current base name, do nothing.
		const currentName = nodePath.basename(sourceSystemPath)
		if (currentName === newName) return sourceVirtualPath

		// Determine the parent directory (system path) and compute the new candidate system path.
		const parentDirectory = nodePath.dirname(sourceSystemPath)
		const targetSystemPath = nodePath.join(parentDirectory, newName)

		// Perform the renaming operation by moving the file/directory.
		await move(sourceSystemPath, targetSystemPath)

		// Convert the target system path back into a virtual path and return it.
		return this.systemToVirtualPath(targetSystemPath)
	}

	// Trash a file or directory
	async trash(virtualPath: string) {
		// Check if operation is allowed
		const allowedOperations = await this.getAllowedOperations(virtualPath)
		if (!allowedOperations.includes('trash')) throw new Error('[operation-not-allowed]')

		// Get the system path
		// This is important to piggy back on for validation logic
		const systemPath = await this.virtualToSystemPath(virtualPath)

		// Calculate the target trash system path
		const trashSystemRoot = await this.virtualToSystemPath('/Trash')
		const trashSystemPath = await nodePath.join(trashSystemRoot, nodePath.basename(systemPath))

		// Retry on error to work around collision race condition
		// TODO: Add better handling in getUniqueName() for this.
		let uniqueTrashSystemPath = ''
		await pRetry(
			async () => {
				// Get a unique trash system path
				uniqueTrashSystemPath = await this.getUniqueName(trashSystemPath, {maxIndex: 1000})

				// Move the file or directory to the trash
				await move(systemPath, uniqueTrashSystemPath)
			},
			{
				retries: 10,
				minTimeout: 100,
				maxTimeout: 100,
				shouldRetry: (error) => error.message === '[destination-already-exists]',
			},
		)

		// Write the meta data for the trashed file or directory
		// TODO: Migrate this to SQLite
		const trashMetaSystemPath = nodePath.join(
			this.trashMetaDirectory,
			`${nodePath.basename(uniqueTrashSystemPath)}.json`,
		)
		await fse.writeFile(trashMetaSystemPath, JSON.stringify({path: virtualPath} satisfies Trashmeta))

		// Return the virtual path of the trashed file or directory
		return this.systemToVirtualPath(uniqueTrashSystemPath)
	}

	// Restore a file or directory from the trash
	async restore(trashVirtualPath: string, {collision = 'error'} = {}) {
		// Check if operation is allowed
		const allowedOperations = await this.getAllowedOperations(trashVirtualPath)
		if (!allowedOperations.includes('restore')) throw new Error('[operation-not-allowed]')

		// Get the system path
		const trashSystemPath = await this.virtualToSystemPath(trashVirtualPath)
		if (!(await fse.pathExists(trashSystemPath))) throw new Error('[source-not-exists]')

		// Read the meta data for the trashed file or directory
		const pathSegments = trashVirtualPath.split('/').filter(Boolean)
		const isChild = pathSegments.length > 2
		// Always use the second path segment so we can recover child files and directories
		const trashMetaSystemPath = nodePath.join(this.trashMetaDirectory, `${pathSegments[1]}.json`)
		let targetSystemPath: string
		try {
			const trashMeta = (await fse.readJson(trashMetaSystemPath)) as Trashmeta
			targetSystemPath = await this.virtualToSystemPath(trashMeta.path)
			// Calculate full path if we're recovering a child file or directory
			if (isChild) targetSystemPath = nodePath.join(targetSystemPath, pathSegments.slice(2).join('/'))
		} catch (error) {
			if ((error as Error)?.message?.includes('ENOENT')) throw new Error('[trash-meta-not-exists]')
			throw error
		}

		// Handle name conflicts
		if (collision === 'keep-both') targetSystemPath = await this.getUniqueName(targetSystemPath)
		const moveOptions = collision === 'replace' ? {overwrite: true} : {}

		// Move the file or directory to the new location
		await move(trashSystemPath, targetSystemPath, moveOptions)

		// Delete the meta data if we're recovering a root file or directory
		if (!isChild) await fse.remove(trashMetaSystemPath)

		// Return the virtual path of the restored file or directory
		return this.systemToVirtualPath(targetSystemPath)
	}

	// Empty the trash
	async emptyTrash() {
		let success = true

		// Get the system path for the trash directory
		const trashDirectory = await this.virtualToSystemPath('/Trash')

		// Stream the trash directory contents
		for await (const systemPath of getDirectoryStream(trashDirectory)) {
			await fse.remove(systemPath).catch((error) => {
				this.logger.error(`Failed to remove '${nodePath.basename(systemPath)}' from trash`, error)
				success = false
			})
		}
		for await (const systemPath of getDirectoryStream(this.trashMetaDirectory)) {
			await fse.remove(systemPath).catch((error) => {
				this.logger.error(`Failed to remove '${nodePath.basename(systemPath)}' from trash meta`, error)
				success = false
			})
		}

		return success
	}

	// Permanently delete a file or directory
	async delete(virtualPath: string) {
		// Check if operation is allowed
		const allowedOperations = await this.getAllowedOperations(virtualPath)
		if (!allowedOperations.includes('delete')) throw new Error('[operation-not-allowed]')

		// Get the system path
		const systemPath = await this.virtualToSystemPath(virtualPath)

		// Delete the file or directory
		try {
			await fse.remove(systemPath)
			return true
		} catch (error) {
			this.logger.error(`Failed to delete '${systemPath}'`, error)
			return false
		}
	}

	// Get allowed operations for a given path
	async getAllowedOperations(virtualPath: string): Promise<FileOperation[]> {
		// Get file status
		let isFile = false
		let isDirectory = false
		try {
			const file = await fse.lstat(await this.virtualToSystemPath(virtualPath))
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

		// Disable creating files in readonly directories
		const isReadonly =
			virtualPath === '/External' ||
			match(virtualPath, ['/Network', '/Network/*']) ||
			virtualPath === '/Backups' ||
			virtualPath.startsWith('/Backups/')
		if (isReadonly) operations.delete('writable')

		// Remove destructive operations if the path is protected
		// Note only the exact paths are protected, not necessarily the children.
		// e.g /Home/Downloads is protected but /Home/Downloads/file.txt is not.
		// Children could be protected with /Home/Downloads/**
		let isProtected = match(virtualPath, [
			'/*',
			'/Home/Downloads',
			'/External/*',
			'/Network/*',
			'/Network/*/*',
			'/Backups',
			'/Backups/**',
		])

		// For /Apps/* paths, only protect if the app id is installed
		if (match(virtualPath, ['/Apps/*'])) {
			const appId = nodePath.basename(virtualPath)
			isProtected = await this.#umbreld.apps.isInstalled(appId)
		}

		if (isProtected) {
			operations.delete('move')
			operations.delete('rename')
			operations.delete('trash')
			operations.delete('delete')
		}

		// Unshareable paths
		const isUnshareable = match(virtualPath, [
			'/Apps',
			'/Apps/*',
			'/External',
			'/External/**',
			'/Network',
			'/Network/**',
			'/Backups',
			'/Backups/**',
		])
		if (isUnshareable) operations.delete('share')

		// External files (not external root or top level mount points)
		const isExternal = match(virtualPath, ['/External/*/**'])
		const isNetwork = match(virtualPath, ['/Network/*/*/**'])
		if (isExternal || isNetwork) {
			// Only allow hard delete so we don't copy to internal storage
			operations.delete('trash')
			operations.add('delete')
		}

		// Add trash specific operations
		const isTrash = match(virtualPath, ['/Trash/**'])
		if (isTrash) {
			operations.delete('unarchive')
			operations.delete('share')
			operations.delete('favorite')
			operations.delete('trash')
			operations.add('restore')
			operations.add('delete')
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
		while (await fse.pathExists(uniquePath)) {
			if (index > maxIndex) throw new Error(`[unique-name-index-exceeded]`)
			uniquePath = nodePath.join(path, `${name} (${index})${extension ? extension : ''}`)
			index++
		}

		return uniquePath
	}

	// We expose an unsafe conversion method that's only suitable to be used on trusted paths.
	// This method is sync and doesn't touch the fs for validation which is important for some use cases
	// for internal code where we just need to convert between path types but don't want to validate anything.
	virtualToSystemPathUnsafe(virtualPath: string) {
		// Normalize virtual path before lookup so directory traversal attacks cannot be resolved.
		// e.g: /Home/../../../../etc/passwd normalizes to /etc/passwd which won't get a match in the base directories lookup.
		virtualPath = normalizePath(virtualPath)

		// Ensure the path is absolute, we can't resolve relative paths.
		// e.g /Home/file.pdf can be resolved but Home/file.pdf can't.
		if (!nodePath.posix.isAbsolute(virtualPath)) throw new Error(`[path-not-absolute]`)

		// Split the path into segments and lookup the system path for the base directory
		const segments = virtualPath.split('/').filter(Boolean)
		const basePath = this.baseDirectories.get(`/${segments[0]}`)

		// Error if we don't find a matching base directory
		if (!basePath) throw new Error(`[invalid-base] No valid base directory found for path: ${virtualPath}`)

		// Swap out the base directory with it's system path and resolve any symlinks
		// or directory traversals to get the real path.
		segments[0] = basePath
		const systemPath = segments.join('/')

		return systemPath
	}

	// Converts a virtual path to a system path.
	// Ensures that the path is safe and does not escape the expected base directory.
	// If the full path doesn't exist it validates symlinks up to the deepest existing path.
	async virtualToSystemPath(virtualPath: string) {
		// Split the path into segments and lookup the system path for the base directory
		const segments = virtualPath.split('/').filter(Boolean)
		const basePath = this.baseDirectories.get(`/${segments[0]}`)!

		const systemPath = this.virtualToSystemPathUnsafe(virtualPath)

		// Ensure the deepest existing real path doesn't resolve to a directory outside
		// of the expected base path. We use realpath to resolve symlinks. This prevents
		// escaping the base directory if a symlink is in the path.
		// e.g:
		// /Home/symlink-to-root/etc/passwd
		const deepestExistingPath = await getDeepestExistingPath(systemPath)
		const deepestExistingRealPath = await fse.realpath(deepestExistingPath)
		const realPath = systemPath.replace(deepestExistingPath, deepestExistingRealPath)
		if (!realPath.startsWith(basePath)) throw new Error(`[escapes-base] '${virtualPath}' escapes '${basePath}'`)

		// We return the system path not the real path because at this point we know
		// the path is safe and we want to return the path as it was passed in.
		// Otherwise we'd resolve symlinks in the path and weird stuff would happen
		// like copying a symlink to a file resulting in copying the file instead of the symlink.
		// e.g:
		// /Home/symlink-to-documents
		// would resolve to system path for /Home/Documents not the actual symlink path.
		return systemPath
	}

	// Converts a system path to a virtual path.
	// Ensures that the path is safe and does not escape the expected base directory.
	systemToVirtualPath(systemPath: string) {
		// Normalize the system path to handle any directory traversals
		systemPath = normalizePath(systemPath)

		// Find the base directory this path belongs to by checking if it starts with any of the base paths
		for (const [baseDirectory, basePath] of this.baseDirectories) {
			if (systemPath.startsWith(basePath)) {
				// Replace the system base path with the virtual base directory name
				const virtualPath = systemPath.replace(basePath, baseDirectory)
				// Normalize to handle any remaining path oddities
				return normalizePath(virtualPath)
			}
		}

		throw new Error(`[invalid-path] Path '${systemPath}' is not within any base directory`)
	}

	// Get view preferences
	async getViewPreferences(): Promise<ViewPreferences> {
		const viewPreferences = await this.#umbreld.store.get('files.preferences')
		return viewPreferences || DEFAULT_VIEW_PREFERENCES
	}

	// Update view preferences
	async updateViewPreferences(newViewPreferences: Partial<ViewPreferences>): Promise<ViewPreferences> {
		let updatedViewPreferences: ViewPreferences

		// Save the new preferences to the store
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const currentViewPreferences = await this.getViewPreferences()
			updatedViewPreferences = {...currentViewPreferences, ...newViewPreferences}
			await set('files.preferences', updatedViewPreferences)
		})

		return updatedViewPreferences!
	}
}

// Match a path against a list of glob patterns
function match(path: string, patterns: string[]) {
	// TODO: Cache Regex creation if perf becomes an issue
	return patterns.some((pattern) => minimatch(path, pattern, {dot: true}))
}

// Resolve traversals and always trim trailing trash
function normalizePath(path: string) {
	// Reduce `.`, `..` and multiple slashes to their canonical form
	const normalized = nodePath.posix.normalize(path)

	// Trim trailing slash, except for the root directory
	if (normalized === '/') return normalized
	return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
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
