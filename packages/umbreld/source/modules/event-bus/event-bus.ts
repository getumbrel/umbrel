import Emittery from 'emittery'

import type Umbreld from '../../index.ts'
import type {AppState} from '../apps/app.ts'
import type {ProgressStatus} from '../apps/schema.ts'
import type {CloudSyncActivity} from '../files/cloud-types.ts'
import type {FileChangeEvent} from '../files/watcher.ts'
import type {OperationsInProgress} from '../files/files.ts'
import type {BackupsInProgress, RestoreStatus} from '../backups/backups.ts'
import type {
	ExpansionStatus,
	FailsafeTransitionStatus,
	RebuildStatus,
	ReplaceStatus,
	ScrubStatus,
} from '../hardware/raid.ts'
import type {Machine, OsImage, MachineAgentControlEvent} from '../machines/machines.ts'
import type {PhotoIndexingProgress} from '../photos/types.ts'

// A file change listener that never settles mustn't hold up later batches
// forever. Timing out releases the dispatch; it doesn't cancel the listener.
export const FILE_CHANGES_LISTENER_TIMEOUT_MS = 1000

// Listeners and streams get a large batch in chunks of this many events,
// pausing between chunks whenever the event loop has been busy, so that no
// listener's pass over a batch holds the event loop for long
export const FILE_CHANGES_CHUNK_SIZE = 4096

export type FileChangesListener = (events: readonly FileChangeEvent[]) => unknown

// File changes are delivered through onFileChanges() and stream() and never
// through the emitter, so listening for them with on() or once() would
// silently never fire (and a once() would wait forever)
type EmitterEventName = Exclude<keyof EventTypes, 'files:watcher:change'>

function assertEmitterEvent(eventName: string) {
	if (eventName === 'files:watcher:change') {
		throw new Error('File changes are delivered through onFileChanges() and stream(), not on() or once()')
	}
}

// A large burst is dispatched and streamed through promise chains that never
// wait on I/O, so without a break they run to completion in one go and the
// event loop serves nothing else: API requests, and the WebSocket pongs whose
// 5s deadline terminates open Files tabs. Everything dispatching or streaming
// events pauses for one event loop turn once this long has passed since the
// last pause. After a quiet period that means the first check pauses straight
// away, which costs well under a millisecond.
const EVENT_LOOP_SLICE_MS = 16
let sliceStartedAt = performance.now()
let pause: Promise<void> | undefined

// Returns a promise to wait on when the current slice has run long enough
function yieldIfBusy() {
	if (!pause && performance.now() - sliceStartedAt < EVENT_LOOP_SLICE_MS) return
	pause ??= new Promise<void>((resolve) =>
		setImmediate(() => {
			pause = undefined
			sliceStartedAt = performance.now()
			resolve()
		}),
	)
	return pause
}

// Type assertion to ensure all events in EventTypes are defined in events
type MissingInEvents = Exclude<keyof EventTypes, (typeof events)[number]>
type _AssertEveryKeyIsListed = MissingInEvents extends never ? true : [`✘ Add these to events →`, MissingInEvents]
const _eventsIncludesAllKeys: _AssertEveryKeyIsListed = true

// The accounts a member share change affects ('all' covers every member)
export type MemberSharesChangeEvent = {sharedWith: 'all' | string[]}

// Statically define event names for use in rpc argument validation
export const events = [
	'files:watcher:change',
	'files:operation-progress',
	'files:cloud-progress',
	'files:member-shares:change',
	'apps:member-shares:change',
	'apps:settings:change',
	'apps:state:change',
	'apps:progress',
	'backups:backup-progress',
	'backups:restore-progress',
	'system:disk:change',
	'system:update-status',
	'files:external-storage:change',
	'files:network-storage:change',
	'raid:expansion-progress',
	'raid:failsafe-transition-progress',
	'raid:rebuild-progress',
	'raid:replace-progress',
	'raid:scrub-progress',
	'machines:updated',
	'machines:os-images-updated',
	'machines:agent-control',
	'raid:status-change',
	'notifications:change',
	'hardware:thunderbolt:devices-change',
	'photos:change',
	'photos:indexing-progress',
] as const satisfies readonly (keyof EventTypes)[]

