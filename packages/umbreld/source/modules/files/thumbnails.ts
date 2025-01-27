import nodePath from 'node:path'
import {createHash} from 'node:crypto'

import fse from 'fs-extra'
import {$} from 'execa'

import type Umbreld from '../../index.js'
import PQueue from 'p-queue'

/** Maximum thumbnail width. */
const width = 104
/** Maximum thumbnail height. */
const height = 104
/** Thumbnail format. */
const format = 'webp'
/** Thumbnail quality. */
const quality = 70
/** Generator concurrency. */
const concurrency = 1
/** Supported image extensions. */
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.heic'])
/** Supported video extensions. */
const videoExtensions = new Set(['.mov', '.mp4', '.3gp', '.mkv', '.avi'])
/** Maximum number of thumbnails to maintain. */
const maxThumbnails = 10000
/** Threshold for pruning old thumbnails when exceeding maxThumbnails. */
const pruneThreshold = 1000

const queue = new PQueue({concurrency})

class Thumbnails {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	thumbnailsDirectory: string
	running: boolean = false
	thumbnails = new Map<string, Date>()

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLocaleLowerCase())
		this.thumbnailsDirectory = `${umbreld.dataDirectory}/thumbnails`
	}

	async start() {
		this.logger.log(`Starting thumbnails`)
		this.running = true

		// Make sure that the thumbnails directory exists
		await fse.ensureDir(this.thumbnailsDirectory, {mode: 0o755})

		// Rebuild the internal map of managed thumbnails. The map is keyed by the
		// thumbnail name and the value is the last time the source was accessed,
		// which is remembered as the thumbnail's modification time.
		const dir = await fse.opendir(this.thumbnailsDirectory)
		const nameExpression = new RegExp(`^[0-9a-z]{64}\\.${format}$`)
		this.thumbnails.clear()
		for await (const dirent of dir) {
			const thumbnailName = dirent.name
			const thumbnailPath = nodePath.join(this.thumbnailsDirectory, thumbnailName)
			const thumbnailStats = await fse.stat(thumbnailPath).catch(() => null)
			if (!thumbnailStats?.isFile() || !nameExpression.test(thumbnailName)) {
				continue
			}
			this.thumbnails.set(thumbnailName, thumbnailStats.mtime)
		}
		if (!this.thumbnails.size) {
			// When we don't have any thumbnails yet, scan existing files in the
			// background and ensure that the cache is filled up with thumbnails for
			// the most recently modified files present in base directories. Does
			// nothing for new installs, but is useful for existing installs where
			// there are existing media files in `data/storage/`.
			this.logger.log(`No thumbnails yet, populating the cache...`)
			this.populateCache().catch((error) => this.logger.error(`Failed to scan for most recent files: ${error.message}`))
		} else {
			// Prune old thumbnails in the background
			this.logger.log(`Found ${this.thumbnails.size} thumbnails`)
			this.maybePrune().catch((error) => this.logger.error(`Failed to prune old thumbnails: ${error.message}`))
		}

		// Watch for filesystem changes
		const {watcher} = this.#umbreld.files
		watcher.addListener('create', this.#change)
		watcher.addListener('update', this.#change)
		watcher.addListener('delete', this.#delete)
	}

	async stop() {
		this.logger.log(`Stopping thumbnails`)
		this.running = false

		// Stop watching for filesystem changes
		const {watcher} = this.#umbreld.files
		watcher.removeListener('create', this.#change)
		watcher.removeListener('update', this.#change)
		watcher.removeListener('delete', this.#delete)

		this.thumbnails.clear()
	}

	#change = async (path: string) => await this.access(path, false)

	#delete = async (path: string) => {
		const thumbnailName = getThumbnailName(path)
		if (!this.thumbnails.delete(thumbnailName)) return
		this.logger.verbose(`Deleted thumbnail of '${path}' (${this.thumbnails.size} thumbnails)`)
		const thumbnailPath = nodePath.join(this.thumbnailsDirectory, thumbnailName)
		await fse.unlink(thumbnailPath).catch(() => {})
	}

	get(path: string) {
		const thumbnailName = getThumbnailName(path)
		return nodePath.join(this.thumbnailsDirectory, thumbnailName)
	}

	async access(path: string, updateTime = true) {
		// Skip files that don't have a supported extension
		const extension = nodePath.extname(path).toLowerCase()
		const isImage = imageExtensions.has(extension)
		const isVideo = !isImage && videoExtensions.has(extension)
		if (!isImage && !isVideo) return

		// Check that the source file exists
		const stats = await fse.stat(path).catch(() => null)
		if (!stats?.isFile()) return

		// Check if the thumbnail needs to be (re-)generated. A thumbnail needs to
		// be (re-)generated when it doesn't exist yet or when its modification
		// time is older than the source file's last modification time.
		const thumbnailName = getThumbnailName(path)
		const thumbnailTime = this.thumbnails.get(thumbnailName) ?? null
		const thumbnailPath = nodePath.join(this.thumbnailsDirectory, thumbnailName)
		const accessTime = new Date()
		const shouldGenerate = !thumbnailTime || Math.ceil(thumbnailTime.getTime()) < Math.floor(stats.mtimeMs)
		if (shouldGenerate) {
			try {
				await queue.add(() => generateThumbnail(path, thumbnailPath))
			} catch (error) {
				// It's possible that there are a bunch of files we can't generate a
				// thumbnail for, hence we don't log errors during production here.
				// If the file previously had a thumbnail already, we keep it.
				this.logger.verbose(`Failed to generate thumbnail of '${path}': ${(error as Error).message}`)
				return
			}
			this.thumbnails.set(thumbnailName, accessTime)
			this.logger.verbose(`Generated thumbnail of '${path}' (${this.thumbnails.size} thumbnails)`)

			// It's possible that the source file has been modified while we were
			// generating its thumbnail, so set the modification time to when we
			// decided to generate the new thumbnail to aid future comparisons.
			await fse
				.utimes(thumbnailPath, accessTime, accessTime)
				.catch((error) => this.logger.error(`Failed to set access time on thumbnail of '${path}': ${error.message}`))

			// Prune old thumbnails in the background when exceeding the limit
			this.maybePrune().catch((error) => this.logger.error(`Failed to prune thumbnails: ${error.message}`))
		} else {
			const shouldRefresh = updateTime && this.thumbnails.has(thumbnailName)
			if (shouldRefresh) {
				this.thumbnails.set(thumbnailName, accessTime)
				this.logger.verbose(`Refreshed thumbnail of '${path}' (${this.thumbnails.size} thumbnails)`)

				// Touch the thumbnail to remember the file's access time over restarts
				await fse
					.utimes(thumbnailPath, accessTime, accessTime)
					.catch((error) =>
						this.logger.error(`Failed to update access time on thumbnail of '${path}': ${error.message}`),
					)
			}
		}
	}

	async maybePrune() {
		const limitExceeded = this.thumbnails.size >= maxThumbnails + pruneThreshold
		if (!limitExceeded) return

		this.logger.log(`Pruning old thumbnails...`)

		// Sort the internal map by access time and prune the oldest thumbnails
		const thumbnailsToPrune = [...this.thumbnails.entries()]
			.sort((a, b) => b[1].getTime() - a[1].getTime())
			.slice(maxThumbnails)
		let pruned = 0
		for (const [thumbnailName, time] of thumbnailsToPrune) {
			if (!this.running) return
			const currentTime = this.thumbnails.get(thumbnailName)
			// Pruning is performed in the background, so thumbnails may have
			// been concurrently deleted or accessed. Skip these cases.
			if (!currentTime || currentTime.getTime() > time.getTime()) continue
			this.thumbnails.delete(thumbnailName)
			const thumbnailPath = nodePath.join(this.thumbnailsDirectory, thumbnailName)
			await fse.unlink(thumbnailPath).catch(() => {})
			pruned += 1
		}
		if (!this.running) return
		this.logger.log(`Pruned ${pruned} thumbnails (${this.thumbnails.size} thumbnails)`)
	}

	async populateCache() {
		// Scan for image and video files in base directories and keep track of the
		// most recently modified files found.
		const mostRecent: {path: string; time: number}[] = []
		const scanner = this.#umbreld.files.watcher.scan()
		let scannedFiles = 0
		for await (const {path, dirent} of scanner) {
			if (!this.running) break

			// Skip non-files
			if (!dirent.isFile()) continue

			// Skip files that don't have a supported extension
			const ext = nodePath.extname(dirent.name).toLowerCase()
			if (!(imageExtensions.has(ext) || videoExtensions.has(ext))) continue

			// Skip inexistent or inaccessible files
			const stats = await fse.stat(path).catch(() => null)
			if (!stats?.isFile()) continue

			scannedFiles += 1

			// Determine the file's update time and skip it if it's older than
			// the least recent file when the limit has already been reached.
			const time = Math.floor(stats.mtimeMs)
			if (mostRecent.length >= maxThumbnails) {
				const oldestTime = mostRecent[mostRecent.length - 1].time
				if (time <= oldestTime) continue
			}

			// Perform a binary search, insert the file and pop the oldest file
			// when the limit is exceeded.
			const index = findInsertionIndexDescending(mostRecent, time)
			mostRecent.splice(index, 0, {path, time})
			if (mostRecent.length > maxThumbnails) mostRecent.pop()
		}

		// Generate thumbnails for the most recent files we've found, but only
		// until the cache has been filled up as we don't want to supersede more
		// recent thumbnails that have been generated in the meantime. It's
		// possible that there are less than maxThumbnails managed thumbnails
		// afterwards when some thumbnails fail to generate, but we assume that
		// it will be close enough to the limit.
		let populated = 0
		for (const {path} of mostRecent) {
			if (!this.running) return
			if (this.thumbnails.size >= maxThumbnails) break
			await this.access(path, /* updateTime */ false)
			populated += 1
		}

		if (!this.running) return
		this.logger.log(`Populated cache with ${populated} thumbnails (${this.thumbnails.size} thumbnails)`)
	}

	async pollThumbnail(virtualPath: string) {
		virtualPath = this.#umbreld.files.validateVirtualPath(virtualPath)
		const path = await this.#umbreld.files.mapVirtualToSystemPath(virtualPath)
		const thumbnailName = getThumbnailName(path)
		const thumbnailTime = this.thumbnails.get(thumbnailName)?.toISOString() ?? null
		return {path: virtualPath, time: thumbnailTime ?? null}
	}

	async pollThumbnails(virtualPaths: string[]) {
		return await Promise.all(virtualPaths.map((path) => this.pollThumbnail(path)))
	}
}

export default Thumbnails

async function generateThumbnail(path: string, thumbnailPath: string) {
	await $`convert ${path}[0] -resize ${width}x${height} -quality ${quality} -auto-orient ${format}:${thumbnailPath}`
}

function getThumbnailName(path: string) {
	const hash = createHash('sha256').update(path).digest('hex')
	return `${hash}.${format}` // doesn't harm to give it an extension for inspection
}

function findInsertionIndexDescending(files: {time: number}[], time: number): number {
	let low = 0
	let high = files.length
	while (low < high) {
		const mid = (low + high) >>> 1
		if (files[mid].time > time) low = mid + 1
		else high = mid
	}
	return low
}
