import ms from 'ms'

import getPackageJson from './utilities/get-package-json.js'
import createLogger from './utilities/logger.js'

import * as services from './services/index.js'

const {Store, Server} = services

export default class Umbreld {
	constructor({dataDirectory, port = 80, logLevel = 'normal'}) {
		this.dataDirectory = dataDirectory
		this.port = port
		this.logLevel = logLevel
		this.logger = createLogger('umbreld', this.logLevel)
		this.services = {}
	}

	async start() {
		// TODO: Check this still works when built into
		// a self contained binary
		const {version} = await getPackageJson(import.meta)
		this.version = version

		this.logger.log(`☂️  Starting Umbrel v${version}`)
		this.logger.log()
		this.logger.log(`dataDirectory: ${this.dataDirectory}`)
		this.logger.log(`port:          ${this.port}`)
		this.logger.log(`logLevel:      ${this.logLevel}`)
		this.logger.log()

		// Load the store service before any other services
		await this.loadService(Store)

		// Load all services apart from Store and Server
		await Promise.all(
			Object.values(services)
				.filter((Service) => ![Store, Server].includes(Service))
				.map((Service) => this.loadService(Service)),
		)

		// Load the server service once all other services are loaded
		await this.loadService(Server)
	}

	async loadService(UmbrelService) {
		const start = Date.now()
		const {name} = UmbrelService
		this.logger.verbose(`Loading service: ${name}`)
		// Create a new instance of the service
		const service = new UmbrelService({umbreld: this})

		// Wait for it to start
		await service.start()
		const loadTime = ms(Date.now() - start)
		this.logger.verbose(`Loaded service ${name} in ${loadTime}`)

		// Expose it on the umbreld instance via it's identifier
		this.services[name.toLowerCase()] = service

		return service
	}
}
