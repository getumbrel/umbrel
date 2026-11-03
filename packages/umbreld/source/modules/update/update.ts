import crypto from 'node:crypto'

import semver from 'semver'

import type Umbreld from '../../index.ts'
import type {ProgressStatus} from '../apps/schema.ts'
import {detectDevice, isUmbrelOS} from '../system/system.ts'
import SigningKeys from './signing-keys.ts'
import {getDevice, installRelease} from './install-release.ts'
import {
	ReleaseVerificationError,
	UpdateError,
	findUpdateBundle,
	findUpdateScript,
	downloadManifestSignature,
	downloadReleaseManifest,
	downloadReleaseNotes,
	readSignatureFile,
	readText,
	releaseDirectoryUrl,
	selectReleaseNotes,
	verifyRelease,
} from './release-signing.ts'

export type ReleaseChannel = 'stable' | 'beta'

const manifestHash = (manifest: string) => crypto.createHash('sha256').update(manifest).digest('hex')

const idleStatus: ProgressStatus = {running: false, progress: 0, description: '', error: false}

// umbrelOS updates. The update server only tells a device where the latest release is: what it shows the
// user and what it installs come from the release's signed manifest and release notes, and Rugix checks the
// update bundle against the hash the manifest pins. A release can also have an update script, pinned by the
// manifest too, that runs to install it.
export default class Update {
	#umbreld: Umbreld
	#updateServerUrl: string
	#status = idleStatus
	signingKeys: SigningKeys
	logger: Umbreld['logger']

