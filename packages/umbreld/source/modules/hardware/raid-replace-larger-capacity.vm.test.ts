import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

describe('RAID storage mode - upgrade disk capacity', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstDeviceId: string
	let secondDeviceId: string
	let thirdDeviceId: string
	let fourthDeviceId: string
	let initialUsableSpace: number
	let afterFirstReplaceUsableSpace: number
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

	test('adds two 32GB NVMe devices and boots VM', async () => {
		await umbreld.vm.addNvme({slot: 1, size: '32G'})
		await umbreld.vm.addNvme({slot: 2, size: '32G'})
		await umbreld.vm.powerOn()
	})

	test('detects both NVMe devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(2)
		const device1 = devices.find((d) => d.slot === 1)
		const device2 = devices.find((d) => d.slot === 2)
		expect(device1).toBeDefined()
		expect(device2).toBeDefined()
		firstDeviceId = device1!.id!
		secondDeviceId = device2!.id!
	})

	test('registers user with storage RAID config (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [firstDeviceId, secondDeviceId], raidType: 'storage'})
	})

	test('waits for RAID setup to complete and logs in', async () => {
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch (error) {
					if (error instanceof Error && error.message.includes('fetch failed')) {
						return false
					}
					throw error
				}
			},
			{interval: 1000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('reports correct RAID status', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(2)
		initialUsableSpace = status.usableSpace!
		expect(initialUsableSpace).toBeGreaterThan(0)
		console.log('Initial usable space:', initialUsableSpace)
	})

	test('creates marker directory to verify data consistency', async () => {
		await umbreld.client.files.createDirectory.mutate({path: '/Home/data-consistency-marker'})
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'data-consistency-marker')).toBe(true)
	})

	test('shuts down and adds first 64GB replacement drive', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.addNvme({slot: 3, size: '64G'})
		await umbreld.vm.powerOn()
	})

	test('logs in after adding replacement drive', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('detects new 64GB drive in slot 3', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(3)
		const thirdDevice = devices.find((d) => d.slot === 3)
		expect(thirdDevice).toBeDefined()
		thirdDeviceId = thirdDevice!.id!
	})

	test('replaces first 32GB device with 64GB device', async () => {
		await umbreld.client.hardware.raid.replaceDevice.mutate({
			oldDevice: firstDeviceId,
			newDevice: thirdDeviceId,
		})
	})

	test('waits for first replacement to complete', async () => {
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.replace?.state === 'finished'
			},
			{interval: 1000, timeout: 600_000},
		)
	})

	test('pool size increased after first replacement (storage mode expands per-disk)', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		afterFirstReplaceUsableSpace = status.usableSpace!
		console.log('Usable space after first replacement:', afterFirstReplaceUsableSpace)
		// In storage mode (stripe), space increases immediately because each disk is its own vdev
		// 32GB + 64GB = ~96GB usable
		expect(afterFirstReplaceUsableSpace).toBeGreaterThan(initialUsableSpace)
	})

	test('shuts down and adds second 64GB replacement drive', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.addNvme({slot: 4, size: '64G'})
		await umbreld.vm.powerOn()
	})

	test('logs in after adding second replacement drive', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('detects new 64GB drive in slot 4', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(4)
		const fourthDevice = devices.find((d) => d.slot === 4)
		expect(fourthDevice).toBeDefined()
		fourthDeviceId = fourthDevice!.id!
	})

	test('replaces second 32GB device with 64GB device', async () => {
		await umbreld.client.hardware.raid.replaceDevice.mutate({
			oldDevice: secondDeviceId,
			newDevice: fourthDeviceId,
		})
	})

	test('waits for second replacement to complete', async () => {
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.replace?.state === 'finished'
			},
			{interval: 1000, timeout: 600_000},
		)
	})

	test('pool size doubled after both replacements', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const finalUsableSpace = status.usableSpace!
		console.log('Final usable space:', finalUsableSpace)
		// Both disks are now 64GB, so usable should be ~128GB (roughly 2x initial)
		expect(finalUsableSpace).toBeGreaterThan(afterFirstReplaceUsableSpace)
		// Should be roughly double the initial space (with some tolerance for metadata)
		expect(finalUsableSpace).toBeGreaterThan(initialUsableSpace * 1.8)
	})

	test('RAID pool is ONLINE with correct devices', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(2)
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([thirdDeviceId, fourthDeviceId].sort())
	})

	test.skip('marker directory still exists after upgrades', async () => {
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'data-consistency-marker')).toBe(true)
	})
})

