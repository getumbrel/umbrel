import path from 'node:path'
import {setTimeout} from 'node:timers/promises'

import {$} from 'execa'

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
import {detectDevice, setCpuGovernor, connectToWiFiNetwork} from './modules/system.js'

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
	settings: {
		releaseChannel: 'stable' | 'beta'
		wifi?: {
			ssid: string
			password?: string
		}
	}
	recentlyOpenedApps: string[]
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

	constructor({
		dataDirectory,
		port = 80,
		logLevel = 'normal',
		defaultAppStoreRepo = 'https://github.com/getumbrel/umbrel-apps.git',
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
	}

	// TODO: Move this to a system module
	// Restore WiFi after OTA update
	async restoreWiFi() {
		const wifiCredentials = await this.store.get('settings.wifi')
		if (!wifiCredentials) return

		while (true) {
			this.logger.log(`Attempting to restore WiFi connection to ${wifiCredentials.ssid}...`)
			try {
				await connectToWiFiNetwork(wifiCredentials)
				this.logger.log(`WiFi connection restored!`)
				break
			} catch (error) {
				this.logger.error(`Failed to restore WiFi connection "${(error as Error).message}". Retrying in 1 minute...`)
				await setTimeout(1000 * 60)
			}
		}
	}

	async setupPiCpuGoverner() {
		// TODO: Move this to a system module
		// Set ondemand cpu governer for Raspberry Pi
		try {
			const {productName} = await detectDevice()
			if (productName === 'Raspberry Pi') {
				await setCpuGovernor('ondemand')
				this.logger.log(`Set ondemand cpu governor`)
			}
		} catch (error) {
			this.logger.error(`Failed to set ondemand cpu governor: ${(error as Error).message}`)
		}
	}

	// Wait for system time to be synced for up to the number of seconds passed in.
	// We need this on Raspberry Pi since it doesn' have a persistent real time clock.
	// It avoids race conditions where umbrelOS starts making network requests before
	// the local time is set which then fail with SSL cert errors.
	async waitForSystemTime(timeout: number) {
		try {
			// Only run on Pi
			const {deviceId} = await detectDevice()
			if (!['pi-4', 'pi-5'].includes(deviceId)) return

			this.logger.log('Checking if system time is synced before continuing...')
			let tries = 0
			while (tries < timeout) {
				tries++
				const timeStatus = await $`timedatectl status`
				const isSynced = timeStatus.stdout.includes('System clock synchronized: yes')
				if (isSynced) {
					this.logger.log('System time is synced. Continuing...')
					return
				}
				this.logger.log('System time is not currently synced, waiting...')
				await setTimeout(1000)
			}
			this.logger.error('System time is not synced but timeout was reached. Continuing...')
		} catch (error) {
			this.logger.error(`Failed to check system time: ${(error as Error).message}`)
		}
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

		// Set ondemand cpu governer for Raspberry Pi
		this.setupPiCpuGoverner()

		// Run migration module before anything else
		// TODO: think through if we want to allow the server module to run before migration.
		// It might be useful if we add more complicated migrations so we can signal progress.
		await this.migration.start()

		// Restore WiFi connection after OTA update
		this.restoreWiFi()

		// Wait for system time to be synced for up to 10 seconds before proceeding
		await this.waitForSystemTime(10)

		// We need to forcefully clean Docker state before being able to safely continue
		// If an existing container is listening on port 80 we'll crash, if an old version
		// of Umbrel wasn't shutdown properly, bringing containers up can fail.
		// Skip this in dev mode otherwise we get very slow reloads since this cleans
		// up app containers on every source code change.
		if (!this.developmentMode) {
			await this.apps
				.cleanDockerState()
				.catch((error) => this.logger.error(`Failed to clean Docker state: ${(error as Error).message}`))
		}

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
