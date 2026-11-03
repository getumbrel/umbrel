import path from 'node:path'
import {setTimeout} from 'node:timers/promises'
import fse from 'fs-extra'

import packageJson from '../package.json' with {type: 'json'}

import {UMBREL_APP_STORE_REPO, BACKUP_RESTORE_FIRST_START_FLAG} from './constants.ts'
import createLogger, {type LogLevel} from './modules/utilities/logger.ts'
import FileStore from './modules/utilities/file-store.ts'
import Migration from './modules/startup-migrations/index.ts'
import Server from './modules/server/index.ts'
import User, {type MemberRecord} from './modules/user/user.ts'
import AppStore from './modules/apps/app-store.ts'
import Apps from './modules/apps/apps.ts'
import Files from './modules/files/files.ts'
import Hardware from './modules/hardware/hardware.ts'
import Notifications from './modules/notifications/notifications.ts'
import EventBus from './modules/event-bus/event-bus.ts'
import Dbus from './modules/dbus/dbus.ts'
import Backups from './modules/backups/backups.ts'
import SystemNg from './modules/system-ng/system-ng.ts'
import Update from './modules/update/update.ts'
import Machines from './modules/machines/machines.ts'
import LanIngress from './modules/lan-ingress/lan-ingress.ts'
import Auth from './modules/auth/auth.ts'
import Mcp, {type McpStoreSettings} from './modules/mcp/mcp.ts'
import Photos, {type PhotoBackupSource, type PhotoBackupSourceRemoval} from './modules/photos/photos.ts'

import type {CloudStore} from './modules/files/cloud-types.ts'

import {
	commitOsPartition,
	setupPiCpuGovernor,
	enlargeRunInRecoveryMode,
	restoreHostname,
	restoreWiFi,
	restoreStaticIp,
	waitForSystemTime,
	reboot,
} from './modules/system/system.ts'
import {cleanupFactoryResetBackups} from './modules/system/factory-reset.ts'