// Statically define event types
export type EventTypes = {
	// Fires when a watched file changes. Emitted in batches with
	// emitFileChanges(), which consumers take with onFileChanges() and
	// streams receive one event at a time.
	'files:watcher:change': FileChangeEvent
	// Fires repeatedly while file operations (copy/move) are in progress
	// with the current progress of each operation
	'files:operation-progress': OperationsInProgress
	// Internal account-scoped wake-up with the current sanitized progress
	// snapshot. The public subscription yields only `activity` to that account.
	'files:cloud-progress': {userId: string; activity: CloudSyncActivity[]}
	// Fires when the paths shared with members change, with the accounts the
	// affected share was or is now shared with
	'files:member-shares:change': MemberSharesChangeEvent
	// Fires when the apps shared with members change, with the accounts the
	// affected share was or is now shared with
	'apps:member-shares:change': MemberSharesChangeEvent
	// Fires after an app settings update reaches a terminal state and the
	// persisted values are ready to read
	'apps:settings:change': {appId: string}
	// Fires when an app's lifecycle state changes, with 'not-installed' when
	// an app disappears (uninstall or failed install)
	'apps:state:change': {appId: string; state: AppState | 'not-installed'}
	// Fires as an app's install or update progresses, with its current state
	'apps:progress': {appId: string; state: AppState; progress: number}
	// Fires repeatedly while backup operations are in progress
	// with the current progress of each backup
	'backups:backup-progress': BackupsInProgress
	// Fires repeatedly while a restore operation is in progress
	// with the current status of the restore operation
	'backups:restore-progress': RestoreStatus
	// Fires when the connected block devices change
	// e.g attaching/removing a USB drive
	'system:disk:change': undefined
	// Fires whenever the umbrelOS update status changes, with the full status
	'system:update-status': ProgressStatus
	// Fires when the accessible external storage devices change
	// e.g mounting/unmounting a USB drive
	'files:external-storage:change': undefined
	// Fires when a network share is mounted
	'files:network-storage:change': undefined
	// Fires when RAID expansion progress changes
	'raid:expansion-progress': ExpansionStatus
	// Fires when failsafe transition progress changes
	'raid:failsafe-transition-progress': FailsafeTransitionStatus
	// Fires when RAID rebuild progress changes
	'raid:rebuild-progress': RebuildStatus
	// Fires when RAID replace progress changes
	'raid:replace-progress': ReplaceStatus
	// Fires repeatedly while a scrub is in progress and once with its result
	'raid:scrub-progress': ScrubStatus
	// Fires with a full snapshot of all virtual machines whenever any machine
	// changes (state transitions, install progress, settings, pinning)
	'machines:updated': Machine[]
	// Fires with a full snapshot of all OS images whenever any image changes
	// (download progress, download completion, custom ISO registration)
	'machines:os-images-updated': OsImage[]
	// Fires when an MCP agent starts or stops driving a machine's console, and
	// with each of its pointer moves while it does
	'machines:agent-control': MachineAgentControlEvent
	// Fires when the RAID pool's user-visible state changes: pool status, data or
	// accelerator membership, per-member status, raid type or topology
	'raid:status-change': undefined
	// Fires when the stored set of notifications changes. Deliberately carries
	// no payload so it can be streamed to members; clients refetch their own
	// account-filtered list.
	'notifications:change': undefined
	// Fires when the user-visible Thunderbolt device state changes
	// e.g. connect/disconnect or an authorization/trust change
	'hardware:thunderbolt:devices-change': undefined
	// Fires when Photos data changes. Account ids let subscriptions discard
	// unrelated activity before clients learn that it happened.
	'photos:change': {accountIds: string[]}
	// Fires with the latest indexing job snapshot for one Photos account.
	'photos:indexing-progress': PhotoIndexingProgress
}

