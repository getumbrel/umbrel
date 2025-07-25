import fse from 'fs-extra'
import {z} from 'zod'
import yaml from 'js-yaml'

import type Umbreld from '../../index.js'

import {detectDevice} from '../system/system.js'
import {findExternalUmbrelInstall, runPreMigrationChecks, migrateData} from '../migration/migration.js'

async function readYaml(path: string) {
	return yaml.load(await fse.readFile(path, 'utf8'))
}

async function writeYaml(path: string, data: any) {
	return fse.writeFile(path, yaml.dump(data))
}

class Migration {
	umbreld: Umbreld
	logger: Umbreld['logger']

	constructor(umbreld: Umbreld) {
		this.umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())
	}

	// One off migration for legacy custom Linux install users
	async migrateLegacyLinuxData() {
		const {deviceId} = await detectDevice()

		// Only run this on unknown devices AKA not a Home or a Pi
		if (deviceId !== 'unknown') return

		// Don't do anything if a user has already been registered
		if (await this.umbreld.user.exists()) return

		this.logger.log(
			'Unkown device booting for the first time, checking if we need to migrate legacy Linux install data...',
		)

		const externalUmbrelInstall = await findExternalUmbrelInstall()
		if (!externalUmbrelInstall) {
			this.logger.log('No legacy Linux install found, skipping migration')
			return
		}

		this.logger.log('Legacy Linux install found, migrating data...')

		const currentInstall = this.umbreld.dataDirectory
		await runPreMigrationChecks(currentInstall, externalUmbrelInstall as string, this.umbreld, false)
		await this.umbreld.server.start()
		await migrateData(currentInstall, externalUmbrelInstall as string, this.umbreld)
		this.logger.log('Migration complete!')
	}

	async activateImportedDataDirectory() {
		const importData = `${this.umbreld.dataDirectory}/import`
		const importDataExists = await fse.exists(importData)
		if (!importDataExists) return
		this.logger.log('Found Umbrel data to import, activating...')
		// We have to move the import dir parrallel to the data dir and then overwrte.
		// This is because fse.move doesn't work if the source is a subdirectory of the destination.
		// This is fine to do on Umbrel Home because all of /home is on the large data partition.
		// On Rasperry Pi the data partition is small on the SD card and only the data dir on the
		// large external USB storage. We don't currently support data import on Pi so it's ok for now
		// but we'll need to handle this if we want to support it in the future.
		const temporaryData = `${this.umbreld.dataDirectory}-import-temp`
		await fse.move(importData, temporaryData, {overwrite: true})
		await fse.move(temporaryData, this.umbreld.dataDirectory, {overwrite: true})
	}

	async migrateLegacyData() {
		// Check for a legacy <1.0 Umbrel data directory
		const userJsonPath = `${this.umbreld.dataDirectory}/db/user.json`
		const userJsonExists = await fse.exists(userJsonPath)
		if (!userJsonExists) return
		this.logger.log('Found legacy Umbrel data, migrating...')

		// Validate the data
		const legacyDataSchema = z.object({
			name: z.string(),
			password: z.string(),
			installedApps: z.array(z.string()).optional(),
			repos: z.array(z.string()),
			remoteTorAccess: z.boolean().optional(),
			otpUri: z.string().optional(),
		})
		const legacyDataJson = await fse.readJson(userJsonPath)
		const legacyData = legacyDataSchema.parse(legacyDataJson)

		// Migrate data
		await this.umbreld.user.setName(legacyData.name)
		await this.umbreld.user.setHashedPassword(legacyData.password)
		if (legacyData.otpUri) await this.umbreld.user.enable2fa(legacyData.otpUri)
		await this.umbreld.store.set('appRepositories', legacyData.repos)
		if (legacyData.installedApps) await this.umbreld.store.set('apps', legacyData.installedApps)
		if (legacyData.remoteTorAccess) await this.umbreld.store.set('torEnabled', legacyData.remoteTorAccess)

		// Showcase widgets for migrating users
		await this.umbreld.store.set('widgets', ['umbrel:memory', 'umbrel:system-stats', 'umbrel:storage'])

		// Ensure we have app repositories pulled otherwise there will be a race condition where
		// if an app gets started before the repo has completed it's initial pull on startup we'll
		// get the error `App with ID <appId> not found in any repository `
		await this.umbreld.appStore.update()

		// Mark the legacy file as migrated
		await fse.move(userJsonPath, `${userJsonPath}.migrated`)

		// Move the .env file so env vars don't get preserved
		const envPath = `${this.umbreld.dataDirectory}/.env`
		await fse.move(envPath, `${envPath}.migrated`)
		this.logger.log('Migration successful')
	}

	async migrateBackThatMacUpPort() {
		// Check if the Back That Mac Up app is installed
		const isBackThatMacUpInstalled = ((await this.umbreld.store.get('apps')) || []).includes('back-that-mac-up')
		if (!isBackThatMacUpInstalled) return

		// Check if app has already been migrated
		const composePath = `${this.umbreld.dataDirectory}/app-data/back-that-mac-up/docker-compose.yml`
		const newSambaPortMapping = '1445:445'
		const compose = (await readYaml(composePath)) as any
		if (compose.services.timemachine.ports[0] === newSambaPortMapping) return
		this.logger.log('Old Back That Mac Up app found, migrating...')

		// Update the docker-compose.yml file to use the new samba port mapping
		// to avoid collisions with umbrelOS Samba port
		compose.services.timemachine.ports = [newSambaPortMapping]
		await writeYaml(composePath, compose)
		this.logger.log('Back That Mac Up app migrated')

		// Add notification
		await this.umbreld.notifications.add('migrated-back-that-mac-up')
	}

	async migrateDownloadsDirectory() {
		const legacyDownloadsPath = `${this.umbreld.dataDirectory}/data/storage/downloads`
		const newDownloadsPath = `${this.umbreld.files.getBaseDirectory('/Home')}/Downloads`
		const legacyDownloadsPathExists = await fse.exists(legacyDownloadsPath)
		const newDownloadsPathHasData =
			(await fse.exists(newDownloadsPath)) && (await fse.readdir(newDownloadsPath)).length > 0
		if (!legacyDownloadsPathExists || newDownloadsPathHasData) return
		this.logger.log('Found legacy Downloads directory, migrating...')
		await fse.ensureDir(newDownloadsPath)
		await fse.move(legacyDownloadsPath, newDownloadsPath, {overwrite: true})
		this.logger.log('Downloads directory migrated')
	}

	async start() {
		this.logger.log('Checking if any migrations are needed...')

		// Ensure data directory exists
		await fse.ensureDir(this.umbreld.dataDirectory)

		// Check for a data directory to import
		try {
			await this.activateImportedDataDirectory()
		} catch (error) {
			this.logger.error(`Failed to activate imported Umbrel data`, error)
		}

		// Check for a legacy <1.0 Umbrel data directory and migrate to 1.0 format if found
		try {
			await this.migrateLegacyData()
		} catch (error) {
			this.logger.error(`Failed to migrate legacy data`, error)
		}

		// Check for first boot of an unknown device and migrate legacy Linux install data if it exists
		try {
			await this.migrateLegacyLinuxData()
		} catch (error) {
			this.logger.error(`Failed to migrate legacy Linux data`, error)
		}

		// Check for the Back That Mac Up app and migrate it if it exists
		try {
			await this.migrateBackThatMacUpPort()
		} catch (error) {
			this.logger.error(`Failed to migrate Back That Mac Up app`, error)
		}

		// Migrate Downloads directory to Home/Downloads
		try {
			await this.migrateDownloadsDirectory()
		} catch (error) {
			this.logger.error(`Failed to migrate Downloads directory`, error)
		}

		// Write the current version to signal what version we've migrated up to.
		// This also serves as a read/write permission check on the first run.
		await this.umbreld.store.set('version', this.umbreld.version)

		this.logger.log('Migrations complete')
	}
}

export default Migration
