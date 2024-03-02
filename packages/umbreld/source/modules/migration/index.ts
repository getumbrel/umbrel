import fse from 'fs-extra'
import {z} from 'zod'

import type Umbreld from '../../index.js'

class Migration {
	umbreld: Umbreld
	logger: Umbreld['logger']

	constructor(umbreld: Umbreld) {
		this.umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())
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

		// Ensure we have app repositories pulled otherwise there will be a race condition where
		// if an app gets started before the repo has completed it's initial pull on startup we'll
		// get the error `App with ID <appId> not found in any repository `
		await this.umbreld.appStore.update()

		// Mark the legacy file as migrated
		await fse.move(userJsonPath, `${userJsonPath}.migrated`)
		this.logger.log('Migration successful')
	}

	async start() {
		// Ensure data directory exists
		await fse.ensureDir(this.umbreld.dataDirectory)

		// Check for a legacy <1.0 Umbrel data directory and migrate to 1.0 format if found
		try {
			await this.migrateLegacyData()
		} catch (error) {
			this.logger.error(`Failed to migrate legacy data: ${(error as Error).message}`)
		}

		// Write the current version to signal what version we've migrated up to.
		// This also serves as a read/write permission check on the first run.
		await this.umbreld.store.set('version', this.umbreld.version)
	}
}

export default Migration
