import path from 'node:path'

// @ts-expect-error I can't get tsconfig setup in a way that allows this without breaking other things.
// However we execute with tsx and it's able to resolve the import without issues.
import packageJson from '../package.json' assert {type: 'json'}

import createLogger, {type LogLevel} from './modules/utilities/logger.js'
import FileStore from './modules/utilities/file-store.js'

import Migration from './modules/migration/index.js'
import Server from './modules/server/index.js'
import User from './modules/user.js'
import AppStore from './modules/apps/app-store.js'
import Apps from './modules/apps/apps.js'

import {commitOsPartition} from './modules/system.js'

type StoreSchema = {
	version: string
	apps: string[]
	appRepositories: string[]
	widgets: string[]
	torEnabled?: boolean
	user: {
		name: string
		hashedPassword: string
		totpUri?: string
		wallpaper?: string
	}
}

export type UmbreldOptions = {
	dataDirectory: string
	port?: number
	logLevel?: LogLevel
	defaultAppStoreRepo?: string
}

export default class Umbreld {
	version = packageJson.version
	dataDirectory: string
	port: number
	logLevel: LogLevel
	logger: ReturnType<typeof createLogger>
	store: FileStore<StoreSchema>
	migration: Migration
	server: Server
	user: User
	appStore: AppStore
	apps: Apps

	constructor({
		dataDirectory,
		port = 80,
		logLevel = 'normal',
		defaultAppStoreRepo = 'https://github.com/getumbrel/umbrel-apps.git',
	}: UmbreldOptions) {
		this.dataDirectory = path.resolve(dataDirectory)
		this.port = port
		this.logLevel = logLevel
		this.logger = createLogger('umbreld', this.logLevel)
		this.store = new FileStore<StoreSchema>({filePath: `${dataDirectory}/umbrel.yaml`})
		this.migration = new Migration(this)
		this.server = new Server({umbreld: this})
		this.user = new User(this)
		this.appStore = new AppStore(this, {defaultAppStoreRepo})
		this.apps = new Apps(this)
	}

	async start() {
		this.logger.log(`☂️  Starting Umbrel v${this.version}`)
		this.logger.log()
		this.logger.log(`dataDirectory: ${this.dataDirectory}`)
		this.logger.log(`port:          ${this.port}`)
		this.logger.log(`logLevel:      ${this.logLevel}`)
		this.logger.log()

		// If we've successfully booted then commit to the current OS partition
		commitOsPartition(this)

		// Run migration module before anything else
		// TODO: think through if we want to allow the server module to run before migration.
		// It might be useful if we add more complicated migrations so we can signal progress.
		await this.migration.start()

		// Initialise modules
		await Promise.all([this.apps.start(), this.appStore.start(), this.server.start()])
	}

	async stop() {
		try {
			// Stop modules
			await Promise.all([this.apps.stop(), this.appStore.stop()])
			return true
		} catch (error) {
			// If we fail to stop gracefully there's not really much we can do, just log the error and return false
			// so it can be handled elsewhere if needed
			this.logger.error(`Failed to stop umbreld: ${(error as Error).message}`)
			return false
		}
	}
}
