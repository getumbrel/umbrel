import path from 'node:path'

import {globby} from 'globby'
import fse from 'fs-extra'
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
import {detectDevice, setCpuGovernor, reboot} from './modules/system.js'

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

	// By default Linux uses the UAS driver for most devices. This causes major
	// stability problems on the Raspberry Pi 4, not due to issues with UAS, but due
	// to devices running in UAS mode using much more power. The Pi can't reliably
	// provide enough power to the USB port and the entire system experiences
	// extreme instability. By blacklisting all devices from the UAS driver on first
	// and then rebooting we fall back to the mass-storage driver, which results in
	// decreased performance, but lower power usage, and much better system stability.
	// TODO: Move this to a system module
	async blacklistUASDriver() {
		try {
			const justDidRebootFile = '/umbrel-just-did-reboot'
			// Only run on Raspberry Pi 4
			const {deviceId} = await detectDevice()
			if (deviceId !== 'pi-4') return
			const blacklist = []
			// Get all USB device uevent files
			const usbDeviceUeventFiles = await globby('/sys/bus/usb/devices/*/uevent')
			for (const ueventFile of usbDeviceUeventFiles) {
				const uevent = await fse.readFile(ueventFile, 'utf8')
				if (!uevent.includes('DRIVER=uas')) continue
				const [vendorId, productId] = uevent
					.split('\n')
					.find((line) => line?.startsWith('PRODUCT='))
					.replace('PRODUCT=', '')
					.split('/')
				const deviceId = `${vendorId}:${productId}`
				this.logger.log(`UAS device found ${deviceId}`)
				blacklist.push(deviceId)
			}

			// Don't reboot if we don't have any UAS devices
			if (blacklist.length === 0) {
				await fse.remove(justDidRebootFile)
				return
			}

			// Check we're not in a boot loop
			if (await fse.pathExists(justDidRebootFile)) {
				this.logger.log('We just rebooted, we could be in a bootloop, skipping reboot')
				return
			}

			// Read current cmdline
			this.logger.log(`Applying quirks to cmdline.txt`)
			let cmdline = await fse.readFile('/boot/cmdline.txt', 'utf8')

			// Don't apply quirks if they're already applied
			const quirksAlreadyApplied = blacklist.every((deviceId) => cmdline.includes(`${deviceId}:u`))
			if (quirksAlreadyApplied) {
				this.logger.log('UAS quirks already applied, skipping')
				return
			}

			// Remove any current quirks
			cmdline = cmdline
				.trim()
				.split(' ')
				.filter((flag) => !flag.startsWith('usb-storage.quirks='))
				.join(' ')
			// Add new quirks
			const quirks = blacklist.map((deviceId) => `${deviceId}:u`).join(',')
			cmdline = `${cmdline} usb-storage.quirks=${quirks}`

			// Remount /boot as writable
			await $`mount -o remount,rw /boot`
			// Write new cmdline
			await fse.writeFile('/boot/cmdline.txt', cmdline)

			// Reboot the system
			this.logger.log(`Rebooting`)
			// We need to make sure we commit before rebooting otherwise
			// OTA updates will get instantly rolled back.
			await commitOsPartition(this)
			await fse.writeFile(justDidRebootFile, cmdline)
			await reboot()
		} catch (error) {
			this.logger.error(`Failed to blacklist UAS driver: ${(error as Error).message}`)
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

		// Blacklist UAS driver for Raspberry Pi 4
		await this.blacklistUASDriver()

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
