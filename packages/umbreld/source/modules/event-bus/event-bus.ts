import Emittery from 'emittery'

import type Umbreld from '../../index.js'
import type {AppState} from '../apps/app.js'
import type {CloudSyncActivity} from '../files/cloud-types.js'
import type {FileChangeEvent} from '../files/watcher.js'
import type {OperationsInProgress} from '../files/files.js'
import type {BackupsInProgress, RestoreStatus} from '../backups/backups.js'
import type {
	ExpansionStatus,
	FailsafeTransitionStatus,
	RebuildStatus,
	ReplaceStatus,
	ScrubStatus,
} from '../hardware/raid.js'
import type {Machine, OsImage, MachineAgentControlEvent} from '../machines/machines.js'
import type {PhotoIndexingProgress} from '../photos/types.js'

// A Watchman callback can contain hundreds of thousands of paths. Emitting the
// whole array at once creates one promise and one copy of each listener's work
// per path, which can exhaust V8 before the consumers drain. This is a rolling
// concurrency ceiling, not an event-count cap: all events are still delivered,
// and each free slot immediately takes the next one. 1,024 retains high batch
// throughput while bounding simultaneous handler/store/filesystem work.
export const FILE_EVENT_EMIT_CONCURRENCY = 1024

// A listener that never settles must not permanently occupy one of those slots.
// Timing out releases only the scheduler slot; it does not cancel the listener.
// If many listeners exceed this deadline, their still-running work can temporarily
// exceed the rolling ceiling; the once-per-batch warning makes that visible.
export const FILE_EVENT_EMIT_TIMEOUT_MS = 1000

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
	'backups:backup-progress',
	'backups:restore-progress',
	'system:disk:change',
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
	// Fires when a watched file changes
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
	// Fires repeatedly while backup operations are in progress
	// with the current progress of each backup
	'backups:backup-progress': BackupsInProgress
	// Fires repeatedly while a restore operation is in progress
	// with the current status of the restore operation
	'backups:restore-progress': RestoreStatus
	// Fires when the connected block devices change
	// e.g attaching/removing a USB drive
	'system:disk:change': undefined
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
	// Add an event listener
	// Returns an unsubscribe function
	on = this.#emitter.on.bind(this.#emitter)
	// Wait for an event to be called once
	// Returns the event data
	once = this.#emitter.once.bind(this.#emitter)

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLocaleLowerCase())
	}

	// Preserve every file event while bounding the promises and handler work
	// admitted at once. Each worker takes the next event as soon as its current
	// event settles, rather than waiting at an all-or-nothing chunk barrier. A
	// timeout releases only the scheduler slot: the original emit promise remains
	// alive and can settle normally without blocking future file events.
	async emitFileChanges(
		events: FileChangeEvent[],
		{
			concurrency = FILE_EVENT_EMIT_CONCURRENCY,
			timeoutMs = FILE_EVENT_EMIT_TIMEOUT_MS,
		}: {concurrency?: number; timeoutMs?: number} = {},
	) {
		if (!Number.isSafeInteger(concurrency) || concurrency < 1)
			throw new Error('File event concurrency must be positive')
		if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('File event timeout must be positive')

		let nextEventIndex = 0
		let loggedTimeout = false
		const emitNext = async () => {
			while (nextEventIndex < events.length) {
				const event = events[nextEventIndex++]

				let timeout: ReturnType<typeof setTimeout> | undefined
				try {
					const timedOut = await Promise.race([
						this.emit('files:watcher:change', event).then(() => false),
						new Promise<true>((resolve) => {
							timeout = setTimeout(() => resolve(true), timeoutMs)
						}),
					])
					if (timedOut && !loggedTimeout) {
						loggedTimeout = true
						this.logger.error(
							`File event handlers exceeded ${timeoutMs}ms; continuing to dispatch the remaining events`,
						)
					}
				} finally {
					if (timeout) clearTimeout(timeout)
				}
			}
		}

		await Promise.all(Array.from({length: Math.min(concurrency, events.length)}, emitNext))
	}

	// Stream events
	stream(event: keyof EventTypes, {signal}: {signal?: AbortSignal} = {}) {
		const iterator = this.#emitter.events(event)

		// An optional AbortSignal instance can be passed in to immediately
		// abort the stream. This is useful to avoid memory leaks when clients
		// subscribe to events and then disconnect without unsubscribing first.
		signal?.addEventListener('abort', () => iterator.return?.(), {once: true})

		return iterator
	}

	// Emit an event
	emit: Emittery<EventTypes>['emit'] = (event: keyof EventTypes, data?: EventTypes[keyof EventTypes]) => {
		this.logger.verbose(`${event} ${data === undefined ? '' : JSON.stringify(data)}`)
		return this.#emitter.emit(event, data).catch((error) => {
			// Make sure we catch any unhandled errors so they don't crash the process
			this.logger.error(`Handler failed for event ${event}`, error)
		})
	}
}
