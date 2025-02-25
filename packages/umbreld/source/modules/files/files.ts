import nodePath, {posix as posixPath} from 'node:path'

import fse from 'fs-extra'
import {$} from 'execa'
import mime from 'mime-types'
import PQueue from 'p-queue'
import {minimatch} from 'minimatch'

import type Umbreld from '../../index.js'
import Samba from './samba.js'
import temporaryDirectory from '../utilities/temporary-directory.js'
import resolveSafe from '../utilities/resolve-safe.js'
import normalizeFsExtraError from '../utilities/normalize-fs-extra-error.js'
import {UMBREL_GID, UMBREL_UID} from '../../constants.js'
import FilesWatcher from './files-watcher.js'
import Recents from './recents.js'
import Thumbnails from './thumbnails.js'
import ExternalStorage from './external-storage.js'

export const DEFAULT_UID = UMBREL_UID
export const DEFAULT_GID = UMBREL_GID
export const DEFAULT_FILE_MODE = 0o644
export const DEFAULT_DIRECTORY_MODE = 0o755
export const SUFFIX_SEARCH_MAX_ITERATIONS = 100

export const DEFAULT_DIRECTORIES = ['Documents', 'Downloads', 'Photos', 'Videos'] as const
export const PROTECTED_VIRTUAL_PATHS = ['/Apps/*', '/Home/Downloads', '/External/*'] as const
export const UNSHAREABLE_VIRTUAL_PATHS = ['/Apps', '/Apps/*', '/External', '/External/**'] as const

const enum Operations {
	none = 0,
	createWithin = 1 << 0,
	rename = 1 << 1,
	copy = 1 << 2,
	copyTo = 1 << 3,
	move = 1 << 4,
	moveTo = 1 << 5,
	delete = 1 << 6,
	trash = 1 << 7,
	restore = 1 << 8,
	share = 1 << 9,
	favorite = 1 << 10,
	archive = 1 << 11,
	extract = 1 << 12,
}

export type Stats = {
	name: string
	path: string
	error?: string
	type?: string
	size?: number
	created?: Date
	modified?: Date
	ops: Operations
}

type Trashmeta = {
	path: string
}

type Permissions = {
	uid: number
	gid: number
	mode: number
}

const statQueue = new PQueue({concurrency: 10})
const deleteQueue = new PQueue({concurrency: 10})
const maxFilesInDirectory = 10000

