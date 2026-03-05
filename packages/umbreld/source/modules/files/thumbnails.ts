import nodePath from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'

import fse from 'fs-extra'
import {$} from 'execa'
import PQueue from 'p-queue'
import {debounce, type DebouncedFunction} from 'es-toolkit'

import type Umbreld from '../../index.js'
import type {FileChangeEvent} from './watcher.js'
import {getDirectoryStream} from './files.js'

// TODO: Add support for .heic files
// ImageMagick 6.9.11-60 (latest version available in Debian apt repos) supports older heic files but does not support more recent heic files which are now common on most devices
const SUPPORTED_THUMBNAIL_EXTENSIONS = [
	// Image formats
	'.webp',
	'.png',
	'.jpg',
	'.jpeg',
	'.gif',
	'.avif',
	// Video formats
	'.mkv',
	'.mov',
	'.mp4',
	'.3gp',
	'.avi',
]

export default class Thumbnails {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	thumbnailDirectory: string
	// Maximum number of thumbnails to keep on disk
	maxThumbnailCount = 100000
	// Trigger cleanup when this many new thumbnails are generated; counter resets after cleanup
	pruningThreshold = 1000
	thumbnailsSinceLastPruning = 0
	// Thumbnail properties - optimized for UI display sizes (20px list view, 56px icons view)
	// 112px = 2x the largest UI size for high-DPI displays; 75% quality balances size/quality for webp
	width = 112
	height = 112
	quality = 75
	format = 'webp'
	// The queue for background thumbnail generation that occurs on file change
	backgroundQueue = new PQueue({concurrency: 1})
	// The queue for on-demand thumbnail generation.
	// We use a concurrency equal to the number of CPU threads to generate thumbnails relatively quickly without overloading the CPU
	onDemandQueue = new PQueue({concurrency: os.cpus().length})
	// The queue for filesystem UUID lookup requests
	filesystemUuidQueue = new PQueue({concurrency: 1})
	deviceIdtoUuidMap = new Map<number, string>()
	// Map to store debounced background thumbnail tasks per filepath
	#backgroundThumbnailDebouncers = new Map<string, DebouncedFunction<() => Promise<void>>>()
	#removeFileChangeListener?: () => void
	#removeDiskChangeListener?: () => void
	#isPruning = false

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(`files:${name.toLowerCase()}`)
		this.thumbnailDirectory = `${umbreld.dataDirectory}/thumbnails`
	}

	async start() {
		this.logger.log('Starting thumbnails')

		// Ensure thumbnail directory exists
		await fse.ensureDir(this.thumbnailDirectory).catch((error) => {
			this.logger.error(`Failed to ensure directory '${this.thumbnailDirectory}' exists`, error)
		})

		// TODO: Enable PDF support in ImageMagick in a safe way

		// Initial non-blocking cleanup on startup
		this.#pruneOldestThumbnails()

		// Attach listener for file changes
		this.#removeFileChangeListener = this.#umbreld.eventBus.on(
			'files:watcher:change',
			this.#handleFileChange.bind(this),
		)

		// Attach disk change listener so the UUID cache is cleared when a disk is mounted
		this.#removeDiskChangeListener = this.#umbreld.eventBus.on('system:disk:change', () =>
			this.deviceIdtoUuidMap.clear(),
		)
	}

	// The debounced background thumbnail generation task for a given systemPath.
	// Uses #backgroundThumbnailDebouncers map for per-path debouncing.
	// Calling this ensures the actual #generateThumbnail task runs only after 1 second of file change inactivity for the path.
	// This avoids rapid regeneration of invalid files while they are in the process of being written.
	// Includes self-cleanup from the map.
	#debouncedGenerateThumbnail(systemPath: string): void {
		let debouncer = this.#backgroundThumbnailDebouncers.get(systemPath)

		if (!debouncer) {
			const generateThumbnailAndCleanup = async () => {
				// Destroy the debouncer now that it's fired to avoid memory leaks
				this.#backgroundThumbnailDebouncers.delete(systemPath)

				// Generate the thumbnail
				await this.#generateThumbnail(systemPath, {background: true}).catch((error) => {
					// We catch errors here to prevent unhandled rejections, since this debounced function runs later and outside the original call context.
					this.logger.error(`Failed to generate thumbnail for ${systemPath}`, error)
				})
			}

			// Create a debounced version with a 1-second delay
			debouncer = debounce(generateThumbnailAndCleanup, 1000)

			// Store the debouncer in the map by file path
			this.#backgroundThumbnailDebouncers.set(systemPath, debouncer)
		}

		this.logger.verbose(`Debouncing thumbnail generation for ${systemPath}`)
		debouncer()
	}

	// Handle file change events from watcher
	async #handleFileChange(event: FileChangeEvent) {
		const systemPath = event.path

		// Skip directories and file types that are not supported for thumbnails
		if (!(await this.#isValidFileForThumbnail(systemPath))) return

		// Only handle create and update events
		// We don't need to handle delete events. We could explicitly remove the thumbnail here, but the LRU cleanup job will remove the thumbnail eventually.
		// We don't need to handle rename or move events because we name the thumbnail based on the file's inode, filesystem ID, and date modified, which don't change when the file is renamed or moved.
		if (event.type === 'create' || event.type === 'update') {
			// Generate the thumbnail in the background queue
			// We use a debouncer to prevent multiple thumbnail creations for the same file when it is being actively written to (e.g., during upload, unarchiving, etc)
			this.#debouncedGenerateThumbnail(systemPath)
		}
	}

	// Check if a file type is supported for thumbnails
	async #isValidFileForThumbnail(systemPath: string): Promise<boolean> {
		// Check if file has a supported extension
		const ext = nodePath.extname(systemPath).toLowerCase()
		if (!SUPPORTED_THUMBNAIL_EXTENSIONS.includes(ext)) return false

		// Sanity check to make sure it exists and is actually a file (not a directory)
		const stats = await fse.stat(systemPath).catch(() => null)
		return Boolean(stats?.isFile())
	}

	// Gets the unique, persistent identifier for the filesystem that contains a file
	// This will not change across reboots or device reassignments
	// We return an empty string for filesystems that don't support a uuid (e.g., docker bind mounts, fs overlays, network shares)
	async getFilesystemUuid(systemPath: string, deviceId: number): Promise<string> {
		// If we have a cached UUID for this device, return it
		const cachedUuid = this.deviceIdtoUuidMap.get(deviceId)
		if (cachedUuid) return cachedUuid

		// If we don't have a cached UUID, we need to get the UUID for the filesystem.
		// This is added to a queue to prevent spawning too many processes in parallel.
		const {stdout} = await this.filesystemUuidQueue.add(
			() => $`findmnt --noheadings --output UUID --target ${systemPath}`,
		)

		// We set uuid to the actual UUID if it was found or an empty string if the filesystem doesn't support a uuid
		// If no uuid is found, stdout will already be an empty string
		const uuid = stdout.trim()

		// Cache the UUID for this device
		// If no uuid is found, this will cache an empty string as the value
		this.deviceIdtoUuidMap.set(deviceId, uuid)

		return uuid
	}

	// Returns a hash from a combination of source file metadata that we can use as a unique thumbnail filename
	async getThumbnailHash(systemPath: string): Promise<string> {
		// Get source file's metadata
		const stats = await fse.stat(systemPath)

		// Get the numeric identity of the device where the file is stored
		// This value can change across system reboots or device reassignments so we can't use it directly as a persistent identifier
		const deviceId = stats.dev

		// Convert the device ID to a persistent filesystem UUID
		// This UUID stays the same regardless of how the filesystem is mounted (i.e., it is consistent across system reboots and device reassignments)
		const uuid = await this.getFilesystemUuid(systemPath, deviceId)

		// Create a unique identifier by combining:
		// - The filesystem's UUID (stays consistent across reboots and device reassignments)
		// - The file's inode number (stays the same if moved/renamed on same filesystem)
		// - The file's modification time (changes when content is modified)
		const identifier = `${uuid}-${stats.ino}-${stats.mtime.getTime()}`

		const hash = crypto.createHash('sha256').update(identifier).digest('hex')

		return hash
	}

	// Get thumbnail system path for a file by its hash
	hashToThumbnailSystemPath(hash: string): string {
		const filename = `${hash}.${this.format}`
		const systemPath = nodePath.normalize(nodePath.join(this.thumbnailDirectory, filename))

		return systemPath
	}

	// TODO: Look into using sharp instead of ImageMagick for performance gains at the possible cost of simplicity
	// Generate a thumbnail for a file
	async #generateThumbnail(systemPath: string, {background = true}: {background?: boolean} = {}): Promise<string> {
		const hash = await this.getThumbnailHash(systemPath)

		// Check if thumbnail already exists
		// If it does, it means we don't need to generate a new one
		const thumbnailSystemPath = this.hashToThumbnailSystemPath(hash)
		if (await fse.pathExists(thumbnailSystemPath)) return hash

		// Process through a queue to prevent spawning too many thumbnail generation processes in parallel
		// We use the background queue for file watcher events and the on-demand queue for explicit requests
		const queue = background ? this.backgroundQueue : this.onDemandQueue

		// Passing [0] to ImageMagick selects only the first frame/page (videos, PDFs, etc.)
		// This flag is ignored for regular images, so we always include it for simplicity
		await queue.add(async () => {
			this.logger.verbose(`Generating thumbnail for ${systemPath}`)
			await $`convert ${systemPath}[0] -resize ${this.width}x${this.height} -quality ${this.quality} -auto-orient ${thumbnailSystemPath}`
		})

		// Count generated thumbnails and trigger cleanup if needed
		// Cleanup is non-blocking and will run in the background
		this.thumbnailsSinceLastPruning++
		if (this.thumbnailsSinceLastPruning >= this.pruningThreshold) {
			this.thumbnailsSinceLastPruning = 0
			this.#pruneOldestThumbnails()
		}

		return hash
	}

	// Gets a thumbnail hash for a file on demand (generating a thumbnail if needed)
	// This is used by the files.getThumbnail() trpc endpoint
	async getThumbnailOnDemand(virtualPath: string): Promise<string> {
		// First validate the path and check if thumbnail type is supported
		const systemPath = await this.#umbreld.files.virtualToSystemPath(virtualPath)
		if (!(await this.#isValidFileForThumbnail(systemPath))) {
			throw new Error(`Unsupported file type for thumbnail: ${nodePath.extname(virtualPath).toLowerCase()}`)
		}

		// Generate the thumbnail in the on-demand queue
		const hash = await this.#generateThumbnail(systemPath, {background: false})

		// Return the relative api endpoint URL of the thumbnail
		return `/api/files/thumbnail/${hash}.${this.format}`
	}

	// Get an existing thumbnail if it exists, without generating a new one
	// This is used by this.umbreld.files.status() to attach an existing thumbnail to a file (as an api endpoint URL)
	// We pass in a safe system path from files.status()
	async getExistingThumbnail(systemPath: string): Promise<string | undefined> {
		// Check if thumbnail type is supported
		if (!(await this.#isValidFileForThumbnail(systemPath))) return undefined

		// Return undefined if no thumbnail exists
		const hash = await this.getThumbnailHash(systemPath)
		const thumbnailSystemPath = this.hashToThumbnailSystemPath(hash)
		const exists = await fse.pathExists(thumbnailSystemPath)
		if (!exists) return undefined

		// We set the thumbnail's date modified to the current time to bump it in the LRU cache
		const now = new Date()
		await fse.utimes(thumbnailSystemPath, now, now).catch((error) => {
			// Even if updating the date modified fails, the thumbnail is still valid and we should return the hash
			this.logger.error(`Failed to touch thumbnail ${thumbnailSystemPath}`, error)
		})

		// Return the relative api endpoint URL of the thumbnail
		return `/api/files/thumbnail/${hash}.${this.format}`
	}

	// Delete oldest thumbnails if we exceed the maxThumbnailCount
	async #pruneOldestThumbnails(): Promise<void> {
		// Skip if a pruning operation is already in progress
		if (this.#isPruning) return

		try {
			this.#isPruning = true
			this.logger.log('Pruning oldest thumbnails')

			const thumbnails: {path: string; mtime: number}[] = []
			let initialThumbnailCount = 0

			// We open an async iterator to the thumbnails directory so we can stream a large directory and not process the entire directory in memory all at once
			for await (const thumbnailPath of getDirectoryStream(this.thumbnailDirectory)) {
				initialThumbnailCount++

				// stat each file serially
				const stats = await fse.stat(thumbnailPath).catch((error) => {
					this.logger.error(`Failed to stat thumbnail ${thumbnailPath}`, error)

					// If we can't stat a file, we can't process it.
					return undefined
				})

				if (!stats) continue
				thumbnails.push({path: thumbnailPath, mtime: stats.mtime.getTime()})
			}

			// Skip pruning if we are under the maxThumbnailCount
			// We can't check this until we've streamed the entire directory. So we need to do the relatively expensive stat() for each file, but we'll skip the blocking sort() and the removal task if we're under the limit.
			if (initialThumbnailCount <= this.maxThumbnailCount) {
				this.logger.log(
					`Thumbnail cache has ${initialThumbnailCount}/${this.maxThumbnailCount} thumbnails. No pruning needed`,
				)
				// The outer 'finally' block will still set #isPruning = false.
				return
			}

			// Sort successfully stat'd thumbnails by modification time (oldest first)
			thumbnails.sort((a, b) => a.mtime - b.mtime)

			// Calculate how many we need to remove based on the initial count vs. the limit
			const excessCount = initialThumbnailCount - this.maxThumbnailCount
			let filesRemoved = 0

			// Remove oldest thumbnails (from the successfully stat-ed list) until we're under the limit
			// Iterate up to excessCount, but stop if we run out of stat-ed thumbnails
			for (let i = 0; i < excessCount && i < thumbnails.length; i++) {
				const thumbnail = thumbnails[i]
				try {
					await fse.remove(thumbnail.path)
					filesRemoved++
				} catch (error) {
					this.logger.error(`Failed to remove thumbnail ${thumbnail.path}`, error)
				}
			}

			this.logger.log(
				`Removed ${filesRemoved} thumbnails. The thumbnail cache is now at ${initialThumbnailCount - filesRemoved}/${this.maxThumbnailCount}`,
			)
		} catch (error) {
			// We just log and don't rethrow here
			this.logger.error(`Failed to clean up thumbnails`, error)
		} finally {
			// We reset the pruning flag regardless of whether the operation succeeded or failed
			this.#isPruning = false
		}
	}

	// Remove listeners
	// Any queued thumbnail generations will be cancelled. These would be generated on-demand in the future or in the background if the file were to be modified again.
	async stop() {
		this.logger.log('Stopping thumbnails')
		this.#removeFileChangeListener?.()
		this.#removeDiskChangeListener?.()

		// Cancel debounced background thumbnail tasks
		this.#backgroundThumbnailDebouncers.forEach((debouncer) => debouncer.cancel())
	}
}
