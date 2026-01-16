import {expect, beforeAll, afterAll, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

describe.sequential('RAID failsafe mode', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstDeviceId: string
	let secondDeviceId: string
	let thirdDeviceId: string
	let initialUsableSpace: number

	beforeAll(async () => {
		umbreld = await createTestVm()
	})

	afterAll(async () => {
		await umbreld?.cleanup()
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

	test('registers user with failsafe RAID config (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [firstDeviceId, secondDeviceId], raidType: 'failsafe'})
	})

	test('waits for RAID setup to complete and logs in', async () => {
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch (error) {
					// Ignore connection errors while VM is rebooting
					if (error instanceof Error && error.message.includes('fetch failed')) {
						return false
					}
					// Rethrow server errors (e.g., initialRaidSetupError)
					throw error
				}
			},
			{interval: 2000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('reports correct RAID status after setup', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(2)
		initialUsableSpace = status.usableSpace!
		expect(initialUsableSpace).toBeGreaterThan(0)
	})

	test('has both devices in the array', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([firstDeviceId, secondDeviceId].sort())
	})

	test('shuts down and adds third SSD', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.addNvme({slot: 3})
		await umbreld.vm.powerOn()
	})

	test('logs in after adding third SSD', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('detects all three NVMe devices after reboot', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(3)
		const thirdDevice = devices.find((d) => d.slot === 3)
		expect(thirdDevice).toBeDefined()
		thirdDeviceId = thirdDevice!.id!
		expect(thirdDeviceId).toBeDefined()
	})

	test('adds third SSD to RAID array', async () => {
		await umbreld.client.hardware.raid.addDevice.mutate({
			device: thirdDeviceId,
		})
	})

	test('reports correct RAID status with three devices', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(3)
	})

	test('has all three devices in the array', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([firstDeviceId, secondDeviceId, thirdDeviceId].sort())
	})

	// In RAIDZ1, when attaching a new device, the expansion is async.
	// Wait for usableSpace to increase as the expansion completes.
	test('usable space increased after adding third device', async () => {
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.usableSpace! > initialUsableSpace
			},
			{interval: 5000, timeout: 600_000},
		)
	})
})
