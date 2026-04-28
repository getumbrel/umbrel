import nodePath from 'node:path'
import nodeFs from 'node:fs'

import watcher from '@parcel/watcher'
import fse from 'fs-extra'
import {$} from 'execa'

import type Umbreld from '../../index.js'

export type FileChangeEvent = watcher.Event

// @parcel/watcher uses a native C++ backend that reads inotify events on a dedicated thread
// and bridges them to JavaScript via NAPI ThreadSafeFunction. We've observed in production that
// this pipeline can silently break: the inotify file descriptor and kernel watches remain alive,
// but events stop arriving in JS. This leaves all downstream consumers (recents, thumbnails,
// samba, favorites) broken until the process is restarted, with no error logged.
//
// The exact trigger is unknown. The @parcel/watcher source has several code paths where this
// could theoretically happen (native thread exiting cleanly, debounce thread deadlock, NAPI
// bridge failure), but we haven't been able to confirm which one occurs in practice.
//
// To handle this, we run a periodic health check: write a sentinel file to a watched directory
// and verify the corresponding event arrives within a timeout. If it doesn't, we tear down the
// dead subscription and recreate it. Detecting silence externally and recovering is more robust
// than trying to prevent every possible native failure mode.

// Health check constants
// How often to run the health check
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
// How long to wait for the sentinel event before considering the watcher dead
const HEALTH_CHECK_TIMEOUT_MS = 30 * 1000 // 30 seconds
// The virtual path we write the sentinel file to (must be a watched path)
const HEALTH_CHECK_PATH = '/Home'
const SENTINEL_FILENAME = '.umbrel-watcher-health-check'
const SENTINEL_WRITE_FLAGS =
	nodeFs.constants.O_WRONLY | nodeFs.constants.O_CREAT | nodeFs.constants.O_TRUNC | nodeFs.constants.O_NOFOLLOW
const SENTINEL_WRITE_MODE = 0o600

export default class Watcher {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	subscriptions: Map<string, watcher.AsyncSubscription> = new Map()
	pathsToWatch: Set<string>
	#healthCheckInterval?: ReturnType<typeof setInterval>

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

		await this.#setupListeners()

		// Start periodic health checks if we have active subscriptions
		if (this.subscriptions.size > 0) {
			this.#healthCheckInterval = setInterval(() => this.#healthCheck(), HEALTH_CHECK_INTERVAL_MS)
		}
	}

	// Subscribe to file changes for a virtual path
	async #watch(virtualPath: string) {
		try {
			const systemPath = await this.#umbreld.files.virtualToSystemPath(virtualPath)
			const subscription = await watcher.subscribe(systemPath, (error, events) => {
				if (error) return this.logger.error(`Failed to watch directory '${virtualPath}'`, error)
				for (const event of events) this.#umbreld.eventBus.emit('files:watcher:change', event)
			})
			this.subscriptions.set(virtualPath, subscription)
			this.logger.log(`Started watching directory '${virtualPath}'`)
		} catch (error) {
			this.logger.error(`Failed to watch directory '${virtualPath}'`, error)
		}
	}

	// Subscribe to file changes for all watched paths
	async #setupListeners() {
		for (const virtualPath of this.pathsToWatch) await this.#watch(virtualPath)
	}

	// Unsubscribe from all watched paths
	async #teardownListeners() {
		for (const [virtualPath, subscription] of this.subscriptions.entries()) {
			await subscription.unsubscribe().catch((error) => {
				this.logger.error(`Failed to unsubscribe from '${virtualPath}'`, error)
			})
			this.subscriptions.delete(virtualPath)
		}
	}

	// Write a sentinel file and verify the event arrives through the full pipeline
	async #healthCheck() {
		const systemPath = await this.#umbreld.files.virtualToSystemPath(HEALTH_CHECK_PATH)
		const sentinelPath = nodePath.join(systemPath, SENTINEL_FILENAME)

		try {
			// Listen for the sentinel event
			const eventReceived = new Promise<void>((resolve) => {
				let timeoutId: ReturnType<typeof setTimeout>
				const removeListener = this.#umbreld.eventBus.on('files:watcher:change', (event: FileChangeEvent) => {
					if (event.path === sentinelPath) {
						clearTimeout(timeoutId)
						removeListener()
						resolve()
					}
				})

				// Clean up the listener after the timeout regardless
				timeoutId = setTimeout(() => removeListener(), HEALTH_CHECK_TIMEOUT_MS)
			})

			// Write the sentinel file without following symlinks
			await this.#writeSentinelFile(sentinelPath)

			// Race the event against the timeout
			const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), HEALTH_CHECK_TIMEOUT_MS))
			const result = await Promise.race([eventReceived.then(() => 'ok' as const), timeout])

			if (result === 'timeout') {
				this.logger.error('Health check failed: watcher did not deliver sentinel event within timeout. Recovering...')
				await this.#teardownListeners()
				await this.#setupListeners()
			} else {
				this.logger.verbose('Health check passed')
			}
		} catch (error) {
			this.logger.error('Health check encountered an error', error)
		} finally {
			// Clean up the sentinel file so it's not visible via Samba or SSH
			await fse.remove(sentinelPath).catch(() => {})
		}
	}

	async #writeSentinelFile(sentinelPath: string) {
		const file = await nodeFs.promises.open(sentinelPath, SENTINEL_WRITE_FLAGS, SENTINEL_WRITE_MODE)
		try {
			await file.writeFile(Date.now().toString())
		} finally {
			await file.close()
		}
	}

	// Stop watchers and health check
	async stop() {
		if (this.#healthCheckInterval) clearInterval(this.#healthCheckInterval)
		await this.#teardownListeners()
	}
}
