import fse from 'fs-extra'
import {$} from 'execa'

import type Umbreld from '../../index.js'

import App from './app.js'

export default class Apps {
	#umbreld: Umbreld
	logger: Umbreld['logger']

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

		this.logger.log('Starting apps')
		// TODO: Start apps
	}

	async stop() {
		this.logger.log('Stopping apps')
		// TODO: Stop apps
	}

	async getApps() {
		const appIds = await this.#umbreld.store.get('apps')
		const apps = appIds.map((appId) => new App(this.#umbreld, appId))

		return apps
	}

	async getApp(appId: string) {
		const apps = await this.getApps()
		const app = apps.find((app) => app.id === appId)
		if (!app) throw new Error(`App ${appId} not found`)

		return app
	}

	async install(appId: string) {
		this.logger.log(`Installing app ${appId}`)
		const appTemplatePath = await this.#umbreld.appStore.getAppTemplateFilePath(appId)

		const appTemplateExists = await fse.pathExists(`${appTemplatePath}/umbrel-app.yml`)
		if (!appTemplateExists) throw new Error('App template not found')

		this.logger.verbose(`Setting up data directory for ${appId}`)
		const appDataDirectory = `${this.#umbreld.dataDirectory}/app-data/${appId}`
		await fse.mkdirp(appDataDirectory)

		// We use rsync to copy to preserve permissions
		await $`rsync --archive --verbose --exclude ".gitkeep" ${appTemplatePath}/. ${appDataDirectory}`

		// TODO

		// execute_hook "${app}" "pre-install"

		// # Source env.
		// source_app "${app}"

		// # Now apply templates
		// template_app "${app}"

		// echo "Pulling images for app ${app}..."
		// compose "${app}" pull

		// if [[ "$*" != *"--skip-start"* ]]; then
		//   echo "Starting app ${app}..."
		//   start_app "${app}"
		// fi

		// Save installed app
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const apps = await get('apps')
			apps.push(appId)
			await set('apps', apps)
		})

		// TODO

		// execute_hook "${app}" "post-install"

		// echo "Successfully installed app ${app}"
		// exit

		return true
	}

	async uninstall(appId: string) {
		const app = await this.getApp(appId)

		return app.uninstall()
	}

	async restart(appId: string) {
		const app = await this.getApp(appId)

		return app.restart()
	}

	async update(appId: string) {
		const app = await this.getApp(appId)

		// TODO: Implement update
		return true
	}

	async trackOpen(appId: string) {
		const app = await this.getApp(appId)

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
