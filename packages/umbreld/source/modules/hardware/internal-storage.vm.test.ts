import {expect, beforeAll, afterAll, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestVm>>
beforeAll(async () => {
	umbreld = await createTestVm()
	await umbreld.vm.powerOn()
}, 180000)
afterAll(async () => await umbreld?.cleanup(), 30000)

test('getDevices() returns empty array when no NVMe devices present', async () => {
	const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
	expect(devices).toEqual([])
})

test('getDevices() detects NVMe device in each slot', async () => {
	for (const slot of [1, 2, 3, 4]) {
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
	}
})
