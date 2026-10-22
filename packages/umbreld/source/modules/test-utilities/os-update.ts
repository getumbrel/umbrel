import fs from 'node:fs'
import http from 'node:http'
import type {AddressInfo} from 'node:net'
import path from 'node:path'
import {pipeline} from 'node:stream/promises'
import {fileURLToPath} from 'node:url'

import {$} from 'execa'
import pWaitFor from 'p-wait-for'

import type {createTestVm} from './create-test-umbreld.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const repoDirectory = path.resolve(currentDirectory, '../../../../..')
const osBuildDirectory = path.join(repoDirectory, 'packages/os/build')

// The OS update bundle built alongside the VM image by `npm run build:amd64:rugix` in packages/os
export const updateBundle = path.join(osBuildDirectory, 'umbrelos-amd64.update')

type TestVm = Awaited<ReturnType<typeof createTestVm>>

// Download a released umbrelOS amd64 image, e.g. to boot a VM from and update it to this build
export async function downloadReleaseImage(version: string) {
	const image = path.join(osBuildDirectory, 'releases', `umbrelos-amd64-${version}.img`)
	if (!fs.existsSync(image)) {
		await fs.promises.mkdir(path.dirname(image), {recursive: true})
		const url = `https://download.umbrel.com/release/${version}/umbrelos-amd64.img.xz`
		await $`bash -c ${'set -o pipefail; curl --fail --silent --show-error --location --retry 5 "$0" | xz --decompress --threads=0 > "$1"'} ${url} ${`${image}.partial`}`
		await fs.promises.rename(`${image}.partial`, image)
	}
	return image
}

// Serve the update bundle over HTTP, with range request support like the real download server.
// VMs reach it at http://10.0.2.2:<port>.
export async function serveUpdateBundle() {
	const {size} = await fs.promises.stat(updateBundle)
	const requestedPaths: string[] = []
	const server = http.createServer((request, response) => {
		requestedPaths.push(request.url ?? '')
		const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
		const start = range ? Number(range[1]) : 0
		const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1
		response.writeHead(range ? 206 : 200, {
			'Accept-Ranges': 'bytes',
			'Content-Length': end - start + 1,
			...(range && {'Content-Range': `bytes ${start}-${end}/${size}`}),
		})
		if (request.method === 'HEAD') return response.end()
		pipeline(fs.createReadStream(updateBundle, {start, end}), response).catch(() => {})
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const {port} = server.address() as AddressInfo

	return {
		port,
		requestedPaths,
		async close() {
			server.closeAllConnections()
			await new Promise((resolve) => server.close(resolve))
		},
	}
}

// Run the OS update script as root the way umbreld does, but downloading the bundle from the
// test host instead of the release server. Returns the script's output.
export async function runUpdateScript(umbreld: TestVm, bundleServerPort: number) {
	const script = (await fs.promises.readFile(path.join(repoDirectory, 'scripts/update-script'), 'utf8')).replace(
		/^download_prefix=.*$/m,
		`download_prefix="http://10.0.2.2:${bundleServerPort}"`,
	)
	const encodedScript = Buffer.from(script).toString('base64')
	return umbreld.vm.sshAsRoot(
		`printf '%s' '${encodedScript}' | base64 -d > /tmp/update-script && bash /tmp/update-script`,
	)
}

// Rugix's view of the A/B boot slots and its version
export async function getRugixState(umbreld: TestVm) {
	// Rugix Ctrl 0.8 also prints a human-readable summary to stderr
	const info = JSON.parse(await umbreld.vm.sshAsRoot('rugix-ctrl system info --json 2>/dev/null'))
	return {
		version: (await umbreld.vm.sshAsRoot('rugix-ctrl --version')).trim(),
		bootFlow: info.boot?.bootFlow as string | undefined,
		activeGroup: info.boot?.activeGroup as string | undefined,
		defaultGroup: info.boot?.defaultGroup as string | undefined,
	}
}

async function getBootId(umbreld: TestVm) {
	return (await umbreld.vm.sshAsRoot('cat /proc/sys/kernel/random/boot_id')).trim()
}

// Run an action that reboots the device, then wait for umbreld to come back and log in again
export async function rebootAndWaitForUmbreld(umbreld: TestVm, action: () => Promise<unknown> | void) {
	const bootId = await getBootId(umbreld)
	await action()
	await pWaitFor(async () => (await getBootId(umbreld).catch(() => bootId)) !== bootId, {
		interval: 5000,
		timeout: 600_000,
	})
	await umbreld.waitForStartup({waitForUser: true})
	await umbreld.login()
}

// Reboot like umbreld does after a successful update. This doesn't go through umbreld's restart,
// which stops umbreld first and hung on a 1.6.1 VM in testing, as this tests the OS update rather
// than how old releases shut down.
export async function reboot(umbreld: TestVm) {
	await umbreld.vm.sshAsRoot('systemd-run --on-active=1 systemctl reboot')
}

// Wait for umbreld to commit the slot it booted into
export async function waitForCommittedBoot(umbreld: TestVm) {
	let state!: Awaited<ReturnType<typeof getRugixState>>
	await pWaitFor(
		async () => {
			state = await getRugixState(umbreld)
			return state.activeGroup !== undefined && state.activeGroup === state.defaultGroup
		},
		{interval: 2000, timeout: 120_000},
	)
	return state
}
