import process from 'node:process'
import {setTimeout} from 'node:timers/promises'
import {parseArgs} from 'node:util'

import packageJson from '../../../package.json' with {type: 'json'}

import {trpc} from '../cli-client.ts'
import {reboot} from '../system/system.ts'
import {installRelease, type InstallStatus} from './install-release.ts'
import {installUpdateBundle} from './rugix.ts'
import {downloadReleaseManifest, parseReleaseManifest, releaseDirectoryUrl} from './release-signing.ts'

const usage = `
    Usage
        $ umbreld update [<release url>]
        $ umbreld update --skip-signature-check <release url>
        $ umbreld update --skip-signature-check <update bundle url or file>

    Installs the latest signed umbrelOS release through the running umbreld, like
    the update button in Settings. Given a release URL, like a test build's
    https://download.umbrel.com/public-<name>/, it installs that signed release
    instead, whatever its version.

    With --skip-signature-check, installs a release without checking that an
    approved key signed it. It still picks this device's update bundle and
    update script from the release's manifest and checks them against it, but
    nothing checks the manifest itself, so that only catches corrupted
    downloads, not tampering. Given an update bundle, it installs it with no
    checks at all. Only use this for builds you trust.

    Examples
        $ sudo umbreld update
        $ sudo umbreld update https://download.umbrel.com/public-machines-usb/
        $ sudo umbreld update --skip-signature-check ./umbrelos-amd64.update
`

// Installs that skip signature verification run here as root rather than through umbreld's API, so
// nothing the UI can reach is able to skip it
async function installUnverified(
	description: string,
	install: (onStatus: (status: InstallStatus) => void) => Promise<void>,
) {
	if (process.getuid?.() !== 0) throw new Error('Installing an update without verification needs root')

	// This works without umbreld running, but shouldn't race an update it's installing
	const status = await Promise.race([trpc.update.status.query(), setTimeout(5000)]).catch(() => undefined)
	if (status?.running) throw new Error('umbreld is already installing an update')

	console.warn(`Installing ${description} WITHOUT checking its signature`)
	// Progress comes in 0.1% steps, so only whole percents are printed
	let reportedProgress = -1
	await install(({progress, description}) => {
		if (description) console.log(description)
		if (progress !== undefined && Math.floor(progress) > reportedProgress) {
			reportedProgress = Math.floor(progress)
			console.log(`Update progress: ${reportedProgress}%`)
		}
	})
	console.log('Update installed, restarting...')
	await reboot()
}

// Installed like a signed release, from a manifest nobody has verified
async function installUnverifiedRelease(url: string) {
	const releaseUrl = releaseDirectoryUrl(url)
	const manifest = await downloadReleaseManifest(releaseUrl, 'umbreld update')
	const release = parseReleaseManifest(manifest)
	await installUnverified(`${release.name} (${release.version}) from ${releaseUrl}`, (onStatus) =>
		installRelease({releaseUrl, manifest, release, installedVersion: packageJson.version, onStatus}),
	)
}

const installUnverifiedBundle = (bundle: string) =>
	installUnverified(bundle, (onStatus) =>
		installUpdateBundle(bundle, {insecureSkipVerification: true}, (progress) => onStatus({progress})),
	)

type UpdateStatus = Awaited<ReturnType<typeof trpc.update.status.query>>

// Whether a status shows the update installed, so it's restarting into it
const isInstalled = (status?: UpdateStatus) => !!status && !status.error && status.progress === 100

// Install a signed release through umbreld, which verifies it: the latest one, or the one at releaseUrl
async function installSignedRelease(releaseUrl?: string) {
	const release = await trpc.update.check.query({releaseUrl})
	if (!releaseUrl && !release.available) {
		return console.log("There's no newer umbrelOS release for this device")
	}
	console.log(`Installing ${release.name} (${release.version})${release.available ? '' : ", which isn't newer"}`)

	// umbreld restarts into the update once it's installed, which can drop the connection before it
	// responds, so follow the update status as well
	let result: {success: boolean} | {error: unknown} | undefined
	trpc.update.install.mutate({releaseUrl, manifestHash: release.manifestHash}).then(
		(success) => (result = {success}),
		(error) => (result = {error}),
	)
	let status: UpdateStatus | undefined
	let reportedProgress = -1
	while (!result) {
		const latestStatus = await trpc.update.status.query().catch(() => undefined)
		// umbreld stopped to restart
		if (!latestStatus) break
		status = latestStatus
		// Progress comes in 0.1% steps, so only whole percents are printed
		if (status.running && Math.floor(status.progress) > reportedProgress) {
			reportedProgress = Math.floor(status.progress)
			console.log(`Update progress: ${reportedProgress}%`)
		}
		await setTimeout(1000)
	}

	if (result && 'success' in result && !result.success) {
		const {error} = await trpc.update.status.query()
		throw new Error(typeof error === 'string' ? error : 'Update failed')
	}
	// An error umbreld sent, like another update already running, rather than a dropped connection
	if (result && 'error' in result && (result.error as {data?: {code?: string}}).data?.code) throw result.error
	if (!(result && 'success' in result) && !isInstalled(status)) {
		throw new Error('Lost the connection to umbreld before the update installed')
	}
	console.log('Update installed, restarting...')
}

export async function updateCli(args: string[]) {
	const {positionals, values} = parseArgs({
		args,
		allowPositionals: true,
		options: {'skip-signature-check': {type: 'boolean'}, help: {type: 'boolean'}},
	})
	const [target, ...extra] = positionals

	if (values.help) return console.log(usage)
	if (extra.length > 0 || (values['skip-signature-check'] && !target)) {
		console.error(usage)
		process.exitCode = 1
		return
	}

	if (!values['skip-signature-check']) return installSignedRelease(target)
	// An update bundle rather than a release
	if (target.endsWith('.update')) return installUnverifiedBundle(target)
	return installUnverifiedRelease(target)
}
