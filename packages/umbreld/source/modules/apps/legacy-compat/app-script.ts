import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'

import {$} from 'execa'

import type Umbreld from '../../../index.js'

export default async function appScript(umbreld: Umbreld, command: string, arg: string) {
	const currentFilename = fileURLToPath(import.meta.url)
	const currentDirname = dirname(currentFilename)
	const scriptPath = join(currentDirname, 'app-script')
	await $({
		stdio: 'inherit',
		env: {
			SCRIPT_UMBREL_ROOT: umbreld.dataDirectory,
			SCRIPT_DOCKER_FRAGMENTS: currentDirname,
		},
	})`${scriptPath} ${command} ${arg}`
}
