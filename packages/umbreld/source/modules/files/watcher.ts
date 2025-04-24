import Emittery from 'emittery'

import watcher from '@parcel/watcher'
import {$} from 'execa'

import type Umbreld from '../../index.js'

export type FileChangeEvent = watcher.Event

export default class Watcher {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	#emitter = new Emittery()
	subscriptions: Map<string, watcher.AsyncSubscription> = new Map()
	pathsToWatch: Set<string>

	constructor(umbreld: Umbreld, {paths}: {paths: string[]}) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(`files:${name.toLocaleLowerCase()}`)
		this.pathsToWatch = new Set(paths)
	}

	// Setup inotify settings and start watchers
	async start() {
		this.logger.log('Starting files watcher')

		// Set system inotify limits
		// https://facebook.github.io/watchman/docs/install#linux-inotify-limits
		this.logger.log('Setting system inotify limits')
		// How many root directories can be watched
		await $`sysctl fs.inotify.max_user_instances=256`.catch((error) =>
			this.logger.error(`Failed to set max user instances`, error),
		)
		// How many directories can be watched across all watched roots
		await $`sysctl fs.inotify.max_user_watches=122404`.catch((error) =>
			this.logger.error(`Failed to set max user watches`, error),
		)
		// How many events can be queued (smaller number = more likely to have notification overflow)
		await $`sysctl fs.inotify.max_queued_events=16384`.catch((error) =>
			this.logger.error(`Failed to set max queued events`, error),
		)

		// Watch all paths in the pathsToWatch set
		for (const virtualPath of this.pathsToWatch) await this.watch(virtualPath)
	}

	// Watch a virtual path
	async watch(virtualPath: string) {
		try {
			const systemPath = await this.#umbreld.files.virtualToSystemPath(virtualPath)
			const subscription = await watcher.subscribe(systemPath, (error, events) => {
				if (error) return this.logger.error(`Failed to watch directory '${virtualPath}'`, error)
				for (const event of events) this.#umbreld.eventBus.emit('files:watcher:change', event)
			})
			this.subscriptions.set(virtualPath, subscription)
			this.logger.log(`Started watching directory '${virtualPath}'`)
			return true
		} catch (error) {
			this.logger.error(`Failed to watch directory '${virtualPath}'`, error)
			return false
		}
	}

	// Stop watchers
	async stop() {
		for (const [virtualPath, subscription] of this.subscriptions.entries()) {
			this.logger.log(`Stopping watcher for directory '${virtualPath}'`)
			try {
				await subscription.unsubscribe()
				this.subscriptions.delete(virtualPath)
				this.logger.log(`Stopped watching directory '${virtualPath}'`)
			} catch (error) {
				this.logger.error(`Failed to unsubscribe from directory`, error)
			}
		}
	}
}
