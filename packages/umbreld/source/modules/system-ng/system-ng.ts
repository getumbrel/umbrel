import type Umbreld from '../../index.ts'

import Device from './device.ts'
import Advertisement from './advertisement.ts'

// Replacement for the legacy system module. Will be renamed to "system" once the old module is fully migrated.
export default class SystemNg {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	device: Device
	advertisement: Advertisement

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())

		this.device = new Device(umbreld)
		this.advertisement = new Advertisement(umbreld)
	}

	async start() {
		this.logger.log('Starting system-ng')

		// Start submodules
		await this.device.start().catch((error) => this.logger.error('Failed to start device', error))
		await this.advertisement.start().catch((error) => this.logger.error('Failed to start advertisement', error))
	}

	async stop() {
		this.logger.log('Stopping system-ng')

		// Stop submodules
		await this.advertisement.stop().catch((error) => this.logger.error('Failed to stop advertisement', error))
		await this.device.stop().catch((error) => this.logger.error('Failed to stop device', error))
	}
}
