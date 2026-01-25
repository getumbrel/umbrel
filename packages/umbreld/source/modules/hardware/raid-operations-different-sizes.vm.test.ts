import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'

import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

// Size validation rules for RAID operations:
//
// Storage mode (striped vdevs):
//   - addDevice: allows any size (smaller or larger)
//   - replaceDevice: rejects smaller than device it's replacing, allows larger
//
// Failsafe mode (raidz1):
//   - addDevice: rejects smaller than current smallest device, allows larger
//   - replaceDevice: rejects smaller than device it's replacing, allows larger
//
// transitionToFailsafe:
//   - rejects smaller than the only current device, allows larger (tested in raid-transition-different-size.vm.test.ts)
//
// Note: "replace with larger" cases are tested in raid-replace-larger-capacity.vm.test.ts
// so they are not duplicated here.

describe('RAID size validation', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let smallDeviceId: string
	let mediumDeviceId: string
	let largeDeviceId: string
	let extraLargeDeviceId: string
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

	test('adds four NVMe devices of different sizes and boots VM', async () => {
		// Small: 32GB, Medium: 64GB, Large: 128GB, Extra Large: 256GB
		await umbreld.vm.addNvme({slot: 1, size: '32G'})
		await umbreld.vm.addNvme({slot: 2, size: '64G'})
		await umbreld.vm.addNvme({slot: 3, size: '128G'})
		await umbreld.vm.addNvme({slot: 4, size: '256G'})
		await umbreld.vm.powerOn()
	})

	test('detects all four NVMe devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(4)
		smallDeviceId = devices.find((d) => d.slot === 1)!.id!
		mediumDeviceId = devices.find((d) => d.slot === 2)!.id!
		largeDeviceId = devices.find((d) => d.slot === 3)!.id!
		extraLargeDeviceId = devices.find((d) => d.slot === 4)!.id!
	})

	// ==================== STORAGE MODE TESTS ====================

	test('registers user with storage RAID using medium device', async () => {
		await umbreld.signup({raidDevices: [mediumDeviceId], raidType: 'storage'})
	})

	test('waits for storage mode RAID setup to complete', async () => {
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch {
					return false
				}
			},
			{interval: 1000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('confirms storage mode RAID with medium device', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.devices).toHaveLength(1)
	})

	test('storage mode: allows adding larger device', async () => {
		await umbreld.client.hardware.raid.addDevice.mutate({device: largeDeviceId})
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.devices).toHaveLength(2)
	})

	test('storage mode: rejects replacing with smaller device', async () => {
		// Try to replace large (128GB) with small (32GB) - should fail
		// Note: must run before adding small to array
		await expect(
			umbreld.client.hardware.raid.replaceDevice.mutate({
				oldDevice: largeDeviceId,
				newDevice: smallDeviceId,
			}),
		).rejects.toThrow()
	})

	test('storage mode: allows adding smaller device', async () => {
		await umbreld.client.hardware.raid.addDevice.mutate({device: smallDeviceId})
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.devices).toHaveLength(3)
	})

	// ==================== FAILSAFE MODE TESTS ====================

	test('powers off and reflashes VM for failsafe mode tests', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.reflash()
		await umbreld.vm.powerOn()
	})

	test('re-detects all four NVMe devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(4)
		smallDeviceId = devices.find((d) => d.slot === 1)!.id!
		mediumDeviceId = devices.find((d) => d.slot === 2)!.id!
		largeDeviceId = devices.find((d) => d.slot === 3)!.id!
		extraLargeDeviceId = devices.find((d) => d.slot === 4)!.id!
	})

	test('registers user with failsafe RAID using medium and large devices', async () => {
		await umbreld.signup({raidDevices: [mediumDeviceId, largeDeviceId], raidType: 'failsafe'})
	})

	test('waits for failsafe mode RAID setup to complete', async () => {
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch {
					return false
				}
			},
			{interval: 1000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('confirms failsafe mode RAID with two devices', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(status.devices).toHaveLength(2)
	})

	test('failsafe mode: rejects adding smaller device', async () => {
		await expect(umbreld.client.hardware.raid.addDevice.mutate({device: smallDeviceId})).rejects.toThrow()
	})

	test('failsafe mode: allows adding larger device', async () => {
		await umbreld.client.hardware.raid.addDevice.mutate({device: extraLargeDeviceId})
		// Wait for expansion to start
		await pWaitFor(
			async () => {
				try {
					const status = await umbreld.client.hardware.raid.getStatus.query()
					return status.devices?.length === 3
				} catch {
					return false
				}
			},
			{interval: 1000, timeout: 600_000},
		)
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.devices).toHaveLength(3)
	})

	test('failsafe mode: rejects replacing with smaller device', async () => {
		// Try to replace extra large (256GB) with small (32GB) - should fail
		await expect(
			umbreld.client.hardware.raid.replaceDevice.mutate({
				oldDevice: extraLargeDeviceId,
				newDevice: smallDeviceId,
			}),
		).rejects.toThrow()
	})

	test('waits for pool to be ONLINE', async () => {
		await pWaitFor(
			async () => {
				try {
					const status = await umbreld.client.hardware.raid.getStatus.query()
					return status.status === 'ONLINE'
				} catch {
					return false
				}
			},
			{interval: 1000, timeout: 600_000},
		)
	})
})
