import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

describe('RAID HDD storage mode and device type validation', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let hddDeviceId1: string
	let hddDeviceId2: string
	let ssdDeviceId: string
	let initialTotalSpace: number
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

	// --- Phase 1: Boot and detect devices ---

	test('adds HDD and NVMe devices and boots VM', async () => {
		await umbreld.vm.addHdd({slot: 1})
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.powerOn()
	})

	test('detects HDD and SSD with correct types', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(2)

		const hdd = devices.find((d) => d.type === 'hdd')
		const ssd = devices.find((d) => d.type === 'ssd')
		expect(hdd).toBeDefined()
		expect(ssd).toBeDefined()
		expect(hdd!.transport).toBe('sata')

		hddDeviceId1 = hdd!.id!
		ssdDeviceId = ssd!.id!
		expect(hddDeviceId1).toBeDefined()
		expect(ssdDeviceId).toBeDefined()
	})

	// --- Phase 2: Setup validation - mixed types should fail ---

	test('rejects creating RAID array with mixed SSD and HDD devices', async () => {
		await expect(
			umbreld.unauthenticatedClient.user.register.mutate({
				name: 'satoshi',
				password: 'moneyprintergobrrr',
				raidDevices: [hddDeviceId1, ssdDeviceId],
				raidType: 'storage',
			}),
		).rejects.toThrow('Cannot mix SSDs and HDDs')
	})

	// --- Phase 3: Setup single HDD in storage mode ---

	test('registers user with single HDD RAID config (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [hddDeviceId1], raidType: 'storage'})
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
			{interval: 2000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('reports correct RAID status with HDD device', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(1)
		expect(status.devices![0].id).toBe(hddDeviceId1)
		initialTotalSpace = status.totalSpace!
		expect(initialTotalSpace).toBeGreaterThan(0)
	})

	test('creates marker directory to verify data consistency', async () => {
		await umbreld.client.files.createDirectory.mutate({path: '/Home/data-consistency-marker'})
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'data-consistency-marker')).toBe(true)
	})

	// --- Phase 4: Add device validation ---

	test('rejects adding SSD to HDD RAID array', async () => {
		await expect(umbreld.client.hardware.raid.addDevice.mutate({deviceId: ssdDeviceId})).rejects.toThrow(
			'Cannot mix SSDs and HDDs',
		)
	})

	test('rejects replacing HDD with SSD', async () => {
		await expect(
			umbreld.client.hardware.raid.replaceDevice.mutate({oldDevice: hddDeviceId1, newDevice: ssdDeviceId}),
		).rejects.toThrow('Cannot mix SSDs and HDDs')
	})

	// --- Phase 5: Expand with second HDD ---

	test('shuts down and adds second HDD', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.addHdd({slot: 2})
		await umbreld.vm.powerOn()
	})

	test('logs in after adding second HDD', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('detects all devices after reboot', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		const hdds = devices.filter((d) => d.type === 'hdd')
		const ssds = devices.filter((d) => d.type === 'ssd')
		expect(hdds).toHaveLength(2)
		expect(ssds).toHaveLength(1)

		const secondHdd = hdds.find((d) => d.id !== hddDeviceId1)
		expect(secondHdd).toBeDefined()
		hddDeviceId2 = secondHdd!.id!
		expect(hddDeviceId2).toBeDefined()
	})

	test('adds second HDD to RAID array', async () => {
		await umbreld.client.hardware.raid.addDevice.mutate({deviceId: hddDeviceId2})
	})

	test('reports correct RAID status with both HDD devices', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(2)
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([hddDeviceId1, hddDeviceId2].sort())
	})

	test('total space increased after adding second HDD', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.totalSpace!).toBeGreaterThan(initialTotalSpace)
	})

	test('marker directory still exists after expansion', async () => {
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'data-consistency-marker')).toBe(true)
	})

	// --- Phase 6: Replace validation with expanded array ---

	test('rejects replacing HDD with SSD in expanded array', async () => {
		await expect(
			umbreld.client.hardware.raid.replaceDevice.mutate({oldDevice: hddDeviceId1, newDevice: ssdDeviceId}),
		).rejects.toThrow('Cannot mix SSDs and HDDs')
	})
})
