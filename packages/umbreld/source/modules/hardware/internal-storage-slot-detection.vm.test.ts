import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

describe('Internal storage device detection', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false

	beforeAll(async () => {
		umbreld = await createTestVm()
		await umbreld.vm.powerOn()
	})

	afterAll(async () => await umbreld?.cleanup())

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('getDevices() returns empty array when no NVMe devices present', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		expect(devices).toEqual([])
	})

	for (const slot of [1, 2, 3, 4]) {
		test(`getDevices() detects NVMe device in slot ${slot}`, async () => {
			// Power off and add NVMe device to slot
			await umbreld.vm.powerOff()
			await umbreld.vm.addNvme({slot})
			await umbreld.vm.powerOn()

			// Check NVMe device is detected in the correct slot
			const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
			expect(devices).toHaveLength(1)
			expect(devices[0].slot).toBe(slot)

			// Power off and remove NVMe device from slot
			await umbreld.vm.powerOff()
			await umbreld.vm.removeNvme({slot})
		})
	}
})
