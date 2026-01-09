import {expect, beforeAll, afterAll, describe, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

describe.sequential('RAID storage mode', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstDeviceId: string
	let secondDeviceId: string
	let initialTotalSpace: number

	beforeAll(async () => {
		umbreld = await createTestVm()
	}, 180000)

	afterAll(async () => {
		await umbreld?.cleanup()
	}, 30000)

	test('adds NVMe device and boots VM', async () => {
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.powerOn()
	}, 180000)

	test('detects NVMe device in slot 1', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(1)
		expect(devices[0].slot).toBe(1)
		firstDeviceId = devices[0].id!
		expect(firstDeviceId).toBeDefined()
	})

	test('registers user with RAID config (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [firstDeviceId], raidType: 'storage'})
	}, 60000)

	test('waits for VM to come back up and logs in', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	}, 180000)

	test('reports correct RAID status after setup', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(1)
		expect(status.devices![0].id).toBe(firstDeviceId)
		initialTotalSpace = status.totalSpace!
		expect(initialTotalSpace).toBeGreaterThan(0)
	})

	test('shuts down and adds second SSD', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.powerOn()
	}, 180000)

	test('logs in after adding second SSD', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	}, 180000)

	test('detects both NVMe devices after reboot', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(2)
		const secondDevice = devices.find((d) => d.slot === 2)
		expect(secondDevice).toBeDefined()
		secondDeviceId = secondDevice!.id!
		expect(secondDeviceId).toBeDefined()
	})

	test('adds second SSD to RAID array', async () => {
		await umbreld.client.hardware.raid.addDevice.mutate({
			device: secondDeviceId,
		})
	})

	test('reports correct RAID status with both devices', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(2)
	})

	test('has both devices in the array', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([firstDeviceId, secondDeviceId].sort())
	})

	test('total space increased after adding second device', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.totalSpace!).toBeGreaterThan(initialTotalSpace)
	})
})
