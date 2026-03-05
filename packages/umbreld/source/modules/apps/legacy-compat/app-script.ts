import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'

import {$} from 'execa'

import type Umbreld from '../../../index.js'

export default async function appScript(umbreld: Umbreld, command: string, arg: string, inheritStdio: boolean = true) {
	// Prevent breaking test output
	if (process.env.TEST === 'true') inheritStdio = false

	const currentFilename = fileURLToPath(import.meta.url)
	const currentDirname = dirname(currentFilename)
	const scriptPath = join(currentDirname, 'app-script')
	// Allow repo to be unset, needed if the repo hasn't been pulled yet after a mmigration
	// or a 3rd party app had it's repo uninstalled.
	let SCRIPT_APP_REPO_DIR = ''
	try {
		SCRIPT_APP_REPO_DIR = await umbreld.appStore.getAppTemplateFilePath(arg)
	} catch {}
	const torEnabled = await umbreld.store.get('torEnabled')
	return $({
		stdio: inheritStdio ? 'inherit' : 'pipe',
		env: {
			SCRIPT_UMBREL_ROOT: umbreld.dataDirectory,
			SCRIPT_DOCKER_FRAGMENTS: currentDirname,
			JWT_SECRET: await umbreld.server.getJwtSecret(),
			SCRIPT_APP_REPO_DIR,
			BITCOIN_NETWORK: 'mainnet', // Needed for legacy reasons otherwise the Bitcoin app fails to start
			TOR_PROXY_IP: '10.21.21.11',
			TOR_PROXY_PORT: '9050',
			TOR_PASSWORD: 'mLcLDdt5qqMxlq3wv8Din3UD44bTZHzRFhIktw38kWg=',
			TOR_HASHED_PASSWORD: '16:158FBE422B1A9D996073BE2B9EC38852C70CE12362CA016F8F6859C426',
			REMOTE_TOR_ACCESS: torEnabled ? 'true' : 'false',
		},
	})`${scriptPath} ${command} ${arg}`
}
