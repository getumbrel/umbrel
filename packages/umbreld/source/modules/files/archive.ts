import archiver from 'archiver'
import fse from 'fs-extra'
import nodePath from 'node:path'
import {pipeline} from 'node:stream/promises'

import {$} from 'execa'

import type Umbreld from '../../index.js'

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
			if (status.isDirectory()) archive.directory(systemPath, nodePath.basename(systemPath))
			else archive.file(systemPath, {name: nodePath.basename(systemPath)})
		}
		archive.finalize()
		return archive
	}

	// Creates a zip archive
	// TODO: There's probably a race condition where creating the same archive twice at the same time
	// will cause the second to overwrite the first. Think of a better way to handle this.
	async createZipFile(virtualPaths: string[]) {
		// Convert virtual paths to system paths
		const systemPaths = await Promise.all(
			virtualPaths.map((virtualPath) => this.#umbreld.files.virtualToSystemPath(virtualPath)),
		)

		// Calculate the zip path
		let zipPath = nodePath.join(nodePath.dirname(systemPaths[0]), this.zipName(systemPaths))
		zipPath = await this.#umbreld.files.getUniqueName(zipPath)

		// Create a zip stream
		// TODO: Add progress reporting
		const zipStream = await this.createZipStream(systemPaths)
		const writeStream = fse.createWriteStream(zipPath)
		await pipeline(zipStream, writeStream)

		// Return virtual path of the zip archive
		return this.#umbreld.files.systemToVirtualPath(zipPath)
	}

	// Creates an archive (alias for createZipFile)
	async archive(virtualPaths: string[]) {
		return this.createZipFile(virtualPaths)
	}

	// Check if the archive format is supported
	isUnarchiveable(path: string) {
		const supportedArchiveFormats = ['.tar.gz', '.tgz', '.tar.bz2', '.tar.xz', '.tar', '.zip', '.7z', '.rar'] as const
		return supportedArchiveFormats.some((format) => path.endsWith(format))
	}

	// Unarchives an archive
	async unarchive(virtualPath: string) {
		// Check if operation is allowed
		const allowedOperations = await this.#umbreld.files.getAllowedOperations(virtualPath)
		if (!allowedOperations.includes('unarchive')) throw new Error('[operation-not-allowed]')

		// Get system path
		const systemPath = await this.#umbreld.files.virtualToSystemPath(virtualPath)

		// Calculate target directory
		const {name} = this.#umbreld.files.splitExtension(systemPath)
		let targetDirectory = nodePath.join(nodePath.dirname(systemPath), name)
		targetDirectory = await this.#umbreld.files.getUniqueName(targetDirectory)

		// Unarchive
		// TODO: Add progress reporting
		await $`unar -force-overwrite -no-directory -output-directory ${targetDirectory} ${systemPath}`

		// Return virtual path of the unarchived files
		return this.#umbreld.files.systemToVirtualPath(targetDirectory)
	}
}
