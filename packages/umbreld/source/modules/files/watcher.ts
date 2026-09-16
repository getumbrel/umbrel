import nodePath from 'node:path'
import nodeFs from 'node:fs'

import watcher from '@parcel/watcher'
import fse from 'fs-extra'
import {$} from 'execa'
import PQueue from 'p-queue'

import type Umbreld from '../../index.js'
import {OWNER_USER_ID} from '../user/constants.js'

export type FileChangeEvent = watcher.Event

type WatcherOptions = {
	paths: string[]
	onChangeBatch?: (virtualPath: string, events: FileChangeEvent[]) => void
	onRestart?: () => void
}

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
	#pendingSubscriptions = new Map<string, Promise<void>>()
	#eventDispatchQueue = new PQueue({concurrency: 1})
	#started = false
	#healthCheckInterval?: ReturnType<typeof setInterval>
	#onChangeBatch?: WatcherOptions['onChangeBatch']
	#onRestart?: () => void
	#healthCheckRunning = false
	#healthCheckWaiter?: {sentinelPath: string; resolve: () => void}

	constructor(umbreld: Umbreld, {paths, onChangeBatch, onRestart}: WatcherOptions) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(`files:${name.toLocaleLowerCase()}`)
		this.pathsToWatch = new Set(paths)
		this.#onChangeBatch = onChangeBatch
		this.#onRestart = onRestart
	}

	// Setup inotify settings and start watchers
	async start() {
		this.logger.log('Starting files watcher')
		this.#started = true
		this.#eventDispatchQueue.start()

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

			// Also verify the pipeline right away instead of waiting for the first
			// interval. The first subscription after the Watchman daemon cold-starts
			// can be silently dead from the beginning (reproducible on first boot in
			// a VM), so catch that within one sentinel timeout and recover.
			this.#healthCheck().catch((error) => this.logger.error('Startup health check failed', error))
		}
	}

	// Subscribe to file changes for a virtual path
	async #watch(virtualPath: string) {
		if (this.subscriptions.has(virtualPath)) return
		const pending = this.#pendingSubscriptions.get(virtualPath)
		if (pending) return pending

		const subscriptionJob = (async () => {
			try {
				// Watch paths are internal, prevalidated roots. Resolve them
				// without pretending the owner is authorized for member homes.
				const systemPath = this.#umbreld.files.virtualToSystemPathUnsafe(virtualPath)
				// Use the Watchman backend explicitly (always installed in umbrelOS). It avoids bugs in
				// @parcel/watcher's inotify backend — https://github.com/getumbrel/umbrel/issues/2158
				const subscription = await watcher.subscribe(
					systemPath,
					(error, events) => {
						if (!this.#started) return
						if (error) return this.logger.error(`Failed to watch directory '${virtualPath}'`, error)

						// Detect the sentinel at the Parcel callback boundary. A large earlier
						// batch can legitimately keep the consumer queue busy for longer than
						// the health-check timeout; that must not be mistaken for a dead native
						// watcher and trigger an unnecessary Watchman resubscription/recrawl.
						const healthCheckWaiter = this.#healthCheckWaiter
						if (healthCheckWaiter && events.some((event) => event.path === healthCheckWaiter.sentinelPath)) {
							this.#healthCheckWaiter = undefined
							healthCheckWaiter.resolve()
						}

						void this.#eventDispatchQueue
							.add(async () => {
								// Parcel has already debounced and coalesced this callback. Preserve
								// that native batch while keeping its internal consumer behind the
								// same serialized callback boundary as public event delivery.
								try {
									this.#onChangeBatch?.(virtualPath, events)
								} catch (error) {
									this.logger.error(`Failed to handle file event batch for '${virtualPath}'`, error)
								}
								await this.#umbreld.eventBus.emitFileChanges(events)
							})
							.catch((error) => this.logger.error(`Failed to dispatch file events for '${virtualPath}'`, error))
					},
					{backend: 'watchman'},
				)
				// The account may have been deleted while subscribe() was pending.
				if (!this.#started || !this.pathsToWatch.has(virtualPath)) {
					await subscription.unsubscribe()
					return
				}
				this.subscriptions.set(virtualPath, subscription)
				this.logger.log(`Started watching directory '${virtualPath}'`)
			} catch (error) {
				this.logger.error(`Failed to watch directory '${virtualPath}'`, error)
			}
		})()
		this.#pendingSubscriptions.set(virtualPath, subscriptionJob)
		await subscriptionJob.finally(() => this.#pendingSubscriptions.delete(virtualPath))
	}

	async addPath(virtualPath: string) {
		if (this.pathsToWatch.has(virtualPath)) return
		this.pathsToWatch.add(virtualPath)
		if (this.#started) await this.#watch(virtualPath)
	}

	async removePath(virtualPath: string) {
		this.pathsToWatch.delete(virtualPath)
		await this.#pendingSubscriptions.get(virtualPath)
		const subscription = this.subscriptions.get(virtualPath)
		if (!subscription) return
		await subscription.unsubscribe().catch((error) => {
			this.logger.error(`Failed to unsubscribe from '${virtualPath}'`, error)
		})
		this.subscriptions.delete(virtualPath)
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

	// Write a sentinel file and verify it reaches the Parcel callback. Consumer
	// pressure is handled separately by the bounded dispatch queue.
	async #healthCheck() {
		if (!this.#started || this.#healthCheckRunning) return
		this.#healthCheckRunning = true
		let sentinelPath: string | undefined
		let timeoutId: ReturnType<typeof setTimeout> | undefined

		try {
			const systemPath = await this.#umbreld.files.virtualToSystemPath(HEALTH_CHECK_PATH, OWNER_USER_ID)
			const currentSentinelPath = nodePath.join(systemPath, SENTINEL_FILENAME)
			sentinelPath = currentSentinelPath

			// Listen for the sentinel event
			const eventReceived = new Promise<void>((resolve) => {
				this.#healthCheckWaiter = {sentinelPath: currentSentinelPath, resolve}
			})

			// Write the sentinel file without following symlinks
			await this.#writeSentinelFile(currentSentinelPath)

			// Race the event against the timeout
			const timeout = new Promise<'timeout'>((resolve) => {
				timeoutId = setTimeout(() => resolve('timeout'), HEALTH_CHECK_TIMEOUT_MS)
			})
			const result = await Promise.race([eventReceived.then(() => 'ok' as const), timeout])

			if (result === 'timeout') {
				if (!this.#started) return
				this.logger.error('Health check failed: watcher did not deliver sentinel event within timeout. Recovering...')
				await this.#teardownListeners()
				await this.#setupListeners()
				this.#onRestart?.()
			} else {
				this.logger.verbose('Health check passed')
			}
		} catch (error) {
			this.logger.error('Health check encountered an error', error)
		} finally {
			if (timeoutId) clearTimeout(timeoutId)
			if (sentinelPath && this.#healthCheckWaiter?.sentinelPath === sentinelPath) this.#healthCheckWaiter = undefined
			this.#healthCheckRunning = false
			// Clean up the sentinel file so it's not visible via Samba or SSH
			if (sentinelPath) await fse.remove(sentinelPath).catch(() => {})
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
		this.#started = false
		this.#healthCheckWaiter?.resolve()
		this.#healthCheckWaiter = undefined
		this.#eventDispatchQueue.pause()
		this.#eventDispatchQueue.clear()
		if (this.#healthCheckInterval) clearInterval(this.#healthCheckInterval)
		await Promise.all(this.#pendingSubscriptions.values())
		await this.#teardownListeners()
		this.#eventDispatchQueue.clear()

		// @parcel/watcher spawns the Watchman daemon but never stops it (it's designed to persist), so
		// it lingers in the umbrel.service cgroup and makes `systemctl stop umbrel` hang until
		// TimeoutStopSec (15min). Shut it down explicitly. Bounded to 1s and errors are only logged so
		// it can never block our own shutdown.
		this.logger.log('Shutting down watchman server')
		await $({timeout: 1000, preferLocal: false})`watchman shutdown-server`.catch((error) =>
			this.logger.error('Failed to shut down watchman server', error),
		)
	}
}
