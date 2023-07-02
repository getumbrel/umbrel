import ms from 'ms'

import getPackageJson from './utilities/get-package-json.js'
import createLogger from './utilities/logger.js'

import * as modules from './modules/index.js'

const {Store, Server} = modules

export default class Umbreld {
	constructor({dataDirectory, port = 80, logLevel = 'normal'}) {
		this.dataDirectory = dataDirectory
		this.port = port
		this.logLevel = logLevel
		this.logger = createLogger('umbreld', this.logLevel)
		this.modules = {}
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

		// Load the store module before any other modules
		await this.loadModule(Store)

		// Load all modules apart from Store and Server
		await Promise.all(
			Object.values(modules)
				.filter((Module) => ![Store, Server].includes(Module))
				.map((Module) => this.loadModule(Module)),
		)

		// Load the server module once all other modules are loaded
		await this.loadModule(Server)
	}

	async loadModule(UmbrelModule) {
		const start = Date.now()
		const {name} = UmbrelModule
		this.logger.verbose(`Loading module: ${name}`)
		// Create a new instance of the module
		const module = new UmbrelModule({umbreld: this})

		// Wait for it to start
		await module.start()
		const loadTime = ms(Date.now() - start)
		this.logger.verbose(`Loaded module ${name} in ${loadTime}`)

		// Expose it on the umbreld instance via it's identifier
		this.modules[name.toLowerCase()] = module

		return module
	}
}