type StoreSchema = {
	version: string
	previousVersion?: string
	discoveryId?: string
	apps: string[]
	// Apps the owner has shared with member accounts. 'all' also covers
	// members created in the future.
	appMemberShares?: {
		appId: string
		sharedWith: 'all' | string[]
	}[]
	appRepositories: string[]
	widgets: string[]
	shortcuts: {
		url: string
		title: string
		icon?: string
	}[]
	torEnabled?: boolean
	// The owner account, always user id '0'
	user: {
		name: string
		hashedPassword: string
		avatarHash?: string
		totpUri?: string
		wallpaper?: string
		language?: string
		temperatureUnit?: string
	}
	// Active members and permanent tombstones for deleted member ids. Member ids
	// are security identities used by sessions, paths, and shares, so they must
	// never be assigned to a different account after deletion.
	members?: MemberRecord[]
	settings: {
		releaseChannel: 'stable' | 'beta'
		wifi?: {
			ssid: string
			password?: string
		}
		externalDns?: boolean
		hostname?: string
		staticIp?: Record<
			string,
			{
				ip: string
				subnetPrefix: number
				gateway: string
				dns: string[]
			}
		>
		// Set while Umbrel's wired interface sits behind the bridge that lets
		// machines join the LAN, so umbrel-static-ip-restore can put it back
		// before NetworkManager starts on the next boot
		lanBridge?: {
			mac: string
		}
	}
	recentlyOpenedApps: string[]
	files: {
		preferences: {
			view: 'icons' | 'list'
			sortBy: 'name' | 'type' | 'modified' | 'size'
			sortOrder: 'ascending' | 'descending'
		}
		favorites: string[]
		shares: {
			name: string
			path: string
			// Missing on legacy records, which always belong to the owner.
			userId?: string
		}[]
		// Owner paths shared with member accounts. 'all' also covers members
		// created in the future. Shares still respect the usual system rules
		// such as protected and read-only paths.
		memberShares?: {
			path: string
			sharedWith: 'all' | string[]
		}[]
		networkStorage: {
			host: string
			share: string
			username: string
			password: string
			mountPath: string
		}[]
		cloud?: CloudStore
	}
	photos?: {
		backupSources?: PhotoBackupSource[]
		backupSourceRemovals?: PhotoBackupSourceRemoval[]
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
	migration: {
		menderToRugixAttempt?: number
	}
	// Runtime RAID maintenance state belongs in Umbreld's data store. The boot
	// RAID config is reserved for locating, mounting, and recovering the pool.
	raid?: {
		nextScrubAt?: number
	}
	mcp?: McpStoreSettings
	authorizedThunderboltDevices?: {
		id: string
		name?: string
		vendor?: string
	}[]
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
	hardware: Hardware
	notifications: Notifications
	eventBus: EventBus
	dbus: Dbus
	backups: Backups
	systemNg: SystemNg
	update: Update
	machines: Machines
	lanIngress: LanIngress
	auth: Auth
	mcp: Mcp
	photos: Photos
	isBackupRestoreFirstStart = false
	private stopped = false

	constructor({
		dataDirectory,
		// LAN ingress owns the public browser-facing ports and proxies dashboard
		// traffic to this internal server port, so the default must not collide
		// with it.
		port = 22080,
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
		this.hardware = new Hardware(this)
		this.notifications = new Notifications(this)
		this.eventBus = new EventBus(this)
		this.dbus = new Dbus(this)
		this.backups = new Backups(this)
		this.systemNg = new SystemNg(this)
		this.update = new Update(this)
		this.machines = new Machines(this)
		this.lanIngress = new LanIngress(this)
		this.auth = new Auth(this)
		this.mcp = new Mcp(this)
		this.photos = new Photos(this)
	}

	async start() {
		this.logger.log(`☂️  Starting Umbrel v${this.version}`)
		this.logger.log()
		this.logger.log(`dataDirectory: ${this.dataDirectory}`)
		this.logger.log(`port:          ${this.port}`)
		this.logger.log(`logLevel:      ${this.logLevel}`)
		this.logger.log()

		// If we've successfully booted then commit to the current OS partition
		await commitOsPartition(this)

		// Give Rugix's RAM-backed state more room if the data mount failed at boot (non-blocking)
		enlargeRunInRecoveryMode(this)

		// Set ondemand cpu governor for Raspberry Pi (non-blocking)
		setupPiCpuGovernor(this)

		// Cleanup old factory reset state backups early to free up disk space ASAP (non-blocking)
		cleanupFactoryResetBackups(this)

		// Run migration module before anything else
		// TODO: think through if we want to allow the server module to run before migration.
		// It might be useful if we add more complicated migrations so we can signal progress.
		const migrationResult = await this.migration.start()
		// If the migration module requests a reboot, halt umbreld startup and reboot the system immediately
		if (migrationResult.reboot) {
			this.logger.log('Rebooting to complete migrations...')
			await reboot()
			return
		}

		if (!(await this.store.get('settings.releaseChannel'))) {
			await this.store.set('settings.releaseChannel', this.version.includes('-beta') ? 'beta' : 'stable')
		}

		// Detect first boot after a backup restore (we run after migrations move 'import' into dataDirectory)
		await this.setBackupRestoreFirstStartFlag()
		await this.auth.start()

		// Start restoring remembered Thunderbolt authorization alongside the
		// other early boot work. Its result is handled here so a later timeout
		// never leaves a rejected promise unobserved.
		const thunderboltAuthorizationRestore = Promise.race([
			this.hardware.thunderbolt
				.reconcile()
				.then(() => true)
				.catch((error) => {
					this.logger.error('Failed to restore Thunderbolt authorization', error)
					return true
				}),
			setTimeout(5_000, false),
		])

		// Restore configured hostname after boot/update (non-blocking)
		restoreHostname(this)

		// Synchronize the system password after OTA update (non-blocking)
		this.user.syncSystemPassword()

		// Restore WiFi connection after OTA update (non-blocking)
		restoreWiFi(this)

		// Restore static IP settings (non-blocking)
		restoreStaticIp(this)

		// Wait for system time to be synced for up to 10 seconds before proceeding
		// We need this on Raspberry Pi since it doesn't have a persistent real time clock.
		// It avoids race conditions where umbrelOS starts making network requests before
		// the local time is set which then fail with SSL cert errors.
		await waitForSystemTime(this, 10)

		// LAN ingress is the browser-facing boundary. Start it before the internal
		// dashboard server and apps so public ports are owned by ingress and app-port
		// nftables rules are in place before app proxies begin accepting traffic.
		await this.lanIngress.start()

		// Revoke restored credentials, pause restored Cloud entries and drop
		// restored app storage move journals before routes or schedulers can
		// observe them. Consume the marker only after every write succeeds.
		if (this.isBackupRestoreFirstStart) {
			await this.mcp.reset()
			await this.files.cloud.pauseRestoredSyncs()
			await this.apps.clearRestoredDataRootMoves()
			await this.consumeBackupRestoreFirstStartFlag()
		}

		// Restore Cloud's persisted destination and deleted-account guards before
		// the dashboard can mutate files. Slower credential maintenance remains
		// part of Files startup and runs in the background.
		await this.files.cloud.restoreProtectionState()

		// Give the early restore up to five seconds to finish before apps inspect
		// attached hardware. A timeout only stops startup from waiting; the original
		// promise continues running and handles its own errors.
		const thunderboltAuthorizationRestored = await thunderboltAuthorizationRestore
		if (!thunderboltAuthorizationRestored) {
			this.logger.error('Timed out waiting for Thunderbolt authorization restore; continuing startup')
		}

		// Initialise modules
		await Promise.all([
			this.user.start(),
			this.files.start(),
			this.hardware.start(),
			this.apps.start(),
			this.appStore.start(),
			this.dbus.start(),
			this.server.start(),
			this.systemNg.start(),
			this.update.start(),
		])

		// Account deletion spans several modules. Retry any cleanup that was
		// interrupted after the member was durably marked as deleted.
		await this.user.finishPendingDeletions()
		await this.photos.start().catch((error) => this.logger.error('Failed to start Photos', error))

		// Apps bind their declared host ports first. Machines then reconcile
		// autostart domains and can report a precise port conflict for restored
		// legacy app state; new app installs consult Machines before binding.
		// Machines is an optional host capability. Persisted VM networking can be
		// temporarily unreconcilable during early boot (for example before a LAN
		// default route exists), but that must never prevent the rest of umbreld
		// from serving the dashboard and retrying normally.
		await this.machines.start().catch((error) => this.logger.error('Failed to start Machines', error))

		// Start backups last because it depends on files
		this.backups.start()

		// Start mcp after the other modules because its startup work (file grant
		// cleanup and the files watcher listener) depends on them being started
		this.mcp.start().catch((error) => this.logger.error('Failed to start MCP', error))
	}

	private async setBackupRestoreFirstStartFlag() {
		try {
			const restoreFlagPath = `${this.dataDirectory}/${BACKUP_RESTORE_FIRST_START_FLAG}`
			if (await fse.pathExists(restoreFlagPath)) {
				this.logger.log('Detected first start after backup restore')
				this.isBackupRestoreFirstStart = true
			}
		} catch (error) {
			this.logger.error('Failed checking backup restore first-start flag', error)
		}
	}

	private async consumeBackupRestoreFirstStartFlag() {
		if (!this.isBackupRestoreFirstStart) return
		const restoreFlagPath = `${this.dataDirectory}/${BACKUP_RESTORE_FIRST_START_FLAG}`
		await fse.remove(restoreFlagPath)
	}

	async stop() {
		// Power actions stop umbreld before handing over to the OS, which then
		// stops it again with SIGTERM. Don't repeat a stop that already completed:
		// by then the OS may be stopping the services it relies on, like libvirt.
		if (this.stopped) return true
		try {
			await Promise.all([
				// Stop file consumers and public listeners before module teardown.
				this.backups.stop(),
				this.lanIngress.stop(),
				this.mcp.stop(),
			])

			// Keep external and network storage mounted until every writer has stopped.
			await Promise.all([this.apps.stop(), this.machines.stop()])
			await this.files.stop()

			// Stop independent modules.
			await Promise.all([
				this.user.stop(),
				this.hardware.stop(),
				this.appStore.stop(),
				this.dbus.stop(),
				this.systemNg.stop(),
				this.update.stop(),
				this.auth.stop(),
				this.photos.stop(),
			])
			this.stopped = true
			return true
		} catch (error) {
			// If we fail to stop gracefully there's not really much we can do, just log the error and return false
			// so it can be handled elsewhere if needed
			this.logger.error(`Failed to stop umbreld`, error)
			return false
		}
	}
}
