import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

const devicePath = (deviceId: string) => `/dev/disk/by-umbrel-id/${deviceId}`

// ZFS debugging switch that stops a rebuild from making progress, so it can be held in place
const suspendRebuildProgress = '/sys/module/zfs/parameters/zfs_scan_suspend_progress'

// Adding a drive wipes it before handing it to ZFS, and ZFS refuses to expand a RAID-Z array that has a
// drive being replaced. The array still reports as healthy when the drive being replaced works, so the
// new drive was wiped and then turned away with ZFS's own error.
describe('Adding a drive to a RAID-Z array that is rebuilding', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let deviceIds: string[]
	let poolName: string
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

	test('sets up a two-SSD failsafe array with two more SSDs fitted (triggers reboot)', async () => {
		for (const slot of [1, 2, 3, 4]) await umbreld.vm.addNvme({slot})
		await umbreld.vm.powerOn()

		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		deviceIds = [1, 2, 3, 4].map((slot) => devices.find((device) => device.slot === slot)!.id!)

		await umbreld.signup({raidDevices: [deviceIds[0], deviceIds[1]], raidType: 'failsafe'})
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
		poolName = (await umbreld.client.hardware.raid.getStatus.query()).name!
	})

	test('gives the fourth SSD something to lose', async () => {
		// A labelled filesystem stands in for whatever the drive holds
		await umbreld.vm.sshAsRoot(`mkfs.ext4 -q -F -L keep-me ${devicePath(deviceIds[3])}`)
	})

	test('starts replacing a working SSD with the third and holds the rebuild', async () => {
		await umbreld.vm.sshAsRoot(`echo 1 > ${suspendRebuildProgress}`)
		await umbreld.client.hardware.raid.replaceDevice.mutate({oldDevice: deviceIds[0], newDevice: deviceIds[2]})

		// The drive being replaced still works, so the array is healthy while it rebuilds
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.status).toBe('ONLINE')
		expect(status.rebuild?.state).toBe('rebuilding')
	})

	test('refuses to add the fourth SSD and leaves it untouched', async () => {
		await expect(umbreld.client.hardware.raid.addDevice.mutate({deviceId: deviceIds[3]})).rejects.toThrow(
			'Cannot add a RAID device while a RAID rebuild is in progress',
		)

		// Its filesystem is still there and it hasn't been partitioned
		const fourthDevice = devicePath(deviceIds[3])
		expect((await umbreld.vm.sshAsRoot(`blkid -s LABEL -o value ${fourthDevice}`)).trim()).toBe('keep-me')
		expect(await umbreld.vm.sshAsRoot(`ls ${fourthDevice}-part* 2>/dev/null || true`)).not.toContain('-part')

		// And it isn't part of the array
		expect(await umbreld.vm.sshAsRoot(`zpool status -P ${poolName}`)).not.toContain(deviceIds[3])
	})

	test('adds the fourth SSD once the rebuild has finished', async () => {
		await umbreld.vm.sshAsRoot(`echo 0 > ${suspendRebuildProgress}`)
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.status === 'ONLINE' && status.rebuild?.state !== 'rebuilding' && status.devices!.length === 2
			},
			{interval: 1000, timeout: 300_000},
		)

		await umbreld.client.hardware.raid.addDevice.mutate({deviceId: deviceIds[3]})
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.devices!.map((device) => device.id).sort()).toEqual([deviceIds[1], deviceIds[2], deviceIds[3]].sort())
	})
})
