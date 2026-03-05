import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'

import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

describe('RAID transition with real 4TB drive sizes', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let largerPhisonDeviceId: string
	let smallerSamsungDeviceId: string
	let exactGenericDeviceId: string
	let smallSimulatedDeviceId: string
	let failed = false

	// Real 4TB NVMe drive sizes in bytes
	const LARGER_PHISON_4TB_SIZE = '4096805658624'
	const SMALLER_SAMSUNG_4TB_SIZE = '4000787030016'
	const EXACT_4TB_SIZE = '4000000000000' // Exactly 4TB
	const SMALL_SIMULATED_4TB_SIZE = '4000000010000' // Just over 4TB - tests rounding edge case

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

	test('adds all four 4TB NVMe devices and boots VM', async () => {
		// Slot 1: Larger Phison, Slot 2: Smaller Samsung, Slot 3: Exact 4TB, Slot 4: Small simulated (just over 4TB)
		await umbreld.vm.addNvme({slot: 1, size: LARGER_PHISON_4TB_SIZE})
		await umbreld.vm.addNvme({slot: 2, size: SMALLER_SAMSUNG_4TB_SIZE})
		await umbreld.vm.addNvme({slot: 3, size: EXACT_4TB_SIZE})
		await umbreld.vm.addNvme({slot: 4, size: SMALL_SIMULATED_4TB_SIZE})
		await umbreld.vm.powerOn()
	})

	test('logs device sizes via lsblk', async () => {
		console.log(await umbreld.vm.ssh('lsblk --bytes'))
	})

	test('detects all four NVMe devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(4)
		largerPhisonDeviceId = devices.find((d) => d.slot === 1)!.id!
		smallerSamsungDeviceId = devices.find((d) => d.slot === 2)!.id!
		exactGenericDeviceId = devices.find((d) => d.slot === 3)!.id!
		smallSimulatedDeviceId = devices.find((d) => d.slot === 4)!.id!
		expect(largerPhisonDeviceId).toBeDefined()
		expect(smallerSamsungDeviceId).toBeDefined()
		expect(exactGenericDeviceId).toBeDefined()
		expect(smallSimulatedDeviceId).toBeDefined()
	})

	test('registers user with storage RAID using larger Phison device (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [largerPhisonDeviceId], raidType: 'storage'})
	})

	test('waits for VM to come back up and logs in', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('reports correct RAID status in storage mode', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(1)
		expect(status.devices![0].id).toBe(largerPhisonDeviceId)
	})

	// Test replace with smaller device in storage mode
	test('replaces larger Phison with smaller Samsung in storage mode', async () => {
		const result = await umbreld.client.hardware.raid.replaceDevice.mutate({
			oldDevice: largerPhisonDeviceId,
			newDevice: smallerSamsungDeviceId,
		})
		expect(result).toBe(true)
	})

	test('waits for storage mode replace to complete', async () => {
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.replace?.state === 'finished' || !status.replace
			},
			{interval: 1000, timeout: 600_000},
		)
	})

	test('has smaller Samsung in array after replacing larger Phison in storage mode', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(1)
		expect(status.devices![0].id).toBe(smallerSamsungDeviceId)
	})

	// Replace back to Phison for failsafe tests
	test('replaces smaller Samsung back to larger Phison in storage mode', async () => {
		const result = await umbreld.client.hardware.raid.replaceDevice.mutate({
			oldDevice: smallerSamsungDeviceId,
			newDevice: largerPhisonDeviceId,
		})
		expect(result).toBe(true)
	})

	test('waits for storage mode replace back to complete', async () => {
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.replace?.state === 'finished' || !status.replace
			},
			{interval: 1000, timeout: 600_000},
		)
	})

	test('has larger Phison back in array after replacing smaller Samsung in storage mode', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(1)
		expect(status.devices![0].id).toBe(largerPhisonDeviceId)
	})

	test('starts transition to failsafe mode with smaller Samsung device', async () => {
		const result = await umbreld.client.hardware.raid.transitionToFailsafe.mutate({device: smallerSamsungDeviceId})
		expect(result).toBe(true)
	})

	test('waits for VM to come back up after transition', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('waits for migration to complete (2 devices in array)', async () => {
		let status: Awaited<ReturnType<typeof umbreld.client.hardware.raid.getStatus.query>>
		await pWaitFor(
			async () => {
				try {
					status = await umbreld.client.hardware.raid.getStatus.query()
					if (status.devices?.length === 2) return true
				} catch {}
				if (status?.failsafeTransitionStatus?.state === 'error') {
					throw new Error(status.failsafeTransitionStatus.error)
				}
				return false
			},
			{interval: 1000, timeout: 600_000},
		)
		expect(status!.devices).toHaveLength(2)
	})

	test('reports correct RAID status in failsafe mode after migration', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(['ONLINE', 'DEGRADED']).toContain(status.status)
		expect(status.devices).toHaveLength(2)
	})

	test('has both devices in the array after migration', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([smallerSamsungDeviceId, largerPhisonDeviceId].sort())
	})

	test('waits for transition to complete', async () => {
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				if (status.failsafeTransitionStatus?.state === 'complete') return true
				if (!status.failsafeTransitionStatus && status.status === 'ONLINE') return true
				return false
			},
			{interval: 1000, timeout: 600_000},
		)
	})

	test('pool eventually enters ONLINE state', async () => {
		let status: Awaited<ReturnType<typeof umbreld.client.hardware.raid.getStatus.query>>
		await pWaitFor(
			async () => {
				status = await umbreld.client.hardware.raid.getStatus.query()
				return status.status === 'ONLINE'
			},
			{interval: 1000, timeout: 600_000},
		)
		expect(status!.status).toBe('ONLINE')
	})

	test('logs device sizes via lsblk', async () => {
		console.log(await umbreld.vm.ssh('lsblk --bytes'))
	})

	test('expands RAID array with exact 4TB device', async () => {
		const result = await umbreld.client.hardware.raid.addDevice.mutate({device: exactGenericDeviceId})
		expect(result).toBe(true)
	})

	test('waits for expansion to complete (3 devices in array)', async () => {
		let status: Awaited<ReturnType<typeof umbreld.client.hardware.raid.getStatus.query>>
		await pWaitFor(
			async () => {
				try {
					status = await umbreld.client.hardware.raid.getStatus.query()
					return status.devices?.length === 3
				} catch {}
				return false
			},
			{interval: 1000, timeout: 600_000},
		)
		expect(status!.devices).toHaveLength(3)
	})

	test('has all three devices in the array after expansion', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([largerPhisonDeviceId, smallerSamsungDeviceId, exactGenericDeviceId].sort())
	})

	test('pool remains in failsafe mode after expansion', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(['ONLINE', 'DEGRADED']).toContain(status.status)
	})

	test('logs device sizes via lsblk after expansion', async () => {
		console.log(await umbreld.vm.ssh('lsblk --bytes'))
	})

	test('replaces larger Phison with small simulated drive', async () => {
		const result = await umbreld.client.hardware.raid.replaceDevice.mutate({
			oldDevice: largerPhisonDeviceId,
			newDevice: smallSimulatedDeviceId,
		})
		expect(result).toBe(true)
	})

	test('waits for replace to complete', async () => {
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.replace?.state === 'finished' || !status.replace
			},
			{interval: 1000, timeout: 600_000},
		)
	})

	test('has small simulated drive in array instead of larger Phison after replace', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const deviceIds = status.devices!.map((d) => d.id)
		expect(deviceIds).toContain(smallSimulatedDeviceId)
		expect(deviceIds).not.toContain(largerPhisonDeviceId)
		expect(deviceIds).toContain(smallerSamsungDeviceId)
		expect(deviceIds).toContain(exactGenericDeviceId)
	})

	test('pool remains in failsafe mode after replace', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(3)
	})

	test('logs final device sizes via lsblk', async () => {
		console.log(await umbreld.vm.ssh('lsblk --bytes'))
		console.log(await umbreld.vm.ssh('lsblk --bytes'))
	})
})