export default class EventBus {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	#emitter = new Emittery<EventTypes>()
	#fileChangesListeners = new Set<FileChangesListener>()
	#fileChangeStreams = new Set<(events: readonly FileChangeEvent[]) => void>()
	// Add an event listener
	// Returns an unsubscribe function
	on = <Name extends EmitterEventName>(
		eventName: Name,
		listener: (eventData: EventTypes[Name]) => void | Promise<void>,
	) => {
		assertEmitterEvent(eventName)
		return this.#emitter.on(eventName, listener)
	}
	// Wait for an event to be called once
	// Returns the event data
	once = <Name extends EmitterEventName>(eventName: Name) => {
		assertEmitterEvent(eventName)
		return this.#emitter.once(eventName)
	}

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLocaleLowerCase())
	}

	// Listen for file changes, a batch at a time. A 100k-file rename is one
	// batch of 200k events, so consumers take the whole batch in one call
	// instead of paying per-event dispatch for each of them.
	// Returns an unsubscribe function
	onFileChanges(listener: FileChangesListener) {
		this.#fileChangesListeners.add(listener)
		return () => {
			this.#fileChangesListeners.delete(listener)
		}
	}

	// Deliver a batch of file changes to every listener in one call per chunk,
	// and event by event to every stream of files:watcher:change
	async emitFileChanges(
		events: readonly FileChangeEvent[],
		{timeoutMs = FILE_CHANGES_LISTENER_TIMEOUT_MS}: {timeoutMs?: number} = {},
	) {
		if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('File event timeout must be positive')
		const timedOut = {logged: false}
		for (let start = 0; start < events.length; start += FILE_CHANGES_CHUNK_SIZE) {
			const paused = yieldIfBusy()
			if (paused) await paused
			const chunk =
				events.length > FILE_CHANGES_CHUNK_SIZE ? events.slice(start, start + FILE_CHANGES_CHUNK_SIZE) : events
			await this.#deliverFileChanges(chunk, timeoutMs, timedOut)
		}
	}

	async #deliverFileChanges(events: readonly FileChangeEvent[], timeoutMs: number, timedOut: {logged: boolean}) {
		if (this.logger.isVerbose) {
			for (const event of events) this.logger.verbose(`files:watcher:change ${JSON.stringify(event)}`)
		}

		for (const enqueue of this.#fileChangeStreams) enqueue(events)

		await Promise.all(
			[...this.#fileChangesListeners].map(async (listener) => {
				// Make sure a failing listener can't crash the process, even after
				// it's timed out
				const settled = Promise.resolve()
					.then(() => listener(events))
					.catch((error) => this.logger.error('File change listener failed', error))
				let timeout: ReturnType<typeof setTimeout> | undefined
				const expired = await Promise.race([
					settled.then(() => false),
					new Promise<true>((resolve) => {
						timeout = setTimeout(() => resolve(true), timeoutMs)
					}),
				])
				clearTimeout(timeout)
				if (expired && !timedOut.logged) {
					timedOut.logged = true
					this.logger.error(`File change listeners exceeded ${timeoutMs}ms; continuing with later batches`)
				}
			}),
		)
	}

	// Stream events. Emittery's own iterator dequeues with Array#shift, which
	// copies the whole backlog for every event, so a subscriber that falls n
	// events behind (a large rename emits hundreds of thousands) costs O(n²) to
	// drain. This queue advances an index instead.
	stream<Name extends keyof EventTypes>(
		event: Name,
		{signal}: {signal?: AbortSignal} = {},
	): AsyncIterableIterator<EventTypes[Name]> {
		let queue: EventTypes[Name][] = []
		let head = 0
		let finished = false
		let wake: (() => void) | undefined
		let unsubscribe: () => void
		if (event === 'files:watcher:change') {
			const enqueue = (events: readonly FileChangeEvent[]) => {
				for (const change of events) queue.push(change as EventTypes[Name])
				wake?.()
			}
			this.#fileChangeStreams.add(enqueue)
			unsubscribe = () => this.#fileChangeStreams.delete(enqueue)
		} else {
			unsubscribe = this.#emitter.on(event, (data) => {
				queue.push(data)
				wake?.()
			})
		}
		const finish = () => {
			if (finished) return
			finished = true
			unsubscribe()
			queue = []
			head = 0
			wake?.()
		}

		// An optional AbortSignal instance can be passed in to immediately
		// abort the stream. This is useful to avoid memory leaks when clients
		// subscribe to events and then disconnect without unsubscribing first.
		signal?.addEventListener('abort', finish, {once: true})

		return {
			async next() {
				const paused = yieldIfBusy()
				if (paused) await paused
				while (head === queue.length) {
					if (finished) return {done: true, value: undefined}
					await new Promise<void>((resolve) => (wake = resolve))
					wake = undefined
				}
				const value = queue[head++]
				// Drop delivered entries so the queue doesn't keep them alive: all of
				// them once caught up, otherwise once they outnumber the pending ones
				if (head === queue.length) {
					queue = []
					head = 0
				} else if (head > 1024 && head * 2 >= queue.length) {
					queue = queue.slice(head)
					head = 0
				}
				return {done: false, value}
			},
			async return() {
				finish()
				return {done: true, value: undefined}
			},
			[Symbol.asyncIterator]() {
				return this
			},
		}
	}

	// Emit an event
	emit: Emittery<EventTypes>['emit'] = (event: keyof EventTypes, data?: EventTypes[keyof EventTypes]) => {
		// File changes have one delivery path, whether one or a batch
		if (event === 'files:watcher:change') return this.emitFileChanges([data as FileChangeEvent])
		if (this.logger.isVerbose) this.logger.verbose(`${event} ${data === undefined ? '' : JSON.stringify(data)}`)
		return this.#emitter.emit(event as keyof EventTypes, data).catch((error) => {
			// Make sure we catch any unhandled errors so they don't crash the process
			this.logger.error(`Handler failed for event ${event}`, error)
		})
	}
}
