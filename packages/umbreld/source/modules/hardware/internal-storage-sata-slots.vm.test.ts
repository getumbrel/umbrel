import {expect, beforeAll, afterAll, describe, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

// The VM has eight SATA slots but QEMU's AHCI controller only has six ports, so slots 7 and 8 are
// on a second controller
describe('Internal storage SATA slots', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'nas'})
	})

	afterAll(async () => await umbreld?.cleanup())

	test('getDevices() detects a SATA HDD in each of the eight slots', async () => {
		for (const slot of [1, 2, 3, 4, 5, 6, 7, 8]) await umbreld.vm.addHdd({slot})
		await umbreld.vm.powerOn()

		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(8)
		expect(devices.every((device) => device.type === 'hdd' && device.transport === 'sata')).toBe(true)

		// The VM gives each drive a serial that starts with its slot
		const slots = devices.map((device) => Number(device.serial.match(/^hdd(\d)-/)?.[1])).sort()
		expect(slots).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
	})
})
