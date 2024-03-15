import crypto from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'

import fetch from 'node-fetch'
import fse from 'fs-extra'
import {$} from 'execa'

// Quickly hack together some yq install logic based on the old install bash script.
// We'll remove this soon along with most of the other apt deps
async function downloadAndInstallYq() {
	const yqSha256 = {
		arm64: '8879e61c0b3b70908160535ea358ec67989ac4435435510e1fcb2eda5d74a0e9',
		amd64: 'c93a696e13d3076e473c3a43c06fdb98fafd30dc2f43bc771c4917531961c760',
	}

	const yqVersion = 'v4.24.5'
	const yqTempFile = '/tmp/yq'

	try {
		// Get system architecture
		const systemArch = (process.arch === 'arm64' ? 'arm64' : 'amd64') as 'arm64' | 'amd64'

		const yqBinary = `yq_linux_${systemArch}`
		const yqUrl = `https://github.com/mikefarah/yq/releases/download/${yqVersion}/${yqBinary}`

		// Download yq binary
		const response = await fetch(yqUrl)
		if (!response.ok) throw new Error(`Failed to download yq: ${response.statusText}`)

		// Save the downloaded binary to a temp file
		await fse.writeFile(yqTempFile, Buffer.from(await response.arrayBuffer()))

		// Calculate the SHA256 checksum of the downloaded file
		const fileBuffer = await fse.readFile(yqTempFile)
		const hashSum = crypto.createHash('sha256')
		hashSum.update(fileBuffer)
		const hex = hashSum.digest('hex')

		// Verify checksum and install yq
		if (hex === yqSha256[systemArch]) {
			await $`mv ${yqTempFile} /usr/bin/yq`
			await $`chmod +x /usr/bin/yq`
			console.log('yq installed successfully...')
		} else {
			console.error('yq install failed. sha256sum mismatch')
			process.exit(1)
		}
	} catch (error) {
		console.error(`Error installing yq: ${(error as Error).message}`)
		process.exit(1)
	}
}

// Install systemd service
async function installService() {
	const currentFilename = fileURLToPath(import.meta.url)
	const currentDirname = dirname(currentFilename)
	const servicePath = join(currentDirname, 'umbrel.service')

	try {
		// Read the service file
		const serviceFile = await fse.readFile(servicePath, 'utf8')

		// Write the service file to the systemd directory
		await fse.writeFile('/etc/systemd/system/umbrel.service', serviceFile)

		// Create relative symlinks for manual enabling
		await fse.symlink('../umbrel.service', '/etc/systemd/system/multi-user.target.wants/umbrel.service')

		console.log('Systemd service installed successfully...')
	} catch (error) {
		console.error(`Error installing systemd service: ${(error as Error).message}`)
		process.exit(1)
	}
}

// TODO: Tidy this up, we should do auto detection for deps etc
export default async function provision() {
	const dockerVersion = 'v25.0.4'
	const commitHash = '0efeea282625c87d28fa1f0d7aace794be2ce3cd'
	const dockerInstallScriptUrl = `https://raw.githubusercontent.com/docker/docker-install/${commitHash}/install.sh`
	const dockerInstallScript = await (await fetch(dockerInstallScriptUrl)).text()
	await fse.writeFile('/tmp/install-docker.sh', dockerInstallScript)
	await $({
		stdio: 'inherit',
		env: {VERSION: dockerVersion},
	})`sh /tmp/install-docker.sh`
	await fse.remove('/tmp/install-docker.sh')
	await $({
		stdio: 'inherit',
	})`apt-get install --yes network-manager python3 fswatch jq rsync curl git gettext-base python3 gnupg avahi-daemon avahi-discover libnss-mdns`
	await downloadAndInstallYq()
	await installService()
}