	constructor(
		umbreld: Umbreld,
		{
			updateServerUrl = 'https://api.umbrel.com/latest-release',
			signingKeys = {},
		}: {updateServerUrl?: string; signingKeys?: ConstructorParameters<typeof SigningKeys>[1]} = {},
	) {
		this.#umbreld = umbreld
		this.#updateServerUrl = updateServerUrl
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())
		this.signingKeys = new SigningKeys(umbreld, signingKeys)
	}

	async start() {
		this.logger.log('Starting update')
		await this.signingKeys.start()
	}

	async stop() {
		this.logger.log('Stopping update')
		await this.signingKeys.stop()
	}

	getStatus() {
		return this.#status
	}

	// Pushed to the UI as it changes, which still polls as a fallback
	#setStatus(properties: Partial<ProgressStatus>) {
		this.#status = {...this.#status, ...properties}
		this.#umbreld.eventBus.emit('system:update-status', this.#status)
	}

	async getReleaseChannel(): Promise<ReleaseChannel> {
		return (await this.#umbreld.store.get('settings.releaseChannel')) || 'stable'
	}

	async setReleaseChannel(channel: ReleaseChannel) {
		return this.#umbreld.store.set('settings.releaseChannel', channel)
	}

	// Ask the update server where the latest release for this device is
	async #getLatestReleaseUrl() {
		let deviceId = 'unknown'
		try {
			deviceId = (await detectDevice()).deviceId
		} catch (error) {
			this.logger.error(`Failed to detect device type`, error)
		}

		let platform = 'unknown'
		try {
			if (await isUmbrelOS()) platform = 'umbrelOS'
		} catch (error) {
			this.logger.error(`Failed to detect platform`, error)
		}

		let channel: ReleaseChannel = 'stable'
		try {
			channel = await this.getReleaseChannel()
		} catch (error) {
			this.logger.error(`Failed to get release channel`, error)
		}

		let device: {bootFlow?: string; arch: string} | undefined
		try {
			device = await getDevice()
		} catch (error) {
			this.logger.error(`Failed to detect boot flow`, error)
		}

		const updateUrl = new URL(this.#updateServerUrl)
		// Provide context to the update server about the underlying device and platform
		// so we can avoid the 1.0 update situation where we need to shim multiple update
		// mechanisms and error-out updates for unsupported platforms. This also helps
		// notifying users for critical security updates that are be relevant only to their specific
		// platform, and avoids notififying users of updates that aren't yet available for their
		// platform.
		updateUrl.searchParams.set('version', this.#umbreld.version)
		updateUrl.searchParams.set('device', deviceId)
		updateUrl.searchParams.set('platform', platform)
		updateUrl.searchParams.set('channel', channel)
		// So the update server can hold a release back from, or offer one to, devices that install a
		// particular update bundle
		updateUrl.searchParams.set('bootFlow', device?.bootFlow ?? 'unknown')
		updateUrl.searchParams.set('arch', device?.arch ?? 'unknown')

		const response = await fetch(updateUrl, {
			headers: {'User-Agent': `umbrelOS ${this.#umbreld.version}`},
			signal: AbortSignal.timeout(30_000),
		})
		if (!response.ok) throw new Error(`Update server responded with HTTP ${response.status}`)
		const {releaseUrl} = JSON.parse(await readText(response)) as {releaseUrl?: unknown}
		// Releases from before signing only come with an unsigned update script, which this device never runs
		return typeof releaseUrl === 'string' ? releaseUrl : undefined
	}

	// The signed release to check or install: the update server's latest, or the one at releaseUrl
	async #findRelease(releaseUrl?: string) {
		releaseUrl ??= await this.#getLatestReleaseUrl()
		if (!releaseUrl) return undefined
		const url = releaseDirectoryUrl(releaseUrl)

		const userAgent = `umbrelOS ${this.#umbreld.version}`
		const [manifest, manifestSignatureFile, notes] = await Promise.all([
			downloadReleaseManifest(url, userAgent),
			downloadManifestSignature(url, userAgent),
			// A release installs without release notes, so failing to download them only means none are shown
			downloadReleaseNotes(url, userAgent).catch((error) => {
				this.logger.error("Failed to download the release's notes", error)
				return {releaseNotes: undefined, signatureFile: undefined}
			}),
		])
		const rootPublicKey = this.signingKeys.rootPublicKey
		const manifestSignatures = readSignatureFile(manifestSignatureFile, rootPublicKey)
		const releaseNotesSignatures = notes.signatureFile
			? readSignatureFile(notes.signatureFile, rootPublicKey)
			: undefined
		for (const signatures of [manifestSignatures, releaseNotesSignatures]) {
			if (signatures?.signingKeysError) {
				this.logger.error("Ignoring a release's approved signing keys list", signatures.signingKeysError)
			}
		}

		// Each signature file carries the root-signed list its signers were approved by, so the release
		// verifies without reaching any other source. Refreshing as well means a revoked key can't sign the
		// release, and only the newest list counts, so an older one a release carries can't bring a revoked
		// key back. If no source is reachable this uses the newest list the device has seen.
		let signingKeys = await this.signingKeys.refresh()
		for (const carried of [manifestSignatures.signingKeys, releaseNotesSignatures?.signingKeys]) {
			if (carried) signingKeys = await this.signingKeys.offer(carried)
		}
		const release = await verifyRelease({
			manifest,
			manifestSignatures,
			releaseNotes: notes.releaseNotes,
			releaseNotesSignatures,
			signingKeys,
		})
		// A release installs without release notes it can't show
		if (release.releaseNotesError) this.logger.error("Not showing the release's notes", release.releaseNotesError)
		return {releaseUrl: url, manifest, release}
	}

	// Whether a release has an update bundle or update script for this device, so it can install it
	async #hasUpdateForDevice(release: Awaited<ReturnType<typeof verifyRelease>>) {
		try {
			const device = await getDevice()
			if (findUpdateBundle(release, device) || findUpdateScript(release, device)) return true
		} catch (error) {
			this.logger.error('Failed to detect boot flow', error)
		}
		this.logger.log(`umbrelOS ${release.version} doesn't include an update for this device`)
		return false
	}

	// The latest signed release, or the one at releaseUrl, and whether it's newer than the installed version
	// and has an update for this device
	async checkUpdate({releaseUrl}: {releaseUrl?: string} = {}): Promise<{
		available: boolean
		version: string
		name: string
		releaseNotes: string
		manifestHash?: string
	}> {
		const found = await this.#findRelease(releaseUrl).catch((error) => {
			// Other errors can repeat what the update or download server sent, like a URL or part of a
			// response, so callers like MCP clients only see that the check failed
			if (error instanceof UpdateError) throw error
			this.logger.error('Failed to check for updates', error)
			throw new UpdateError('Failed to check for updates')
		})
		if (!found) return {available: false, version: this.#umbreld.version, name: '', releaseNotes: ''}

		const {release} = found
		return {
			available: semver.gt(release.version, this.#umbreld.version) && (await this.#hasUpdateForDevice(release)),
			version: release.version,
			name: release.name,
			releaseNotes: selectReleaseNotes(release.releaseNotes, this.#umbreld.version),
			// Given back to install, so it only installs this release
			manifestHash: manifestHash(found.manifest),
		}
	}

	// Install the latest signed release, or the one at releaseUrl, ready to boot into on the next restart.
	// Given the manifestHash a check returned, it only installs that release, since the update server can
	// point at a different one between the user seeing it and installing it. Older clients that don't give
	// one install the latest. Returns whether it installed. Failures are reported through the update status.
	async install({releaseUrl, manifestHash: checkedManifestHash}: {releaseUrl?: string; manifestHash?: string} = {}) {
		if (this.#status.running) throw new Error('An update is already running')
		this.#setStatus({...idleStatus, running: true, description: 'Updating...'})

		try {
			const found = await this.#findRelease(releaseUrl)
			if (!found) throw new ReleaseVerificationError('No signed release found')

			if (checkedManifestHash !== undefined && checkedManifestHash !== manifestHash(found.manifest)) {
				throw new ReleaseVerificationError(
					'The release has changed since this device checked for updates. Check for updates again.',
				)
			}

			// The update server's latest release has to be newer so it can't roll a device back. A release
			// asked for by URL, like a test build, can be any version.
			const {release} = found
			if (!releaseUrl && !semver.gt(release.version, this.#umbreld.version)) {
				throw new ReleaseVerificationError(
					`umbrelOS ${release.version} isn't newer than the installed ${this.#umbreld.version}`,
				)
			}

			this.logger.log(
				`Installing umbrelOS ${release.version} from ${found.releaseUrl} signed by ${release.signedByRootKey ? 'the root key' : release.signers.map((signer) => signer.name).join(' and ')}`,
			)
			await installRelease({
				releaseUrl: found.releaseUrl,
				manifest: found.manifest,
				release,
				installedVersion: this.#umbreld.version,
				onStatus: (status) => {
					// Only log whole percents
					if (status.progress !== undefined && Math.floor(status.progress) > Math.floor(this.#status.progress)) {
						this.logger.log(`Update progress: ${Math.floor(status.progress)}%`)
					}
					this.#setStatus(status)
				},
			})
		} catch (error) {
			this.logger.error('Update failed', error)
			// Leave the error in the status so UI polls can tell a failed update from a successful one that
			// rebooted
			this.#setStatus({...idleStatus, error: error instanceof UpdateError ? error.message : 'Update failed'})
			return false
		}

		this.#setStatus({running: false, progress: 100, description: 'Restarting...'})
		return true
	}
}
