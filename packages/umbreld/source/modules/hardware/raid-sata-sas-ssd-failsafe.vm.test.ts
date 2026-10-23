import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm, driveBuses} from '../test-utilities/create-test-umbreld.ts'

// SATA SSDs on the motherboard's controller and SSDs behind a SAS HBA both pool as raidz
// like NVMe SSDs
describe.each(driveBuses)('RAID %s SSD failsafe behavior', (bus) => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let ssdDeviceId1: string
	let ssdDeviceId2: string
	let ssdDeviceId3: string
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

	test('detects the SSDs as SSD type with the bay transport', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		const ssds = devices.filter((device) => device.type === 'ssd' && device.transport === bus)
		const hdds = devices.filter((device) => device.type === 'hdd')

		expect(ssds).toHaveLength(2)
		expect(hdds).toHaveLength(1)

		ssdDeviceId1 = ssds[0].id!
		ssdDeviceId2 = ssds[1].id!
		hddDeviceId = hdds[0].id!
		expect(ssdDeviceId1).toBeDefined()
		expect(ssdDeviceId2).toBeDefined()
		expect(hddDeviceId).toBeDefined()
	})

	test('registers user with 2-disk SSD failsafe config (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [ssdDeviceId1, ssdDeviceId2], raidType: 'failsafe'})
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

	test('reports raidz failsafe topology for SSDs', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(status.topology).toBe('raidz')
		expect(status.status).toBe('ONLINE')
		const deviceIds = status.devices!.map((device) => device.id).sort()
		expect(deviceIds).toEqual([ssdDeviceId1, ssdDeviceId2].sort())
	})

	test('rejects addMirror on SSD raidz failsafe arrays', async () => {
		await expect(
			umbreld.client.hardware.raid.addMirror.mutate({deviceIds: [ssdDeviceId1, ssdDeviceId2]}),
		).rejects.toThrow('addMirror is only supported for mirror failsafe mode')
	})

	test('rejects adding HDD to SSD failsafe arrays', async () => {
		await expect(umbreld.client.hardware.raid.addDevice.mutate({deviceId: hddDeviceId})).rejects.toThrow(
			'Cannot mix SSDs and HDDs',
		)
	})

	test('shuts down and adds third SSD', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.addSsd({slot: 4, bus})
		await umbreld.vm.powerOn()
	})

	test('logs in after adding third SSD', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('adds third SSD to raidz failsafe array', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		const availableSsds = devices.filter(
			(device) =>
				device.type === 'ssd' && device.transport === bus && device.id !== ssdDeviceId1 && device.id !== ssdDeviceId2,
		)
		expect(availableSsds).toHaveLength(1)
		ssdDeviceId3 = availableSsds[0].id!
		await umbreld.client.hardware.raid.addDevice.mutate({deviceId: ssdDeviceId3})
	})

	test('reports all SSDs in failsafe raidz array', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(status.topology).toBe('raidz')
		expect(status.status).toBe('ONLINE')
		const deviceIds = status.devices!.map((device) => device.id).sort()
		expect(deviceIds).toEqual([ssdDeviceId1, ssdDeviceId2, ssdDeviceId3].sort())
	})
})
