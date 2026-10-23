import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm, driveBuses} from '../test-utilities/create-test-umbreld.ts'

// A pool member whose labels are destroyed (wiped or corrupted drive) comes back after a
// reboot as an unrecognised member while its physical disk is still attached under the
// same umbrel id. ZFS's documented recovery is replacing the member with its own disk in
// place, so replaceDevice must allow oldDevice === newDevice for unhealthy members while
// still rejecting self-replacement of healthy ones.
describe.each(driveBuses)('Self-replacement of a wiped mirror member (%s)', (bus) => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
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

	test('boots a NAS VM with two HDD bays', async () => {
		await umbreld.vm.addHdd({slot: 1, bus})
		await umbreld.vm.addHdd({slot: 2, bus})
		await umbreld.vm.powerOn()
	})

	test('creates a FailSafe mirror on the HDDs (triggers reboot)', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		const hdds = devices.filter((device) => device.type === 'hdd')
		expect(hdds).toHaveLength(2)
		;[firstHddId, secondHddId] = hdds.map((hdd) => hdd.id!)

		await umbreld.signup({raidDevices: [firstHddId, secondHddId], raidType: 'failsafe'})
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch (error) {
					// Ignore connection errors while VM is rebooting
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

	test("wipes one member's labels and reboots degraded", async () => {
		// Destroy the GPT and the ZFS labels at both ends of the data partition - the
		// state a corrupted or externally reformatted drive is in after a power cycle.
		// The running pool doesn't notice (labels are only read at import), the reboot
		// forces a fresh partition scan and import.
		await umbreld.vm.sshAsRoot(
			`
			set -e
			DISK=$(readlink -f /dev/disk/by-umbrel-id/${secondHddId})
			PART=$(readlink -f /dev/disk/by-umbrel-id/${secondHddId}-part2)
			PART_MB=$(($(blockdev --getsize64 $PART) / 1048576))
			DISK_MB=$(($(blockdev --getsize64 $DISK) / 1048576))
			dd if=/dev/zero of=$PART bs=1M count=32 conv=fsync
			dd if=/dev/zero of=$PART bs=1M count=32 seek=$((PART_MB - 32)) conv=fsync
			dd if=/dev/zero of=$DISK bs=1M count=32 conv=fsync
			dd if=/dev/zero of=$DISK bs=1M count=32 seek=$((DISK_MB - 32)) conv=fsync
			sync
		`.trim(),
		)

		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.status === 'DEGRADED'
			},
			{interval: 1000, timeout: 60_000},
		)
	})

	test('reports the wiped member as failed with its disk still attached', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const member = status.devices!.find((device) => device.id === secondHddId)
		expect(member).toBeDefined()
		expect(member!.status).not.toBe('ONLINE')

		// The physical disk is still attached and reports the same umbrel id
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		expect(devices.some((device) => device.id === secondHddId)).toBe(true)
	})

	test('rejects replacing a healthy member with itself', async () => {
		await expect(
			umbreld.client.hardware.raid.replaceDevice.mutate({oldDevice: firstHddId, newDevice: firstHddId}),
		).rejects.toThrow(/healthy/)
	})

	test('replaces the wiped member with its own disk', async () => {
		await expect(
			umbreld.client.hardware.raid.replaceDevice.mutate({oldDevice: secondHddId, newDevice: secondHddId}),
		).resolves.toBe(true)

		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.status === 'ONLINE' && (status.devices ?? []).every((device) => device.status === 'ONLINE')
			},
			{interval: 2000, timeout: 300_000},
		)

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.devices).toHaveLength(2)
		expect(status.devices!.map((device) => device.id).sort()).toEqual([firstHddId, secondHddId].sort())
	})

	test('pool survives a reboot after the in-place replacement', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.status === 'ONLINE'
			},
			{interval: 1000, timeout: 120_000},
		)
	})
})
