import fse from 'fs-extra'
import {$} from 'execa'

import randomToken from '../../modules/utilities/random-token.js'

import type Umbreld from '../../index.js'

import appEnvironment from './legacy-compat/app-environment.js'

import App from './app.js'

export default class Apps {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	instances: App[] = []

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())
	}

	async start() {
		// Set apps to empty array on first start
		if ((await this.#umbreld.store.get('apps')) === undefined) {
			await this.#umbreld.store.set('apps', [])
		}

		// Create a random umbrel seed on first start if one doesn't exist.
		// This is only used to determinstically derive app seed, app password
		// and custom app specific environment variables. It's needed to maintain
		// compatibility with legacy apps. In the future we'll migrate to apps
		// storing their own random seed/password/etc inside their own data directory.
		const umbrelSeedFile = `${this.#umbreld.dataDirectory}/db/umbrel-seed/seed`
		if (!(await fse.exists(umbrelSeedFile))) {
			this.logger.verbose('Creating Umbrel seed')
			await fse.ensureFile(umbrelSeedFile)
			await fse.writeFile(umbrelSeedFile, randomToken(256))
		}

		// Start app environment
		await appEnvironment(this.#umbreld, 'up')

		// Start apps
		this.logger.log('Starting apps')
		const appIds = await this.#umbreld.store.get('apps')
		this.instances = appIds.map((appId) => new App(this.#umbreld, appId))
		await Promise.all(
			this.instances.map((app) =>
				app.start().catch((error) => {
					// We handle individual errors here to prevent apps start from throwing
					// if a dingle app fails.
					this.logger.error(`Failed to start app ${app.id}: ${error.message}`)
				}),
			),
		)
	}

	async stop() {
		this.logger.log('Stopping apps')
		await Promise.all(this.instances.map((app) => app.stop()))
	}

	async isInstalled(appId: string) {
		return this.instances.some((app) => app.id === appId)
	}

	getApp(appId: string) {
		const app = this.instances.find((app) => app.id === appId)
		if (!app) throw new Error(`App ${appId} not found`)

		return app
	}

	async getInstalledApps() {
		return this.instances.map((app) => app.id)
	}

	async install(appId: string) {
		if (await this.isInstalled(appId)) throw new Error(`App ${appId} is already installed`)

		this.logger.log(`Installing app ${appId}`)
		const appTemplatePath = await this.#umbreld.appStore.getAppTemplateFilePath(appId)

		const appTemplateExists = await fse.pathExists(`${appTemplatePath}/umbrel-app.yml`)
		if (!appTemplateExists) throw new Error('App template not found')

		this.logger.verbose(`Setting up data directory for ${appId}`)
		const appDataDirectory = `${this.#umbreld.dataDirectory}/app-data/${appId}`
		await fse.mkdirp(appDataDirectory)

		// We use rsync to copy to preserve permissions
		await $`rsync --archive --verbose --exclude ".gitkeep" ${appTemplatePath}/. ${appDataDirectory}`

		// Save reference to app instance
		const app = new App(this.#umbreld, appId)
		this.instances.push(app)

		// Complete the install process via the app script
		await app.install()

		// Save installed app
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const apps = await get('apps')
			apps.push(appId)
			await set('apps', apps)
		})

		return true
	}

	async uninstall(appId: string) {
		const app = this.getApp(appId)

		await app.uninstall()

		// Remove app instance
		this.instances = this.instances.filter((app) => app.id !== appId)

		return true
	}

	async restart(appId: string) {
		const app = this.getApp(appId)

		return app.restart()
	}

	async update(appId: string) {
		const app = this.getApp(appId)

		return app.update()
	}

	async trackOpen(appId: string) {
		const app = this.getApp(appId)

		// TODO: Implement track open
		return true
	}

	async setTorEnabled(torEnabled: boolean) {
		const currentTorEnabled = await this.#umbreld.store.get('torEnabled')

		// TODO: check if tor is currently in the process of being enabled/disabled

		// Check if we're applying the current setting
		if (currentTorEnabled === torEnabled) {
			throw new Error(`Tor is already ${torEnabled ? 'enabled' : 'disabled'}`)
		}

		// Toggle Tor
		await this.stop()
		await this.#umbreld.store.set('torEnabled', torEnabled)
		await this.start()

		return true
	}

	async getTorEnabled() {
		// TODO: check if tor is currently in the process of being enabled/disabled
		return this.#umbreld.store.get('torEnabled')
	}
}
