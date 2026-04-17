import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

const expectedSingleAcceleratorL2arcSizeGb = 10
const expectedSingleAcceleratorSpecialSizeGb = 490

function expectSizeToBeWithinTenPercentOfGb(actualBytes: number | undefined, expectedGb: number) {
	expect(actualBytes).toBeDefined()
	const actualGb = actualBytes! / 1_000_000_000
	expect(actualGb).toBeGreaterThanOrEqual(expectedGb * 0.9)
	expect(actualGb).toBeLessThanOrEqual(expectedGb * 1.1)
}

describe('RAID HDD accelerator validation in storage mode', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let hddDeviceId1: string
	let hddDeviceId2: string
	let acceleratorDeviceId1: string
	let spareAcceleratorDeviceId1: string
	let spareAcceleratorDeviceId2: string
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

	test('adds two HDDs and three NVMe SSDs and boots VM', async () => {
		await umbreld.vm.addHdd({slot: 1})
		await umbreld.vm.addHdd({slot: 2})
		await umbreld.vm.addNvme({slot: 1, size: '512G'})
		await umbreld.vm.addNvme({slot: 2, size: '500G'})
		await umbreld.vm.addNvme({slot: 3, size: '500G'})
		await umbreld.vm.powerOn()
	})

	test('detects HDD and SSD devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		const hdds = devices.filter((device) => device.type === 'hdd')
		const ssds = devices.filter((device) => device.type === 'ssd')

		expect(hdds).toHaveLength(2)
		expect(ssds).toHaveLength(3)

		hddDeviceId1 = hdds[0].id!
		hddDeviceId2 = hdds[1].id!
		acceleratorDeviceId1 = ssds[0].id!
		spareAcceleratorDeviceId1 = ssds[1].id!
		spareAcceleratorDeviceId2 = ssds[2].id!
	})

	test('registers user with HDD storage config', async () => {
		await umbreld.signup({raidDevices: [hddDeviceId1], raidType: 'storage'})
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

	test('sets l2arc_exclude_special on startup', async () => {
		const value = (await umbreld.vm.ssh('cat /sys/module/zfs/parameters/l2arc_exclude_special')).trim()
		expect(value).toBe('1')
	})

	test('rejects adding two accelerator SSDs in storage mode', async () => {
		await expect(
			umbreld.client.hardware.raid.addAccelerator.mutate({
				deviceIds: [acceleratorDeviceId1, spareAcceleratorDeviceId1],
			}),
		).rejects.toThrow('Storage mode requires exactly one SSD for the accelerator')
	})

	test('rejects using a RAID data disk as an accelerator', async () => {
		await expect(
			umbreld.client.hardware.raid.addAccelerator.mutate({
				deviceIds: [hddDeviceId1],
			}),
		).rejects.toThrow('Cannot add a RAID data device as an accelerator')
	})

	test('rejects using a non-SSD device as an accelerator', async () => {
		await expect(
			umbreld.client.hardware.raid.addAccelerator.mutate({
				deviceIds: [hddDeviceId2],
			}),
		).rejects.toThrow('Accelerator devices must be SSDs')
	})

	test('adds a single SSD accelerator', async () => {
		await umbreld.client.hardware.raid.addAccelerator.mutate({deviceIds: [acceleratorDeviceId1]})
	})

	test('sets special_small_blocks on the pool', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const value = (await umbreld.vm.ssh(`zfs get -H -o value special_small_blocks ${status.name}`)).trim()
		expect(value).toBe('32K')
	})

	test('reports the accelerator after setup', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.accelerator).toMatchObject({exists: true})
		expect(status.accelerator?.devices).toHaveLength(1)
		expect(status.accelerator?.devices?.[0]).toMatchObject({id: acceleratorDeviceId1})
		expectSizeToBeWithinTenPercentOfGb(status.accelerator?.l2arcSize, expectedSingleAcceleratorL2arcSizeGb)
		expectSizeToBeWithinTenPercentOfGb(status.accelerator?.specialSize, expectedSingleAcceleratorSpecialSizeGb)
	})

	test('preserves the accelerator across reboot', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.accelerator).toMatchObject({exists: true})
		expect(status.accelerator?.devices).toHaveLength(1)
		expect(status.accelerator?.devices?.[0]).toMatchObject({id: acceleratorDeviceId1})
		expectSizeToBeWithinTenPercentOfGb(status.accelerator?.l2arcSize, expectedSingleAcceleratorL2arcSizeGb)
		expectSizeToBeWithinTenPercentOfGb(status.accelerator?.specialSize, expectedSingleAcceleratorSpecialSizeGb)
	})

	test('rejects replacing an accelerator with a device already in the accelerator', async () => {
		await expect(
			umbreld.client.hardware.raid.replaceDevice.mutate({
				oldDevice: acceleratorDeviceId1,
				newDevice: acceleratorDeviceId1,
			}),
		).rejects.toThrow('Cannot replace with a device that is already in the accelerator')
	})

	test('rejects replacing an accelerator with a device already in the RAID array', async () => {
		await expect(
			umbreld.client.hardware.raid.replaceDevice.mutate({
				oldDevice: acceleratorDeviceId1,
				newDevice: hddDeviceId1,
			}),
		).rejects.toThrow('Cannot replace with a device that is already in the RAID array')
	})

	test('rejects replacing a device that is not in the RAID array or accelerator', async () => {
		await expect(
			umbreld.client.hardware.raid.replaceDevice.mutate({
				oldDevice: spareAcceleratorDeviceId1,
				newDevice: spareAcceleratorDeviceId2,
			}),
		).rejects.toThrow(`Device ${spareAcceleratorDeviceId1} is not in the RAID array or accelerator`)
	})
})
