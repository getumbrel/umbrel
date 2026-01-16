import {expect, beforeAll, afterAll, describe, test} from 'vitest'

import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

describe.sequential('RAID storage to failsafe transition', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstDeviceId: string
	let secondDeviceId: string

	beforeAll(async () => {
		umbreld = await createTestVm()
	})

	afterAll(async () => {
		await umbreld?.cleanup()
	})

	test('adds one NVMe device and boots VM', async () => {
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.powerOn()
	})

	test('detects NVMe device', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(1)
		expect(devices[0].slot).toBe(1)
		firstDeviceId = devices[0].id!
		expect(firstDeviceId).toBeDefined()
	})

	test('registers user with storage RAID config (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [firstDeviceId], raidType: 'storage'})
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
		expect(status.devices![0].id).toBe(firstDeviceId)
	})

	test('shuts down and adds second NVMe device', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.powerOn()
	})

	test('logs in after adding second device', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('detects both NVMe devices', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(2)
		const secondDevice = devices.find((d) => d.slot === 2)
		expect(secondDevice).toBeDefined()
		secondDeviceId = secondDevice!.id!
		expect(secondDeviceId).toBeDefined()
	})

	test('still in storage mode with one device', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.devices).toHaveLength(1)
	})

	test('starts transition to failsafe mode (triggers reboot)', async () => {
		const result = await umbreld.client.hardware.raid.transitionToFailsafe.mutate({
			device: secondDeviceId,
		})
		expect(result).toBe(true)
	})

	test('waits for migration to complete (2 devices in array)', async () => {
		// umbreld completes the migration asynchronously on startup
		// Wait for both devices to appear in the array
		let status: Awaited<ReturnType<typeof umbreld.client.hardware.raid.getStatus.query>>
		await pWaitFor(
			async () => {
				try {
					status = await umbreld.client.hardware.raid.getStatus.query()
					if (status.devices?.length === 2) return true
				} catch {}
				if (status?.failsafeTransitionError) throw new Error(status.failsafeTransitionError)
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
		// Pool may be DEGRADED while resilvering the old device into the array
		expect(['ONLINE', 'DEGRADED']).toContain(status.status)
		expect(status.devices).toHaveLength(2)
		expect(status.failsafeTransitionError).toBeUndefined()
	})

	test('has both devices in the array after migration', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([firstDeviceId, secondDeviceId].sort())
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
})
