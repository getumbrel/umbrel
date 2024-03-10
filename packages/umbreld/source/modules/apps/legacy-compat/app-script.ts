import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'

import {$} from 'execa'

import type Umbreld from '../../../index.js'

export default async function appScript(umbreld: Umbreld, command: string, arg: string, inheritStdio: boolean = true) {
	const currentFilename = fileURLToPath(import.meta.url)
	const currentDirname = dirname(currentFilename)
	const scriptPath = join(currentDirname, 'app-script')
	const SCRIPT_APP_REPO_DIR = await umbreld.appStore.getAppTemplateFilePath(arg)
	return $({
		stdio: inheritStdio ? 'inherit' : 'pipe',
		env: {
			SCRIPT_UMBREL_ROOT: umbreld.dataDirectory,
			SCRIPT_DOCKER_FRAGMENTS: currentDirname,
			JWT_SECRET: await umbreld.server.getJwtSecret(),
			SCRIPT_APP_REPO_DIR,
			BITCOIN_NETWORK: 'mainnet', // Needed for legacy reasons otherwise the Bitcoin app fails to start
		},
	})`${scriptPath} ${command} ${arg}`
}
