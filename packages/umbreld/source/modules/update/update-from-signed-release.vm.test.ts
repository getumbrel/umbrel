// @vm-requires-update-bundle
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import fse from 'fs-extra'
import semver from 'semver'
import {afterAll, beforeAll, describe, expect, test} from 'vitest'

import {ARCHIVE_DIRECTORY} from '../../../scripts/release-signing.ts'
import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import {
	downloadReleaseImage,
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
	createSigningKey,
	installLatestRelease,
	publishRelease,
	redirectToUmbrelApi,
	serveUmbrelApi,
	signingKey,
	trustRootKey,
	type SignerKey,
} from '../test-utilities/release-signing.ts'

const {version: buildVersion} = await fse.readJson(new URL('../../../package.json', import.meta.url))

// Devices verify an update with the umbreld they're running, which can be any signed release, so a change
// to how releases are signed has to keep working with every one of them. This boots the first signed
// release, whose verifier is the oldest in the field, and the latest, and updates each to this build.
//
// It finds the signed releases in releases/, so it skips until there's one. To check a change against
// an image built from an earlier commit instead, set UPDATE_FROM_IMAGE to it.
const signedVersions = (await fse.readdir(ARCHIVE_DIRECTORY))
	.map((file) => file.match(/^(.+)-manifest\.txt$/)?.[1])
	.filter((version): version is string => !!version && !!semver.valid(version))
	.sort(semver.compare)
const fromReleases = process.env.UPDATE_FROM_IMAGE
	? [{name: path.basename(process.env.UPDATE_FROM_IMAGE), image: async () => process.env.UPDATE_FROM_IMAGE!}]
	: [...new Set([signedVersions[0], signedVersions.at(-1)])]
			.filter((version) => version !== undefined)
			.map((version) => ({name: `umbrelOS ${version}`, image: () => downloadReleaseImage(version)}))

if (fromReleases.length === 0) test.skip('updates from signed releases, once there are any in releases/')

describe.each(fromReleases)('Updating from $name', ({image}) => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let api: Awaited<ReturnType<typeof serveUmbrelApi>>
	let releases: Awaited<ReturnType<typeof serveUpdateBundle>>
	let directory: string
	let alice: SignerKey
	let bob: SignerKey
	let mallory: SignerKey

	// The release's own root key is swapped for a test one, which signs the keys lists
	const rootKey = createRootKey()
	let signingKeysList: string

	beforeAll(async () => {
		directory = await fse.mkdtemp(path.join(os.tmpdir(), 'umbreld-update-from-signed-release-vm-test-'))
		;[alice, bob, mallory] = await Promise.all(
			['alice-mbp-2026', 'bob-mbp-2025', 'mallory-mbp'].map((name) => createSigningKey(name)),
		)
		signingKeysList = createSigningKeysList({
			date: '2026-01-01T00:00:00Z',
			keys: [signingKey(alice), signingKey(bob)],
			rootKey,
		})
		api = await serveUmbrelApi()
		releases = await serveUpdateBundle()

		umbreld = await createTestVm({device: 'umbrel-home', image: await image()})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
		await redirectToUmbrelApi(umbreld, api)
		await trustRootKey(umbreld, rootKey, signingKeysList)
		// Downloading the release image and booting it
	}, 2_400_000)

	afterAll(async () => {
		await umbreld?.cleanup()
		await releases?.close()
		await api?.close()
		await fse.remove(directory)
	})

	test('refuses a release signed by an unapproved key', async () => {
		const release = await publishRelease({api, releases}, {signers: [mallory], signingKeysList})
		expect((await installLatestRelease(umbreld)).success).toBe(false)
		expect(release.bundleRequested()).toBe(false)
	})

	// The release pins a bundle hash the bundle doesn't have, so Rugix refuses it once umbreld has verified it
	test('verifies a release with more than one signer', async () => {
		const twoSignerList = createSigningKeysList({
			date: '2026-02-01T00:00:00Z',
			requiredSignatures: 2,
			keys: [signingKey(alice), signingKey(bob)],
			rootKey,
		})

		const oneSigner = await publishRelease({api, releases}, {signers: [alice], signingKeysList: twoSignerList})
		expect((await installLatestRelease(umbreld)).success).toBe(false)
		expect(oneSigner.bundleRequested()).toBe(false)

		const twoSigners = await publishRelease({api, releases}, {signers: [alice, bob], signingKeysList: twoSignerList})
		expect((await installLatestRelease(umbreld)).success).toBe(false)
		expect(twoSigners.bundleRequested()).toBe(true)
	})

	test('verifies a release signed by the root key alone', async () => {
		const release = await publishRelease({api, releases}, {signers: [], signingKeysList, rootKey})
		expect((await installLatestRelease(umbreld)).success).toBe(false)
		expect(release.bundleRequested()).toBe(true)
	})

	test('follows a root key handover the list a release carries ends with', async () => {
		const newRootKey = createRootKey()
		const handedOver = createSigningKeysList({
			date: '2026-03-01T00:00:00Z',
			keys: [signingKey(alice), signingKey(bob)],
			rootKey: newRootKey,
			handovers: [createRootKeyHandover({date: '2026-02-15T00:00:00Z', from: rootKey, to: newRootKey})],
		})
		const release = await publishRelease(
			{api, releases},
			{signers: [], signingKeysList: handedOver, rootKey: newRootKey},
		)
		expect((await installLatestRelease(umbreld)).success).toBe(false)
		expect(release.bundleRequested()).toBe(true)
		signingKeysList = handedOver
	})

	test('installs this build as a signed release and boots into it', async () => {
		const bundleHash = (await fs.promises.readFile(`${updateBundle}.hash`, 'utf8')).trim()
		const release = await publishRelease({api, releases}, {signers: [alice, bob], signingKeysList, bundleHash})
		const {activeGroup} = await getRugixState(umbreld)

		await rebootAndWaitForUmbreld(umbreld, async () => {
			expect(await installLatestRelease(umbreld)).toEqual({success: true, error: false})
		})

		expect(release.bundleRequested()).toBe(true)
		const state = await waitForCommittedBoot(umbreld)
		expect(state.activeGroup).not.toBe(activeGroup)
		expect(state.defaultGroup).toBe(state.activeGroup)
		expect((await umbreld.client.system.version.query()).version).toBe(buildVersion)
		// Installing and rebooting take a while on an emulated amd64 VM
	}, 2_400_000)
})
