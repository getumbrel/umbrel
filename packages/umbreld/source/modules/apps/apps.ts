import fse from 'fs-extra'
import {$} from 'execa'

import type Umbreld from '../../index.js'

export default class Apps {
	#umbreld: Umbreld
	logger: Umbreld['logger']

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())
	}

	async start() {
		this.logger.log('Starting apps')
		// TODO: Start apps
	}

	async stop() {
		this.logger.log('Stopping apps')
		// TODO: Stop apps
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

		// echo "Saving app ${app} in DB..."
		// update_installed_apps add "${app}" "${repo}"

		// execute_hook "${app}" "post-install"

		// echo "Successfully installed app ${app}"
		// exit

		return fse.readdir(appDataDirectory)
	}
}
