import {expect, beforeAll, afterAll, describe, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

describe('Internal storage rounded size', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>

	// Test sizes in bytes
	const GB_512 = '512000000000'
	const TB_1_EXACT = '1000000000000'
	const TB_4_PHISON = '4096805658624' // Larger Phison SSD
	const TB_4_SAMSUNG = '4000787030016' // Smaller Samsung SSD

	beforeAll(async () => {
		umbreld = await createTestVm()
	})

	afterAll(async () => {
		await umbreld?.cleanup()
	})

	test('adds NVMe devices with various sizes and boots VM', async () => {
		await umbreld.vm.addNvme({slot: 1, size: GB_512})
		await umbreld.vm.addNvme({slot: 2, size: TB_1_EXACT})
		await umbreld.vm.addNvme({slot: 3, size: TB_4_PHISON})
		await umbreld.vm.addNvme({slot: 4, size: TB_4_SAMSUNG})
		await umbreld.vm.powerOn()
	})

	test('returns correct rounded sizes for all devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(4)

		// Find devices by slot
		const slot1 = devices.find((d) => d.slot === 1)!
		const slot2 = devices.find((d) => d.slot === 2)!
		const slot3 = devices.find((d) => d.slot === 3)!
		const slot4 = devices.find((d) => d.slot === 4)!

		// 512GB - under 1TB, should not be rounded
		expect(slot1.size).toBe(512_000_000_000)
		expect(slot1.roundedSize).toBe(512_000_000_000)

		// 1TB exact - should stay at 1TB
		expect(slot2.size).toBe(1_000_000_000_000)
		expect(slot2.roundedSize).toBe(1_000_000_000_000)

		// Phison 4TB (~4.097TB) - should round to 4TB
		expect(slot3.size).toBe(4_096_805_658_624)
		expect(slot3.roundedSize).toBe(4_000_000_000_000)

		// Samsung 4TB (~4.001TB) - should round to 4TB
		expect(slot4.size).toBe(4_000_787_030_016)
		expect(slot4.roundedSize).toBe(4_000_000_000_000)
	})

	test('Phison and Samsung 4TB drives have matching rounded sizes', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		const slot3 = devices.find((d) => d.slot === 3)!
		const slot4 = devices.find((d) => d.slot === 4)!

		// Different actual sizes
		expect(slot3.size).not.toBe(slot4.size)

		// But same rounded sizes for RAID compatibility
		expect(slot3.roundedSize).toBe(slot4.roundedSize)
		expect(slot3.roundedSize).toBe(4_000_000_000_000)
	})
})
