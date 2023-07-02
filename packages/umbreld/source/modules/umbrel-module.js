import createLogger from '../utilities/logger.js'

export default class UmbrelModule {
	constructor({umbreld}) {
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
