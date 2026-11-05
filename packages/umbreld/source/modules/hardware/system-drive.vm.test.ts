import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm, driveBuses} from '../test-utilities/create-test-umbreld.ts'

// System drive detection and protection on custom hardware: a NAS that boots from a
// visible NVMe disk (unlike Umbrel Pro's eMMC, which never appears in internal storage).
// The boot disk must be flagged as the system drive both before RAID exists (the data
// directory lives on the boot disk) and after (the data directory resolves to the ZFS
// pool and / is an overlay, so detection relies on the rugix config partition), and every
// RAID mutation must refuse to touch it.
describe.each(driveBuses)('System drive detection and protection (%s HDD pool)', (bus) => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let bootDriveId: string
	let firstHddId: string
	let secondHddId: string
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

	test('boots a NAS VM with an NVMe boot disk and two HDD bays', async () => {
		await umbreld.vm.addHdd({slot: 1, bus})
		await umbreld.vm.addHdd({slot: 2, bus})
		await umbreld.vm.powerOn()
	})

	test('flags the boot NVMe as the system drive before any RAID exists', async () => {
		// Before RAID setup the data directory lives on the boot disk's data partition,
		// so detection works via the data directory and config partition paths
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(3)

		const bootDrive = devices.find((device) => device.type === 'ssd')
		expect(bootDrive).toBeDefined()
		expect(bootDrive!.transport).toBe('nvme')
		expect(bootDrive!.isSystemDrive).toBe(true)
		bootDriveId = bootDrive!.id!

		const hdds = devices.filter((device) => device.type === 'hdd')
		expect(hdds).toHaveLength(2)
		for (const hdd of hdds) expect(hdd.isSystemDrive).toBe(false)
		;[firstHddId, secondHddId] = hdds.map((hdd) => hdd.id!)
	})

	test('refuses to create a RAID array on the system drive', async () => {
		await expect(umbreld.signup({raidDevices: [bootDriveId], raidType: 'storage'})).rejects.toThrow(
			'Cannot use the system drive for RAID',
		)
	})

	test('refuses the system drive as an accelerator during setup', async () => {
		await expect(
			umbreld.signup({
				raidDevices: [firstHddId, secondHddId],
				raidType: 'storage',
				acceleratorDevices: [bootDriveId],
			}),
		).rejects.toThrow('Cannot use the system drive for RAID')
	})

	test('creates a Full Storage array on the HDDs (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [firstHddId, secondHddId], raidType: 'storage'})
	})

	test('waits for RAID setup to complete and logs in', async () => {
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch (error) {
					// Ignore connection errors while VM is rebooting
					if (error instanceof Error && error.message.includes('fetch failed')) {
						return false
					}
					// Rethrow server errors (e.g., initialRaidSetupError)
					throw error
				}
			},
			{interval: 2000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('still flags the boot drive when the data directory lives on the ZFS pool', async () => {
		// After RAID setup / is an overlay and the data directory resolves to the pool,
		// so only the rugix config partition identifies the boot disk
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		const bootDrive = devices.find((device) => device.id === bootDriveId)
		expect(bootDrive!.isSystemDrive).toBe(true)

		// The pool members are not system drives
		for (const hddId of [firstHddId, secondHddId]) {
			expect(devices.find((device) => device.id === hddId)!.isSystemDrive).toBe(false)
		}

		// Sanity check the pool is built from the HDDs
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.devices!.map((device) => device.id).sort()).toEqual([firstHddId, secondHddId].sort())
	})

	test('refuses to add the system drive to the array', async () => {
		await expect(umbreld.client.hardware.raid.addDevice.mutate({deviceId: bootDriveId})).rejects.toThrow(
			'Cannot use the system drive for RAID',
		)
	})

	test('refuses the system drive as a mirror member', async () => {
		await expect(umbreld.client.hardware.raid.addMirror.mutate({deviceIds: [bootDriveId, firstHddId]})).rejects.toThrow(
			'Cannot use the system drive for RAID',
		)
	})

	test('refuses the system drive as an accelerator', async () => {
		// The boot disk is an NVMe SSD so it passes the accelerator type check and must be
		// stopped by the system drive guard
		await expect(umbreld.client.hardware.raid.addAccelerator.mutate({deviceIds: [bootDriveId]})).rejects.toThrow(
			'Cannot use the system drive for RAID',
		)
	})

	test('refuses the system drive as a replacement device', async () => {
		await expect(
			umbreld.client.hardware.raid.replaceDevice.mutate({oldDevice: firstHddId, newDevice: bootDriveId}),
		).rejects.toThrow('Cannot use the system drive for RAID')
	})

	test('refuses the system drive in FailSafe transitions', async () => {
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({newDeviceId: bootDriveId}),
		).rejects.toThrow('Cannot use the system drive for RAID')

		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeMirror.mutate({
				pairs: [
					{existingDeviceId: firstHddId, newDeviceId: bootDriveId},
					{existingDeviceId: secondHddId, newDeviceId: bootDriveId},
				],
			}),
		).rejects.toThrow('Cannot use the system drive for RAID')
	})

	test('rejects RAID mutations from unauthenticated clients', async () => {
		await expect(
			umbreld.unauthenticatedClient.hardware.raid.addDevice.mutate({deviceId: bootDriveId}),
		).rejects.toThrow()
	})
})

