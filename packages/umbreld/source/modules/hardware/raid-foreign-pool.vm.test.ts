import {expect, beforeAll, afterAll, describe, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

// Tests that SSDs previously used in another Umbrel installation don't interfere
// with the current installation. The system should mount the correct pool based
// on the pool name stored in the config, ignoring any foreign pools.
describe.sequential('RAID with previously used SSDs', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let currentPoolDevices: string[]

	beforeAll(async () => {
		umbreld = await createTestVm()
	})

	afterAll(async () => {
		await umbreld?.cleanup()
	})

	// Phase 1: Set up an Umbrel with SSDs in slots 1+2 (simulates a previous installation)
	test('adds two NVMe devices (slots 1+2) and boots VM', async () => {
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.powerOn()
	})

	test('detects both NVMe devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(2)
	})

	test('registers user with storage RAID using slots 1+2', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		await umbreld.signup({raidDevices: devices.map((d) => d.id!), raidType: 'storage'})
	})

	test('waits for setup to complete', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('verifies RAID setup', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.devices).toHaveLength(2)
	})

	// Phase 2: Simulate obtaining SSDs from a different Umbrel
	// Disconnect the SSDs, reflash to a fresh OS, then set up with new SSDs
	test('powers off and disconnects SSDs', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.disconnectNvme({slot: 1})
		await umbreld.vm.disconnectNvme({slot: 2})
	})

	test('reflashes to simulate fresh Umbrel', async () => {
		await umbreld.vm.reflash()
	})

	test('adds new NVMe devices (slots 3+4) and boots fresh', async () => {
		await umbreld.vm.addNvme({slot: 3})
		await umbreld.vm.addNvme({slot: 4})
		await umbreld.vm.powerOn()
	})

	test('detects new NVMe devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(2)
		expect(devices.map((d) => d.slot).sort()).toEqual([3, 4])
	})

	test('registers user with storage RAID using slots 3+4', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		currentPoolDevices = devices.map((d) => d.id!)
		await umbreld.signup({raidDevices: currentPoolDevices, raidType: 'storage'})
	})

	test('waits for setup to complete', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('verifies RAID setup', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.devices).toHaveLength(2)
	})

	// Phase 3: Connect the SSDs from the previous Umbrel and verify they're ignored
	test('powers off and connects SSDs from previous Umbrel', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.connectNvme({slot: 1})
		await umbreld.vm.connectNvme({slot: 2})
	})

	test('boots with all four SSDs', async () => {
		await umbreld.vm.powerOn()
	})

	test('mounts the current pool and ignores the foreign pool', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.devices?.map((d) => d.id).sort()).toEqual(currentPoolDevices.sort())
	})
})
