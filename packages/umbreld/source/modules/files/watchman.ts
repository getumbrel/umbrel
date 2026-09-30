import watchman from 'fb-watchman'

// A minimal Watchman client for Watcher, talking to the daemon directly over its
// socket with Meta's pure JavaScript client. It replaces @parcel/watcher, whose
// native Watchman backend held a lock while waiting for each response that the
// thread reading those responses also needed. That deadlocked whenever a change
// notification arrived first, wedging the watcher and eventually every libuv
// worker thread. Everything here runs on the event loop, so that can't happen,
// and failures surface as ordinary errors.
//
// The event semantics deliberately match @parcel/watcher's Watchman backend: the
// same fields and create/update/delete mapping, the same per-path coalescing
// within a batch, the same path ordering, and the same batching window.

export type FileChangeEvent = {path: string; type: 'create' | 'update' | 'delete'}
export type WatchmanCallback = (error: Error | null, events: FileChangeEvent[]) => void
export type WatchmanSubscription = {unsubscribe: () => Promise<void>}

// The subscription is gone (the connection was lost, or Watchman canceled it
// because its root was deleted). Changes may have been missed.
export class WatchmanSubscriptionLostError extends Error {}

// Watchman reported a fresh instance, so the subscription is still active but
// changes may have been missed. The caller should rescan instead of receiving
// every file as a create.
export class WatchmanFreshInstanceError extends Error {}

// `watch` waits for the initial crawl, which can take minutes for a large tree
// on slow storage. Other commands answer immediately. The limits only guard
// against an unresponsive daemon; a timeout drops the connection so everything
// on it recovers through a fresh one.
const WATCH_TIMEOUT_MS = 30 * 60 * 1000
const COMMAND_TIMEOUT_MS = 60 * 1000

// @parcel/watcher's batching: deliver the first change after a quiet period
// straight away, then batch until changes pause for 50ms, flushing at least
// every 500ms.
const BATCH_QUIET_MS = 50
const BATCH_MAX_WAIT_MS = 500

const S_IFMT = 0o170000
const S_IFDIR = 0o040000

type WatchmanFile = {name: string; mode: number; exists: boolean; new: boolean}

type Subscription = {
	name: string
	directory: string
	callback: WatchmanCallback
	connection: Connection
	events: Map<string, {created: boolean; deleted: boolean}>
	lastFlushAt: number
	flushTimer?: ReturnType<typeof setTimeout>
}

type Connection = {client: watchman.Client; closed: boolean}

// @types/fb-watchman types command() as per-command overloads, which a generic
// command helper can't satisfy
type Command = (args: unknown[], callback: (error: Error | null, response: any) => void) => void

// Code units from U+D800 up, where UTF-16 and UTF-8 order can differ
const HIGH_CODE_UNIT = /[\uD800-\uFFFF]/

// @parcel/watcher delivers each batch sorted by path bytes. Comparing strings
// compares UTF-16 code units, which gives the same order as UTF-8 bytes as long
// as no code unit is U+D800 or above. That covers almost every path and is much
// cheaper, so compare bytes only when a batch needs it.
function sortByPathBytes(events: FileChangeEvent[]) {
	if (!events.some(({path}) => HIGH_CODE_UNIT.test(path))) {
		return events.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
	}
	return events
		.map((event) => ({key: Buffer.from(event.path), event}))
		.sort((a, b) => Buffer.compare(a.key, b.key))
		.map(({event}) => event)
}

export default class Watchman {
	#connection?: Connection
	#subscriptions = new Map<string, Subscription>()
	#nextSubscriptionId = 0

