import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm, driveBuses} from '../test-utilities/create-test-umbreld.ts'

describe.each(driveBuses)('Initial RAID setup lock (%s)', (bus) => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let hddDeviceId: string
	let ssdDeviceId: string
	let failed = false

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'nas', bootDisk: 'nvme'})
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

	test('boots a NAS VM with HDD and SSD data devices', async () => {
		await umbreld.vm.addHdd({slot: 1, bus})
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.powerOn()
	})

	test('detects both data devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		hddDeviceId = devices.find((device) => device.type === 'hdd')!.id!
		ssdDeviceId = devices.find((device) => device.type === 'ssd')!.id!
		expect(hddDeviceId).toBeDefined()
		expect(ssdDeviceId).toBeDefined()
	})

	test('clears the lock when setup fails', async () => {
		await expect(umbreld.signup({raidDevices: [hddDeviceId, ssdDeviceId], raidType: 'storage'})).rejects.toThrow(
			'Cannot mix SSDs and HDDs',
		)
	})

	test('allows only one concurrent initial setup operation', async () => {
		const results = await Promise.allSettled([
			umbreld.signup({raidDevices: [hddDeviceId], raidType: 'storage'}),
			umbreld.signup({raidDevices: [hddDeviceId], raidType: 'storage'}),
		])

		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
		const rejected = results.filter((result) => result.status === 'rejected')
		expect(rejected).toHaveLength(1)
		expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
			message: expect.stringContaining('Initial RAID setup is already in progress'),
		})
	})

	test('waits for setup to reboot and create the user', async () => {
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch (error) {
					if (error instanceof Error && error.message.includes('fetch failed')) return false
					throw error
				}
			},
			{interval: 2000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('created exactly the requested HDD pool', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.devices?.map((device) => device.id)).toEqual([hddDeviceId])
	})
})
