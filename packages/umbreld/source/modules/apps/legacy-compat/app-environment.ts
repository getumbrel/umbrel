import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'

import {$} from 'execa'

import type Umbreld from '../../../index.js'

export default async function appEnvironment(umbreld: Umbreld, command: string) {
	const currentFilename = fileURLToPath(import.meta.url)
	const currentDirname = dirname(currentFilename)
	const composePath = join(currentDirname, 'docker-compose.yml')
	const torEnabled = await umbreld.store.get('torEnabled')
	const options = {
		stdio: 'inherit',
		cwd: umbreld.dataDirectory,
		env: {
			UMBREL_DATA_DIR: umbreld.dataDirectory,
			// TODO: Load these from somewhere more appropriate
			NETWORK_IP: '10.21.0.0',
			GATEWAY_IP: '10.21.0.1',
			DASHBOARD_IP: '10.21.21.3',
			MANAGER_IP: '10.21.21.4',
			AUTH_IP: '10.21.21.6',
			AUTH_PORT: '2000',
			TOR_PROXY_IP: '10.21.21.11',
			TOR_PROXY_PORT: '9050',
			TOR_PASSWORD: 'mLcLDdt5qqMxlq3wv8Din3UD44bTZHzRFhIktw38kWg=',
			TOR_HASHED_PASSWORD: '16:158FBE422B1A9D996073BE2B9EC38852C70CE12362CA016F8F6859C426',
			UMBREL_AUTH_SECRET: 'DEADBEEF', // Not used, just left in for compatibility reasons
			JWT_SECRET: await umbreld.server.getJwtSecret(),
			UMBRELD_RPC_HOST: `host.docker.internal:${umbreld.server.port}`, // TODO: Check host.docker.internal works on linux
			UMBREL_LEGACY_COMPAT_DIR: currentDirname,
			UMBREL_TORRC: torEnabled ? `${currentDirname}/tor-server-torrc` : `${currentDirname}/tor-proxy-torrc`,
		},
	}
	if (command === 'up') {
		await $(
			options as any,
		)`docker compose --project-name umbrel --file ${composePath} ${command} --build --detach --remove-orphans`
	} else {
		await $(options as any)`docker compose --project-name umbrel --file ${composePath} ${command}`
	}
}
