import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

const expectedSingleAcceleratorL2arcSizeGb = 10
const expectedSingleAcceleratorSpecialSizeGb = 490
const expectedStripedAcceleratorL2arcSizeGb = 20
const expectedMirroredAcceleratorSpecialSizeGb = 490

function expectSizeToBeWithinTenPercentOfGb(actualBytes: number | undefined, expectedGb: number) {
	expect(actualBytes).toBeDefined()
	const actualGb = actualBytes! / 1_000_000_000
	expect(actualGb).toBeGreaterThanOrEqual(expectedGb * 0.9)
	expect(actualGb).toBeLessThanOrEqual(expectedGb * 1.1)
}

describe('RAID HDD accelerator during initial storage setup', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let hddDeviceId1: string
	let hddDeviceId2: string
	let acceleratorDeviceId1: string
	let acceleratorDeviceId2: string
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

	test('adds two HDDs and two NVMe SSDs and boots VM', async () => {
		await umbreld.vm.addHdd({slot: 1})
		await umbreld.vm.addHdd({slot: 2})
		await umbreld.vm.addNvme({slot: 1, size: '512G'})
		await umbreld.vm.addNvme({slot: 2, size: '500G'})
		await umbreld.vm.powerOn()
	})

	test('detects HDD and SSD devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		const hdds = devices.filter((device) => device.type === 'hdd')
		const ssds = devices.filter((device) => device.type === 'ssd')

		expect(hdds).toHaveLength(2)
		expect(ssds).toHaveLength(2)

		hddDeviceId1 = hdds[0].id!
		hddDeviceId2 = hdds[1].id!
		acceleratorDeviceId1 = ssds[0].id!
		acceleratorDeviceId2 = ssds[1].id!
	})

	test('sets up storage mode with an accelerator in a single register call', async () => {
		await umbreld.signup({
			raidDevices: [hddDeviceId1],
			raidType: 'storage',
			acceleratorDevices: [acceleratorDeviceId1],
		})
	})

	test('waits for storage setup to complete and logs in', async () => {
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

	test('reports the accelerator after initial storage setup', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('storage')
		expect(status.devices).toHaveLength(1)
		expect(status.accelerator).toMatchObject({exists: true})
		expect(status.accelerator?.devices).toHaveLength(1)
		expect(status.accelerator?.devices?.[0]).toMatchObject({id: acceleratorDeviceId1})
		expectSizeToBeWithinTenPercentOfGb(status.accelerator?.l2arcSize, expectedSingleAcceleratorL2arcSizeGb)
		expectSizeToBeWithinTenPercentOfGb(status.accelerator?.specialSize, expectedSingleAcceleratorSpecialSizeGb)
	})
})

describe('RAID HDD mirrored accelerator during initial failsafe setup', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let hddDeviceId1: string
	let hddDeviceId2: string
	let acceleratorDeviceId1: string
	let acceleratorDeviceId2: string
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

	test('adds two HDDs and two NVMe SSDs and boots VM', async () => {
		await umbreld.vm.addHdd({slot: 1})
		await umbreld.vm.addHdd({slot: 2})
		await umbreld.vm.addNvme({slot: 1, size: '512G'})
		await umbreld.vm.addNvme({slot: 2, size: '500G'})
		await umbreld.vm.powerOn()
	})

	test('detects HDD and SSD devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		const hdds = devices.filter((device) => device.type === 'hdd')
		const ssds = devices.filter((device) => device.type === 'ssd')

		expect(hdds).toHaveLength(2)
		expect(ssds).toHaveLength(2)

		hddDeviceId1 = hdds[0].id!
		hddDeviceId2 = hdds[1].id!
		acceleratorDeviceId1 = ssds[0].id!
		acceleratorDeviceId2 = ssds[1].id!
	})

	test('sets up failsafe mode with an accelerator in a single register call', async () => {
		await umbreld.signup({
			raidDevices: [hddDeviceId1, hddDeviceId2],
			raidType: 'failsafe',
			acceleratorDevices: [acceleratorDeviceId1, acceleratorDeviceId2],
		})
	})

	test('waits for failsafe setup to complete and logs in', async () => {
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

	test('reports striped l2arc and mirrored special after initial failsafe setup', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.topology).toBe('mirror')
		expect(status.devices).toHaveLength(2)
		expect(status.accelerator).toMatchObject({exists: true})
		expect(status.accelerator?.devices).toHaveLength(2)

		const acceleratorIds = status.accelerator!.devices!.map((device) => device.id).sort()
		expect(acceleratorIds).toEqual([acceleratorDeviceId1, acceleratorDeviceId2].sort())
		expectSizeToBeWithinTenPercentOfGb(status.accelerator?.l2arcSize, expectedStripedAcceleratorL2arcSizeGb)
		expectSizeToBeWithinTenPercentOfGb(status.accelerator?.specialSize, expectedMirroredAcceleratorSpecialSizeGb)
	})
})
