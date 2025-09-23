import nodePath from 'node:path'

import PQueue from 'p-queue'
import fse from 'fs-extra'
import {debounce} from 'es-toolkit'

import type Umbreld from '../../index.js'

import type {FileChangeEvent} from './watcher.js'

export default class Recents {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	#removeFileChangeListener?: () => void
	// Debounce the write to disk to prevent excessive writes when many events are triggered
	#debouncedWrite = debounce(this.#directWrite.bind(this), 1000)
	recentFiles: string[] = []
	maxRecents = 50
	paths: string[]
	queue = new PQueue({concurrency: 1})

	constructor(umbreld: Umbreld, {paths}: {paths: string[]}) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(`files:${name.toLocaleLowerCase()}`)
		this.paths = paths
	}

	// Add listener
	async start() {
		this.logger.log('Starting recents')

		// Read recent files from disk and set initial value if undefined
		// TODO: This should really be stored in a proper database.
		// Migrate this to SQLite once we have it. Or ideally query this
		// directly from a live filesystem index.
		this.recentFiles = await this.#umbreld.store.get('files.recents')
		if (this.recentFiles === undefined) {
			this.logger.log('Creating initial recents entry in store')
			this.recentFiles = []
			await this.#umbreld.store.set('files.recents', this.recentFiles)
		}

		// Attach listener
		this.#removeFileChangeListener = this.#umbreld.eventBus.on(
			'files:watcher:change',
			this.#handleFileChange.bind(this),
		)
	}

	// Get recents
	async get() {
		const recents = await Promise.all(
			this.recentFiles.map(async (virtualPath) => {
				const systemPath = await this.#umbreld.files.virtualToSystemPath(virtualPath)
				return this.#umbreld.files.status(systemPath).catch(() => undefined)
			}),
		)

		// Filter out any files that don't exist
		const filteredRecents = recents.filter((file) => file !== undefined)

		return filteredRecents
	}

	// Write recents
	async #directWrite() {
		await this.#umbreld.store.set('files.recents', this.recentFiles)
	}

	// Handle file change
	async #handleFileChange(event: FileChangeEvent) {
		// Pipe through a queue to ensure we handle events in order
		return this.queue
			.add(async () => {
				// Calculate paths
				const systemPath = event.path
				const path = this.#umbreld.files.systemToVirtualPath(systemPath)

				// Ignore files outside of the watched paths
				const isWatched = this.paths.some((watchedPath) => path.startsWith(`${watchedPath}/`))
				if (!isWatched) return

				// Ignore hidden files
				if (this.#umbreld.files.isHidden(nodePath.basename(path))) return

				// Ignore files in the backups directory
				if (path.includes(`/${this.#umbreld.backups.backupDirectoryName}/`)) return

				// Remove the path from the list if it exists
				// This is to prevent duplicates when adding or to remove with a deletion
				this.recentFiles = this.recentFiles.filter((item) => item !== path)

				// Add the path back to the beginning of the list if it's an update or create
				if (['update', 'create'].includes(event.type)) {
					// Check file is not a directory or non standard file type
					const stats = await fse.stat(systemPath)
					if (!stats.isFile()) return

					this.recentFiles.unshift(path)
				}

				// Keep the list at maxRecents length
				this.recentFiles = this.recentFiles.slice(0, this.maxRecents)

				// Write the recent files to disk
				this.#debouncedWrite()
			})
			.catch((error) => this.logger.error(`Failed to handle file change`, error))
	}

	// Remove listener
	async stop() {
		this.logger.log('Stopping recents')
		this.#removeFileChangeListener?.()
		this.#debouncedWrite.cancel()
		await this.#directWrite()
	}
}