// Same protection on an SSD pool. The guards run before any pool-type logic so this
// exercises the identical code paths from an SSD pool's perspective, plus a positive
// control proving legitimate SSDs are not over-blocked.
describe('System drive protection (SSD pool)', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let bootDriveId: string
	let firstSsdId: string
	let secondSsdId: string
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

	test('boots a NAS VM with an NVMe boot disk and two NVMe data drives', async () => {
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.powerOn()
	})

	test('flags exactly the boot drive among three NVMe devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(3)

		// All three are NVMe SSDs; only the boot disk is a system drive
		const systemDrives = devices.filter((device) => device.isSystemDrive)
		expect(systemDrives).toHaveLength(1)
		bootDriveId = systemDrives[0].id!
		;[firstSsdId, secondSsdId] = devices.filter((device) => !device.isSystemDrive).map((device) => device.id!)
	})

	test('creates a Full Storage array on one SSD (triggers reboot)', async () => {
		// Single-drive storage mode keeps the second SSD unpooled so the transition and
		// add paths below are otherwise legitimate
		await umbreld.signup({raidDevices: [firstSsdId], raidType: 'storage'})
	})

	test('waits for RAID setup to complete and logs in', async () => {
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch (error) {
					// Ignore connection errors while VM is rebooting
					if (error instanceof Error && error.message.includes('fetch failed')) {
						return false
					}
					// Rethrow server errors (e.g., initialRaidSetupError)
					throw error
				}
			},
			{interval: 2000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('still flags the boot drive after SSD RAID setup', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		expect(devices.find((device) => device.id === bootDriveId)!.isSystemDrive).toBe(true)
		expect(devices.find((device) => device.id === firstSsdId)!.isSystemDrive).toBe(false)
	})

	test('refuses the system drive in the raidz FailSafe transition', async () => {
		// The pool is a genuine single-SSD storage pool, so this transition would be
		// legitimate with any other SSD
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({newDeviceId: bootDriveId}),
		).rejects.toThrow('Cannot use the system drive for RAID')
	})

	test('refuses to add the system drive to the SSD array', async () => {
		await expect(umbreld.client.hardware.raid.addDevice.mutate({deviceId: bootDriveId})).rejects.toThrow(
			'Cannot use the system drive for RAID',
		)
	})

	test('refuses the system drive as a replacement in the SSD array', async () => {
		await expect(
			umbreld.client.hardware.raid.replaceDevice.mutate({oldDevice: firstSsdId, newDevice: bootDriveId}),
		).rejects.toThrow('Cannot use the system drive for RAID')
	})

	test('refuses the system drive in HDD-only operations before their pool-type checks', async () => {
		await expect(
			umbreld.client.hardware.raid.addMirror.mutate({deviceIds: [bootDriveId, secondSsdId]}),
		).rejects.toThrow('Cannot use the system drive for RAID')

		await expect(umbreld.client.hardware.raid.addAccelerator.mutate({deviceIds: [bootDriveId]})).rejects.toThrow(
			'Cannot use the system drive for RAID',
		)
	})

	test('still allows adding a legitimate SSD to the array', async () => {
		// Positive control: the guard must not over-block non-system drives
		await umbreld.client.hardware.raid.addDevice.mutate({deviceId: secondSsdId})
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.devices).toHaveLength(2)
		expect(status.devices!.map((device) => device.id).sort()).toEqual([firstSsdId, secondSsdId].sort())
	})
})
