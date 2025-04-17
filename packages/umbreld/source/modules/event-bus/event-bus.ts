import Emittery from 'emittery'

import type Umbreld from '../../index.js'
import type {FileChangeEvent} from '../files/watcher.js'

// Statically define event types
type EventTypes = {
	// Fires when a watched file changes
	'file:change': FileChangeEvent
	// Fires when the connected block devices change
	// e.g attaching/removing a USB drive
	'system:disk:change': undefined
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

	// Emit an event
	emit: Emittery<EventTypes>['emit'] = (event: keyof EventTypes, data?: EventTypes[keyof EventTypes]) => {
		this.logger.verbose(`${event} ${data === undefined ? '' : JSON.stringify(data)}`)
		return this.#emitter.emit(event, data).catch((error) => {
			// Make sure we catch any unhandled errors so they don't crash the process
			this.logger.error(`Handler failed for event ${event}: ${error.message}`)
			console.log(error.stack)
		})
	}
}
