import nodePath from 'node:path'

import z from 'zod'
import fse from 'fs-extra'
import express from 'express'
import formidable from 'formidable'
import archiver from 'archiver'

import {router, privateProcedure} from '../trpc.js'
import type Umbreld from '../../../../index.js'
import temporaryDirectory from '../../../utilities/temporary-directory.js'
import normalizeFsExtraError from '../../../utilities/normalize-fs-extra-error.js'
import {getSystemDiskUsage} from '../../../system.js'
import {DEFAULT_FILE_MODE, DEFAULT_GID, DEFAULT_UID, SUFFIX_SEARCH_MAX_ITERATIONS} from '../../../files/files.js'

// Default number of files to list
const defaultFilesPerPage = 100

// View preferences, first entry is the default
const viewValues = ['icons', 'list'] as const
const sortByValues = ['name', 'type', 'created', 'modified', 'size'] as const
const sortOrderValues = ['asc', 'desc'] as const

// Static comparison utility for fast sorting
const collator = new Intl.Collator('en-US', {sensitivity: 'base', numeric: true})
const compareByName = (a: {name: string}, b: {name: string}) => collator.compare(a.name, b.name)
const compareByCreated = (a: {created?: Date}, b: {created?: Date}) =>
	a.created && b.created ? a.created.getTime() - b.created.getTime() : a.created ? -1 : b.created ? 1 : 0
const compareByModified = (a: {modified?: Date}, b: {modified?: Date}) =>
	a.modified && b.modified ? a.modified.getTime() - b.modified.getTime() : a.modified ? -1 : b.modified ? 1 : 0
const compareByType = (a: {type?: string}, b: {type?: string}) =>
	a.type && b.type ? collator.compare(a.type, b.type) : a.type ? -1 : b.type ? 1 : 0
const compareBySize = (a: {size?: number}, b: {size?: number}) =>
	a.size && b.size ? a.size - b.size : a.size ? -1 : b.size ? 1 : 0