describe('RAID failsafe mode - upgrade disk capacity', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstDeviceId: string
	let secondDeviceId: string
	let thirdDeviceId: string
	let fourthDeviceId: string
	let initialUsableSpace: number
	let afterFirstReplaceUsableSpace: number
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

	test('adds two 32GB NVMe devices and boots VM', async () => {
		await umbreld.vm.addNvme({slot: 1, size: '32G'})
		await umbreld.vm.addNvme({slot: 2, size: '32G'})
		await umbreld.vm.powerOn()
	})

	test('detects both NVMe devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(2)
		const device1 = devices.find((d) => d.slot === 1)
		const device2 = devices.find((d) => d.slot === 2)
		expect(device1).toBeDefined()
		expect(device2).toBeDefined()
		firstDeviceId = device1!.id!
		secondDeviceId = device2!.id!
	})

	test('registers user with failsafe RAID config (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [firstDeviceId, secondDeviceId], raidType: 'failsafe'})
	})

	test('waits for RAID setup to complete and logs in', async () => {
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch (error) {
					if (error instanceof Error && error.message.includes('fetch failed')) {
						return false
					}
					throw error
				}
			},
			{interval: 1000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('reports correct RAID status', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(2)
		initialUsableSpace = status.usableSpace!
		expect(initialUsableSpace).toBeGreaterThan(0)
		console.log('Initial usable space:', initialUsableSpace)
	})

	test('creates marker directory to verify data consistency', async () => {
		await umbreld.client.files.createDirectory.mutate({path: '/Home/data-consistency-marker'})
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'data-consistency-marker')).toBe(true)
	})

	test('shuts down and adds first 64GB replacement drive', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.addNvme({slot: 3, size: '64G'})
		await umbreld.vm.powerOn()
	})

	test('logs in after adding replacement drive', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('detects new 64GB drive in slot 3', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(3)
		const thirdDevice = devices.find((d) => d.slot === 3)
		expect(thirdDevice).toBeDefined()
		thirdDeviceId = thirdDevice!.id!
	})

	test('replaces first 32GB device with 64GB device', async () => {
		await umbreld.client.hardware.raid.replaceDevice.mutate({
			oldDevice: firstDeviceId,
			newDevice: thirdDeviceId,
		})
	})

	test('waits for first replacement to complete', async () => {
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.replace?.state === 'finished'
			},
			{interval: 1000, timeout: 600_000},
		)
	})

	test('pool size unchanged after first replacement (still limited by 32GB disk)', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		afterFirstReplaceUsableSpace = status.usableSpace!
		console.log('Usable space after first replacement:', afterFirstReplaceUsableSpace)
		// In failsafe mode (raidz1), space is limited by smallest disk
		// Should still be ~32GB since one disk is still 32GB
		expect(afterFirstReplaceUsableSpace).toBeLessThan(initialUsableSpace * 1.5)
	})

	test('shuts down and adds second 64GB replacement drive', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.addNvme({slot: 4, size: '64G'})
		await umbreld.vm.powerOn()
	})

	test('logs in after adding second replacement drive', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('detects new 64GB drive in slot 4', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(4)
		const fourthDevice = devices.find((d) => d.slot === 4)
		expect(fourthDevice).toBeDefined()
		fourthDeviceId = fourthDevice!.id!
	})

	test('replaces second 32GB device with 64GB device', async () => {
		await umbreld.client.hardware.raid.replaceDevice.mutate({
			oldDevice: secondDeviceId,
			newDevice: fourthDeviceId,
		})
	})

	test('waits for second replacement to complete', async () => {
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.replace?.state === 'finished'
			},
			{interval: 1000, timeout: 600_000},
		)
	})

	test('pool size doubled after both replacements', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const finalUsableSpace = status.usableSpace!
		console.log('Final usable space:', finalUsableSpace)
		// Both disks are now 64GB, so usable should be ~64GB (roughly 2x initial)
		expect(finalUsableSpace).toBeGreaterThan(afterFirstReplaceUsableSpace)
		// Should be roughly double the initial space (with some tolerance for metadata)
		expect(finalUsableSpace).toBeGreaterThan(initialUsableSpace * 1.8)
	})

	test('RAID pool is ONLINE with correct devices', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(2)
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([thirdDeviceId, fourthDeviceId].sort())
	})

	test.skip('marker directory still exists after upgrades', async () => {
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'data-consistency-marker')).toBe(true)
	})
})
