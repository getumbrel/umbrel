// @vm-requires-update-bundle
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import fse from 'fs-extra'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import {triggerFactoryReset} from '../test-utilities/rebooting-action.ts'
import {
	downloadReleaseImage,
	getRugixState,
	rebootAndWaitForUmbreld,
	reboot,
	runUpdateScript,
	serveUpdateBundle,
	updateBundle,
	waitForCommittedBoot,
} from '../test-utilities/os-update.ts'
import {
	createRootKey,
	createSigningKeysList,
	createSigningKey,
	installLatestRelease,
	publishRelease,
	redirectToUmbrelApi,
	serveUmbrelApi,
	signingKey,
	trustRootKey,
} from '../test-utilities/release-signing.ts'

// The release devices in the field update from. Its Rugix Ctrl installs this build's bundle.
const fromVersion = '2.0.0'

// System partitions of the A/B boot groups in the amd64 GPT layout
const systemPartition = {a: 4, b: 5} as const

describe(`OS update from umbrelOS ${fromVersion}`, () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let bundleServer: Awaited<ReturnType<typeof serveUpdateBundle>>
	let api: Awaited<ReturnType<typeof serveUmbrelApi>> | undefined
	let directory: string
	let failed = false
	let newRugixVersion: string

	const markerName = 'os-update-marker.txt'

	beforeAll(async () => {
		directory = await fse.mkdtemp(path.join(os.tmpdir(), 'umbreld-os-update-vm-test-'))
		bundleServer = await serveUpdateBundle()
		umbreld = await createTestVm({device: 'umbrel-home', image: await downloadReleaseImage(fromVersion)})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
	})

	afterAll(async () => {
		await umbreld?.cleanup()
		await bundleServer?.close()
		await api?.close()
		await fse.remove(directory)
	})

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('boots the released image from boot group a', async () => {
		const {version} = await umbreld.client.system.version.query()
		expect(version).toBe(fromVersion)

		const state = await getRugixState(umbreld)
		expect(state.bootFlow).toBe('grub')
		expect(state.activeGroup).toBe('a')
		expect(state.defaultGroup).toBe('a')
	})

	test('creates a marker file', async () => {
		await umbreld.api.post(`files/upload?path=/Home/${markerName}`, {body: 'os update marker'})
	})

	test('installs the update with the released Rugix Ctrl', async () => {
		const {version: oldRugixVersion} = await getRugixState(umbreld)

		const output = await runUpdateScript(umbreld, bundleServer.port)

		// The update script picks the native amd64 bundle for the grub boot flow
		expect(bundleServer.requestedPaths).toContain('/umbrelos-amd64.update')
		// umbreld drives the update progress bar from these events
		expect(output).toMatch(/\{"event":"UpdateProgress","progress":[\d.]+\}/)

		// Installing doesn't change the running system
		const state = await getRugixState(umbreld)
		expect(state.version).toBe(oldRugixVersion)
		expect(state.activeGroup).toBe('a')
	})

	test('boots and commits the updated system after restarting', async () => {
		await rebootAndWaitForUmbreld(umbreld, () => reboot(umbreld))

		const state = await waitForCommittedBoot(umbreld)
		expect(state.activeGroup).toBe('b')
		expect(state.defaultGroup).toBe('b')
		expect(state.version).toMatch(/^rugix-ctrl v1\./)
		newRugixVersion = state.version
	})

	test('keeps user data across the update', async () => {
		const homeListing = await umbreld.client.files.list.query({path: '/Home'})
		expect(homeListing.files.map((file) => file.name)).toContain(markerName)
	})

	test('keeps the config partition read-only', async () => {
		const options = await umbreld.vm.sshAsRoot('findmnt --noheadings --output OPTIONS /run/rugix/mounts/config')
		expect(options.split(',')).toContain('ro')
	})

	// Releases from before signing reach this build with the update script, and from then on it only
	// installs signed releases. Its root key is swapped for a test one.
	test('installs its next update as a signed release through umbreld, with the updated Rugix Ctrl', async () => {
		const rootKey = createRootKey()
		const alice = await createSigningKey('alice-mbp-2026')
		const signingKeysList = createSigningKeysList({date: '2026-01-01T00:00:00Z', keys: [signingKey(alice)], rootKey})
		api = await serveUmbrelApi()
		await redirectToUmbrelApi(umbreld, api)
		await trustRootKey(umbreld, rootKey, signingKeysList)
		const bundleHash = (await fs.promises.readFile(`${updateBundle}.hash`, 'utf8')).trim()
		await publishRelease({api, releases: bundleServer}, {signers: [alice], signingKeysList, bundleHash})

		await rebootAndWaitForUmbreld(umbreld, async () => {
			expect(await installLatestRelease(umbreld)).toEqual({success: true, error: false})
		})

		const state = await waitForCommittedBoot(umbreld)
		expect(state.activeGroup).toBe('a')
		expect(state.version).toBe(newRugixVersion)
		// Installing and rebooting take a while on an emulated amd64 VM
	}, 1_800_000)

	test('falls back to the committed system when the updated system fails to boot', async () => {
		// GRUB boots the other system once when Rugix sets this flag, clearing it as it does
		const getBootSpareFlag = () =>
			umbreld.vm.sshAsRoot(
				'grep --text --only-matching "rugpi_boot_spare=[a-z]*" /run/rugix/mounts/config/rugpi/boot_spare.grubenv',
			)

		await runUpdateScript(umbreld, bundleServer.port)
		expect(await getBootSpareFlag()).toBe('rugpi_boot_spare=true')

		// Break the freshly installed system partition so its trial boot panics before
		// umbreld can commit it
		await umbreld.vm.sshAsRoot(
			`wipefs --all --quiet "$(rugix-ctrl utils resolve-partition ${systemPartition.b} | jq -r .device)"`,
		)

		await rebootAndWaitForUmbreld(umbreld, () => reboot(umbreld))

		// The trial boot was used up and the device came back on the committed system
		expect(await getBootSpareFlag()).toBe('rugpi_boot_spare=false')
		const state = await waitForCommittedBoot(umbreld)
		expect(state.activeGroup).toBe('a')
		expect(state.defaultGroup).toBe('a')
	})

	test('recovers the failed slot with the next update', async () => {
		await runUpdateScript(umbreld, bundleServer.port)
		await rebootAndWaitForUmbreld(umbreld, () => reboot(umbreld))

		const state = await waitForCommittedBoot(umbreld)
		expect(state.activeGroup).toBe('b')
		expect(state.version).toBe(newRugixVersion)
	})

	test('factory resets the updated system', async () => {
		await triggerFactoryReset(umbreld.client.system.factoryReset.mutate({password: 'moneyprintergobrrr'}))

		await pWaitFor(
			async () => {
				try {
					return !(await umbreld.unauthenticatedClient.user.exists.query())
				} catch {
					return false
				}
			},
			{interval: 2000, timeout: 600_000},
		)

		await umbreld.registerAndLogin()
		const homeListing = await umbreld.client.files.list.query({path: '/Home'})
		expect(homeListing.files.map((file) => file.name)).not.toContain(markerName)

		// Factory reset keeps the installed system
		const state = await getRugixState(umbreld)
		expect(state.activeGroup).toBe('b')
		expect(state.defaultGroup).toBe('b')
		expect(state.version).toBe(newRugixVersion)
	})
})
