import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

// A mirror FailSafe transition mirrors the HDDs first and the accelerator SSD last. If it stops in between,
// the data is mirrored but the accelerator's special vdev, which holds the only copy of the pool's metadata,
// is still on a single SSD. Losing that SSD loses the whole pool, so the array must not report as FailSafe.
describe('Mirrored HDD RAID status with an unmirrored accelerator', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let hddId: string
	let mirrorHddId: string
	let acceleratorId: string
	let mirrorAcceleratorId: string
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

	test('boots a NAS VM with two HDDs and two SSDs', async () => {
		await umbreld.vm.addHdd({slot: 1})
		await umbreld.vm.addHdd({slot: 2})
		await umbreld.vm.addNvme({slot: 1, size: '128G'})
		await umbreld.vm.addNvme({slot: 2, size: '128G'})
		await umbreld.vm.powerOn()

		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		const hdds = devices.filter((device) => device.type === 'hdd')
		const ssds = devices.filter((device) => device.type === 'ssd' && device.isSystemDrive === false)
		expect(hdds).toHaveLength(2)
		expect(ssds).toHaveLength(2)
		hddId = hdds[0].id!
		mirrorHddId = hdds[1].id!
		acceleratorId = ssds[0].id!
		mirrorAcceleratorId = ssds[1].id!
	})

	test('sets up single HDD storage with an accelerator', async () => {
		await umbreld.signup({raidDevices: [hddId], raidType: 'storage', acceleratorDevices: [acceleratorId]})
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

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('storage')
		expect(status.accelerator?.devices?.map((device) => device.id)).toEqual([acceleratorId])
		poolName = status.name
	})

	// Reproduce a transition that stopped after mirroring the data: the HDD is mirrored while the
	// accelerator is still a single SSD.
	test('mirrors only the HDD', async () => {
		await umbreld.vm.sshAsRoot(`
			set -eu
			new_device='/dev/disk/by-umbrel-id/${mirrorHddId}'
			wipefs --all "$new_device"
			sgdisk --zap-all "$new_device"
			sgdisk --new=1:0:+100M --change-name=1:umbrel-raid-state "$new_device"
			sgdisk --new=2:0:0 --change-name=2:umbrel-raid-data "$new_device"
			udevadm settle
			zpool attach -f '${poolName}' '/dev/disk/by-umbrel-id/${hddId}-part2' "$new_device-part2"
		`)
		await pWaitFor(async () => (await umbreld.client.hardware.raid.getStatus.query()).mirrors?.length === 1, {
			interval: 1000,
			timeout: 60_000,
		})
	})

	test('does not report the array as failsafe while the accelerator is a single SSD', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.topology).toBe('mirror')
		expect(status.mirrors![0].sort()).toEqual([hddId, mirrorHddId].sort())
		expect(status.accelerator?.devices?.map((device) => device.id)).toEqual([acceleratorId])
		expect(status.raidType).toBe('storage')
		expect(status.failsafeTransitionStatus).toEqual({
			state: 'error',
			progress: 0,
			error:
				"FailSafe was only partly enabled. Part of this array isn't mirrored, so your data isn't protected against a drive failure.",
		})
	})

	test('reports the array as failsafe once the accelerator is mirrored too', async () => {
		await umbreld.vm.sshAsRoot(`
			set -eu
			device='/dev/disk/by-umbrel-id/${acceleratorId}'
			new_device='/dev/disk/by-umbrel-id/${mirrorAcceleratorId}'
			wipefs --all "$new_device"
			sgdisk --zap-all "$new_device"
			sgdisk --replicate="$new_device" "$device"
			sgdisk --randomize-guids "$new_device"
			udevadm settle
			zpool attach -f '${poolName}' "$device-part3" "$new_device-part3"
		`)
		await pWaitFor(async () => (await umbreld.client.hardware.raid.getStatus.query()).raidType === 'failsafe', {
			interval: 1000,
			timeout: 60_000,
		})
		expect((await umbreld.client.hardware.raid.getStatus.query()).failsafeTransitionStatus).toBeUndefined()
	})
})
