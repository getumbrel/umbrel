import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

describe('RAID HDD failsafe setup and expansion', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let hddDeviceId1: string
	let hddDeviceId2: string
	let hddDeviceId3: string
	let hddDeviceId4: string
	let hddDeviceId5: string
	let ssdDeviceId: string
	let initialUsableSpace: number
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

	test('adds HDDs and NVMe device and boots VM', async () => {
		await umbreld.vm.addHdd({slot: 1})
		await umbreld.vm.addHdd({slot: 2})
		await umbreld.vm.addHdd({slot: 3})
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.powerOn()
	})

	test('detects all devices with correct types', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(4)

		const hdds = devices.filter((d) => d.type === 'hdd')
		const ssds = devices.filter((d) => d.type === 'ssd')
		expect(hdds).toHaveLength(3)
		expect(ssds).toHaveLength(1)

		hddDeviceId1 = hdds[0].id!
		hddDeviceId2 = hdds[1].id!
		hddDeviceId3 = hdds[2].id!
		ssdDeviceId = ssds[0].id!
	})

	// --- Phase 2: Setup validation ---

	test('rejects HDD failsafe setup with odd number of devices', async () => {
		await expect(
			umbreld.unauthenticatedClient.user.register.mutate({
				name: 'satoshi',
				password: 'moneyprintergobrrr',
				raidDevices: [hddDeviceId1, hddDeviceId2, hddDeviceId3],
				raidType: 'failsafe',
			}),
		).rejects.toThrow('HDD failsafe mode requires an even number of devices')
	})

	test('rejects mixed HDD and SSD failsafe setup', async () => {
		await expect(
			umbreld.unauthenticatedClient.user.register.mutate({
				name: 'satoshi',
				password: 'moneyprintergobrrr',
				raidDevices: [hddDeviceId1, ssdDeviceId],
				raidType: 'failsafe',
			}),
		).rejects.toThrow('Cannot mix SSDs and HDDs')
	})

	// --- Phase 3: Setup 2-HDD failsafe (mirror) ---

	test('registers user with 2-HDD failsafe config (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [hddDeviceId1, hddDeviceId2], raidType: 'failsafe'})
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

	test('reports correct failsafe status with mirror topology', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(status.topology).toBe('mirror')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(2)
		initialUsableSpace = status.usableSpace!
		expect(initialUsableSpace).toBeGreaterThan(0)
	})

	test('has both HDDs in the array', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([hddDeviceId1, hddDeviceId2].sort())
	})

	test('usable space is approximately half of total space', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		// Mirror uses half the raw space for redundancy
		const ratio = status.usableSpace! / status.totalSpace!
		expect(ratio).toBeGreaterThan(0.4)
		expect(ratio).toBeLessThan(0.6)
	})

	test('creates marker directory to verify data consistency', async () => {
		await umbreld.client.files.createDirectory.mutate({path: '/Home/failsafe-setup-marker'})
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'failsafe-setup-marker')).toBe(true)
	})

	// --- Phase 4: Add device validation ---

	test('rejects adding single HDD to mirror pool', async () => {
		await expect(umbreld.client.hardware.raid.addDevice.mutate({deviceId: hddDeviceId3})).rejects.toThrow(
			'addDevice is not supported for mirror failsafe mode, use addMirror',
		)
	})

	test('rejects addMirror with duplicate devices', async () => {
		await expect(
			umbreld.client.hardware.raid.addMirror.mutate({deviceIds: [hddDeviceId3, hddDeviceId3]}),
		).rejects.toThrow('Mirror pair requires two different devices')
	})

	test('rejects addMirror when one device is already in the RAID array', async () => {
		await expect(
			umbreld.client.hardware.raid.addMirror.mutate({deviceIds: [hddDeviceId1, hddDeviceId3]}),
		).rejects.toThrow('Cannot add a device that is already in the RAID array')
	})

	test('rejects addMirror when a device does not exist', async () => {
		const missingDeviceId = 'ata-missing-device-for-test'
		await expect(
			umbreld.client.hardware.raid.addMirror.mutate({deviceIds: [missingDeviceId, hddDeviceId3]}),
		).rejects.toThrow(`Device not found: /dev/disk/by-id/${missingDeviceId}`)
	})

	test('rejects adding SSD to mirror pool', async () => {
		await expect(
			umbreld.client.hardware.raid.addMirror.mutate({deviceIds: [ssdDeviceId, hddDeviceId3]}),
		).rejects.toThrow('Cannot mix SSDs and HDDs')
	})

	// --- Phase 5: Expand with mirror pair ---

	test('shuts down and adds two more HDDs', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.addHdd({slot: 4})
		await umbreld.vm.addHdd({slot: 5})
		await umbreld.vm.powerOn()
	})

	test('logs in after adding HDDs', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('detects new HDDs after reboot', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		const hdds = devices.filter((d) => d.type === 'hdd')
		expect(hdds).toHaveLength(5)

		// Find the two new HDDs not in the pool
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const poolDeviceIds = status.devices!.map((d) => d.id)
		const newHdds = hdds.filter((d) => !poolDeviceIds.includes(d.id!))
		expect(newHdds).toHaveLength(3) // original 3rd HDD + 2 new ones

		hddDeviceId4 = newHdds.find((d) => d.id !== hddDeviceId3)!.id!
		hddDeviceId5 = newHdds.find((d) => d.id !== hddDeviceId3 && d.id !== hddDeviceId4)!.id!
		expect(hddDeviceId4).toBeDefined()
		expect(hddDeviceId5).toBeDefined()
	})

	test('adds mirror pair to failsafe array', async () => {
		await umbreld.client.hardware.raid.addMirror.mutate({deviceIds: [hddDeviceId4, hddDeviceId5]})
	})

	test('reports correct status with 4 devices', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(status.topology).toBe('mirror')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(4)
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([hddDeviceId1, hddDeviceId2, hddDeviceId4, hddDeviceId5].sort())
	})

	test('usable space increased after adding mirror pair', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.usableSpace!).toBeGreaterThan(initialUsableSpace)
	})

	test('marker directory still exists after expansion', async () => {
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'failsafe-setup-marker')).toBe(true)
	})
})
