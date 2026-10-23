import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm, driveBuses} from '../test-utilities/create-test-umbreld.ts'

describe.each(driveBuses)('Partially mirrored HDD FailSafe transition retry (%s)', (bus) => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstDeviceId: string
	let secondDeviceId: string
	let mirrorDeviceId: string
	let retryDeviceIds: string[]
	let acceleratorDeviceId: string
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

	// Six HDDs let us exercise destructive retries, while the SSD covers the
	// accelerator path that must also reject this partial topology.
	test('adds six HDDs and an accelerator SSD, then boots the VM', async () => {
		for (let slot = 1; slot <= 6; slot++) await umbreld.vm.addHdd({slot, bus})
		await umbreld.vm.addNvme({slot: 1, size: '500G'})
		await umbreld.vm.powerOn()
	})

	test('detects all seven storage devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		const hdds = devices.filter((device) => device.type === 'hdd')
		const ssds = devices.filter((device) => device.type === 'ssd')
		expect(hdds).toHaveLength(6)
		expect(ssds).toHaveLength(1)

		firstDeviceId = hdds[0].id!
		secondDeviceId = hdds[1].id!
		mirrorDeviceId = hdds[2].id!
		retryDeviceIds = hdds.slice(3).map((device) => device.id!)
		acceleratorDeviceId = ssds[0].id!
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
		poolName = (await umbreld.client.hardware.raid.getStatus.query()).name
	})

	// Reproduce a persisted partial transition: one storage vdev has been mirrored,
	// while the other remains an unprotected top-level disk.
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

	test('reports the mixed topology before retrying', async () => {
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.raidType === 'storage' && status.topology === 'mirror' && status.mirrors?.length === 1
			},
			{interval: 1000, timeout: 60_000},
		)

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.devices).toHaveLength(3)
		expect(status.mirrors?.[0].sort()).toEqual([firstDeviceId, mirrorDeviceId].sort())
	})

	test('rejects adding a mirror pair without touching its candidate disks', async () => {
		await expect(
			umbreld.client.hardware.raid.addMirror.mutate({deviceIds: [retryDeviceIds[0], retryDeviceIds[1]]}),
		).rejects.toThrow(/mirror failsafe mode/i)

		await umbreld.vm.sshAsRoot(`
set -eu
for device_id in '${retryDeviceIds[0]}' '${retryDeviceIds[1]}'; do
	test ! -e "/dev/disk/by-umbrel-id/$device_id-part1"
	test ! -e "/dev/disk/by-umbrel-id/$device_id-part2"
done
`)
	})

	test('rejects adding an accelerator without touching the SSD', async () => {
		await expect(
			umbreld.client.hardware.raid.addAccelerator.mutate({deviceIds: [acceleratorDeviceId]}),
		).rejects.toThrow(/partially protected/i)

		await umbreld.vm.sshAsRoot(`
set -eu
test ! -e '/dev/disk/by-umbrel-id/${acceleratorDeviceId}-part1'
test ! -e '/dev/disk/by-umbrel-id/${acceleratorDeviceId}-part2'
test ! -e '/dev/disk/by-umbrel-id/${acceleratorDeviceId}-part3'
`)

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.accelerator).toMatchObject({exists: false})
	})

	test('rejects a full transition retry before touching its candidate disks', async () => {
		const statusBefore = await umbreld.client.hardware.raid.getStatus.query()
		const pairs = statusBefore.devices!.map((device, index) => ({
			existingDeviceId: device.id,
			newDeviceId: retryDeviceIds[index],
		}))

		await expect(umbreld.client.hardware.raid.transitionToFailsafeMirror.mutate({pairs})).rejects.toThrow(
			/unmirrored storage array/i,
		)

		await umbreld.vm.sshAsRoot(`
set -eu
for device_id in ${retryDeviceIds.map((id) => `'${id}'`).join(' ')}; do
	test ! -e "/dev/disk/by-umbrel-id/$device_id-part1"
	test ! -e "/dev/disk/by-umbrel-id/$device_id-part2"
done
`)

		const statusAfter = await umbreld.client.hardware.raid.getStatus.query()
		expect(statusAfter.raidType).toBe('storage')
		expect(statusAfter.topology).toBe('mirror')
		expect(statusAfter.mirrors).toEqual(statusBefore.mirrors)
		expect(statusAfter.devices?.map((device) => device.id).sort()).toEqual(
			statusBefore.devices?.map((device) => device.id).sort(),
		)
	})
})
