import type Umbreld from '../../index.js'

import InternalStorage from './internal-storage.js'

export default class Hardware {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	internalStorage: InternalStorage

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())

		this.internalStorage = new InternalStorage(umbreld)
	}

	async start() {
		this.logger.log('Starting hardware')

		// Start submodules
		await this.internalStorage.start().catch((error) => this.logger.error('Failed to start internal storage', error))
	}

	async stop() {
		this.logger.log('Stopping hardware')

		// Stop submodules
		await this.internalStorage.stop().catch((error) => this.logger.error('Failed to stop internal storage', error))
	}
}