export default router({
	// Get the share password
	sharePassword: privateProcedure.query(({ctx}) => ctx.files.samba.getSharePassword()),

	// Get view preferences
	preferences: privateProcedure.query(async ({ctx}) => {
		const files = (await ctx.umbreld.store.get('files')) ?? {}
		return {
			view: files?.view ?? viewValues[0],
			sortBy: files?.sortBy ?? sortByValues[0],
			sortOrder: files?.sortOrder ?? sortOrderValues[0],
		}
	}),

	// Set view preferences
	setPreferences: privateProcedure
		.input(
			z.object({
				// Preferred view, see viewValues
				view: z.enum(viewValues).optional(),
				// Preferred sort colum, see sortByValues
				sortBy: z.enum(sortByValues).optional(),
				// Preferred sort order, see sortOrderValues
				sortOrder: z.enum(sortOrderValues).optional(),
			}),
		)
		.mutation(async ({ctx, input: {view, sortBy, sortOrder}}) => {
			await ctx.umbreld.store.getWriteLock(async ({get, set}) => {
				const files = (await get('files')) ?? {}
				if (view) files.view = view
				if (sortBy) files.sortBy = sortBy
				if (sortOrder) files.sortOrder = sortOrder
				await set('files', files)
			})
			return true
		}),

	// List a directory with optional pagination and sorting
	list: privateProcedure
		.input(
			z.object({
				// Absolute path of the directory to list
				path: z.string(),
				// Offset of first entry to return
				start: z.number().nonnegative().int().default(0),
				// Number of entries to return
				count: z.number().nonnegative().int().default(defaultFilesPerPage),
				// Sort column
				sortBy: z.enum(sortByValues).default(sortByValues[0]),
				// Sort order
				sortOrder: z.enum(sortOrderValues).default(sortOrderValues[0]),
			}),
		)
		.query(async ({ctx, input: {path, start, count, sortBy, sortOrder}}) => {
			const {stats, items, truncatedAt} = await ctx.files.listDirectory(path)

			// We filter out system-specific metadatafiles like .DS_Store (macOS) and .directory (KDE Dolphin)
			const userVisibleFiles = items.filter((item) => item.name !== '.DS_Store' && item.name !== '.directory')

			// Sort according to provided parameters. Select the comparator
			// before the loop to avoid unnecessary work per iteration.
			const ascending = sortOrder === 'asc'
			const compare =
				sortBy === 'created'
					? compareByCreated
					: sortBy === 'modified'
						? compareByModified
						: sortBy === 'type'
							? compareByType
							: sortBy === 'size'
								? compareBySize
								: compareByName

			const sortedItems = userVisibleFiles.sort((a, b) => {
				// Fall back to compare by name when comparing equal. When already
				// comparing by name, this won't compare twice because no two files
				// can have the same name.
				let comparison = compare(a, b) || compareByName(a, b)
				return ascending ? comparison : -comparison
			})

			return {
				stats,
				items: sortedItems.slice(start, start + count),
				truncatedAt,
				start,
				count,
				total: items.length,
			}
		}),

	// Create a new directory
	createDirectory: privateProcedure
		.input(
			z.object({
				// New directory name
				name: z.string(),
				// Absolute path of the parent directory
				path: z.string(),
			}),
		)
		.mutation(({ctx, input: {name, path}}) => ctx.files.createDirectory(path, name)),

	// Copy a directory or file to another directory
	copy: privateProcedure
		.input(
			z.object({
				// Absolute path of the file or directory to copy
				path: z.string(),
				// Absolute path of the containing target directory
				toDirectory: z.string(),
				// Whether to overwrite existing files
				overwrite: z.boolean().default(false),
			}),
		)
		.mutation(({ctx, input: {path, toDirectory, overwrite}}) => ctx.files.copy(path, toDirectory, overwrite)),

	// Move a directory or file to another directory
	move: privateProcedure
		.input(
			z.object({
				// Absolute path of the file or directory to move
				path: z.string(),
				// Absolute path of the containing target directory
				toDirectory: z.string(),
				// Whether to overwrite existing files
				overwrite: z.boolean().default(false),
			}),
		)
		.mutation(({ctx, input: {path, toDirectory, overwrite}}) => ctx.files.move(path, toDirectory, overwrite)),

	// Rename a directory or file inside of its current directory
	rename: privateProcedure
		.input(
			z.object({
				// Absolute path of the file or directory to rename
				path: z.string(),
				// New name of the file or directory within its current directory
				toName: z.string(),
				// Whether to overwrite existing files
				overwrite: z.boolean().default(false),
			}),
		)
		.mutation(({ctx, input: {path, toName, overwrite}}) => ctx.files.rename(path, toName, overwrite)),

	// Delete a directory or file
	delete: privateProcedure
		.input(
			z.object({
				// Absolute path of the file or directory to delete
				path: z.string(),
			}),
		)
		.mutation(({ctx, input: {path}}) => ctx.files.delete(path)),

	// Move a directory or file to trash
	trash: privateProcedure
		.input(
			z.object({
				// Absolute path of the file or directory to trash
				path: z.string(),
			}),
		)
		.mutation(({ctx, input: {path}}) => ctx.files.trash(path)),

	// Restore a directory or file from trash. Returns `false` when the original
	// path already exists, unless `force = true` is given.
	restore: privateProcedure
		.input(
			z.object({
				// Absolute path, within trash, of the file or directory to restore
				path: z.string(),
				// Whether to overwrite existing files
				overwrite: z.boolean().default(false),
			}),
		)
		.mutation(({ctx, input: {path, overwrite}}) => ctx.files.restore(path, overwrite)),

	// Empty the trash directory
	emptyTrash: privateProcedure.mutation(({ctx}) => ctx.files.emptyTrash()),

	// Get supported archive extensions
	archiveExtensions: privateProcedure.query(({ctx}) => ctx.files.supportedArchiveExtensions),

	// Archive a directory (TODO: single file?)
	archive: privateProcedure
		.input(
			z.object({
				// Absolute path of the directory to archive
				paths: z.array(z.string()).min(1),
			}),
		)
		.mutation(({ctx, input: {paths}}) => ctx.files.archive(paths)),

	// Extract an archive
	extract: privateProcedure
		.input(
			z.object({
				// Absolute path of the archive to extract
				path: z.string(),
			}),
		)
		.mutation(({ctx, input: {path}}) => ctx.files.extract(path)),

	// Get existing shares
	shares: privateProcedure.query(({ctx}) => ctx.files.samba.getShares()),

	// Add a new share
	share: privateProcedure
		.input(
			z.object({
				// Absolute path of the directory to share
				path: z.string(),
			}),
		)
		.mutation(({ctx, input: {path}}) => ctx.files.samba.addShare(path)),

	// Delete an existing share
	unshare: privateProcedure
		.input(
			z.object({
				// Absolute path of the directory to unshare
				path: z.string(),
			}),
		)
		.mutation(({ctx, input: {path}}) => ctx.files.samba.deleteShare(path)),

	// Get favorite directories
	favorites: privateProcedure.query(({ctx}) => ctx.files.getFavorites()),

	// Add a new favorite directory
	addFavorite: privateProcedure
		.input(
			z.object({
				// Absolute path of the directory to add to favorites
				path: z.string(),
			}),
		)
		.mutation(({ctx, input: {path}}) => ctx.files.addFavorite(path)),

	// Delete an existing favorite directory
	deleteFavorite: privateProcedure
		.input(
			z.object({
				// Absolute path of the directory to delete from favorites
				path: z.string(),
			}),
		)
		.mutation(({ctx, input: {path}}) => ctx.files.deleteFavorite(path)),

	// Get recently created or modified files
	recents: privateProcedure.query(({ctx}) => ctx.files.recents.get()),

	// Poll for thumbnails for a list of paths. Temporary solution until we have
	// a signaling channel to the UI.
	pollThumbnails: privateProcedure
		.input(z.object({paths: z.array(z.string())}))
		.query(async ({ctx, input: {paths}}) => ctx.files.thumbnails.pollThumbnails(paths)),

	// List external disks and partitions
	externalStorage: privateProcedure.query(({ctx}) => ctx.files.externalStorage.get()),

	// Eject an external disk
	eject: privateProcedure
		.input(z.object({id: z.string()}))
		.mutation(({ctx, input: {id}}) => ctx.files.externalStorage.eject(id)),

	// Check if an external drive is connected on non-Umbrel Home hardware
	// This is used to notify non-Home users why they can't see their hardware.
	isExternalDriveConnectedOnNonUmbrelHome: privateProcedure.query(({ctx}) =>
		ctx.files.externalStorage.isExternalDriveConnectedOnNonUmbrelHome(),
	),
})

