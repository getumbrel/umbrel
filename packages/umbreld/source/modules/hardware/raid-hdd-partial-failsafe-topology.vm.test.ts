import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm, driveBuses} from '../test-utilities/create-test-umbreld.ts'

describe.each(driveBuses)('Partially mirrored HDD RAID status (%s)', (bus) => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstDeviceId: string
	let secondDeviceId: string
	let mirrorDeviceId: string
	let poolName: string
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

	// Set up a two-disk HDD stripe with one spare disk for a partial mirror transition.
	test('adds three HDDs and boots the VM', async () => {
		await umbreld.vm.addHdd({slot: 1, bus})
		await umbreld.vm.addHdd({slot: 2, bus})
		await umbreld.vm.addHdd({slot: 3, bus})
		await umbreld.vm.powerOn()
	})

	test('detects all three HDDs', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		const hdds = devices.filter((device) => device.type === 'hdd')
		expect(hdds).toHaveLength(3)

		firstDeviceId = hdds[0].id!
		secondDeviceId = hdds[1].id!
		mirrorDeviceId = hdds[2].id!
	})

	test('registers with one HDD in storage mode', async () => {
		await umbreld.signup({raidDevices: [firstDeviceId], raidType: 'storage'})
	})

	test('waits for RAID setup to complete and logs in', async () => {
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

	test('adds the second HDD as another storage vdev', async () => {
		await umbreld.client.hardware.raid.addDevice.mutate({deviceId: secondDeviceId})
	})

	test('reports both unmirrored HDDs as storage mode', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('storage')
		expect(status.topology).toBe('stripe')
		expect(status.devices?.map((device) => device.id).sort()).toEqual([firstDeviceId, secondDeviceId].sort())
		poolName = status.name
	})

	// Reproduce an interrupted multi-disk transition: the first HDD is mirrored,
	// while the second remains an unprotected top-level vdev.
	test('mirrors only the first HDD', async () => {
		await umbreld.vm.sshAsRoot(`
set -eu
new_device='/dev/disk/by-umbrel-id/${mirrorDeviceId}'
wipefs --all "$new_device"
sgdisk --zap-all "$new_device"
sgdisk --new=1:0:+100M --change-name=1:umbrel-raid-state "$new_device"
sgdisk --new=2:0:0 --change-name=2:umbrel-raid-data "$new_device"
udevadm settle
zpool attach -f '${poolName}' '/dev/disk/by-umbrel-id/${firstDeviceId}-part2' "$new_device-part2"
`)
	})

	test('has one mirror and one unmirrored HDD', async () => {
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.mirrors?.length === 1 && status.devices?.length === 3
			},
			{interval: 1000, timeout: 60_000},
		)

		const status = await umbreld.client.hardware.raid.getStatus.query()
		const mirroredDeviceIds = status.mirrors![0].sort()
		expect(mirroredDeviceIds).toEqual([firstDeviceId, mirrorDeviceId].sort())
		expect(
			status.devices?.filter((device) => !mirroredDeviceIds.includes(device.id)).map((device) => device.id),
		).toEqual([secondDeviceId])
	})

	test('does not report the partially mirrored pool as failsafe', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('storage')
	})
})
