import fse from 'fs-extra'
import yaml from 'js-yaml'

import type Umbreld from '../../index.js'
import {type AppRepositoryMeta, type AppManifest} from './schema.js'

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
}
