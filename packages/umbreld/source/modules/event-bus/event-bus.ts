import Emittery from 'emittery'

import type Umbreld from '../../index.js'
import type {FileChangeEvent} from '../files/watcher.js'
import type {OperationsInProgress} from '../files/files.js'
import type {BackupsInProgress, RestoreProgress} from '../backups/backups.js'

// Type assertion to ensure all events in EventTypes are defined in events
type MissingInEvents = Exclude<keyof EventTypes, (typeof events)[number]>
type _AssertEveryKeyIsListed = MissingInEvents extends never ? true : [`✘ Add these to events →`, MissingInEvents]
const _eventsIncludesAllKeys: _AssertEveryKeyIsListed = true

// Statically define event names for use in rpc argument validation
export const events = [
	'files:watcher:change',
	'files:operation-progress',
	'backups:backup-progress',
	'backups:restore-progress',
	'system:disk:change',
	'files:external-storage:change',
] as const satisfies readonly (keyof EventTypes)[]

// Statically define event types
export type EventTypes = {
	// Fires when a watched file changes
	'files:watcher:change': FileChangeEvent
	// Fires repeatedly while file operations (copy/move) are in progress
	// with the current progress of each operation
	'files:operation-progress': OperationsInProgress
	// Fires repeatedly while backup operations are in progress
	// with the current progress of each backup
	'backups:backup-progress': BackupsInProgress
	// Fires repeatedly while a restore operation is in progress
	// with the current progress of the restore. Will fire with null
	// when the restore is complete.
	'backups:restore-progress': RestoreProgress
	// Fires when the connected block devices change
	// e.g attaching/removing a USB drive
	'system:disk:change': undefined
	// Fires when the accessible external storage devices change
	// e.g mounting/unmounting a USB drive
	'files:external-storage:change': undefined
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
