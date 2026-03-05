import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'

import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

describe('RAID storage to failsafe transition with 90% full array', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstDeviceId: string
	let secondDeviceId: string
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

	test('adds one 5GB NVMe device and boots VM', async () => {
		await umbreld.vm.addNvme({slot: 1, size: '5G'})
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
	})

	test('creates marker directory to verify data migration', async () => {
		await umbreld.client.files.createDirectory.mutate({path: '/Home/migration-test-directory'})
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'migration-test-directory')).toBe(true)
	})

	test('fills array to over 90% capacity', async () => {
		// Get current usage
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const usedSpace = status.usedSpace ?? 0
		const usableSpace = status.usableSpace ?? 1

		// Calculate how much to write to reach 91% (a bit over 90% to ensure we exceed threshold)
		const targetUsage = 0.91
		const bytesToWrite = Math.ceil(targetUsage * usableSpace - usedSpace)
		const mbToWrite = Math.ceil(bytesToWrite / (1024 * 1024))

		console.log(`Current usage: ${((usedSpace / usableSpace) * 100).toFixed(1)}%`)
		console.log(`Writing ${mbToWrite}MB to reach ~91% capacity...`)

		// Write the data in one go
		await umbreld.vm.ssh(`dd if=/dev/urandom of=~/fill-data.bin bs=1M count=${mbToWrite}`)

		// Verify we're over 90%
		const finalStatus = await umbreld.client.hardware.raid.getStatus.query()
		const finalUsage = ((finalStatus.usedSpace ?? 0) / (finalStatus.usableSpace ?? 1)) * 100
		expect(finalUsage).toBeGreaterThan(90)
		console.log(`Final usage before transition: ${finalUsage.toFixed(1)}%`)
	})

	test('shuts down and adds second 5GB NVMe device', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.addNvme({slot: 2, size: '5G'})
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
	})

	test('starts transition to failsafe mode', async () => {
		const result = await umbreld.client.hardware.raid.transitionToFailsafe.mutate({
			device: secondDeviceId,
		})
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
		expect(deviceIds).toEqual([firstDeviceId, secondDeviceId].sort())
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

	test('verifies marker directory was migrated correctly', async () => {
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'migration-test-directory')).toBe(true)
	})
})