export function installFilesMiddleware(umbreld: Umbreld, expressApp: express.Application) {
	const {logger} = umbreld.files

	const checkAuthorization = async (request: express.Request) => {
		// We shouldn't really use the proxy token for this but it's
		// fine until we have subdomains and refactor to session cookies
		try {
			await umbreld.server.verifyProxyToken(request?.cookies?.UMBREL_PROXY_TOKEN)
			return true
		} catch {
			return false
		}
	}

	const checkFilename = (name: string) => {
		try {
			return umbreld.files.validateFilename(name)
		} catch {
			return undefined
		}
	}

	const checkPath = async (path: string) => {
		try {
			path = umbreld.files.validateVirtualPath(path)
			return await umbreld.files.mapVirtualToSystemPath(path)
		} catch {
			return undefined
		}
	}

	const downloadMiddleware = async (
		request: express.Request,
		response: express.Response,
		next: (error?: Error) => void,
	) => {
		const authorized = await checkAuthorization(request)
		if (!authorized) {
			return response.status(401).json({
				error: 'unauthorized',
			})
		}

		// Handle single path or array of paths
		const requestedPaths = Array.isArray(request.query.path)
			? request.query.path.map(String)
			: [String(request.query.path || '')]

		// Check that at least one path is provided
		if (requestedPaths.length < 1) {
			return response.status(400).json({
				error: 'bad request',
			})
		}

		// Multiple paths are only supported when downloading
		const isDownload = request.params.action === 'download'
		if (!isDownload && requestedPaths.length > 1) {
			return response.status(400).json({
				error: 'bad request',
			})
		}

		// Check that all paths are within base directories
		const checkedPaths = await Promise.all(requestedPaths.map(checkPath))
		if (checkedPaths.some((path) => !path)) {
			return response.status(403).json({
				error: 'forbidden',
			})
		}

		if (isDownload) {
			// Check that all paths are in the same directory
			// This is to avoid collisions in the zip archive
			// e.g:
			// /Data/foo/file.txt
			// /Data/bar/file.txt
			// would result in a zip archive with two files called file.txt
			const directories = checkedPaths.map((path) => nodePath.dirname(path!))
			const uniqueDirectories = new Set(directories)
			if (uniqueDirectories.size > 1) {
				return response.status(400).json({
					error: 'paths must be in same directory',
				})
			}
		} else {
			// Serve thumbnail when requested
			const isThumbnail = request.params.action === 'thumbnail'
			if (isThumbnail) {
				// Re-check the thumbnail in the background when viewing the file
				umbreld.files.thumbnails.access(checkedPaths[0]!, false).catch(() => {})

				// Set the file path to the thumbnail path
				checkedPaths[0] = umbreld.files.thumbnails.get(checkedPaths[0]!)
			}
		}

		// Get stats for all paths
		const stats = await Promise.all(checkedPaths.map((path) => fse.stat(path!).catch(() => null)))
		if (stats.some((stat) => !stat)) {
			return response.status(404).json({
				error: 'notfound',
			})
		}

		// For single file that exists, serve directly
		if (requestedPaths.length === 1 && stats[0]!.isFile()) {
			if (isDownload) {
				const filename = nodePath.basename(checkedPaths[0]!)
				response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
			}
			response.sendFile(checkedPaths[0]!, {dotfiles: 'allow', index: false}, (error) => {
				if (!error) return
				logger.error(`Failed to send file '${checkedPaths[0]!}': ${error.message}`)
				next(error)
			})
			return
		}

		// For directory or multiple files, create zip archive
		response.setHeader('Content-Type', 'application/zip')
		const filename = requestedPaths.length === 1 ? `${nodePath.basename(checkedPaths[0]!)}.zip` : 'umbrel-files.zip'
		response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)

		const archive = archiver('zip')
		archive.pipe(response)

		// Add all files/directories to archive
		for (let i = 0; i < checkedPaths.length; i++) {
			const path = checkedPaths[i]!
			const stat = stats[i]!
			if (stat.isDirectory()) {
				archive.directory(path, nodePath.basename(path))
			} else {
				archive.file(path, {name: nodePath.basename(path)})
			}
		}

		archive.finalize()
	}

	expressApp.get('/api/files/:action(download|view|thumbnail)', downloadMiddleware)

	const uploadMiddleware = async (request: express.Request, response: express.Response) => {
		const authorized = await checkAuthorization(request)
		if (!authorized) {
			return response.status(401).json({
				error: 'unauthorized',
			})
		}

		// The upload form must contain a `path` field plus any number of file uploads
		let path: string | undefined
		const files = new Array<{path: string; name: string; error?: string}>()
		let responded = false
		const temporary = temporaryDirectory(umbreld.temporaryDirectory)

		// Respond with an error, if any, and the last known state of files
		const respondOnce = (error?: string) => {
			if (responded) return
			responded = true
			if (error) {
				for (const file of files) file.error ??= 'Cancelled due to error'
				logger.error(error)
			}
			response.json({
				error: error ?? null,
				files,
			})
			temporary
				.destroy()
				.catch((error) => logger.error(`Failed to destroy temporary upload directory: ${error.message}`))
		}

		// Parse the upload form and handle form fields and files
		const uploadDirectory = await temporary.create()
		const diskUsage = await getSystemDiskUsage(umbreld)
		const diskFree = diskUsage.size - diskUsage.totalUsed
		const maxFileSize = Math.min(diskFree, 10_000_000_000) // 10GB or free space, whichever is less
		const form = formidable({
			keepExtensions: true,
			allowEmptyFiles: true,
			uploadDir: uploadDirectory,
			minFileSize: 0,
			maxFileSize,
			maxTotalFileSize: maxFileSize,
		})
		form.on('field', (fieldName, value) => {
			if (fieldName !== 'path') return
			path = value
		})
		form.on('fileBegin', (_, file) => {
			const path = file.filepath
			const name = file.originalFilename ?? `upload-${files.length + 1}`
			files.push({path, name, error: checkFilename(name) ? undefined : 'Invalid file name'})
		})
		form.on('end', async () => {
			// Check that the upload path is valid and clean up if it's not
			const checkedPath = path && (await checkPath(path))
			if (!checkedPath) {
				return respondOnce('EPERM: Upload path is invalid')
			}
			// Check that the upload path is a directory
			const checkedPathStats = await fse.stat(checkedPath).catch(() => null)
			if (!checkedPathStats?.isDirectory()) {
				return respondOnce('ENOTDIR: Upload path is not a directory')
			}

			// Move uploaded files to their target locations
			for (const file of files) {
				// Skip files that already errored
				if (file.error) continue
				// Ensure that target paths do not escape the base directory
				let targetPath = await checkPath(nodePath.join(path || '', file.name))
				if (!targetPath) {
					file.error = 'EPERM: Target path is invalid'
					continue
				}
				// Create or overwrite the file if possible
				let targetStats = await fse.stat(targetPath).catch(() => null)
				if (targetStats && !targetStats.isFile()) {
					file.error = 'EISDIR: Target path exists and is not a file'
					continue
				}
				try {
					let targetName = umbreld.files.getFileTargetName(file.name)
					let nextSuffix = 2
					do {
						if (nextSuffix > SUFFIX_SEARCH_MAX_ITERATIONS) {
							throw new Error('Gave up searching for a suffix')
						}
						try {
							await fse.move(file.path, targetPath)
							break
						} catch (error) {
							// Account for fs-extra throwing its own errors
							const isEEXIST =
								(error as Error).message === 'dest already exists.' ||
								(error as NodeJS.ErrnoException).code === 'EEXIST'
							if (!isEEXIST) {
								throw normalizeFsExtraError(error)
							}
							targetName = umbreld.files.getFileTargetName(file.name, nextSuffix++)
							targetPath = nodePath.join(checkedPath, targetName)
						}
					} while (true)
					file.path = targetPath

					// Reuse mode of existing files, otherwise use default mode
					const mode = (targetStats?.mode ?? DEFAULT_FILE_MODE) & 0o777
					await fse.chmod(targetPath, mode).catch((error) => {
						logger.error(`Failed to set mode of '${targetPath}': ${error.message}`)
					})

					// Reuse owner of existing files, otherwise inherit from
					// directory or, if not possible, fall back to default owner
					if (!targetStats) {
						const directoryPath = nodePath.dirname(targetPath)
						targetStats = await fse.stat(directoryPath).catch(() => null)
					}
					const uid = targetStats?.uid ?? DEFAULT_UID
					const gid = targetStats?.gid ?? DEFAULT_GID
					await fse.chown(targetPath, uid, gid).catch((error) => {
						logger.error(`Failed to set owner of '${targetPath}': ${error.message}`)
					})

					logger.log(`Uploaded '${file.name}' to '${targetPath}' (mode=${mode.toString(8)}, uid=${uid}, gid=${gid})`)
				} catch (error) {
					file.error = (error as Error).message
				}
			}
			respondOnce()
		})
		form.parse(request).catch((error) => {
			respondOnce(`Failed to process upload: ${error.message}`)
		})
	}

	expressApp.post('/api/files/upload', uploadMiddleware)
}