	async subscribe(directory: string, callback: WatchmanCallback): Promise<WatchmanSubscription> {
		await this.#watch(directory)
		const connection = this.#connect()
		const {clock} = await this.#command(connection, ['clock', directory])

		// Register before subscribing: the response and the first notifications
		// can arrive in the same read, before this function resumes.
		const name = `umbreld-${this.#nextSubscriptionId++}`
		const subscription: Subscription = {
			name,
			directory,
			callback,
			connection,
			events: new Map(),
			lastFlushAt: 0,
		}
		this.#subscriptions.set(name, subscription)
		try {
			await this.#command(connection, [
				'subscribe',
				directory,
				name,
				{fields: ['name', 'mode', 'exists', 'new'], since: clock},
			])
		} catch (error) {
			this.#forget(subscription)
			throw error
		}
		// Watchman can cancel the subscription in the same read as acknowledging it.
		// It has already been reported lost then, so it mustn't look active.
		if (!this.#subscriptions.has(name)) {
			throw new WatchmanSubscriptionLostError(`Watchman canceled the subscription for '${directory}'`)
		}

		return {unsubscribe: () => this.#unsubscribe(subscription)}
	}

	// Drop the connection without notifying subscribers
	close() {
		for (const subscription of this.#subscriptions.values()) this.#forget(subscription)
		if (this.#connection) this.#retire(this.#connection)
	}

	// `watch` waits for the root's initial crawl, and until it answers Watchman
	// sends nothing else on that connection, not even notifications for other
	// roots. Crawl on a short-lived connection of its own so a slow crawl can't
	// hold up other roots, and a timeout only fails this one.
	async #watch(directory: string) {
		const connection = this.#createConnection()
		try {
			await this.#command(connection, ['watch', directory], WATCH_TIMEOUT_MS)
		} finally {
			this.#retire(connection)
		}
	}

	#connect() {
		if (this.#connection && !this.#connection.closed) return this.#connection
		this.#connection = this.#createConnection()
		return this.#connection
	}

	#createConnection() {
		const client = new watchman.Client()
		const connection: Connection = {client, closed: false}
		client.on('subscription', (notification) => this.#handleNotification(connection, notification))
		// Without an error listener an EventEmitter error would crash umbreld
		client.on('error', (error) => this.#lose(connection, error))
		client.on('end', () => this.#lose(connection, new Error('The Watchman connection was closed')))
		return connection
	}

	#command(connection: Connection, args: unknown[], timeout = COMMAND_TIMEOUT_MS) {
		return new Promise<any>((resolve, reject) => {
			if (connection.closed) return reject(new Error('The Watchman connection was closed'))
			const timer = setTimeout(() => {
				const error = new Error(`Watchman did not respond to '${args[0]}' within ${timeout / 1000}s`)
				reject(error)
				this.#lose(connection, error)
			}, timeout)
			const command = connection.client.command.bind(connection.client) as Command
			command(args, (error, response) => {
				clearTimeout(timer)
				if (error) return reject(error)
				resolve(response)
			})
		})
	}

	async #unsubscribe(subscription: Subscription) {
		if (!this.#subscriptions.has(subscription.name)) return
		this.#forget(subscription)
		// Subscriptions die with their connection, so there's nothing to cancel
		if (subscription.connection.closed) return
		await this.#command(subscription.connection, ['unsubscribe', subscription.directory, subscription.name])
	}

	#forget(subscription: Subscription) {
		clearTimeout(subscription.flushTimer)
		this.#subscriptions.delete(subscription.name)
	}

	#retire(connection: Connection) {
		if (connection.closed) return
		connection.closed = true
		if (this.#connection === connection) this.#connection = undefined
		// Ending the client fails its queued and in-flight commands
		connection.client.end()
	}

	// A broken connection kills every subscription on it, and fb-watchman only
	// fails pending commands on a clean close, so retire it and start fresh.
	#lose(connection: Connection, cause: Error) {
		if (connection.closed) return
		this.#retire(connection)
		for (const subscription of [...this.#subscriptions.values()]) {
			if (subscription.connection !== connection) continue
			this.#forget(subscription)
			subscription.callback(
				new WatchmanSubscriptionLostError(
					`Lost Watchman subscription for '${subscription.directory}': ${cause.message}`,
				),
				[],
			)
		}
	}

	#handleNotification(connection: Connection, notification: any) {
		const subscription = this.#subscriptions.get(notification.subscription)
		if (!subscription || subscription.connection !== connection) return

		if (notification.canceled) {
			this.#forget(subscription)
			subscription.callback(
				new WatchmanSubscriptionLostError(`Watchman canceled the subscription for '${subscription.directory}'`),
				[],
			)
			return
		}
		if (notification.error) return subscription.callback(new Error(notification.error), [])
		if (notification.is_fresh_instance) {
			subscription.callback(
				new WatchmanFreshInstanceError(`Watchman reported a fresh instance for '${subscription.directory}'`),
				[],
			)
			return
		}
		// State assertions and other unilateral messages don't carry file changes
		if (!Array.isArray(notification.files)) return

		for (const file of notification.files as WatchmanFile[]) {
			this.#record(subscription, `${subscription.directory}/${file.name}`, file)
		}
		this.#scheduleFlush(subscription)
	}

	// @parcel/watcher's mapping and per-path coalescing
	#record(subscription: Subscription, path: string, file: WatchmanFile) {
		const isDirectory = (file.mode & S_IFMT) === S_IFDIR
		let event = subscription.events.get(path)
		if (file.new && file.exists) {
			event ??= {created: false, deleted: false}
			// A path removed and recreated within a batch is an update
			if (event.deleted) event.deleted = false
			else event.created = true
		} else if (file.exists && !isDirectory) {
			event ??= {created: false, deleted: false}
		} else if (!file.new && !file.exists) {
			event ??= {created: false, deleted: false}
			event.deleted = true
		} else {
			return
		}
		subscription.events.set(path, event)
	}

	#scheduleFlush(subscription: Subscription) {
		clearTimeout(subscription.flushTimer)
		if (Date.now() - subscription.lastFlushAt > BATCH_MAX_WAIT_MS) return this.#flush(subscription)
		subscription.flushTimer = setTimeout(() => this.#flush(subscription), BATCH_QUIET_MS)
	}

	#flush(subscription: Subscription) {
		subscription.flushTimer = undefined
		subscription.lastFlushAt = Date.now()
		const events: FileChangeEvent[] = []
		for (const [path, {created, deleted}] of subscription.events) {
			// Created and deleted within the same batch
			if (created && deleted) continue
			events.push({path, type: created ? 'create' : deleted ? 'delete' : 'update'})
		}
		subscription.events.clear()
		if (events.length === 0 || !this.#subscriptions.has(subscription.name)) return
		subscription.callback(null, sortByPathBytes(events))
	}
}