export default class Files {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	homeDirectory: string
	trashDirectory: string
	trashMetaDirectory: string
	appsDirectory: string
	mediaDirectory: string
	baseDirectories: Map<string, string>
	watcher: FilesWatcher
	recents: Recents
	thumbnails: Thumbnails
	samba: Samba
	externalStorage: ExternalStorage
	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLocaleLowerCase())
		this.homeDirectory = nodePath.join(umbreld.dataDirectory, 'home')
		this.trashDirectory = nodePath.join(umbreld.dataDirectory, 'trash')
		this.trashMetaDirectory = nodePath.join(umbreld.dataDirectory, 'trash-meta')
		this.appsDirectory = nodePath.join(umbreld.dataDirectory, 'app-data')
		this.mediaDirectory = nodePath.join(umbreld.dataDirectory, 'external')
		this.baseDirectories = new Map([
			[this.homeDirectory, 'Home'],
			[this.trashDirectory, 'Trash'],
			[this.appsDirectory, 'Apps'],
			[this.mediaDirectory, 'External'],
		])

		this.externalStorage = new ExternalStorage(umbreld)
		this.watcher = new FilesWatcher(umbreld)
		this.recents = new Recents(umbreld)
		this.thumbnails = new Thumbnails(umbreld)
		this.samba = new Samba(umbreld)
	}

	async start() {
		this.logger.log('Starting files')

		const defaultPermissions = {uid: DEFAULT_UID, gid: DEFAULT_GID, mode: DEFAULT_DIRECTORY_MODE}

		// Make sure that required directories exist with sane permissions
		await Promise.all([
			this.ensureDirectoryWithPermissions(this.homeDirectory, defaultPermissions).catch((error) =>
				this.logger.error(`Failed to ensure home directory: ${error.message}`),
			),
			this.ensureDirectoryWithPermissions(this.trashDirectory, defaultPermissions).catch((error) =>
				this.logger.error(`Failed to ensure trash directory: ${error.message}`),
			),
			this.ensureDirectoryWithPermissions(this.trashMetaDirectory, defaultPermissions).catch((error) =>
				this.logger.error(`Failed to ensure trash meta directory: ${error.message}`),
			),
			this.ensureDirectoryWithPermissions(this.appsDirectory, defaultPermissions).catch((error) =>
				this.logger.error(`Failed to ensure apps directory: ${error.message}`),
			),
			this.ensureDirectoryWithPermissions(this.mediaDirectory, defaultPermissions).catch((error) =>
				this.logger.error(`Failed to ensure media directory: ${error.message}`),
			),
		])

		// Initialize favorites with default directories on first run
		const favoritesInitialized = (await this.#umbreld.store.get('files.favorites')) !== undefined
		if (!favoritesInitialized) {
			const favorites = (
				await Promise.all(
					DEFAULT_DIRECTORIES.map(async (defaultDirectoryName) => {
						const defaultDirectoryPath = nodePath.join(this.homeDirectory, defaultDirectoryName)
						try {
							await this.ensureDirectoryWithPermissions(defaultDirectoryPath, defaultPermissions)
							return this.mapSystemToVirtualPath(defaultDirectoryPath)
						} catch (error) {
							this.logger.error(
								`Failed to ensure default directory '${defaultDirectoryName}': ${(error as Error).message}`,
							)
							return null
						}
					}),
				)
			).filter((favorite) => favorite !== null) as string[]
			await this.#umbreld.store.set('files.favorites', favorites)
		}

		// Start watching for filesystem changes
		await this.recents.start()
		await this.thumbnails.start()
		await this.watcher.start()
		await this.externalStorage.start()

		// Make sure the share password exists and is applied and start samba daemon
		await this.samba.start()
	}

	async stop() {
		this.logger.log('Stopping files')

		// Stop watching for filesystem changes
		await this.externalStorage.stop()
		await this.watcher.stop()
		await this.recents.stop()
		await this.thumbnails.stop()

		// Stop samba daemon
		await this.samba.stop()
	}

	// === Helpers (non-virtual) ===

	async setPermissions(path: string, {uid, gid, mode}: Permissions) {
		await fse.chmod(path, mode)
		await fse.chown(path, uid, gid)
	}

	async inheritPermissions(path: string, fromPath: string, modeMask = 0o777) {
		const parentStats = await fse.stat(fromPath)
		const uid = parentStats.uid
		const gid = parentStats.gid
		const mode = parentStats.mode & modeMask
		await this.setPermissions(path, {uid, gid, mode})
	}

	async ensureDirectory(path: string) {
		path = nodePath.resolve(path)
		const segments = path.split(nodePath.sep).filter(Boolean)
		let current = nodePath.parse(path).root
		for (const segment of segments) {
			current = nodePath.join(current, segment)
			const parentPath = nodePath.dirname(current)
			try {
				await fse.mkdir(current)
				await this.inheritPermissions(current, parentPath).catch((error) =>
					this.logger.error(
						`Failed to inherit parent permissions when ensuring directory '${current}': ${error.message}`,
					),
				)
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
					// When current exists, make sure it's a directory
					const stats = await fse.lstat(current).catch(() => null)
					if (!stats?.isDirectory()) {
						throw new Error('ENOTDIR: Cannot ensure directory at non-directory')
					}
				} else {
					throw error
				}
			}
		}
	}

	async ensureDirectoryWithPermissions(path: string, permissions: Permissions) {
		await this.ensureDirectory(path) // inherit from interjacent parent first
		await this.setPermissions(path, permissions)
	}

	isBaseDirectory(path: string) {
		return this.baseDirectories.has(path)
	}

	isTrash(path: string) {
		return path === this.trashDirectory || path.startsWith(`${this.trashDirectory}${nodePath.sep}`)
	}

	async mapVirtualToSystemPath(virtualPath: string) {
		if (!posixPath.isAbsolute(virtualPath)) {
			throw new Error('EPERM: Path must be absolute')
		}
		for (const [path, name] of this.baseDirectories) {
			const virtualBase = `/${name}`
			if (virtualPath === virtualBase || virtualPath.startsWith(`${virtualBase}/`)) {
				return await resolveSafe(path, posixPath.relative(virtualBase, virtualPath))
			}
		}
		throw new Error(`Cannot map '${virtualPath}' to a system path`)
	}

	mapSystemToVirtualPath(systemPath: string) {
		for (const [path, name] of this.baseDirectories) {
			if (systemPath === path || systemPath.startsWith(`${path}${nodePath.sep}`)) {
				return posixPath.join('/', name, nodePath.relative(path, systemPath))
			}
		}
		throw new Error(`Cannot map '${systemPath}' to a virtual path`)
	}

	validateVirtualPath(virtualPath: string) {
		// Since virtual paths aren't used to create files or directories, but
		// to point to existing files or directories, they are not subject to
		// the same restrictions as new file names below. The requirement here
		// is that any possible Unix path can be referenced, even those that
		// are all spaces, have trailing spaces etc., as long as they exist.
		if (virtualPath.includes('\0')) {
			throw new Error('EPERM: Path must not contain invalid characters')
		}
		// Reduce `.`, `..` and multiple slashes to their canonical form, in
		// turn eliminating traversal patterns and redundant characters.
		const normalized = posixPath.normalize(virtualPath)
		// Trim trailing slash, except for the root directory
		if (normalized === '/') return normalized
		return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
	}

	validateFilename(filename: string) {
		// We are only interested in a file name here, not in a path, so we can
		// drop everything but the base name and check the outcome.
		const trimmedBasename = nodePath.basename(filename.trim())
		if (!trimmedBasename.length) {
			throw new Error('EPERM: Filename must not be empty')
		}
		if (filename !== trimmedBasename) {
			throw new Error('EPERM: Filename must not contain redundant characters')
		}
		// Check that the now known-to-be file name is not `.` or `..`
		const traversalPatterns = /^\.{1,2}$/
		if (traversalPatterns.test(trimmedBasename)) {
			throw new Error('EPERM: Filename must not contain traversal patterns')
		}
		// Reject "reserved" characters. Unix paths actually allow most
		// characters, but we want to prevent potential issues with them.
		const reservedCharacters = /[<>:"/\\|?*\u0000-\u001F]/g
		if (reservedCharacters.test(trimmedBasename)) {
			throw new Error('EPERM: Filename must not contain reserved characters')
		}
		return trimmedBasename
	}

	getSupportedDirectoryOperations(path: string, isBaseDirectoryRoot: boolean) {
		const isTrash = this.isTrash(path)
		const isInTrashRoot = nodePath.dirname(path) === this.trashDirectory
		let operations = Operations.copy | Operations.copyTo | Operations.moveTo
		if (!isBaseDirectoryRoot) {
			operations |= Operations.move
			operations |= Operations.delete
		}
		if (!isTrash) {
			operations |= Operations.createWithin
			operations |= Operations.trash
			operations |= Operations.share
			operations |= Operations.favorite
			if (!isBaseDirectoryRoot) {
				operations |= Operations.rename
				operations |= Operations.archive
			}
		}
		if (isInTrashRoot) {
			operations |= Operations.restore
		}
		return operations
	}

	getSupportedOperations(path: string, virtualPath: string, type: string) {
		const isBaseDirectory = this.isBaseDirectory(path)
		if (type === 'directory' || isBaseDirectory) {
			// Checking for isBaseDirectory separately above in case `type` is unknown
			return this.getSupportedDirectoryOperations(path, isBaseDirectory)
		}
		const isTrash = this.isTrash(path)
		const isInTrashRoot = nodePath.dirname(path) === this.trashDirectory
		let operations = Operations.copy | Operations.move | Operations.delete
		if (!isTrash) {
			operations |= Operations.rename
			operations |= Operations.trash
			const pathLower = path.toLowerCase()
			const hasSupportedArchiveExtension = this.supportedArchiveExtensions.some((extension) =>
				pathLower.endsWith(extension),
			)
			if (hasSupportedArchiveExtension) {
				operations |= Operations.extract
			}
		}
		if (isInTrashRoot) {
			operations |= Operations.restore
		}
		if (this.isProtected(virtualPath)) {
			operations &= ~(Operations.move | Operations.rename | Operations.delete | Operations.trash)
		}
		if (this.isUnshareable(virtualPath)) {
			operations &= ~Operations.share
		}
		return operations
	}

	async stat(path: string, virtualPath: string): Promise<Stats> {
		const name = this.baseDirectories.get(path) ?? nodePath.basename(path)
		try {
			const stats = await fse.lstat(path)
			const type = stats.isDirectory()
				? 'directory'
				: stats.isBlockDevice()
					? 'block-device'
					: stats.isCharacterDevice()
						? 'character-device'
						: stats.isSymbolicLink()
							? 'symbolic-link'
							: stats.isFIFO()
								? 'fifo'
								: stats.isSocket()
									? 'socket'
									: mime.lookup(name) || 'application/octet-stream'
			return {
				name,
				path: virtualPath,
				type,
				size: stats.size,
				created: stats.birthtime,
				modified: stats.mtime,
				ops: this.getSupportedOperations(path, virtualPath, type),
			}
		} catch (error) {
			const errno = (error as NodeJS.ErrnoException).code
			return {
				name,
				path: virtualPath,
				error: errno,
				ops: errno !== 'ENOENT' ? this.getSupportedOperations(path, virtualPath, '') : 0,
			}
		}
	}

	getFileTargetName(path: string, suffix?: number) {
		const extension = getFileExtension(path)
		let targetName = nodePath.basename(path, extension)
		if (suffix) targetName += ` (${suffix})`
		if (extension.length) targetName += extension
		return targetName
	}

	getDirectoryTargetName(path: string, suffix?: number) {
		let targetName = nodePath.basename(path)
		if (suffix) targetName += ` (${suffix})`
		return targetName
	}

	// === Virtual filesystem operations ===

	isProtected(virtualPath: string) {
		return PROTECTED_VIRTUAL_PATHS.some((rule) => minimatch(virtualPath, rule))
	}

	isUnshareable(virtualPath: string) {
		return UNSHAREABLE_VIRTUAL_PATHS.some((rule) => minimatch(virtualPath, rule))
	}

	async listDirectory(virtualPath: string) {
		virtualPath = this.validateVirtualPath(virtualPath)

		// Virtual root directory lists virtual base directories
		if (virtualPath === '/') {
			const stats = {
				name: '',
				path: '/',
				type: 'directory',
				ops: Operations.none,
			} satisfies Stats
			const items = await Promise.all(
				[...this.baseDirectories.entries()].map(([path, name]) => this.stat(path, `/${name}`)),
			)
			return {stats, items}
		}

		// Map any other virtual path to its corresponding system path
		const path = await this.mapVirtualToSystemPath(virtualPath)
		const stats = await this.stat(path, virtualPath)

		// Limit the maximum number of files in a directory as a precaution and
		// use a global queue with a sensible concurrency to obtain file stats.
		// TODO: Figure out a proper way to browse all files, always.
		const items = new Array<Stats>()
		const dir = await fse.opendir(path, {encoding: 'utf8'})
		let truncatedAt: number | undefined = undefined
		try {
			let count = 0
			for await (const dirent of dir) {
				if (++count > maxFilesInDirectory) {
					truncatedAt = maxFilesInDirectory
					break
				}
				await statQueue.add(async () => {
					const filePath = nodePath.join(path, dirent.name)
					const virtualFilePath = posixPath.join(virtualPath, dirent.name)
					items.push(await this.stat(filePath, virtualFilePath))
				})
			}
		} finally {
			// Make sure the directory is closed in any case
			dir.close().catch(() => undefined)
		}
		return {
			stats,
			items,
			truncatedAt,
		}
	}

	async createDirectory(virtualPath: string, name: string) {
		virtualPath = this.validateVirtualPath(virtualPath)
		name = this.validateFilename(name)
		const path = await this.mapVirtualToSystemPath(virtualPath)

		if (this.isTrash(path)) {
			throw new Error('ENOTSUP: Cannot create a directory in trash')
		}

		const parentStats = await fse.lstat(path).catch(() => null)
		if (!parentStats) {
			throw new Error('ENOENT: Parent directory does not exist')
		}
		if (!parentStats.isDirectory()) {
			throw new Error('ENOTDIR: Parent is not a directory')
		}

		const targetPath = nodePath.join(path, name)
		await this.ensureDirectory(targetPath)
		return this.mapSystemToVirtualPath(targetPath)
	}

	async copy(virtualPath: string, toVirtualDirectory: string, overwrite = false) {
		virtualPath = this.validateVirtualPath(virtualPath)
		const path = await this.mapVirtualToSystemPath(virtualPath)
		toVirtualDirectory = this.validateVirtualPath(toVirtualDirectory)
		const toDirectory = await this.mapVirtualToSystemPath(toVirtualDirectory)

		// Copying a base directory is technically possible, but would require
		// special logic because these have virtual names for example. Disallow
		// for now and revisit in case the UI ever needs to support it.
		if (this.isBaseDirectory(path)) {
			throw new Error('ENOTSUP: Cannot copy a base directory')
		}

		if (toDirectory === this.trashDirectory) {
			// Handle copy to trash root by calling through to the trash route so it
			// also creates the respective meta file. It's technically OK to copy to
			// a trash subdirectory as well, so there's no need to disallow it.
			return await this.trash(virtualPath, {keepOriginal: true})
		}

		const basename = nodePath.basename(path)
		const wantedPath = nodePath.join(toDirectory, basename)

		// Obtain a unique name for the file in case the path already exists
		let targetPath = wantedPath
		const targetDirectory = nodePath.dirname(targetPath)
		let targetBasename = this.getFileTargetName(targetPath)
		let nextSuffix = 2
		while (await fse.pathExists(targetPath)) {
			if (nextSuffix > SUFFIX_SEARCH_MAX_ITERATIONS) {
				throw new Error('EEXIST: Gave up searching for a suffix')
			}
			targetBasename = this.getFileTargetName(wantedPath, nextSuffix++)
			targetPath = nodePath.join(targetDirectory, targetBasename)
		}

		if (!overwrite) {
			// When the source is a directory, `fse.copy` copies everything inside
			// of the directory to the destination, but that's not what we want when
			// the target already exists. Hence, perform an additional check.
			const targetExists = await fse.pathExists(targetPath)
			if (targetExists) throw new Error(`EEXIST: Target already exists`)
		}
		try {
			await fse.copy(path, targetPath, {overwrite, errorOnExist: true})
		} catch (error) {
			throw normalizeFsExtraError(error)
		}
		return true
	}

	async move(virtualPath: string, toVirtualDirectory: string, overwrite = false) {
		virtualPath = this.validateVirtualPath(virtualPath)

		if (this.isProtected(virtualPath)) {
			throw new Error('ENOTSUP: Cannot move a protected file or directory')
		}

		const path = await this.mapVirtualToSystemPath(virtualPath)
		toVirtualDirectory = this.validateVirtualPath(toVirtualDirectory)
		const toDirectory = await this.mapVirtualToSystemPath(toVirtualDirectory)

		if (this.isBaseDirectory(path)) {
			throw new Error('ENOTSUP: Cannot move a base directory')
		}

		if (toDirectory === this.trashDirectory) {
			// Handle move to trash root by calling through to the trash route so it
			// also creates the respective meta file. It's technically OK to move to
			// a trash subdirectory as well, so there's no need to disallow it.
			return await this.trash(virtualPath)
		}

		const basename = nodePath.basename(path)
		const targetPath = nodePath.join(toDirectory, basename)
		await this.ensureDirectory(toDirectory)
		try {
			await fse.move(path, targetPath, {overwrite})
		} catch (error) {
			throw normalizeFsExtraError(error)
		}
		const movedFromTrashRoot = nodePath.dirname(path) === this.trashDirectory
		if (movedFromTrashRoot) {
			const metaPath = nodePath.join(this.trashMetaDirectory, `${nodePath.basename(path)}.json`)
			await fse
				.remove(metaPath)
				.catch((error) =>
					this.logger.error(
						`Failed to remove trash meta file '${metaPath}' when moving from trash root: ${error.message}`,
					),
				)
		}
		await this.samba.replaceOrDeleteShare(virtualPath, targetPath)
		await this.#replaceOrDeleteFavorite(virtualPath, targetPath)
		return true
	}

	async rename(virtualPath: string, toName: string, overwrite = false) {
		virtualPath = this.validateVirtualPath(virtualPath)

		if (this.isProtected(virtualPath)) {
			throw new Error('ENOTSUP: Cannot rename a protected file or directory')
		}

		const path = await this.mapVirtualToSystemPath(virtualPath)
		toName = this.validateFilename(toName)

		if (this.isBaseDirectory(path)) {
			throw new Error('ENOTSUP: Cannot rename a base directory')
		}

		if (this.isTrash(path)) {
			throw new Error('ENOTSUP: Cannot rename in trash')
		}

		const parentPath = nodePath.dirname(path)
		const targetPath = nodePath.join(parentPath, toName)
		if (!overwrite) {
			// fs.rename overwrites the target file if it exists but throws
			// when the target is a directory. So check manually instead.
			const targetExists = await fse.pathExists(targetPath)
			if (targetExists) throw new Error('EEXIST: Target already exists')
		}
		await fse.rename(path, targetPath)
		await this.samba.replaceOrDeleteShare(virtualPath, targetPath)
		await this.#replaceOrDeleteFavorite(virtualPath, targetPath)
		return this.mapSystemToVirtualPath(targetPath)
	}

	async delete(virtualPath: string) {
		virtualPath = this.validateVirtualPath(virtualPath)

		if (this.isProtected(virtualPath)) {
			throw new Error('ENOTSUP: Cannot delete a protected file or directory')
		}

		const path = await this.mapVirtualToSystemPath(virtualPath)

		if (this.isBaseDirectory(path)) {
			throw new Error('ENOTSUP: Cannot delete a base directory')
		}

		await fse.remove(path)
		if (this.isTrash(path)) {
			// When deleting from trash, delete the respective meta file if it exists.
			// It's expected that this fails when deleting inside a trashed directory.
			const relativePathInTrash = nodePath.relative(this.trashDirectory, path)
			const metaPath = nodePath.join(this.trashMetaDirectory, `${relativePathInTrash}.json`)
			await fse.remove(metaPath).catch(() => {})
		} else {
			await this.samba.deleteShare(virtualPath).catch(() => false)
			await this.deleteFavorite(virtualPath).catch(() => false)
		}
		return true
	}

	async trash(virtualPath: string, {keepOriginal = false}: {keepOriginal?: boolean} = {}) {
		virtualPath = this.validateVirtualPath(virtualPath)

		if (this.isProtected(virtualPath)) {
			throw new Error('ENOTSUP: Cannot trash a protected file or directory')
		}

		const path = await this.mapVirtualToSystemPath(virtualPath)

		if (this.isBaseDirectory(path)) {
			throw new Error('ENOTSUP: Cannot trash a base directory')
		}

		if (this.isTrash(path)) {
			throw new Error('ENOTSUP: Cannot trash trash')
		}

		const stats = await fse.stat(path)
		const isDirectory = stats.isDirectory()

		// Obtain a unique name for the file in case multiple files of the same name,
		// at the same place or not, have been trashed.
		let targetName = isDirectory ? this.getDirectoryTargetName(path) : this.getFileTargetName(path)
		let targetPath = nodePath.join(this.trashDirectory, targetName)
		let nextSuffix = 2
		while (await fse.pathExists(targetPath)) {
			if (nextSuffix > SUFFIX_SEARCH_MAX_ITERATIONS) {
				throw new Error('EEXIST: Gave up searching for a suffix')
			}
			targetName = isDirectory
				? this.getDirectoryTargetName(path, nextSuffix++)
				: this.getFileTargetName(path, nextSuffix++)
			targetPath = nodePath.join(this.trashDirectory, targetName)
		}

		// Only move (or copy) the file when creating the meta file succeeded
		const targetMetaPath = nodePath.join(this.trashMetaDirectory, `${targetName}.json`)
		await fse.writeFile(targetMetaPath, JSON.stringify({path: virtualPath} satisfies Trashmeta))
		try {
			await fse[keepOriginal ? 'copy' : 'move'](path, targetPath)
		} catch (error) {
			await fse
				.remove(targetMetaPath)
				.catch((error) => this.logger.error(`Failed to undo trash meta file '${targetMetaPath}': ${error.message}`))
			throw normalizeFsExtraError(error)
		}
		return true
	}

	async restore(virtualPath: string, overwrite = false) {
		virtualPath = this.validateVirtualPath(virtualPath)
		const path = await this.mapVirtualToSystemPath(virtualPath)

		if (!this.isTrash(path)) {
			throw new Error('ENOTSUP: Can only restore from trash')
		}

		if (this.isBaseDirectory(path)) {
			throw new Error('ENOTSUP: Cannot restore trash base directory')
		}

		const relativePathInTrash = nodePath.relative(this.trashDirectory, path)
		const metaPath = nodePath.join(this.trashMetaDirectory, `${relativePathInTrash}.json`)
		const meta = JSON.parse(await fse.readFile(metaPath, 'utf-8')) as Trashmeta
		const originalPath = await this.mapVirtualToSystemPath(meta.path)

		// Obtain a unique name for the file in case the path already exists
		const targetDirectory = nodePath.dirname(originalPath)
		let targetBasename = this.getFileTargetName(originalPath)
		let targetPath = nodePath.join(targetDirectory, targetBasename)
		let nextSuffix = 2
		while (await fse.pathExists(targetPath)) {
			if (nextSuffix > SUFFIX_SEARCH_MAX_ITERATIONS) {
				throw new Error('EEXIST: Gave up searching for a suffix')
			}
			targetBasename = this.getFileTargetName(originalPath, nextSuffix++)
			targetPath = nodePath.join(targetDirectory, targetBasename)
		}

		const targetPathExists = await fse.pathExists(targetPath)

		if (targetPathExists && !overwrite) {
			throw new Error(`EEXIST: Target already exists`)
		}
		await this.ensureDirectory(nodePath.dirname(targetPath))
		try {
			await fse.move(path, targetPath, {overwrite: true})
		} catch (error) {
			throw normalizeFsExtraError(error)
		}
		await fse.remove(metaPath)
		return true
	}

	async emptyTrash() {
		let deleted = 0
		let failed = 0
		const dir = await fse.opendir(this.trashDirectory)
		for await (const dirent of dir) {
			const itemName = dirent.name
			const itemPath = nodePath.join(this.trashDirectory, itemName)
			const metaPath = nodePath.join(this.trashMetaDirectory, `${itemName}.json`)
			await deleteQueue.add(async () => {
				try {
					await fse.remove(itemPath)
					deleted += 1
					await fse
						.remove(metaPath)
						.catch((error) => this.logger.error(`Failed to delete trash meta file of '${itemName}': ${error.message}`))
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
						failed += 1
						this.logger.error(`Failed to delete '${itemName}' from trash: ${(error as Error).message}`)
					}
				}
			})
		}
		return {deleted, failed}
	}

	supportedArchiveExtensions = ['.tar.gz', '.tgz', '.tar.bz2', '.tar.xz', '.tar', '.zip', '.7z']

	async archive(virtualPaths: string[]) {
		if (virtualPaths.length === 0) {
			throw new Error('EINVAL: No paths provided')
		}

		// Validate and map all paths serially
		const systemPaths: string[] = []
		for (const virtualPath of virtualPaths) {
			const validPath = this.validateVirtualPath(virtualPath)
			const path = await this.mapVirtualToSystemPath(validPath)

			if (this.isBaseDirectory(path)) {
				throw new Error('ENOTSUP: Cannot archive a base directory')
			}

			if (this.isTrash(path)) {
				throw new Error('ENOTSUP: Cannot archive within trash')
			}

			// Check that the path exists
			const stats = await fse.stat(path).catch(() => null)
			if (!stats) {
				throw new Error('ENOENT: Path does not exist')
			}

			systemPaths.push(path)
		}

		// For multiple files, use archive.zip in the parent directory of first path
		// For single file/dir, use its name with .zip extension
		const targetDirectory = nodePath.dirname(systemPaths[0])
		const targetBasename = virtualPaths.length === 1 ? nodePath.basename(systemPaths[0]) : 'Archive'
		let targetPath = nodePath.join(targetDirectory, `${targetBasename}.zip`)
		let nextSuffix = 2

		while (await fse.pathExists(targetPath)) {
			if (nextSuffix > SUFFIX_SEARCH_MAX_ITERATIONS) {
				throw new Error('EEXIST: Gave up searching for a suffix')
			}
			targetPath = nodePath.join(targetDirectory, `${targetBasename} (${nextSuffix++}).zip`)
		}

		// Create zip archive with 7z
		await $({
			cwd: targetDirectory,
		})`7z a ${targetPath} ${systemPaths}`

		return this.mapSystemToVirtualPath(targetPath)
	}

	async extract(virtualPath: string) {
		virtualPath = this.validateVirtualPath(virtualPath)
		const path = await this.mapVirtualToSystemPath(virtualPath)

		if (this.isTrash(path)) {
			throw new Error('ENOTSUP: Cannot extract within trash')
		}

		// Check that the path is a file we can extract
		const pathLower = path.toLowerCase()
		const extension = this.supportedArchiveExtensions.find((extension) => pathLower.endsWith(extension))
		if (!extension) {
			throw new Error('ENOTSUP: Not a supported archive type')
		}
		const stats = await fse.stat(path).catch(() => null)
		if (!stats?.isFile()) {
			throw new Error('ENOTSUP: Not an archive file')
		}

		// We want to extract the file to a directory of the same name placed next to
		// it. When the target directory already exists, try an incremental suffix.
		const targetDirectory = nodePath.dirname(path)
		const targetBasename = nodePath.basename(path, extension)
		let targetPath = nodePath.join(targetDirectory, targetBasename)
		let nextSuffix = 2
		while (await fse.pathExists(targetPath)) {
			if (nextSuffix > SUFFIX_SEARCH_MAX_ITERATIONS) {
				throw new Error('EEXIST: Gave up searching for a suffix')
			}
			targetPath = nodePath.join(targetDirectory, `${targetBasename} (${nextSuffix++})`)
		}

		// Extract the archive to a temporary directory first so we can inspect
		// whether it includes a single top-level directory we can normalize. This
		// directory is located on the data partition so files can be moved swiftly.
		const temporary = temporaryDirectory(this.#umbreld.temporaryDirectory)
		const containingTemporaryDirectory = await temporary.create()
		try {
			const isTarArchive = /^\.tar|\.tgz$/.test(extension)
			if (isTarArchive) {
				// Preserve permissions when extracting a tar archive so we don't break
				// backups of apps that rely on certain permissions to be set.
				await $`tar -xpf ${path} -C ${containingTemporaryDirectory}`
			} else {
				// Otherwise rely on 7z's wide archive format support
				await $`7z x ${path} -o${containingTemporaryDirectory}`
			}

			// Find out whether this archive contained a single top-level directory.
			// It it did, move the top-level directory itself to the target path.
			// Otherwise create the target directory and move the archive's contents
			// there. If the check fails, assume that there is no top-level directory.
			const checkSingleTopLevelDirectory = async () => {
				const entries = await fse.readdir(containingTemporaryDirectory).catch((error) => {
					this.logger.error(`Failed to read temporary archive directory: ${error.message}`)
					return []
				})
				if (entries.length !== 1) return null
				const topLevel = nodePath.join(containingTemporaryDirectory, entries[0])
				const stats = await fse.stat(topLevel).catch((error) => {
					this.logger.error(`Failed to stat top-level archive entry: ${error.message}`)
					return null
				})
				if (!stats?.isDirectory()) return null
				return topLevel
			}
			const singleTopLevelDirectory = await checkSingleTopLevelDirectory()
			await fse.move(singleTopLevelDirectory ?? containingTemporaryDirectory, targetPath)
		} finally {
			temporary.destroy().catch((error) => {
				this.logger.error(`Failed to clean up temporary directory: ${error.message}`)
			})
		}
		return this.mapSystemToVirtualPath(targetPath)
	}

	async getFavorites() {
		let favorites: string[]
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			favorites = (await get('files.favorites'))?.slice() ?? []
			const validFavorites = (
				await Promise.all(
					favorites.map(async (favorite) => {
						try {
							const path = await this.mapVirtualToSystemPath(favorite)
							const stats = await fse.stat(path)
							if (!stats.isDirectory()) {
								throw new Error('ENOTDIR: Favorite path is not a directory')
							}
							return favorite
						} catch (error) {
							// We no longer auto cleanup, see comment below.
							// this.logger.log(`Cleaned up invalid favorite '${favorite}': ${(error as Error).message}`)
							return null
						}
					}),
				)
			).filter((favorite) => favorite !== null) as string[]
			// Temporarily disable this to avoid deleting favourites on external storage
			// when the device isn't attached.
			// TODO: Come up with a proper solution for this in the refactor.
			// if (validFavorites.length === favorites.length) return
			// await set('files.favorites', validFavorites)
			favorites = validFavorites
		})
		return favorites!.map((favorite) => ({
			path: favorite,
			name: nodePath.basename(favorite),
		}))
	}

	async addFavorite(virtualPath: string) {
		virtualPath = this.validateVirtualPath(virtualPath)
		const path = await this.mapVirtualToSystemPath(virtualPath)

		if (this.isTrash(path)) {
			throw new Error('ENOTSUP: Cannot favorite trash')
		}

		// Check that the path is a directory
		const stats = await fse.stat(path).catch(() => null)
		if (!stats?.isDirectory()) {
			throw new Error('ENOTDIR: Favorite path is not a directory')
		}
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const favorites = (await get('files.favorites'))?.slice() ?? []
			let favorite = favorites.find((favorite) => favorite === virtualPath)
			if (favorite) return
			favorites.push(virtualPath)
			await set('files.favorites', favorites)
		})
		return true
	}

	async deleteFavorite(virtualPath: string) {
		virtualPath = this.validateVirtualPath(virtualPath)
		await this.mapVirtualToSystemPath(virtualPath) // for consistency

		let deleted = false
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const favorites = (await get('files.favorites')) ?? []
			const newFavorites = favorites.filter((favorite) => favorite !== virtualPath)
			deleted = newFavorites.length < favorites.length
			if (deleted) await set('files.favorites', newFavorites)
		})
		return deleted
	}

	async #replaceFavorite(knownGoodVirtualPath: string, newPath: string) {
		const newVirtualPath = await this.mapSystemToVirtualPath(newPath)

		if (this.isTrash(newPath)) {
			throw new Error('ENOTSUP: Cannot favorite trash')
		}

		// Check that newPath is a directory
		const stats = await fse.stat(newPath).catch(() => null)
		if (!stats?.isDirectory()) {
			throw new Error('ENOTDIR: New favorite path is not a directory')
		}
		let replaced = false
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const favorites = (await get('files.favorites'))?.slice() ?? []
			const favoriteIndex = favorites.findIndex((favorite) => favorite === knownGoodVirtualPath)
			if (favoriteIndex < 0) return
			favorites[favoriteIndex] = newVirtualPath
			await set('files.favorites', favorites)
			replaced = true
		})
		return replaced
	}

	async #replaceOrDeleteFavorite(knownGoodVirtualPath: string, newPath: string) {
		const replaced = await this.#replaceFavorite(knownGoodVirtualPath, newPath).catch((error) => {
			this.logger.log(`Cannot replace favorite at '${knownGoodVirtualPath}': ${error.message}`)
			return false
		})
		if (replaced) return true
		return await this.deleteFavorite(knownGoodVirtualPath).catch((error) => {
			this.logger.error(`Failed to delete favorite at '${knownGoodVirtualPath}' instead: ${error.message}`)
		})
	}
}

/**
 * Like `path.extname`, but considering a second level, so when determining a
 * filename with a suffix, we get `.xyz-2.tar.gz` instead of `.xyz.tar-2.gz`.
 * Return value includes the leading dot. Returns an empty string when there
 * is no extension or the extension is a dot.
 */
function getFileExtension(name: string) {
	const secondLevelExtensions = ['.tar']
	const extension = nodePath.extname(name)
	const remainder = name.substring(0, name.length - extension.length)
	const secondLevel = secondLevelExtensions.find((extension) => remainder.endsWith(extension))
	return secondLevel ? `${secondLevel}${extension}` : extension
}
