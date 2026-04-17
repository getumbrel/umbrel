import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

const expectedStripedAcceleratorL2arcSizeGb = 20
const expectedMirroredAcceleratorSpecialSizeGb = 490

function expectSizeToBeWithinTenPercentOfGb(actualBytes: number | undefined, expectedGb: number) {
	expect(actualBytes).toBeDefined()
	const actualGb = actualBytes! / 1_000_000_000
	expect(actualGb).toBeGreaterThanOrEqual(expectedGb * 0.9)
	expect(actualGb).toBeLessThanOrEqual(expectedGb * 1.1)
}

describe('RAID HDD accelerator in failsafe mode', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let hddDeviceId1: string
	let hddDeviceId2: string
	let acceleratorDeviceId1: string
	let acceleratorDeviceId2: string
	let spareAcceleratorDeviceId: string
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
		await umbreld.vm.addNvme({slot: 3, size: '512G'})
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
		acceleratorDeviceId2 = ssds[1].id!
		spareAcceleratorDeviceId = ssds[2].id!
	})

	test('registers user with HDD failsafe config', async () => {
		await umbreld.signup({raidDevices: [hddDeviceId1, hddDeviceId2], raidType: 'failsafe'})
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

	test('rejects adding only one accelerator SSD in failsafe mode', async () => {
		await expect(
			umbreld.client.hardware.raid.addAccelerator.mutate({deviceIds: [acceleratorDeviceId1]}),
		).rejects.toThrow('Failsafe mode requires exactly two SSDs for the accelerator')
	})

	test('rejects duplicate accelerator SSDs in failsafe mode', async () => {
		await expect(
			umbreld.client.hardware.raid.addAccelerator.mutate({deviceIds: [acceleratorDeviceId1, acceleratorDeviceId1]}),
		).rejects.toThrow('Accelerator devices must be unique')
	})

	test('adds striped l2arc and mirrored special with 512GB and 500GB SSDs', async () => {
		await umbreld.client.hardware.raid.addAccelerator.mutate({
			deviceIds: [acceleratorDeviceId1, acceleratorDeviceId2],
		})
	})

	test('rejects adding an accelerator when one is already configured', async () => {
		await expect(
			umbreld.client.hardware.raid.addAccelerator.mutate({
				deviceIds: [spareAcceleratorDeviceId, acceleratorDeviceId1],
			}),
		).rejects.toThrow('RAID array already has an accelerator')
	})

	test('reports striped l2arc and mirrored special separately from RAID data devices', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.devices).toHaveLength(2)
		expect(status.accelerator).toMatchObject({exists: true})
		expect(status.accelerator?.devices).toHaveLength(2)

		const acceleratorIds = status.accelerator!.devices!.map((device) => device.id).sort()
		expect(acceleratorIds).toEqual([acceleratorDeviceId1, acceleratorDeviceId2].sort())
		expectSizeToBeWithinTenPercentOfGb(status.accelerator?.l2arcSize, expectedStripedAcceleratorL2arcSizeGb)
		expectSizeToBeWithinTenPercentOfGb(status.accelerator?.specialSize, expectedMirroredAcceleratorSpecialSizeGb)
	})
})
