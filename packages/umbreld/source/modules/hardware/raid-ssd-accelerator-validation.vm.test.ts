import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

describe('RAID SSD accelerator validation', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let ssdDeviceId1: string
	let ssdDeviceId2: string
	let ssdDeviceId3: string
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

	test('adds three NVMe SSDs and boots VM', async () => {
		await umbreld.vm.addNvme({slot: 1, size: '512G'})
		await umbreld.vm.addNvme({slot: 2, size: '500G'})
		await umbreld.vm.addNvme({slot: 3, size: '500G'})
		await umbreld.vm.powerOn()
	})

	test('detects SSD devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(3)

		ssdDeviceId1 = devices[0].id!
		ssdDeviceId2 = devices[1].id!
		ssdDeviceId3 = devices[2].id!
	})

	test('rejects initial setup with an accelerator on an SSD RAID array', async () => {
		await expect(
			umbreld.signup({
				raidDevices: [ssdDeviceId1],
				raidType: 'storage',
				acceleratorDevices: [ssdDeviceId2],
			}),
		).rejects.toThrow('Accelerators are only supported for HDD RAID arrays')
	})

	test('registers user with SSD storage config', async () => {
		await umbreld.signup({raidDevices: [ssdDeviceId1], raidType: 'storage'})
	})

	test('waits for RAID setup to complete and logs in', async () => {
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch {
					return false
				}
			},
			{interval: 2000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('rejects adding an accelerator to an SSD RAID array', async () => {
		await expect(umbreld.client.hardware.raid.addAccelerator.mutate({deviceIds: [ssdDeviceId2]})).rejects.toThrow(
			'Accelerators are only supported for HDD RAID arrays',
		)
	})

	test('rejects replacing a storage device with an accelerator device already in the array', async () => {
		await expect(
			umbreld.client.hardware.raid.replaceDevice.mutate({
				oldDevice: ssdDeviceId1,
				newDevice: ssdDeviceId1,
			}),
		).rejects.toThrow('Cannot replace with a device that is already in the RAID array')
	})

	test('can still see spare SSDs after the rejection paths', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		expect(devices.some((device) => device.id === ssdDeviceId2)).toBe(true)
		expect(devices.some((device) => device.id === ssdDeviceId3)).toBe(true)
	})
})
