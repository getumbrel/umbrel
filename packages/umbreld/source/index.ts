import path from 'node:path'

import fse from 'fs-extra'

import packageJson from '../package.json' assert {type: 'json'}

import createLogger from './modules/utilities/logger.js'
import FileStore from './modules/utilities/file-store.js'

import Server from './modules/server/index.js'

type UmbreldOptions = {
	dataDirectory: string
	port?: number
	logLevel?: string
}

export default class Umbreld {
	version = packageJson.version
	dataDirectory: string
	port: number
	logLevel: string
	logger: ReturnType<typeof createLogger>
	store: FileStore
	server: Server

	constructor({dataDirectory, port = 80, logLevel = 'normal'}: UmbreldOptions) {
		this.dataDirectory = path.resolve(dataDirectory)
		this.port = port
		this.logLevel = logLevel
		this.logger = createLogger('umbreld', this.logLevel)
		this.store = new FileStore({filePath: `${dataDirectory}/umbrel.yaml`})
		this.server = new Server({umbreld: this})
	}

	async start() {
		this.logger.log(`☂️  Starting Umbrel v${this.version}`)
		this.logger.log()
		this.logger.log(`dataDirectory: ${this.dataDirectory}`)
		this.logger.log(`port:          ${this.port}`)
		this.logger.log(`logLevel:      ${this.logLevel}`)
		this.logger.log()

		// Load the store service before any other services
		const dataDirExists = await fse.pathExists(this.dataDirectory)
		if (!dataDirExists) throw new Error('Data directory does not exist')
		// In the future we'll handle migrations here, for now lets just write the version to check read/write permissions are ok.
		await this.store.set('version', this.version)

		// Start the server
		await this.server.start()
	}
}
