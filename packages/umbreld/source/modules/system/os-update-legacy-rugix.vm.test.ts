// @vm-requires-update-bundle
import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'
import {
	downloadReleaseImage,
	getRugixState,
	rebootAndWaitForUmbreld,
	reboot,
	runUpdateScript,
	serveUpdateBundle,
	waitForCommittedBoot,
} from '../test-utilities/os-update.js'

// The oldest Rugix releases still in the field. 1.6.x ships Rugix Ctrl 0.8, which the update
// script drives with `--reboot deferred`, and 1.7.x ships Rugix Ctrl 1.0.
describe.each([
	{fromVersion: '1.6.1', fromRugixVersion: /^rugix-ctrl v0\.8\./},
	{fromVersion: '1.7.4', fromRugixVersion: /^rugix-ctrl v1\.0\./},
])('OS update from umbrelOS $fromVersion', ({fromVersion, fromRugixVersion}) => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let bundleServer: Awaited<ReturnType<typeof serveUpdateBundle>>
	let failed = false
	let newRugixVersion: string

	const markerName = 'os-update-marker.txt'

	beforeAll(async () => {
		bundleServer = await serveUpdateBundle()
		umbreld = await createTestVm({device: 'umbrel-home', image: await downloadReleaseImage(fromVersion)})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
	})

	afterAll(async () => {
		await umbreld?.cleanup()
		await bundleServer?.close()
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
		expect(state.version).toMatch(fromRugixVersion)
		expect(state.bootFlow).toBe('grub')
		expect(state.activeGroup).toBe('a')
	})

	test('creates a marker file', async () => {
		// Written directly since the files API of old releases differs
		await umbreld.vm.sshAsRoot(
			`printf 'os update marker' > ${umbreld.vm.dataDirectory}/home/${markerName} && chown 1000:1000 ${umbreld.vm.dataDirectory}/home/${markerName}`,
		)
	})

	test('installs the update with the released Rugix Ctrl', async () => {
		await runUpdateScript(umbreld, bundleServer.port)

		// The update script picks the native amd64 bundle for the grub boot flow
		expect(bundleServer.requestedPaths).toContain('/umbrelos-amd64.update')
	})

	test('boots and commits the updated system after restarting', async () => {
		await rebootAndWaitForUmbreld(umbreld, () => reboot(umbreld))

		const state = await waitForCommittedBoot(umbreld)
		expect(state.activeGroup).toBe('b')
		expect(state.defaultGroup).toBe('b')
		expect(state.version).not.toMatch(fromRugixVersion)
		expect(state.version).toMatch(/^rugix-ctrl v1\./)
		newRugixVersion = state.version
	})

	test('keeps user data across the update', async () => {
		const homeListing = await umbreld.client.files.list.query({path: '/Home'})
		expect(homeListing.files.map((file) => file.name)).toContain(markerName)
	})

	test('installs another update with the updated Rugix Ctrl', async () => {
		const output = await runUpdateScript(umbreld, bundleServer.port)
		expect(output).toContain('{"event":"UpdateProgress","progress":100')

		await rebootAndWaitForUmbreld(umbreld, () => reboot(umbreld))

		const state = await waitForCommittedBoot(umbreld)
		expect(state.activeGroup).toBe('a')
		expect(state.version).toBe(newRugixVersion)
	})
})
