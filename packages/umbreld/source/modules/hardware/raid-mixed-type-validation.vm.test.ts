import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm, driveBuses} from '../test-utilities/create-test-umbreld.ts'

describe.each(driveBuses)('RAID device type validation - %s SSD array rejects HDD', (bus) => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let ssdDeviceId1: string
	let ssdDeviceId2: string
	let hddDeviceId: string
	let failed = false

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'nas'})
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

	test('adds SSD and HDD devices and boots VM', async () => {
		await umbreld.vm.addSsd({slot: 1, bus})
		await umbreld.vm.addSsd({slot: 2, bus})
		await umbreld.vm.addHdd({slot: 3, bus})
		await umbreld.vm.powerOn()
	})

	test('detects SSDs and HDD with correct types', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(3)

		const ssds = devices.filter((d) => d.transport === bus && d.type === 'ssd')
		const hdds = devices.filter((d) => d.type === 'hdd')

		expect(ssds).toHaveLength(2)
		expect(hdds).toHaveLength(1)
		expect(ssds.every((d) => d.type === 'ssd')).toBe(true)

		ssdDeviceId1 = ssds[0].id!
		ssdDeviceId2 = ssds[1].id!
		hddDeviceId = hdds[0].id!
		expect(ssdDeviceId1).toBeDefined()
		expect(ssdDeviceId2).toBeDefined()
		expect(hddDeviceId).toBeDefined()
	})

	test('registers user with single SSD RAID config (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [ssdDeviceId1], raidType: 'storage'})
	})

	test('waits for RAID setup to complete and logs in', async () => {
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch (error) {
					if (error instanceof Error && error.message.includes('fetch failed')) return false
					throw error
				}
			},
			{interval: 2000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('reports correct RAID status with SSD device', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(1)
		expect(status.devices![0].id).toBe(ssdDeviceId1)
	})

	test('rejects adding HDD to SSD RAID array', async () => {
		await expect(umbreld.client.hardware.raid.addDevice.mutate({deviceId: hddDeviceId})).rejects.toThrow(
			'Cannot mix SSDs and HDDs',
		)
	})

	test('rejects replacing SSD with HDD', async () => {
		await expect(
			umbreld.client.hardware.raid.replaceDevice.mutate({oldDevice: ssdDeviceId1, newDevice: hddDeviceId}),
		).rejects.toThrow('Cannot mix SSDs and HDDs')
	})

	test('allows adding second SSD to RAID array', async () => {
		await umbreld.client.hardware.raid.addDevice.mutate({deviceId: ssdDeviceId2})
	})

	test('reports correct RAID status with both SSDs', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(2)
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([ssdDeviceId1, ssdDeviceId2].sort())
	})
})

describe.each(driveBuses)('RAID device type validation - NVMe SSD array rejects HDD (%s)', (bus) => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let ssdDeviceId1: string
	let ssdDeviceId2: string
	let hddDeviceId: string
	let failed = false

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'nas'})
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

	test('adds NVMe SSD and HDD devices and boots VM', async () => {
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.addHdd({slot: 3, bus})
		await umbreld.vm.powerOn()
	})

	test('detects NVMe SSDs and HDD with correct types', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(3)

		const nvmeSsds = devices.filter((d) => d.transport === 'nvme' && d.type === 'ssd')
		const hdds = devices.filter((d) => d.type === 'hdd')

		expect(nvmeSsds).toHaveLength(2)
		expect(hdds).toHaveLength(1)
		expect(nvmeSsds.every((d) => d.type === 'ssd')).toBe(true)

		ssdDeviceId1 = nvmeSsds[0].id!
		ssdDeviceId2 = nvmeSsds[1].id!
		hddDeviceId = hdds[0].id!
		expect(ssdDeviceId1).toBeDefined()
		expect(ssdDeviceId2).toBeDefined()
		expect(hddDeviceId).toBeDefined()
	})

	test('registers user with single SSD RAID config (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [ssdDeviceId1], raidType: 'storage'})
	})

	test('waits for RAID setup to complete and logs in', async () => {
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch (error) {
					if (error instanceof Error && error.message.includes('fetch failed')) return false
					throw error
				}
			},
			{interval: 2000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('reports correct RAID status with NVMe SSD device', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(1)
		expect(status.devices![0].id).toBe(ssdDeviceId1)
	})

	test('rejects adding HDD to NVMe SSD RAID array', async () => {
		await expect(umbreld.client.hardware.raid.addDevice.mutate({deviceId: hddDeviceId})).rejects.toThrow(
			'Cannot mix SSDs and HDDs',
		)
	})

	test('rejects replacing NVMe SSD with HDD', async () => {
		await expect(
			umbreld.client.hardware.raid.replaceDevice.mutate({oldDevice: ssdDeviceId1, newDevice: hddDeviceId}),
		).rejects.toThrow('Cannot mix SSDs and HDDs')
	})

	test('allows adding second NVMe SSD to RAID array', async () => {
		await umbreld.client.hardware.raid.addDevice.mutate({deviceId: ssdDeviceId2})
	})

	test('reports correct RAID status with both NVMe SSDs', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(2)
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([ssdDeviceId1, ssdDeviceId2].sort())
	})
})
