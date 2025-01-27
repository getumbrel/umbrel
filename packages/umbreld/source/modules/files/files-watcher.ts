import {EventEmitter} from 'node:events'
import nodePath from 'node:path'

import watcher from '@parcel/watcher'
import fse from 'fs-extra'

import type Umbreld from '../../index.js'

class FilesWatcher extends EventEmitter {
	#umbreld: Umbreld
	subscriptions: Map<string, watcher.AsyncSubscription> = new Map()
	logger: Umbreld['logger']

	constructor(umbreld: Umbreld) {
		super()
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLocaleLowerCase())
	}

	async start() {
		await this.reload()
	}

	async reload() {
		const directories = [...this.#umbreld.files.baseDirectories.keys()].filter(
			(path) => path !== this.#umbreld.files.trashDirectory && path !== this.#umbreld.files.appsDirectory,
		)
		await this.watch(directories)
	}

	async stop() {
		await this.watch([])
	}

	async watch(directories: string[]) {
		// Start watching new directories
		for (const directory of directories) {
			if (this.subscriptions.has(directory)) {
				continue
			}
			const subscription = await watcher
				.subscribe(directory, (err, events) => {
					if (err) {
						this.subscriptions.delete(directory)
						this.logger.error(`Failed to watch directory '${directory}': ${err.message}`)
						return
					}
					for (const event of events) {
						const {type, path} = event
						this.emit(type, path)
					}
				})
				.catch((error) => {
					this.logger.error(`Failed to subscribe to directory '${directory}': ${error.message}`)
					return null
				})
			if (!subscription) continue
			this.subscriptions.set(directory, subscription)
			this.logger.log(`Started watching directory '${directory}'`)

			// Stop watching old directories
			for (const directory of this.subscriptions.keys()) {
				if (!directories.includes(directory)) {
					const subscription = this.subscriptions.get(directory)
					if (!subscription) continue
					this.subscriptions.delete(directory)
					this.logger.log(`Stopped watching directory '${directory}'`)
					await subscription
						.unsubscribe()
						.catch((error) =>
							this.logger.error(`Failed to unsubscribe from directory '${directory}': ${error.message}`),
						)
				}
			}
		}
	}

	/** Scans all base directories, yielding for each file. */
	async *scan() {
		const directoriesToScan = [...this.#umbreld.files.baseDirectories.keys()]
		while (directoriesToScan.length > 0) {
			const directoryPath = directoriesToScan.shift()!
			const dir = await fse.opendir(directoryPath, {encoding: 'utf8'})
			for await (const dirent of dir) {
				const path = nodePath.join(directoryPath, dirent.name)
				if (dirent.isDirectory()) {
					directoriesToScan.push(path)
				}
				yield {path, dirent}
			}
		}
	}
}

export default FilesWatcher
