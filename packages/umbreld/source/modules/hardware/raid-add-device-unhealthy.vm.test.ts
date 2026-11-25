import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

const devicePath = (deviceId: string) => `/dev/disk/by-umbrel-id/${deviceId}`

// Adding a drive wipes it before handing it to ZFS, and ZFS refuses to expand a RAID-Z array that has a
// drive missing. So the drive was wiped and then turned away with ZFS's own error.
describe('Adding a drive to a RAID-Z array that has a drive missing', () => {
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

	test('sets up a two-SSD failsafe array with a third SSD fitted (triggers reboot)', async () => {
		for (const slot of [1, 2, 3]) await umbreld.vm.addNvme({slot})
		await umbreld.vm.powerOn()

		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		deviceIds = [1, 2, 3].map((slot) => devices.find((device) => device.slot === slot)!.id!)

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

	test('gives the third SSD something to lose', async () => {
		// A labelled filesystem stands in for whatever the drive holds
		await umbreld.vm.sshAsRoot(`mkfs.ext4 -q -F -L keep-me ${devicePath(deviceIds[2])}`)
	})

	test('loses one of the SSDs in the array', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.removeNvme({slot: 2})
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.status).toBe('DEGRADED')
	})

	test('refuses to add the third SSD and leaves it untouched', async () => {
		await expect(umbreld.client.hardware.raid.addDevice.mutate({deviceId: deviceIds[2]})).rejects.toThrow(
			'Cannot add a RAID device until the RAID array is healthy',
		)

		// Its filesystem is still there and it hasn't been partitioned
		const thirdDevice = devicePath(deviceIds[2])
		expect((await umbreld.vm.sshAsRoot(`blkid -s LABEL -o value ${thirdDevice}`)).trim()).toBe('keep-me')
		expect(await umbreld.vm.sshAsRoot(`ls ${thirdDevice}-part* 2>/dev/null || true`)).not.toContain('-part')

		// And it isn't part of the array
		expect(await umbreld.vm.sshAsRoot(`zpool status -P ${poolName}`)).not.toContain(deviceIds[2])
	})
})
