import fse from 'fs-extra'
import yaml from 'js-yaml'
import {type Compose} from 'compose-spec-schema'

import type Umbreld from '../../index.js'
import {type AppManifest} from './schema.js'

import appScript from './legacy-compat/app-script.js'

async function readYaml(path: string) {
	return yaml.load(await fse.readFile(path, 'utf8'))
}

async function writeYaml(path: string, data: any) {
	return fse.writeFile(path, yaml.dump(data))
}

type AppState =
	| 'unknown'
	| 'installing'
	| 'starting'
	| 'running'
	| 'stopping'
	| 'stopped'
	| 'restarting'
	| 'uninstalling'
	| 'updating'
	| 'ready'
// TODO: Change ready to running.
// Also note that we don't currently handle failing events to update the app state into a failed state.
// That should be ok for now since apps rarely fail, but there will be the potential for state bugs here
// where the app instance state gets out of sync with the actual state of the app.
// We can handle this much more robustly in the future.

export default class App {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	id: string
	dataDirectory: string
	state: AppState = 'unknown'
	stateProgress = 0

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

	readCompose() {
		return readYaml(`${this.dataDirectory}/docker-compose.yml`) as Promise<Compose>
	}

	writeCompose(compose: Compose) {
		return writeYaml(`${this.dataDirectory}/docker-compose.yml`, compose)
	}

	async install() {
		this.state = 'installing'
		// Temporary patch to fix contianer names for modern docker-compose installs.
		// The contianer name scheme used to be <project-name>_<service-name>_1 but
		// recent versions of docker-compose use <project-name>-<service-name>-1
		// swapping underscores for dashes. This breaks Umbrel in places where the
		// containers are referenced via name and it also breaks referring to other
		// containers via DNS since the hostnames are derived with the same method.
		// We manually force all container names to the old scheme to maintain compatibility.
		const compose = await this.readCompose()
		for (const serviceName of Object.keys(compose.services!)) {
			compose.services![serviceName].container_name = `${this.id}_${serviceName}_1`
		}

		await this.writeCompose(compose)

		// TODO: Pull images here before the install script and calculate live progress for
		// this.stateProgress so button animations work

		await appScript(this.#umbreld, 'install', this.id)
		this.state = 'ready'

		return true
	}

	async start() {
		this.logger.log(`Starting app ${this.id}`)
		this.state = 'starting'
		await appScript(this.#umbreld, 'start', this.id)
		this.state = 'ready'

		return true
	}

	async stop() {
		this.state = 'stopping'
		await appScript(this.#umbreld, 'stop', this.id)
		this.state = 'stopped'

		return true
	}

	async restart() {
		this.state = 'restarting'
		await appScript(this.#umbreld, 'stop', this.id)
		await appScript(this.#umbreld, 'start', this.id)
		this.state = 'ready'

		return true
	}

	async uninstall() {
		this.state = 'uninstalling'
		await appScript(this.#umbreld, 'stop', this.id)
		await fse.remove(this.dataDirectory)

		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			let apps = await get('apps')
			apps = apps.filter((appId) => appId !== this.id)
			await set('apps', apps)
		})

		return true
	}
}
