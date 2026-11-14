import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

// A transition that loses power while syncing leaves its half-built migration pool on the new device.
// Retrying with a different device used to build a second pool with the same name, which the boot
// script couldn't tell apart from the first, so the retry synced everything and then failed to switch.
describe('RAID failsafe transition retried with a different device after losing power', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let deviceIds: string[]
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

	test('sets up a single-SSD storage array with two spare SSDs fitted (triggers reboot)', async () => {
		for (const slot of [1, 2, 3]) await umbreld.vm.addNvme({slot})
		await umbreld.vm.powerOn()

		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		deviceIds = [1, 2, 3].map((slot) => devices.find((device) => device.slot === slot)!.id!)

		await umbreld.signup({raidDevices: [deviceIds[0]], raidType: 'storage'})
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

	test('writes data with a checksum', async () => {
		// Enough data that the copy is still running when the power is cut
		await umbreld.vm.ssh('dd if=/dev/urandom of=~/data.bin bs=1M count=3000 && sha256sum ~/data.bin > ~/data.sha256')
	})

	test('loses power while syncing to the first spare SSD', async () => {
		await umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({newDeviceId: deviceIds[1]})
		await pWaitFor(
			async () => {
				const {failsafeTransitionStatus} = await umbreld.client.hardware.raid.getStatus.query()
				if (failsafeTransitionStatus?.state === 'error') throw new Error(failsafeTransitionStatus.error)
				return failsafeTransitionStatus?.state === 'syncing' && failsafeTransitionStatus.progress > 0
			},
			{interval: 200, timeout: 60_000},
		)

		await umbreld.vm.forcePowerOff()
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('storage')
		expect(status.devices!.map((device) => device.id)).toEqual([deviceIds[0]])
	})

	test('transitions to the second spare SSD instead', async () => {
		await umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({newDeviceId: deviceIds[2]})

		// Through the sync, the reboot and the rebuild
		await pWaitFor(
			async () => {
				let status: Awaited<ReturnType<typeof umbreld.client.hardware.raid.getStatus.query>>
				try {
					status = await umbreld.client.hardware.raid.getStatus.query()
				} catch {
					// The VM is going down for the reboot or coming back up
					await umbreld.login().catch(() => {})
					return false
				}
				if (status.failsafeTransitionStatus?.state === 'error') throw new Error(status.failsafeTransitionStatus.error)
				return status.failsafeTransitionStatus?.state === 'complete'
			},
			{interval: 1000, timeout: 900_000},
		)

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.status).toBe('ONLINE')
		expect(status.devices!.map((device) => device.id).sort()).toEqual([deviceIds[0], deviceIds[2]].sort())
		expect(await umbreld.vm.ssh('sha256sum --check ~/data.sha256')).toContain(': OK')
	})

	test('leaves no migration pool on the first spare SSD', async () => {
		// zpool import exits non-zero when there's nothing to import
		const importable = await umbreld.vm.sshAsRoot('zpool import -d /dev/disk/by-umbrel-id 2>&1 || true')
		expect(importable).not.toContain('-migration')
	})
})
