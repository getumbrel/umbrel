import path from 'node:path'

// TODO: import packageJson from '../package.json' assert {type: 'json'}
const packageJson = (await import('../package.json', {assert: {type: 'json'}})).default

import {UMBREL_APP_STORE_REPO} from './constants.js'
import createLogger, {type LogLevel} from './modules/utilities/logger.js'
import FileStore from './modules/utilities/file-store.js'
import Migration from './modules/startup-migrations/index.js'
import Server from './modules/server/index.js'
import User from './modules/user/user.js'
import AppStore from './modules/apps/app-store.js'
import Apps from './modules/apps/apps.js'
import Files from './modules/files/files.js'
import Notifications from './modules/notifications/notifications.js'
import EventBus from './modules/event-bus/event-bus.js'
import Dbus from './modules/dbus/dbus.js'
import Backups from './modules/backups/backups.js'

import {commitOsPartition, setupPiCpuGovernor, restoreWiFi, waitForSystemTime} from './modules/system/system.js'
import {overrideDevelopmentHostname} from './modules/development.js'

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
		language?: string
		temperatureUnit?: string
	}
	settings: {
		releaseChannel: 'stable' | 'beta'
		wifi?: {
			ssid: string
			password?: string
		}
		externalDns?: boolean
	}
	development: {
		hostname?: string
	}
	recentlyOpenedApps: string[]
	files: {
		preferences: {
			view: 'icons' | 'list'
			sortBy: 'name' | 'type' | 'modified' | 'size'
			sortOrder: 'ascending' | 'descending'
		}
		favorites: string[]
		recents: string[]
		shares: {
			name: string
			path: string
		}[]
		networkStorage: {
			host: string
			share: string
			username: string
			password: string
			mountPath: string
		}[]
	}
	notifications: string[]
	backups: {
		repositories: {
			id: string
			path: string
			password: string
			lastBackup?: number
		}[]
		ignore: string[]
	}
}

export type UmbreldOptions = {
	dataDirectory: string
	port?: number
	logLevel?: LogLevel
	defaultAppStoreRepo?: string
}

export default class Umbreld {
	version: string = packageJson.version
	versionName: string = packageJson.versionName
	developmentMode: boolean
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
	files: Files
	notifications: Notifications
	eventBus: EventBus
	dbus: Dbus
	backups: Backups

	constructor({
		dataDirectory,
		port = 80,
		logLevel = 'normal',
		defaultAppStoreRepo = UMBREL_APP_STORE_REPO,
	}: UmbreldOptions) {
		this.developmentMode = process?.env?.NODE_ENV === 'development'
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
		this.files = new Files(this)
		this.notifications = new Notifications(this)
		this.eventBus = new EventBus(this)
		this.dbus = new Dbus(this)
		this.backups = new Backups(this)
	}

	async start() {
		this.logger.log(`☂️  Starting Umbrel v${this.version}`)
		this.logger.log()
		this.logger.log(`dataDirectory: ${this.dataDirectory}`)
		this.logger.log(`port:          ${this.port}`)
		this.logger.log(`logLevel:      ${this.logLevel}`)
		this.logger.log()

		// If we've successfully booted then commit to the current OS partition (non-blocking)
		commitOsPartition(this)

		// Set ondemand cpu governor for Raspberry Pi (non-blocking)
		setupPiCpuGovernor(this)

		// Run migration module before anything else
		// TODO: think through if we want to allow the server module to run before migration.
		// It might be useful if we add more complicated migrations so we can signal progress.
		await this.migration.start()

		// Override hostname in development when set
		const developmentHostname = await this.store.get('development.hostname')
		if (developmentHostname) await overrideDevelopmentHostname(this, developmentHostname)

		// Synchronize the system password after OTA update (non-blocking)
		this.user.syncSystemPassword()

		// Restore WiFi connection after OTA update (non-blocking)
		restoreWiFi(this)

		// Wait for system time to be synced for up to 10 seconds before proceeding
		// We need this on Raspberry Pi since it doesn't have a persistent real time clock.
		// It avoids race conditions where umbrelOS starts making network requests before
		// the local time is set which then fail with SSL cert errors.
		await waitForSystemTime(this, 10)

		// We need to forcefully clean Docker state before being able to safely continue
		// If an existing container is listening on port 80 we'll crash, if an old version
		// of Umbrel wasn't shutdown properly, bringing containers up can fail.
		// Skip this in dev mode otherwise we get very slow reloads since this cleans
		// up app containers on every source code change.
		if (!this.developmentMode) {
			await this.apps.cleanDockerState().catch((error) => this.logger.error(`Failed to clean Docker state`, error))
		}

		// Initialise modules
		await Promise.all([
			this.files.start(),
			this.apps.start(),
			this.appStore.start(),
			this.dbus.start(),
			this.server.start(),
		])

		// Start backups last because it depends on files
		this.backups.start()
	}

	async stop() {
		try {
			// Stop backups first because it depends on files
			await this.backups.stop()

			// Stop modules
			await Promise.all([this.files.stop(), this.apps.stop(), this.appStore.stop(), this.dbus.stop()])
			return true
		} catch (error) {
			// If we fail to stop gracefully there's not really much we can do, just log the error and return false
			// so it can be handled elsewhere if needed
			this.logger.error(`Failed to stop umbreld`, error)
			return false
		}
	}
}
