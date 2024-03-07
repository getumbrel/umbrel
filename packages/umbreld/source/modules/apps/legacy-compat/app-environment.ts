import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'

import {$} from 'execa'

import type Umbreld from '../../../index.js'

export default async function appEnvironment(umbreld: Umbreld, command: string) {
	const currentFilename = fileURLToPath(import.meta.url)
	const currentDirname = dirname(currentFilename)
	const composePath = join(currentDirname, 'docker-compose.yml')
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
			UMBREL_AUTH_SECRET: 'DEADBEEF',
			JWT_SECRET: await umbreld.server.getJwtSecret(),
			UMBRELD_RPC_HOST: `host.docker.internal:${umbreld.server.port}`, // TODO: Check host.docker.internal works on linux
		},
	}
	if (command === 'up') {
		await $(options as any)`docker-compose --project-name umbrel --file ${composePath} ${command} --build --detach`
	}
	await $(options as any)`docker-compose --project-name umbrel --file ${composePath} ${command}`
}
