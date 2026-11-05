import nodePath from 'node:path'
import nodeFs from 'node:fs'

import fse from 'fs-extra'
import {$} from 'execa'
import PQueue from 'p-queue'

import type Umbreld from '../../index.ts'
import {OWNER_USER_ID} from '../user/constants.ts'
import Watchman, {
	WatchmanFreshInstanceError,
	WatchmanSubscriptionLostError,
	type FileChangeEvent,
	type WatchmanSubscription,
} from './watchman.ts'

export type {FileChangeEvent}

type WatcherOptions = {
	paths: string[]
	onChangeBatch?: (virtualPath: string, events: FileChangeEvent[]) => void
	onRestart?: () => void
}

// Watchman can stop delivering events without the connection failing, for example
// when the daemon becomes poisoned after an internal error. That would leave every
// downstream consumer (recents, thumbnails, samba, favorites, the file index) stale
// with nothing logged.
//
// To handle this, we run a periodic health check: write a sentinel file to a watched directory
// and verify the corresponding event arrives within a timeout. If it doesn't, we tear down the
// subscriptions, restart Watchman, and verify new subscriptions. Reconnecting to the same daemon
// cannot clear Watchman's poisoned state. Lost connections and canceled subscriptions are
// reported straight away and recovered through the same path.

// How long to wait after losing a subscription before resubscribing. Only one
// quick resubscribe runs per health check interval. Later losses wait for the
// regular health check, so a root that keeps failing is retried at that pace
// instead of in an endless loop.
const RESUBSCRIBE_DELAY_MS = 5000

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
	subscriptions: Map<string, WatchmanSubscription> = new Map()
	pathsToWatch: Set<string>
	#pendingSubscriptions = new Map<string, Promise<void>>()
	#eventDispatchQueue = new PQueue({concurrency: 1})
	#started = false
	#healthCheckInterval?: ReturnType<typeof setInterval>
	#onChangeBatch?: WatcherOptions['onChangeBatch']
	#onRestart?: () => void
	#healthCheckRunning?: Promise<void>
	#healthCheckWaiter?: {sentinelPath: string; resolve: (healthy: boolean) => void}
	#recovering = false
	#recoveryPending = false
	#watchmanPoisoned = false
	#subscriptionGeneration = 0
	#watchman = new Watchman()
	#resubscribeTimer?: ReturnType<typeof setTimeout>
	#quickResubscribeUsed = false

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

		// Failed initial subscriptions still need recovery, including when none started.
		if (this.#started && this.pathsToWatch.size > 0) {
			this.#healthCheckInterval = setInterval(() => {
				this.#quickResubscribeUsed = false
				void this.#healthCheck()
			}, HEALTH_CHECK_INTERVAL_MS)

			// Also verify the pipeline right away instead of waiting for the first
			// interval. The first subscription after the Watchman daemon cold-starts
			// can be silently dead from the beginning (reproducible on first boot in
			// a VM), so catch that within one sentinel timeout and recover.
			void this.#healthCheck()
		}
	}

	// Subscribe to file changes for a virtual path
	async #watch(virtualPath: string) {
		if (this.subscriptions.has(virtualPath)) return
		const pending = this.#pendingSubscriptions.get(virtualPath)
		if (pending) return pending

		const subscriptionJob = (async () => {
			const generation = this.#subscriptionGeneration
			try {
				// Watch paths are internal, prevalidated roots. Resolve them
				// without pretending the owner is authorized for member homes.
				const systemPath = this.#umbreld.files.virtualToSystemPathUnsafe(virtualPath)
				// Watchman is always installed in umbrelOS. It avoids bugs in inotify-based
				// watching — https://github.com/getumbrel/umbrel/issues/2158
				const subscription = await this.#watchman.subscribe(systemPath, (error, events) => {
					if (!this.#started || generation !== this.#subscriptionGeneration) return
					if (error) return this.#handleWatchError(virtualPath, error)

					// Detect the sentinel at the subscription callback boundary. A large
					// earlier batch can legitimately keep the consumer queue busy for longer
					// than the health-check timeout; that must not be mistaken for a dead
					// watcher and trigger an unnecessary Watchman resubscription/recrawl.
					const healthCheckWaiter = this.#healthCheckWaiter
					if (
						healthCheckWaiter &&
						events.some((event) => event.path === healthCheckWaiter.sentinelPath && event.type !== 'delete')
					) {
						this.#healthCheckWaiter = undefined
						healthCheckWaiter.resolve(true)
					}

					void this.#eventDispatchQueue
						.add(async () => {
							// Watchman has already batched and coalesced this callback. Preserve
							// that batch while keeping its internal consumer behind the same
							// serialized callback boundary as public event delivery.
							try {
								this.#onChangeBatch?.(virtualPath, events)
							} catch (error) {
								this.logger.error(`Failed to handle file event batch for '${virtualPath}'`, error)
							}
							await this.#umbreld.eventBus.emitFileChanges(events)
						})
						.catch((error) => this.logger.error(`Failed to dispatch file events for '${virtualPath}'`, error))
				})
				// The account may have been deleted while subscribe() was pending.
				if (!this.#started || generation !== this.#subscriptionGeneration || !this.pathsToWatch.has(virtualPath)) {
					await subscription.unsubscribe()
					return
				}
				this.subscriptions.set(virtualPath, subscription)
				this.logger.log(`Started watching directory '${virtualPath}'`)
			} catch (error) {
				this.#handleWatchError(virtualPath, error)
			}
		})()
		this.#pendingSubscriptions.set(virtualPath, subscriptionJob)
		await subscriptionJob.finally(() => this.#pendingSubscriptions.delete(virtualPath))
	}

	#handleWatchError(virtualPath: string, error: unknown) {
		// Changes may have been missed while the subscription stays active
		if (error instanceof WatchmanFreshInstanceError) {
			this.logger.error(`${error.message}, rescanning`)
			this.#onRestart?.()
			return
		}
		// The subscription is gone. Forget it so the health check resubscribes and,
		// once events are verified again, requests a catch-up scan.
		if (error instanceof WatchmanSubscriptionLostError) {
			this.logger.error(error.message)
			this.subscriptions.delete(virtualPath)
			this.#scheduleResubscribe()
			return
		}
		// Poison is daemon-wide, unlike a missing or inaccessible directory. It
		// needs a restart even if no subscription could start to receive a probe.
		if (error instanceof Error && error.message.includes('A non-recoverable condition has triggered')) {
			this.#watchmanPoisoned = true
		}
		this.logger.error(`Failed to watch directory '${virtualPath}'`, error)
	}

	#scheduleResubscribe() {
		if (this.#resubscribeTimer || this.#recovering || this.#quickResubscribeUsed) return
		this.#quickResubscribeUsed = true
		this.#resubscribeTimer = setTimeout(() => {
			this.#resubscribeTimer = undefined
			void this.#healthCheck()
		}, RESUBSCRIBE_DELAY_MS)
	}

	async addPath(virtualPath: string) {
		if (this.pathsToWatch.has(virtualPath)) return
		this.pathsToWatch.add(virtualPath)
		// Recovery's setup pass picks up roots added while the daemon is restarting.
		if (this.#started && !this.#recovering) await this.#watch(virtualPath)
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
		for (const virtualPath of this.pathsToWatch) {
			if (!this.#started) return
			await this.#watch(virtualPath)
		}
	}

	// Unsubscribe from all watched paths
	async #teardownListeners() {
		// Late callbacks from retired subscriptions must not validate a new probe.
		this.#subscriptionGeneration++
		for (const [virtualPath, subscription] of this.subscriptions.entries()) {
			await subscription.unsubscribe().catch((error) => {
				this.logger.error(`Failed to unsubscribe from '${virtualPath}'`, error)
			})
			this.subscriptions.delete(virtualPath)
		}
	}

	#hasAllSubscriptions() {
		return [...this.pathsToWatch].every((path) => this.subscriptions.has(path))
	}

	#healthCheck() {
		if (!this.#started || this.#healthCheckRunning) return this.#healthCheckRunning
		this.#healthCheckRunning = this.#runHealthCheck().finally(() => {
			this.#healthCheckRunning = undefined
		})
		return this.#healthCheckRunning
	}

	async #runHealthCheck() {
		try {
			// Retry individual failures without interrupting healthy subscriptions.
			// A restored root needs one catch-up scan for changes missed while offline.
			for (const path of this.pathsToWatch) {
				if (!this.#started) return
				if (this.subscriptions.has(path)) continue
				await this.#watch(path)
				if (this.subscriptions.has(path)) this.#recoveryPending = true
			}
			if (!this.#started) return
			if (!this.#watchmanPoisoned && !this.subscriptions.has(HEALTH_CHECK_PATH)) {
				throw new Error('Cannot verify event delivery without a Home subscription')
			}
			if (this.#watchmanPoisoned || !(await this.#testEventDelivery())) {
				if (!this.#started) return
				this.#recoveryPending = true
				this.logger.error('Watchman is poisoned or did not deliver the sentinel event. Restarting Watchman...')
				this.#recovering = true
				try {
					await Promise.all(this.#pendingSubscriptions.values())
					await this.#teardownListeners()
					if (!this.#started) return
					// Retire the connection first so resubscribing after the restart
					// always starts a fresh one rather than landing on the old socket.
					this.#watchman.close()
					await this.#shutdownWatchman()
					this.#watchmanPoisoned = false
					if (!this.#started) return
					await this.#setupListeners()
					// A subscription can still fail right after the daemon restarts, so
					// retry roots that failed once before verifying.
					if (!this.#started) return
					if (!this.#hasAllSubscriptions()) await this.#setupListeners()
				} finally {
					this.#recovering = false
				}
				if (!this.#started) return
				if (this.#watchmanPoisoned || !this.subscriptions.has(HEALTH_CHECK_PATH)) {
					throw new Error('Failed to restore the Home subscription on a healthy daemon')
				}
				if (!(await this.#testEventDelivery())) throw new Error('Restarted Watchman did not deliver a sentinel event')
			}
			if (!this.#started) return
			// A broken secondary root must not suppress catch-up for restored roots
			// or cause a daemon restart. Retry it independently at the next interval.
			if (!this.#hasAllSubscriptions()) {
				this.logger.error('Some directories remain unwatched; will retry their subscriptions at the next interval')
			}
			this.logger.verbose('Health check passed')
			if (this.#recoveryPending) {
				this.#recoveryPending = false
				// Only verified recovery requests a catch-up scan. The index's independent
				// periodic reconciliation continues even when watching remains broken.
				this.#onRestart?.()
			}
		} catch (error) {
			if (this.#started) this.logger.error('Watcher health check failed; will retry at the next interval', error)
		}
	}

	// Verify a write reaches the subscription callback without waiting behind consumers.
	async #testEventDelivery() {
		const systemPath = await this.#umbreld.files.virtualToSystemPath(HEALTH_CHECK_PATH, OWNER_USER_ID)
		if (!this.#started) return false
		const sentinelPath = nodePath.join(systemPath, SENTINEL_FILENAME)
		let timeoutId: ReturnType<typeof setTimeout> | undefined
		const eventReceived = new Promise<boolean>((resolve) => {
			this.#healthCheckWaiter = {sentinelPath, resolve}
			timeoutId = setTimeout(() => resolve(false), HEALTH_CHECK_TIMEOUT_MS)
		})
		try {
			await this.#writeSentinelFile(sentinelPath)
			return await eventReceived
		} finally {
			if (timeoutId) clearTimeout(timeoutId)
			this.#healthCheckWaiter = undefined
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
		this.#started = false
		this.#healthCheckWaiter?.resolve(false)
		this.#healthCheckWaiter = undefined
		this.#eventDispatchQueue.pause()
		this.#eventDispatchQueue.clear()
		if (this.#healthCheckInterval) clearInterval(this.#healthCheckInterval)
		clearTimeout(this.#resubscribeTimer)
		this.#resubscribeTimer = undefined
		await this.#healthCheckRunning
		await Promise.all(this.#pendingSubscriptions.values())
		await this.#teardownListeners()
		this.#watchman.close()
		this.#eventDispatchQueue.clear()

		// Connecting spawns the Watchman daemon, which is designed to persist, so it
		// lingers in the umbrel.service cgroup and makes `systemctl stop umbrel` hang until
		// TimeoutStopSec (15min). Bound the command to 5s and log shutdown errors.
		await this.#shutdownWatchman().catch((error) => this.logger.error('Failed to shut down watchman server', error))
	}

	async #shutdownWatchman() {
		this.logger.log('Shutting down watchman server')
		const result = await $({
			timeout: 5000,
			preferLocal: false,
			reject: false,
		})`watchman --no-spawn --no-local shutdown-server`
		// With spawning and local fallback disabled, an absent daemon returns 1
		// without output. It is already stopped; do not launch it just to stop it.
		if (result.exitCode === 1 && !result.stdout && !result.stderr && !result.timedOut) return
		if (result.exitCode !== 0) {
			throw new Error(
				`Watchman shutdown failed (exit=${result.exitCode}, timedOut=${result.timedOut}): ${result.stderr || result.stdout}`,
			)
		}
		const response = JSON.parse(result.stdout)
		if (response['shutdown-server'] !== true) {
			throw new Error(`Watchman did not confirm shutdown: ${result.stdout}`)
		}
	}
}
