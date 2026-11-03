// @vm-requires-update-bundle
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import fse from 'fs-extra'
import pWaitFor from 'p-wait-for'
import {afterAll, beforeAll, beforeEach, describe, expect, test} from 'vitest'

import {BUNDLED_SIGNING_KEYS_PATH, SIGNING_KEYS_URLS, verifySigningKeysList} from './release-signing.ts'
import {ARCHIVE_DIRECTORY} from '../../../scripts/release-signing.ts'
import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import {
	getRugixState,
	rebootAndWaitForUmbreld,
	serveUpdateBundle,
	updateBundle,
	waitForCommittedBoot,
} from '../test-utilities/os-update.ts'
import {
	createRootKey,
	createRootKeyHandover,
	createSigningKeysList,
	createManifest,
	createReleaseManifestFiles,
	createSigningKey,
	installLatestRelease,
	latestReleaseUrl,
	publishRelease,
	readUmbreldLogs,
	redirectToUmbrelApi,
	restartUmbreld,
	secureEnclaveSignatureVector,
	serveUmbrelApi,
	signRelease,
	signingKey,
	testHostAddress,
	trustRootKey,
	unmatchedBundleHash,
	verifyArchivedReleasesOnDevice,
	type PublishedRelease,
	type SignerKey,
} from '../test-utilities/release-signing.ts'

const [apiSigningKeysUrl, mirrorSigningKeysUrl] = SIGNING_KEYS_URLS
const savedSigningKeysPath = '/home/umbrel/umbrel/umbrelos-signing-keys.txt'

