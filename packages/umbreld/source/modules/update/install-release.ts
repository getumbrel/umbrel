import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'

import {$} from 'execa'
import fse from 'fs-extra'

import {detectDevice} from '../system/system.ts'
import {floorToTenthPercent} from '../utilities/progress.ts'
import {getBootFlow, installUpdateBundle} from './rugix.ts'
import {
	MANIFEST_FILE,
	ReleaseVerificationError,
	UpdateError,
	findUpdateBundle,
	findUpdateScript,
	readBody,
	releaseFileUrl,
	type ReleaseManifest,
} from './release-signing.ts'

// The version of what update scripts are given. Later versions only add to it.
export const UPDATE_SCRIPT_INTERFACE = '1'

export type InstallStatus = {progress?: number; description?: string}

// This device's architecture by Debian's name for it, like the manifest uses
export const getArch = () => (({x64: 'amd64', arm64: 'arm64'}) as Record<string, string>)[process.arch] ?? process.arch

// The boot flow and architecture that pick what a device installs from a release
export async function getDevice() {
	return {bootFlow: await getBootFlow(), arch: getArch()}
}

// Install a release on this device, ready to boot into on the next restart. The device installs the
// release's update bundle for it, checked against the bundle hash the manifest pins, unless the release
// has an update script for it, which runs first and can install the release itself.
export async function installRelease({
	releaseUrl,
	manifest,
	release,
	installedVersion,
	onStatus = () => {},
}: {
	releaseUrl: string
	// The manifest's text, which the update script is given
	manifest: string
	release: ReleaseManifest
	installedVersion: string
	onStatus?: (status: InstallStatus) => void
}) {
	const device = await getDevice()
	const bundle = findUpdateBundle(release, device)
	const script = findUpdateScript(release, device)
	const noUpdate = () => new UpdateError(`umbrelOS ${release.version} doesn't include an update for this device`)
	if (!bundle && !script) throw noUpdate()

	if (script) {
		const {installed} = await runUpdateScript({
			releaseUrl,
			manifest,
			release,
			installedVersion,
			script,
			bundle,
			device,
			onStatus,
		})
		if (installed) return
	}

	if (!bundle) throw noUpdate()
	await installUpdateBundle(releaseFileUrl(releaseUrl, bundle.name), {bundleHash: bundle.bundleHash}, (progress) =>
		onStatus({progress}),
	)
}

// Run a release's update script as root, which can fix something on the device before the update bundle
// installs, or install the release itself. It's downloaded in full and checked against the manifest
// before it runs, so nothing the download server changes can run. It's run directly, so it needs a #!
// line, from a directory of its own with the manifest beside it.
//
// It's given what it needs in environment variables:
//
//   UMBREL_UPDATE_SCRIPT_INTERFACE  1, which only changes when later versions give scripts more
//   UMBREL_RELEASE_URL              The release's directory URL, ending in /, which the update server
//                                   chose, so check anything downloaded from it against the manifest
//   UMBREL_RELEASE_MANIFEST         The path to the release's manifest, which was verified
//   UMBREL_RELEASE_VERSION          The release's version
//   UMBREL_INSTALLED_VERSION        The version installed now
//   UMBREL_UPDATE_BUNDLE            The update bundle the device would install, or empty if there's none
//   UMBREL_UPDATE_BUNDLE_HASH       That bundle's Rugix bundle hash
//   UMBREL_BOOT_FLOW                The device's Rugix boot flow, like grub, or empty if it has none
//   UMBREL_ARCH                     The device's Debian architecture, like amd64
//   UMBREL_DEVICE_ID                The device's ID, like umbrel-home, or unknown
//
// It reports back with lines like the update scripts umbrelOS ran before releases were signed:
//
//   umbrel-update: {"progress": 40, "description": "Migrating..."}
//   umbrel-update: {"error": "The message to show if the script fails"}
//   umbrel-update: {"installed": true}
//
// The last says the script installed the release itself, so the device restarts into it without
// installing the update bundle. Rugix's progress events, from `rugix-ctrl update install`, are reported
// too. If the script exits with an error the update stops, showing the script's error if it reported one.
async function runUpdateScript({
	releaseUrl,
	manifest,
	release,
	installedVersion,
	script,
	bundle,
	device,
	onStatus,
}: {
	releaseUrl: string
	manifest: string
	release: ReleaseManifest
	installedVersion: string
	script: {name: string; sha256: string}
	bundle?: {name: string; bundleHash: string}
	device: {bootFlow?: string; arch: string}
	onStatus: (status: InstallStatus) => void
}) {
	const response = await fetch(releaseFileUrl(releaseUrl, script.name), {
		headers: {'User-Agent': `umbrelOS ${installedVersion}`},
		signal: AbortSignal.timeout(60_000),
	})
	if (!response.ok) throw new Error(`Failed to download the update script: HTTP ${response.status}`)
	const contents = await readBody(response, 16 * 1024 * 1024)
	if (crypto.createHash('sha256').update(contents).digest('hex') !== script.sha256) {
		throw new ReleaseVerificationError("The update script doesn't match the signed release")
	}

	let deviceId = 'unknown'
	try {
		deviceId = (await detectDevice()).deviceId
	} catch {
		// The script can tell from unknown
	}

	const directory = await fse.mkdtemp(path.join(os.tmpdir(), 'umbreld-update-script-'))
	try {
		const scriptPath = `${directory}/${script.name}`
		await fse.writeFile(scriptPath, contents, {mode: 0o700})
		await fse.writeFile(`${directory}/${MANIFEST_FILE}`, manifest)

		const child = $({
			cwd: directory,
			all: true,
			env: {
				UMBREL_UPDATE_SCRIPT_INTERFACE: UPDATE_SCRIPT_INTERFACE,
				UMBREL_RELEASE_URL: releaseUrl,
				UMBREL_RELEASE_MANIFEST: `${directory}/${MANIFEST_FILE}`,
				UMBREL_RELEASE_VERSION: release.version,
				UMBREL_INSTALLED_VERSION: installedVersion,
				UMBREL_UPDATE_BUNDLE: bundle?.name ?? '',
				UMBREL_UPDATE_BUNDLE_HASH: bundle?.bundleHash ?? '',
				UMBREL_BOOT_FLOW: device.bootFlow ?? '',
				UMBREL_ARCH: device.arch,
				UMBREL_DEVICE_ID: deviceId,
			},
		})`${scriptPath}`

		let installed = false
		let error: string | undefined
		let previousProgress = 0
		readline.createInterface({input: child.all!}).on('line', (line) => {
			try {
				if (line.startsWith('umbrel-update: ')) {
					const report = JSON.parse(line.slice('umbrel-update: '.length))
					if (typeof report.error === 'string') error = report.error
					if (report.installed === true) installed = true
					const status = {
						...(typeof report.progress === 'number' && {progress: report.progress}),
						...(typeof report.description === 'string' && {description: report.description}),
					}
					if (Object.keys(status).length > 0) onStatus(status)
					return
				}

				// Only report each 0.1% step of Rugix's progress to avoid spamming events
				const event = JSON.parse(line) as {event: string; progress: number}
				if (event.event !== 'UpdateProgress' || typeof event.progress !== 'number') return
				const progress = floorToTenthPercent(event.progress)
				if (progress > previousProgress) {
					previousProgress = progress
					onStatus({progress})
				}
			} catch {
				// Not a report
			}
		})

		await child.catch((cause) => {
			throw new UpdateError(error ?? 'The update script failed', {cause})
		})
		return {installed}
	} finally {
		await fse.remove(directory)
	}
}
