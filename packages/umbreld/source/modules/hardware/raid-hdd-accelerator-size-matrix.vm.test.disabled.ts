import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

function expectSizeToBeWithinTenPercentOfGb(actualBytes: number | undefined, expectedGb: number) {
	expect(actualBytes).toBeDefined()
	const actualGb = actualBytes! / 1_000_000_000
	expect(actualGb).toBeGreaterThanOrEqual(expectedGb * 0.9)
	expect(actualGb).toBeLessThanOrEqual(expectedGb * 1.1)
}

for (const {ssdSizeGb, expectedL2arcTotalGb, expectedSpecialTotalGb} of [
	{ssdSizeGb: 128, expectedL2arcTotalGb: 20, expectedSpecialTotalGb: 117}, // 128 GB each, no rounding
	{ssdSizeGb: 256, expectedL2arcTotalGb: 20, expectedSpecialTotalGb: 240}, // 256 GB each, rounded to 250 GB
	{ssdSizeGb: 512, expectedL2arcTotalGb: 20, expectedSpecialTotalGb: 490}, // 512 GB each, rounded to 500 GB
	{ssdSizeGb: 1024, expectedL2arcTotalGb: 20, expectedSpecialTotalGb: 990}, // 1024 GB each, rounded to 1000 GB
]) {
	describe(`RAID HDD mirrored accelerator during initial failsafe setup with ${ssdSizeGb}GB SSDs`, () => {
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

		test('adds two HDDs and two same-size NVMe SSDs and boots VM', async () => {
			await umbreld.vm.addHdd({slot: 1})
			await umbreld.vm.addHdd({slot: 2})
			await umbreld.vm.addNvme({slot: 1, size: `${ssdSizeGb}G`})
			await umbreld.vm.addNvme({slot: 2, size: `${ssdSizeGb}G`})
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

		test('reports the expected striped l2arc and mirrored special sizes', async () => {
			const status = await umbreld.client.hardware.raid.getStatus.query()
			expect(status.raidType).toBe('failsafe')
			expect(status.topology).toBe('mirror')
			expect(status.devices).toHaveLength(2)
			expect(status.accelerator).toMatchObject({exists: true})
			expect(status.accelerator?.devices).toHaveLength(2)

			const acceleratorIds = status.accelerator!.devices!.map((device) => device.id).sort()
			expect(acceleratorIds).toEqual([acceleratorDeviceId1, acceleratorDeviceId2].sort())
			expectSizeToBeWithinTenPercentOfGb(status.accelerator?.l2arcSize, expectedL2arcTotalGb)
			expectSizeToBeWithinTenPercentOfGb(status.accelerator?.specialSize, expectedSpecialTotalGb)
		})
	})
}
