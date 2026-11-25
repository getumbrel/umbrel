import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

// When the array fails to mount at boot the system runs from an in-memory overlay, so no user
// exists and registration is open. Registering with RAID devices from there must not rebuild
// the drives of an array that is only missing a drive.
describe('RAID setup is rejected while the existing array failed to mount', () => {
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

	test('adds two NVMe devices and boots VM', async () => {
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.powerOn()
	})

	test('detects both NVMe devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(2)
		firstDeviceId = devices.find((d) => d.slot === 1)!.id!
		secondDeviceId = devices.find((d) => d.slot === 2)!.id!
	})

	test('registers user with storage RAID using both devices', async () => {
		await umbreld.signup({raidDevices: [firstDeviceId, secondDeviceId], raidType: 'storage'})
	})

	test('waits for RAID setup to complete and logs in', async () => {
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

	test('creates a marker directory on the array', async () => {
		await umbreld.client.files.createDirectory.mutate({path: '/Home/setup-guard-marker'})
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'setup-guard-marker')).toBe(true)
	})

	test('boots into recovery mode with one SSD disconnected', async () => {
		// A storage array can't import with a member missing, so the mount fails
		await umbreld.vm.powerOff()
		await umbreld.vm.disconnectNvme({slot: 2})
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: false})
		expect(await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailure.query()).toBe(true)
		expect(await umbreld.unauthenticatedClient.user.exists.query()).toBe(false)
	})

	test('rejects registering with RAID devices in recovery mode', async () => {
		// Pass the member that is still connected: setup would repartition it and destroy the array
		await expect(umbreld.signup({raidDevices: [firstDeviceId], raidType: 'storage'})).rejects.toThrow(
			'Cannot set up RAID because the existing storage failed to mount',
		)
	})

	test('leaves the connected member in the array', async () => {
		// A test import still finds the pool on the connected drive, so it wasn't repartitioned
		const devices = await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailureDevices.query()
		expect(devices).toHaveLength(2)
		expect(devices.find((d) => d.name.includes(firstDeviceId))?.isOk).toBe(true)
		expect(devices.find((d) => d.name.includes(secondDeviceId))?.isOk).toBe(false)
	})

	test('mounts the array again once the SSD is reconnected', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.connectNvme({slot: 2})
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
		expect(await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailure.query()).toBe(false)

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.status).toBe('ONLINE')
		expect(status.devices?.map((d) => d.id).sort()).toEqual([firstDeviceId, secondDeviceId].sort())
	})

	test('still has the marker directory', async () => {
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'setup-guard-marker')).toBe(true)
	})
})
