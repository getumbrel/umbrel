import type Umbreld from '../index.js'
import createLogger from '../utilities/logger.js'

export type ServiceOptions = {umbreld: Umbreld}

export default class UmbrelService {
	umbreld: Umbreld
	logger: ReturnType<typeof createLogger>

	constructor({umbreld}: ServiceOptions) {
		this.umbreld = umbreld
		const {name} = this.constructor
		const {logLevel} = umbreld
		this.logger = createLogger(name.toLowerCase(), logLevel)
	}

	async start() {
		return this
	}

	async stop() {
		return this
	}
}

export type ServiceConstructor = new (options: ServiceOptions) => UmbrelService
