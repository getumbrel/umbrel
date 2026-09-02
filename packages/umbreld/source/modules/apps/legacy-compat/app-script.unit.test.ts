import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {chmod, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'

import {describe, expect, test} from 'vitest'
import {$} from 'execa'
import fse from 'fs-extra'

const currentDirname = dirname(fileURLToPath(import.meta.url))
const appScriptPath = join(currentDirname, 'app-script')

const hostNetworkCompose = `version: "3.7"

services:
  server:
    image: example/host-net:latest
    network_mode: host
`

const appProxyCompose = `version: "3.7"

services:
  app_proxy:
    environment:
      APP_HOST: example_server_1
      APP_PORT: 3000
  server:
    image: example/app:latest
`

const yqStub = `#!/usr/bin/env bash
set -euo pipefail
args=("$@")
if [[ "\${args[0]:-}" == "e" ]]; then
  args=("\${args[@]:1}")
fi
expr="\${args[0]:-}"
file="\${args[1]:-}"
if [[ -n "\${file}" ]]; then
  input=$(cat "\${file}")
else
  input=$(cat)
fi

case "\${expr}" in
  .port)
    printf '%s\\n' "$(printf '%s\\n' "\${input}" | sed -n 's/^port:[[:space:]]*//p' | tr -d '"' | head -1)"
    ;;
  .version)
    printf '%s\\n' "$(printf '%s\\n' "\${input}" | sed -n 's/^version:[[:space:]]*//p' | tr -d '"' | head -1)"
    ;;
  '.dependencies[]')
    exit 0
    ;;
  *)
    if [[ "\${expr}" == *'has("app_proxy")'* ]]; then
      if printf '%s\\n' "\${input}" | grep -qE '^[[:space:]]*app_proxy:'; then
        echo true
      else
        echo false
      fi
    else
      echo "unexpected yq: \${expr}" >&2
      exit 1
    fi
    ;;
esac
`

const harness = `#!/usr/bin/env bash
set -euo pipefail
# Load function definitions without executing the CLI
source "\${APP_SCRIPT_FUNCTIONS}"
app="\${APP_ID}"
app_data_dir="\${UMBREL_ROOT}/app-data/\${app}"
app_hidden_service_file="\${UMBREL_ROOT}/tor/data/app-\${app}/hostname"
source_app "\${app}"
printf '%s\\n' "\${TOR_HS_PORTS}"
`

async function torHsPortsForApp({
	appId,
	port,
	compose,
}: {
	appId: string
	port: number
	compose: string
}): Promise<string> {
	const tempRoot = await mkdtemp(join(tmpdir(), 'umbrel-app-script-'))
	try {
		const umbrelRoot = join(tempRoot, 'umbrel')
		const binDir = join(tempRoot, 'bin')
		const appDataDir = join(umbrelRoot, 'app-data', appId)
		const functionsFile = join(tempRoot, 'app-script-fns')
		const harnessFile = join(tempRoot, 'harness.sh')
		const yqFile = join(binDir, 'yq')

		await fse.ensureDir(binDir)
		await fse.ensureDir(join(umbrelRoot, 'db/umbrel-seed'))
		await fse.ensureDir(appDataDir)
		await writeFile(join(umbrelRoot, 'db/umbrel-seed/seed'), 'test-seed\n')
		await writeFile(join(umbrelRoot, 'umbrel.yaml'), 'apps: []\n')
		await writeFile(
			join(appDataDir, 'umbrel-app.yml'),
			`manifestVersion: 1
id: ${appId}
name: Test
version: "1.0.0"
port: ${port}
dependencies: []
`,
		)
		await writeFile(join(appDataDir, 'docker-compose.yml'), compose)

		const {stdout: functions} = await $`sed ${'/^# Check dependencies$/,$d'} ${appScriptPath}`
		await writeFile(functionsFile, functions)
		await writeFile(harnessFile, harness)
		await writeFile(yqFile, yqStub)
		await chmod(harnessFile, 0o755)
		await chmod(yqFile, 0o755)

		const {stdout} = await $({
			env: {
				...process.env,
				PATH: `${binDir}:${process.env.PATH}`,
				SCRIPT_UMBREL_ROOT: umbrelRoot,
				SCRIPT_DOCKER_FRAGMENTS: currentDirname,
				APP_SCRIPT_FUNCTIONS: functionsFile,
				APP_ID: appId,
				REMOTE_TOR_ACCESS: 'true',
			},
		})`bash ${harnessFile}`

		return stdout.trim()
	} finally {
		await rm(tempRoot, {recursive: true, force: true})
	}
}

describe('source_app TOR_HS_PORTS', () => {
	test('host-networked apps without app_proxy target the docker gateway', async () => {
		const ports = await torHsPortsForApp({
			appId: 'pi-hole',
			port: 8082,
			compose: hostNetworkCompose,
		})
		expect(ports).toBe('80:10.21.0.1:8082')
		expect(ports).not.toMatch(/app_proxy_/)
	})

	test('host-networked Tailscale without app_proxy targets the docker gateway', async () => {
		const ports = await torHsPortsForApp({
			appId: 'tailscale',
			port: 8240,
			compose: hostNetworkCompose.replace('network_mode: host', 'network_mode: "host"'),
		})
		expect(ports).toBe('80:10.21.0.1:8240')
	})

	test('apps with an app_proxy service also target the docker gateway', async () => {
		const ports = await torHsPortsForApp({
			appId: 'sparkles-hello-world',
			port: 4000,
			compose: appProxyCompose,
		})
		expect(ports).toBe('80:10.21.0.1:4000')
		expect(ports).not.toMatch(/app_proxy_/)
	})
})