// End to end checks that umbrelOS only installs releases signed by an approved key, running everything
// on the device the way it runs in the field: umbreld fetching the update server and the approved keys
// list over HTTPS, the image's own Node checking root key and release signatures, and Rugix checking update
// bundles. The update server and keys list sources are stand-ins
// on the test host, and the tests that need to sign lists swap in a test root key.
describe('Release signing', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let api: Awaited<ReturnType<typeof serveUmbrelApi>>
	let releases: Awaited<ReturnType<typeof serveUpdateBundle>>
	let directory: string
	let alice: SignerKey
	let bob: SignerKey
	let carol: SignerKey
	let dave: SignerKey
	let mallory: SignerKey
	let installedVersion: string
	let logCursor: string | undefined
	// The approved keys list releases carry with their signatures unless a test gives another
	let carriedList: string

	// Publish a release signed by one signer or several
	const publish = ({
		signer,
		signers = signer ? [signer] : [],
		signingKeysList = carriedList,
		...options
	}: Omit<Parameters<typeof publishRelease>[1], 'signers' | 'signingKeysList'> & {
		signer?: SignerKey
		signers?: SignerKey[]
		signingKeysList?: string
	}) => publishRelease({api, releases}, {signers, signingKeysList, ...options})

	async function readNewLogs() {
		const {logs, cursor} = await readUmbreldLogs(umbreld, logCursor)
		logCursor = cursor
		return logs
	}

	async function expectRefused(release: PublishedRelease, error: string) {
		await readNewLogs()
		await expect(installLatestRelease(umbreld)).resolves.toEqual({success: false, error})
		expect(release.bundleRequested(), 'Rugix was asked to install a refused release').toBe(false)
	}

	// The release pins a bundle hash the served bundle doesn't have, so Rugix refuses it once umbreld has
	// verified the release and started installing it
	async function expectVerified(release: PublishedRelease) {
		await readNewLogs()
		await expect(installLatestRelease(umbreld)).resolves.toEqual({
			success: false,
			error: "The update bundle doesn't match the signed release",
		})
		expect(release.bundleRequested(), "Rugix wasn't asked to install the release").toBe(true)
		const releaseUrl = `http://${testHostAddress}:${releases.port}/${release.id}/`
		expect(await readNewLogs()).toContain(
			`Installing umbrelOS ${release.version} from ${releaseUrl} signed by ${release.signedByRootKey ? 'the root key' : release.signers.map((signer) => signer.name).join(' and ')}`,
		)
	}

	const savedSigningKeys = () => umbreld.vm.sshAsRoot(`cat ${savedSigningKeysPath} 2>/dev/null || true`)

	beforeAll(async () => {
		directory = await fse.mkdtemp(path.join(os.tmpdir(), 'umbreld-release-signing-vm-test-'))
		;[alice, bob, carol, dave, mallory] = await Promise.all(
			['alice-mbp-2026', 'bob-mbp-2025', 'carol-mbp-2026', 'dave-mbp-2026', 'mallory-mbp'].map((name) =>
				createSigningKey(name),
			),
		)
		// The image's own list, signed by its root key
		carriedList = await fse.readFile(BUNDLED_SIGNING_KEYS_PATH, 'utf8')
		api = await serveUmbrelApi()
		releases = await serveUpdateBundle()

		// Boot the amd64 image the update bundle is for, even on an arm64 host
		umbreld = await createTestVm({
			device: 'umbrel-home',
			image: path.join(path.dirname(updateBundle), 'umbrelos-amd64.img'),
		})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
		await redirectToUmbrelApi(umbreld, api)
		installedVersion = (await umbreld.client.system.version.query()).version
	})

	afterAll(async () => {
		await umbreld?.cleanup()
		await releases?.close()
		await api?.close()
		await fse.remove(directory)
	})

	describe('with the root key built into the image', () => {
		test("verifies the image's approved keys list against its root key", async () => {
			// umbreld can only tell the key is unapproved once it has a valid list, which here is the
			// image's own, carried by the release, as neither source has one. The number of signatures
			// it needs comes from that list.
			const release = await publish({signer: mallory})
			const {requiredSignatures} = verifySigningKeysList(carriedList)
			await expectRefused(
				release,
				`This release has 0 of the ${requiredSignatures} signatures it needs from approved keys`,
			)
			expect(await readNewLogs()).not.toContain('Ignoring invalid signing keys list')

			// It looked for a newer list at both sources first
			for (const url of SIGNING_KEYS_URLS) {
				expect(api.requests).toContainEqual({url, userAgent: `umbrelOS ${installedVersion}`})
			}
		})

		test("verifies a real Secure Enclave key's signatures with the image's Node", async () => {
			const {message, signature, publicKey} = secureEnclaveSignatureVector
			const verify = (signedMessage: string) =>
				umbreld.vm.sshAsRoot(
					`node -e 'const crypto = require("crypto"); const [publicKey, message, signature] = process.argv.slice(1); const key = crypto.createPublicKey({key: Buffer.concat([Buffer.from("3039301306072a8648ce3d020106082a8648ce3d030107032200", "hex"), Buffer.from(publicKey, "hex")]), format: "der", type: "spki"}); process.exit(crypto.verify("sha256", Buffer.from("umbrelOS release signature\\n" + message), {key, dsaEncoding: "ieee-p1363"}, Buffer.from(signature, "base64")) ? 0 : 1)' ${publicKey} '${signedMessage}' ${signature}`,
				)

			await expect(verify(message)).resolves.toBeDefined()
			await expect(verify(`${message}!`)).rejects.toThrow()
		})

		// Every release archived in releases/, which is what each release's pull request adds
		test("verifies every archived release with the root key and the image's Node", async () => {
			const results = await verifyArchivedReleasesOnDevice(umbreld, ARCHIVE_DIRECTORY)
			const versions = (await fse.readdir(ARCHIVE_DIRECTORY))
				.filter((file) => file.endsWith('-manifest.txt'))
				.map((file) => file.slice(0, -'-manifest.txt'.length))
			expect(results.map((result) => result.version)).toEqual(versions.sort())
			expect(results.filter((result) => 'error' in result)).toEqual([])
		})

		test('never runs an unsigned update script from the update server', async () => {
			releases.files.set('/legacy/update-script', '#!/usr/bin/env bash\ntouch /tmp/unsigned-update-script-ran\n')
			api.respond(
				latestReleaseUrl,
				JSON.stringify({
					version: '99.0.0',
					updateScript: `http://${testHostAddress}:${releases.port}/legacy/update-script`,
				}),
			)

			expect((await umbreld.client.update.check.query()).available).toBe(false)
			await expect(installLatestRelease(umbreld)).resolves.toEqual({success: false, error: 'No signed release found'})
			expect(releases.requestedPaths).not.toContain('/legacy/update-script')
		})
	})

	describe('with a test root key', () => {
		const rootKey = createRootKey()
		// The list the device ships with approves Alice and the published one Bob too. The newest one then
		// revokes Bob and approves Carol.
		let publishedList: string
		let revokingList: string

		beforeAll(async () => {
			publishedList = createSigningKeysList({
				date: '2026-02-01T00:00:00Z',
				keys: [signingKey(alice), signingKey(bob)],
				rootKey,
			})
			revokingList = createSigningKeysList({
				date: '2026-04-01T00:00:00Z',
				keys: [signingKey(alice), signingKey(carol)],
				rootKey,
			})

			api.respond(apiSigningKeysUrl, publishedList)
			// Releases carry the list the device ships with, so the device learns newer ones from the sources
			carriedList = createSigningKeysList({date: '2026-01-01T00:00:00Z', keys: [signingKey(alice)], rootKey})
			await trustRootKey(umbreld, rootKey, carriedList)
			logCursor = (await readUmbreldLogs(umbreld)).cursor
		})

		// The check archived releases get above, which has nothing to check until there's one
		test('catches an archived release that fails verification on the device', async () => {
			const archive = await fse.mkdtemp(path.join(directory, 'releases-'))
			const archiveRelease = async (version: string, servedReleaseNotes = 'Notes') => {
				const manifest = createManifest(version)
				await fse.writeFile(`${archive}/${version}-manifest.txt`, manifest)
				await fse.writeFile(`${archive}/${version}-release-notes.md`, servedReleaseNotes)
				const {manifestSignature, releaseNotesSignature} = await signRelease(manifest, {
					releaseNotes: 'Notes',
					signingKeysList: carriedList,
					signers: [alice],
				})
				await fse.writeFile(`${archive}/${version}-manifest.txt.sig`, manifestSignature)
				await fse.writeFile(`${archive}/${version}-release-notes.md.sig`, releaseNotesSignature)
			}
			await archiveRelease('2.1.0')
			await archiveRelease('2.1.1', 'Notes changed after signing')

			expect(await verifyArchivedReleasesOnDevice(umbreld, archive)).toEqual([
				{version: '2.1.0', name: 'umbrelOS 2.1.0', signedByRootKey: false, signers: [alice.name]},
				{version: '2.1.1', error: `This release has an invalid signature from ${alice.name}`},
			])
		})

		test('fetches and saves a newer approved keys list when it starts', async () => {
			await pWaitFor(async () => (await savedSigningKeys()) === publishedList.trimEnd(), {
				interval: 1000,
				timeout: 60_000,
			})
		})

		test('shows the name and release notes from the signed release, not the update server', async () => {
			const release = await publish({signer: alice, releaseNotes: '## Signed notes\n\n- With Markdown'})
			await expect(umbreld.client.update.check.query()).resolves.toEqual({
				available: true,
				version: '99.0.0',
				name: release.name,
				releaseNotes: '## Signed notes\n\n- With Markdown',
				manifestHash: crypto.createHash('sha256').update(release.manifest).digest('hex'),
			})
		})

		// What it installs is signed separately, so it still installs
		test("doesn't show release notes changed after signing", async () => {
			const release = await publish({
				signer: alice,
				tamperReleaseNotes: () => 'Visit https://evil.example to finish updating',
			})
			await expect(umbreld.client.update.check.query()).resolves.toMatchObject({available: true, releaseNotes: ''})
			await expectVerified(release)
		})

		test("doesn't offer a signed release that isn't newer", async () => {
			for (const olderVersion of [installedVersion, '1.7.4']) {
				await publish({signer: alice, version: olderVersion})
				expect((await umbreld.client.update.check.query()).available).toBe(false)
			}
		})

		test('installs a release signed by an approved key, with Rugix checking its bundle', async () => {
			await expectVerified(await publish({signer: alice}))
		})

		// So the devices the release job pins for each bundle are the ones devices report
		test('installs the bundle the release manifest script pins for this device', async () => {
			const otherHash = `sha512-256:${'1'.repeat(64)}`
			const files = await createReleaseManifestFiles({
				'umbrelos-amd64-legacy.update': otherHash,
				'umbrelos-amd64.update': unmatchedBundleHash,
				'umbrelos-pi.update': otherHash,
			})
			await expectVerified(await publish({signer: alice, files}))
		})

		test.each([
			{
				refusal: 'a release without a signature',
				options: () => ({signer: alice, unsigned: true}),
				error: "This release isn't signed",
			},
			{
				refusal: 'a release signed by an unapproved key',
				options: () => ({signer: mallory}),
				error: () => "This release is signed by a key that isn't approved",
			},
			{
				refusal: 'a bundle hash changed after signing',
				options: () => ({
					signer: alice,
					tamper: (manifest: string) => manifest.replace(/bundle:\S+/, `bundle:sha512-256:${'1'.repeat(64)}`),
				}),
				error: () => `This release has an invalid signature from ${alice.name}`,
			},
			{
				refusal: 'a signature of the manifest without what release signatures start with',
				options: () => ({signer: alice, prefix: ''}),
				error: () => `This release has an invalid signature from ${alice.name}`,
			},
			{
				refusal: "a release that isn't newer",
				options: () => ({signer: alice, version: '1.7.4'}),
				error: () => `umbrelOS 1.7.4 isn't newer than the installed ${installedVersion}`,
			},
			{
				refusal: "a release without this device's update bundle",
				options: () => ({signer: alice, bundle: 'umbrelos-pi.update'}),
				error: "umbrelOS 99.0.0 doesn't include an update for this device",
			},
		])('refuses $refusal', async ({options, error}) => {
			const release = await publish(options())
			await expectRefused(release, typeof error === 'function' ? error() : error)
		})

		test('ignores a forged approved keys list', async () => {
			const forgedList = createSigningKeysList({
				date: '2026-03-01T00:00:00Z',
				keys: [signingKey(mallory)],
				rootKey: createRootKey(),
			})
			api.respond(apiSigningKeysUrl, forgedList)

			await expectRefused(await publish({signer: mallory}), "This release is signed by a key that isn't approved")
			expect(await savedSigningKeys()).toBe(publishedList.trimEnd())
		})

		test('picks up a newer approved keys list from the GitHub mirror when api.umbrel.com is down', async () => {
			api.respond(apiSigningKeysUrl, {status: 500})
			api.respond(mirrorSigningKeysUrl, revokingList)

			await expectVerified(await publish({signer: carol}))
			expect(await savedSigningKeys()).toContain(carol.publicKey)
		})

		test('refuses a release signed by a key a newer list revoked', async () => {
			await expectRefused(await publish({signer: bob}), "This release is signed by a key that isn't approved")
		})

		test('keeps the revocation when the sources serve an older list again', async () => {
			api.respond(apiSigningKeysUrl, publishedList)
			api.respond(mirrorSigningKeysUrl, publishedList)

			await expectRefused(await publish({signer: bob}), "This release is signed by a key that isn't approved")
			expect(await savedSigningKeys()).toContain(carol.publicKey)
		})

		test('keeps the revocation across a restart with no source reachable', async () => {
			api.respond(apiSigningKeysUrl, {status: 500})
			api.respond(mirrorSigningKeysUrl, undefined)
			await restartUmbreld(umbreld)

			await expectRefused(await publish({signer: bob}), "This release is signed by a key that isn't approved")
			await expectVerified(await publish({signer: carol}))
		})

		// By its manifest's hash, so another release of the same version still installs
		test('refuses a signed release a newer list revoked', async () => {
			const revoked = await publish({signer: carol, version: '99.0.1'})
			api.respond(
				mirrorSigningKeysUrl,
				createSigningKeysList({
					date: '2026-04-15T00:00:00Z',
					keys: [signingKey(alice), signingKey(carol)],
					revokedReleases: [
						{manifest: crypto.createHash('sha256').update(revoked.manifest).digest('hex'), label: '99.0.1'},
					],
					rootKey,
				}),
			)
			await expectRefused(revoked, 'umbrelOS 99.0.1 has been revoked')
			await expectVerified(await publish({signer: carol, version: '99.0.1'}))
		})

		// Each release's signature carries the root-signed list its signers were approved by
		describe('the approved keys list a release carries', () => {
			test('approves its signers with no source reachable, and the device keeps it', async () => {
				const approvingDave = createSigningKeysList({
					date: '2026-05-01T00:00:00Z',
					keys: [signingKey(alice), signingKey(carol), signingKey(dave)],
					rootKey,
				})

				await expectVerified(await publish({signer: dave, signingKeysList: approvingDave}))
				expect(await savedSigningKeys()).toBe(approvingDave.trimEnd())
			})

			test("can't bring back a key a newer list revoked", async () => {
				await expectRefused(
					await publish({signer: bob, signingKeysList: publishedList}),
					"This release is signed by a key that isn't approved",
				)
				expect(await savedSigningKeys()).toContain(dave.publicKey)
			})

			test("is ignored unless it's signed by the root key", async () => {
				const forgedList = createSigningKeysList({
					date: '2026-05-15T00:00:00Z',
					keys: [signingKey(mallory)],
					rootKey: createRootKey(),
				})
				await expectRefused(
					await publish({signer: mallory, signingKeysList: forgedList}),
					"This release is signed by a key that isn't approved",
				)
				expect(await savedSigningKeys()).not.toContain(mallory.publicKey)
			})
		})

		// The root key sets how many approved signers each release needs, in the list
		describe('releases needing more than one signer', () => {
			let twoSignerList: string

			beforeAll(() => {
				twoSignerList = createSigningKeysList({
					date: '2026-06-01T00:00:00Z',
					requiredSignatures: 2,
					keys: [signingKey(alice), signingKey(carol), signingKey(dave)],
					rootKey,
				})
			})

			test('refuses a release with one signature once a list requires two', async () => {
				await expectRefused(
					await publish({signer: alice, signingKeysList: twoSignerList}),
					'This release has 1 of the 2 signatures it needs from approved keys',
				)
			})

			test("doesn't count a second signature from an unapproved key or the same key", async () => {
				for (const signers of [
					[alice, mallory],
					[alice, alice],
				]) {
					await expectRefused(
						await publish({signers, signingKeysList: twoSignerList}),
						'This release has 1 of the 2 signatures it needs from approved keys',
					)
				}
			})

			test('installs a release signed by two approved keys', async () => {
				await expectVerified(await publish({signers: [alice, carol], signingKeysList: twoSignerList}))
			})

			test("can't go back to one signature by carrying an older list", async () => {
				await expectRefused(
					await publish({signer: alice}),
					'This release has 1 of the 2 signatures it needs from approved keys',
				)
			})

			test('installs a release with one signature again once a newer list requires one', async () => {
				api.respond(
					apiSigningKeysUrl,
					createSigningKeysList({
						date: '2026-07-01T00:00:00Z',
						keys: [signingKey(alice), signingKey(carol), signingKey(dave)],
						rootKey,
					}),
				)
				await expectVerified(await publish({signer: alice}))
			})
		})

		// In an emergency the root key can sign a release by itself, and it can move to a new hardware wallet
		describe('the root key', () => {
			const newRootKey = createRootKey()

			test('can sign a release by itself, whatever the list requires', async () => {
				const twoSignerList = createSigningKeysList({
					date: '2026-07-15T00:00:00Z',
					requiredSignatures: 2,
					keys: [signingKey(alice), signingKey(carol), signingKey(dave)],
					rootKey,
				})
				await expectVerified(await publish({signers: [], signingKeysList: twoSignerList, rootKey}))
			})

			test("can't be another key", async () => {
				await expectRefused(
					await publish({signers: [], rootKey: createRootKey()}),
					'This release has an invalid signature from the root key',
				)
			})

			test('moves to a new key with a handover the list a release carries ends with', async () => {
				const handedOver = createSigningKeysList({
					date: '2026-08-01T00:00:00Z',
					keys: [signingKey(alice), signingKey(carol), signingKey(dave)],
					rootKey: newRootKey,
					handovers: [createRootKeyHandover({date: '2026-07-20T00:00:00Z', from: rootKey, to: newRootKey})],
				})
				await expectVerified(await publish({signer: alice, signingKeysList: handedOver}))
				expect(await savedSigningKeys()).toBe(handedOver.trimEnd())
			})

			test('only the new key can sign releases by itself', async () => {
				await expectRefused(
					await publish({signers: [], rootKey}),
					'This release has an invalid signature from the root key',
				)
				await expectVerified(await publish({signers: [], rootKey: newRootKey}))
			})

			test("ignores the old key's lists from then on", async () => {
				api.respond(
					apiSigningKeysUrl,
					createSigningKeysList({date: '2026-09-01T00:00:00Z', keys: [signingKey(mallory)], rootKey}),
				)
				await expectRefused(await publish({signer: mallory}), "This release is signed by a key that isn't approved")
				expect(await savedSigningKeys()).toContain(newRootKey.publicKey)
			})
		})

		// A release can run code on the device to install it, like fixing something that would break the
		// update, pinned by its manifest like its bundles
		describe("a release's update script", () => {
			const ranPath = '/run/umbrel-update-script-test'
			const script = (...lines: string[]) =>
				['#!/usr/bin/env bash', 'set -euo pipefail', `mkdir -p ${ranPath}`, ...lines, ''].join('\n')
			const ran = () => umbreld.vm.sshAsRoot(`cat ${ranPath}/ran 2>/dev/null || true`)

			beforeEach(async () => {
				await umbreld.vm.sshAsRoot(`rm -rf ${ranPath}`)
			})

			test('runs as root before Rugix installs the bundle, with what it needs to know', async () => {
				const release = await publish({
					signer: alice,
					updateScript: script(
						`{ id -u; env | grep ^UMBREL_ | LC_ALL=C sort; head -1 "$UMBREL_RELEASE_MANIFEST"; } > ${ranPath}/ran`,
						'echo \'umbrel-update: {"progress": 5, "description": "Getting ready..."}\'',
					),
				})
				await expectVerified(release)

				const lines = (await ran()).split('\n')
				expect(lines[0]).toBe('0')
				expect(lines).toEqual(
					expect.arrayContaining([
						'UMBREL_ARCH=amd64',
						'UMBREL_BOOT_FLOW=grub',
						// The device's product code, which umbreld sends the update server as its device
						expect.stringMatching(/^UMBREL_DEVICE_ID=U\d+$/),
						`UMBREL_INSTALLED_VERSION=${installedVersion}`,
						`UMBREL_RELEASE_URL=http://${testHostAddress}:${releases.port}/${release.id}/`,
						'UMBREL_RELEASE_VERSION=99.0.0',
						'UMBREL_UPDATE_BUNDLE=umbrelos-amd64.update',
						'UMBREL_UPDATE_SCRIPT_INTERFACE=1',
						'--- umbrelOS Manifest ---',
					]),
				)
			})

			test('never runs a script changed after it was signed', async () => {
				const release = await publish({
					signer: alice,
					updateScript: script('true'),
					servedUpdateScript: script(`touch ${ranPath}/ran && echo tampered > ${ranPath}/ran`),
				})
				await expectRefused(release, "The update script doesn't match the signed release")
				expect(await ran()).toBe('')
			})

			test('stops the update with the error it reports', async () => {
				const release = await publish({
					signer: alice,
					updateScript: script('echo \'umbrel-update: {"error": "Free up 2 GB to update"}\'', 'exit 1'),
				})
				await expectRefused(release, 'Free up 2 GB to update')
			})
		})

		describe('a release by URL, like a public test build', () => {
			const releaseUrl = (release: PublishedRelease) => `http://${testHostAddress}:${releases.port}/${release.id}/`

			test('can only be chosen by root', async () => {
				const release = await publish({signer: alice})
				await expect(umbreld.client.update.install.mutate({releaseUrl: releaseUrl(release)})).rejects.toThrow(
					'Only root can install a release by URL',
				)
				await expect(umbreld.client.update.check.query({releaseUrl: releaseUrl(release)})).rejects.toThrow(
					'Only root can install a release by URL',
				)
				expect(release.bundleRequested()).toBe(false)
			})

			test('installs with umbreld update whatever its version, once umbreld verifies it', async () => {
				const release = await publish({signer: alice, version: installedVersion})
				// The update server doesn't offer it
				api.respond(latestReleaseUrl, undefined)
				await readNewLogs()

				await expect(umbreld.vm.sshAsRoot(`umbreld update ${releaseUrl(release)}`)).rejects.toThrow(
					"The update bundle doesn't match the signed release",
				)
				expect(release.bundleRequested()).toBe(true)
				expect(await readNewLogs()).toContain(
					`Installing umbrelOS ${installedVersion} from ${releaseUrl(release)} signed by ${alice.name}`,
				)
			})

			test('refuses an unsigned one with umbreld update', async () => {
				const release = await publish({signer: alice, unsigned: true})
				await expect(umbreld.vm.sshAsRoot(`umbreld update ${releaseUrl(release)}`)).rejects.toThrow(
					"This release isn't signed",
				)
				expect(release.bundleRequested()).toBe(false)
			})

			test('installs without verification only when asked, still checking the bundle against the manifest', async () => {
				const release = await publish({signer: alice, unsigned: true})
				const output = umbreld.vm.sshAsRoot(`umbreld update --skip-signature-check ${releaseUrl(release)}`)
				await expect(output).rejects.toThrow('WITHOUT checking its signature')
				await expect(output).rejects.toThrow("The update bundle doesn't match the signed release")
				expect(release.bundleRequested()).toBe(true)
			})
		})

		test('installs a signed release and boots into it', async () => {
			const bundleHash = (await fs.promises.readFile(`${updateBundle}.hash`, 'utf8')).trim()
			const files = await createReleaseManifestFiles({'umbrelos-amd64.update': bundleHash})
			const release = await publish({signer: alice, files})
			expect((await umbreld.client.update.check.query()).available).toBe(true)
			const {activeGroup} = await getRugixState(umbreld)

			await rebootAndWaitForUmbreld(umbreld, async () => {
				// umbreld restarts once the update is installed, which can drop the request before it responds
				umbreld.client.update.install.mutate().catch(() => {})
				await pWaitFor(
					async () => {
						const status = await umbreld.client.update.status.query().catch(() => undefined)
						if (status?.error) throw new Error(`The update failed: ${status.error}`)
						// No status means umbreld has stopped to restart
						return status === undefined || status.description === 'Restarting...'
					},
					// The first check waits for the install to reset the status from earlier tests
					{before: false, interval: 2000, timeout: 1_800_000},
				)
			})

			expect(release.bundleRequested()).toBe(true)
			const state = await waitForCommittedBoot(umbreld)
			expect(state.activeGroup).not.toBe(activeGroup)
			expect(state.defaultGroup).toBe(state.activeGroup)
			// Installing and rebooting take a while on an emulated amd64 VM
		}, 2_400_000)
	})
})
