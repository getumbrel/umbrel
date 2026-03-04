// TODO: Move this into a system submodule when we have a
// cleaned up system module

import dbus from '@homebridge/dbus-native'
import {throttle} from 'es-toolkit'
import type Umbreld from '../../index.js'

export default class Dbus {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	#removeDiskEventListeners?: () => void

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLocaleLowerCase())
	}

	async start() {
		this.logger.log('Starting dbus')

		await this.addDiskEventListeners().catch((error) => {
			this.logger.error(`Failed to add disk event listeners`, error)
		})
	}

	async addDiskEventListeners() {
		this.logger.log('Attaching disk event listeners')

		// Create throttled event emitter since we often get lots of events at once
		const sendThrottledEvent = throttle(async () => this.#umbreld.eventBus.emit('system:disk:change'), 100, {
			edges: ['leading'],
		})

		// Setup event handler
		const handleDeviceChange = (unitName: string) => {
			// Check if we have a new disk device service from systemd
			const isDisk = typeof unitName === 'string' && unitName.includes('disk') && unitName.endsWith('.device')
			if (isDisk) sendThrottledEvent()
		}

		// Attach event handler to systemd service events
		return new Promise((resolve, reject) => {
			dbus
				.systemBus()
				.getService('org.freedesktop.systemd1')
				.getInterface('/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', (error, manager) => {
					if (error) return reject(error)

					// Add listeners
					manager.addListener('UnitNew', handleDeviceChange)
					manager.addListener('UnitRemoved', handleDeviceChange)

					// Create cleanup function
					this.#removeDiskEventListeners = () => {
						this.logger.log('Removing disk event listeners')
						manager.removeListener('UnitNew', handleDeviceChange)
						manager.removeListener('UnitRemoved', handleDeviceChange)
						this.#removeDiskEventListeners = undefined
					}

					resolve(true)
				})
		})
	}

	async stop() {
		this.logger.log('Stopping dbus')
		this.#removeDiskEventListeners?.()
	}
}
