import fse from 'fs-extra'
import yaml from 'js-yaml'

import type Umbreld from '../../index.js'
import {type AppManifest} from './schema.js'

import appScript from './legacy-compat/app-script.js'

async function readYaml(path: string) {
	return yaml.load(await fse.readFile(path, 'utf8'))
}

export default class App {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	id: string
	dataDirectory: string

	constructor(umbreld: Umbreld, appId: string) {
		// Throw on invalid appId
		if (!/^[a-zA-Z0-9-_]+$/.test(appId)) throw new Error(`Invalid app ID: ${appId}`)

		this.#umbreld = umbreld
		this.id = appId
		this.dataDirectory = `${umbreld.dataDirectory}/app-data/${this.id}`
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())
	}

	readManifest() {
		return readYaml(`${this.dataDirectory}/umbrel-app.yml`) as Promise<AppManifest>
	}

	async install() {
		// TODO: Do not allow installing if the app is already installed

		await appScript(this.#umbreld, 'install', this.id)

		return true
	}

	async start() {
		// TODO: Implement start
		await appScript(this.#umbreld, 'start', this.id)

		return true
	}

	async stop() {
		// TODO: Implement stop

		await appScript(this.#umbreld, 'stop', this.id)

		return true
	}

	async restart() {
		await this.stop()
		await this.start()

		return true
	}

	async uninstall() {
		await this.stop()
		await fse.remove(this.dataDirectory)

		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			let apps = await get('apps')
			apps = apps.filter((appId) => appId !== this.id)
			await set('apps', apps)
		})

		return true
	}
}
