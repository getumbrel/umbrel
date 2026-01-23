import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

describe('RAID survives SSD slot swap', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstDeviceId: string
	let secondDeviceId: string
	let failed = false

	beforeAll(async () => {
		umbreld = await createTestVm()
	})

	afterAll(async () => {
		await umbreld?.cleanup()
	})

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('adds two NVMe devices and boots VM', async () => {
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.powerOn()
	})

	test('detects both NVMe devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(2)
		const device1 = devices.find((d) => d.slot === 1)
		const device2 = devices.find((d) => d.slot === 2)
		expect(device1).toBeDefined()
		expect(device2).toBeDefined()
		firstDeviceId = device1!.id!
		secondDeviceId = device2!.id!
	})

	test('registers user with storage RAID config (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [firstDeviceId, secondDeviceId], raidType: 'storage'})
	})

	test('waits for RAID setup to complete and logs in', async () => {
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch (error) {
					if (error instanceof Error && error.message.includes('fetch failed')) {
						return false
					}
					throw error
				}
			},
			{interval: 1000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('reports correct RAID status', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(2)
	})

	test('shuts down VM', async () => {
		await umbreld.vm.powerOff()
	})

	test('swaps NVMe devices between slots', async () => {
		// Swap slots: move 1 -> 3 (temp), 2 -> 1, 3 -> 2
		await umbreld.vm.moveNvme({fromSlot: 1, toSlot: 3})
		await umbreld.vm.moveNvme({fromSlot: 2, toSlot: 1})
		await umbreld.vm.moveNvme({fromSlot: 3, toSlot: 2})
	})

	test('boots VM after slot swap', async () => {
		await umbreld.vm.powerOn()
	})

	test('logs in after slot swap', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('detects devices with swapped slots', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(2)

		// Device IDs should be the same but in opposite slots
		const device1 = devices.find((d) => d.slot === 1)
		const device2 = devices.find((d) => d.slot === 2)
		expect(device1).toBeDefined()
		expect(device2).toBeDefined()

		// First device should now be in slot 2, second device in slot 1
		expect(device1!.id).toBe(secondDeviceId)
		expect(device2!.id).toBe(firstDeviceId)
	})

	test('RAID pool is still ONLINE after slot swap', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(2)
	})

	test('RAID devices have correct IDs after slot swap', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([firstDeviceId, secondDeviceId].sort())
	})
})
