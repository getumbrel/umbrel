import {constants} from 'node:fs'
import {open} from 'node:fs/promises'

import archiver from 'archiver'
import compressible from 'compressible'
import fse from 'fs-extra'
import mime from 'mime-types'
import nodePath from 'node:path'
import {Readable} from 'node:stream'
import {pipeline} from 'node:stream/promises'

import {$} from 'execa'

import type Umbreld from '../../index.ts'
import {OWNER_USER_ID} from '../user/constants.ts'

type ZipEntryData = archiver.EntryData & {store?: boolean}

export default class Archive {
	#umbreld: Umbreld
	logger: Umbreld['logger']

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(`files:${name.toLocaleLowerCase()}`)
	}

	// No background tasks
	async start() {}
	async stop() {}

	// Get the name for a zip archive based on it's contents
	zipName(files: string[], {defaultName = 'Archive.zip'} = {}) {
		if (files.length === 1) return `${nodePath.basename(files[0])}.zip`
		return defaultName
	}

	// Decide whether to skip ZIP deflate compression for a file.
	// We compress only when the MIME type is known to be compressible.
	// For unknown MIME types, we default to storing without compression
	// to avoid wasted CPU and degraded download performance for binary/media files.
	#shouldSkipCompression(filePath: string): boolean {
		const mimeType = mime.lookup(filePath)
		if (typeof mimeType !== 'string') return true
		return compressible(mimeType) !== true
	}

	// Returns a readable stream of a zip archive from a list of system paths
	async createZipStream(systemPaths: string[]) {
		// Check that all paths are in the same directory
		// This is to avoid collisions in the zip archive
		// e.g:
		// /foo/file.txt
		// /bar/file.txt
		// would result in a zip archive with two files called file.txt
		const directories = systemPaths.map((systemPath) => nodePath.dirname(systemPath))
		const uniqueDirectories = new Set(directories)
		if (uniqueDirectories.size > 1) throw new Error('paths must be in same directory')

		const archive = archiver('zip')
		for (const systemPath of systemPaths) {
			const status = await fse.stat(systemPath)

			if (status.isDirectory()) {
				// For directories, we use a callback to set compression options per file
				archive.directory(systemPath, nodePath.basename(systemPath), (entry) => {
					const zipEntry = entry as ZipEntryData
					if (zipEntry.stats?.isFile() && this.#shouldSkipCompression(zipEntry.name)) zipEntry.store = true
					return zipEntry
				})
			} else {
				// For files, we set compression options directly
				const options: ZipEntryData = {name: nodePath.basename(systemPath)}
				if (this.#shouldSkipCompression(systemPath)) options.store = true
				archive.file(systemPath, options)
			}
		}

		// We convert any finalize rejection to a stream error so callers can handle it.
		archive.finalize().catch((error) => archive.emit('error', error))
		return archive
	}

	// Photos selections may span unrelated folders. Flatten those files into
	// one archive and disambiguate repeated basenames without exposing source
	// directory structure.
	async createFlatFileZipStream(systemPaths: string[]) {
		const archive = archiver('zip')
		const usedNames = new Set<string>()
		for (const systemPath of systemPaths) {
			const status = await fse.stat(systemPath)
			if (!status.isFile()) throw new Error('photos archive entries must be files')
			const name = uniqueArchiveName(nodePath.basename(systemPath), usedNames)
			archive.file(systemPath, {name, ...(this.#shouldSkipCompression(systemPath) ? {store: true} : {})})
		}
		archive.finalize().catch((error) => archive.emit('error', error))
		return archive
	}

	// Photos selections can span folders, but every byte must remain tied to a
	// descriptor opened and authorized for this account. Each lazy source holds
	// only its own descriptor while Archiver consumes it, avoiding both path
	// reopen races and an O(selection) descriptor burst. Archiver dates a
	// stream entry when it is queued, before its file is opened, so the caller
	// supplies each file's modification time; without one the entry would be
	// dated by the download.
	async createAuthorizedFlatFileZipStream(files: Array<{virtualPath: string; modifiedMs?: number}>, userId: string) {
		const archive = archiver('zip')
		const usedNames = new Set<string>()
		const sources: Readable[] = []
		for (const {virtualPath, modifiedMs} of files) {
			const name = uniqueArchiveName(nodePath.posix.basename(virtualPath), usedNames)
			const source = Readable.from(
				(async function* (umbreld: Umbreld) {
					const file = await umbreld.files.openFileForRead(virtualPath, userId)
					try {
						for await (const chunk of file.handle.createReadStream({autoClose: false})) yield chunk
					} finally {
						await file.handle.close().catch(() => {})
					}
				})(this.#umbreld),
			)
			sources.push(source)
			archive.append(source, {
				name,
				...(modifiedMs !== undefined && modifiedMs > 0 ? {date: new Date(modifiedMs)} : {}),
				...(this.#shouldSkipCompression(virtualPath) ? {store: true} : {}),
			})
		}
		// Archiver never destroys its sources, so a cancelled download would leave
		// their descriptors open until garbage collection, which kills the process
		// on Node.js 25+. Destroying a source closes its descriptor via the finally.
		archive.once('close', () => sources.forEach((source) => source.destroy()))
		archive.finalize().catch((error) => archive.emit('error', error))
		return archive
	}

	// Creates a zip archive
	// Concurrent attempts can calculate the same archive name. Reserve the
	// output with O_EXCL and retry instead of allowing one to overwrite another.
	async createZipFile(virtualPaths: string[], userId: string = OWNER_USER_ID) {
		virtualPaths = virtualPaths.map((virtualPath) => this.#umbreld.files.normalizeVirtualPath(virtualPath))

		// Convert virtual paths to system paths (authorized against the requesting account)
		const systemPaths = await Promise.all(
			virtualPaths.map((virtualPath) => this.#umbreld.files.virtualToSystemPath(virtualPath, userId)),
		)

		// Reserve a unique authorized output without following links. The initial
		// lstat-based name selection handles existing dangling symlinks; O_EXCL
		// closes the race between selecting and opening the path.
		const baseZipPath = nodePath.join(nodePath.dirname(systemPaths[0]), this.zipName(systemPaths))
		let zipPath = ''
		let zipFile: Awaited<ReturnType<typeof open>> | undefined
		for (let attempt = 0; attempt < 100; attempt++) {
			const uniqueZipPath = await this.#umbreld.files.getUniqueName(baseZipPath)
			const authorizedZipPath = await this.#umbreld.files.authorizeWritableDestinationSystemPath(uniqueZipPath, userId)
			try {
				zipFile = await open(
					authorizedZipPath,
					constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
					0o600,
				)
				zipPath = authorizedZipPath
				break
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
			}
		}
		if (!zipFile) throw new Error('[unique-name-index-exceeded]')

		let complete = false
		try {
			// Create a zip stream
			// TODO: Add progress reporting
			const zipStream = await this.createZipStream(systemPaths)
			const writeStream = zipFile.createWriteStream()
			zipFile = undefined
			await pipeline(zipStream, writeStream)
			complete = true
			await this.#umbreld.files.chownSystemPath(zipPath).catch(() => {})
		} finally {
			await zipFile?.close().catch(() => {})
			if (!complete) await fse.remove(zipPath).catch(() => {})
		}

		void this.#umbreld.files.fileIndex
			.reconcilePath(zipPath)
			.catch((error) => this.logger.error(`Failed to index archive '${zipPath}'`, error))

		// Return virtual path of the zip archive
		return this.#umbreld.files.systemToVirtualPath(zipPath)
	}

	// Creates an archive (alias for createZipFile)
	async archive(virtualPaths: string[], userId: string = OWNER_USER_ID) {
		return this.createZipFile(virtualPaths, userId)
	}

	// Check if the archive format is supported
	isUnarchiveable(path: string) {
		const supportedArchiveFormats = ['.tar.gz', '.tgz', '.tar.bz2', '.tar.xz', '.tar', '.zip', '.7z', '.rar'] as const
		return supportedArchiveFormats.some((format) => path.endsWith(format))
	}

	// Unarchives an archive
	async unarchive(virtualPath: string, userId: string = OWNER_USER_ID) {
		// Authorize before consulting Cloud-aware advisory operations.
		const systemPath = await this.#umbreld.files.virtualToSystemPath(virtualPath, userId)

		// Check if operation is allowed
		const allowedOperations = await this.#umbreld.files.getAllowedOperations(virtualPath, userId)
		if (!allowedOperations.includes('unarchive')) {
			await this.#umbreld.files.assertCloudMutablePath(virtualPath, userId)
			throw new Error('[operation-not-allowed]')
		}

		// The archive is extracted next to itself, so authorize the containing directory.
		await this.#umbreld.files.virtualToSystemPath(nodePath.posix.dirname(virtualPath), userId)

		// Calculate target directory
		const {name} = this.#umbreld.files.splitExtension(systemPath)
		let targetDirectory = nodePath.join(nodePath.dirname(systemPath), name)
		targetDirectory = await this.#umbreld.files.getUniqueName(targetDirectory)
		targetDirectory = await this.#umbreld.files.authorizeWritableDestinationSystemPath(targetDirectory, userId)

		// Unarchive
		// TODO: Add progress reporting
		await $`unar -force-overwrite -no-directory -output-directory ${targetDirectory} ${systemPath}`
		void this.#umbreld.files.fileIndex
			.reconcilePath(targetDirectory)
			.catch((error) => this.logger.error(`Failed to index extracted archive '${targetDirectory}'`, error))

		// Return virtual path of the unarchived files
		return this.#umbreld.files.systemToVirtualPath(targetDirectory)
	}
}

function uniqueArchiveName(name: string, usedNames: Set<string>) {
	if (!usedNames.has(name)) {
		usedNames.add(name)
		return name
	}
	const extension = nodePath.extname(name)
	const stem = nodePath.basename(name, extension)
	for (let suffix = 2; ; suffix++) {
		const candidate = `${stem} (${suffix})${extension}`
		if (usedNames.has(candidate)) continue
		usedNames.add(candidate)
		return candidate
	}
}
