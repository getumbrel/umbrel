import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

// Enabling FailSafe on a single SSD ends with the original SSD being rebuilt into the new array.
// ZFS carries that rebuild on by itself after a power cut, but umbreld was no longer watching it
// finish, so the snapshots the transition had taken were never destroyed.
describe('RAID storage to failsafe transition after losing power while rebuilding', () => {
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

	test('sets up a single-SSD storage array (triggers reboot)', async () => {
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.powerOn()

		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		firstDeviceId = devices.find((device) => device.slot === 1)!.id!
		secondDeviceId = devices.find((device) => device.slot === 2)!.id!

		await umbreld.signup({raidDevices: [firstDeviceId], raidType: 'storage'})
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
		// Enough data that the rebuild is still running when the power is cut
		await umbreld.vm.ssh('dd if=/dev/urandom of=~/data.bin bs=1M count=6000 && sha256sum ~/data.bin > ~/data.sha256')
	})

	test('syncs to the new array and reboots', async () => {
		await umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({newDeviceId: secondDeviceId})
		await pWaitFor(
			async () => {
				try {
					const {failsafeTransitionStatus} = await umbreld.client.hardware.raid.getStatus.query()
					if (failsafeTransitionStatus?.state === 'error') throw new Error(failsafeTransitionStatus.error)
					return failsafeTransitionStatus?.state === 'rebooting'
				} catch (error) {
					if (error instanceof Error && error.message.includes('fetch failed')) return true
					throw error
				}
			},
			{interval: 1000, timeout: 600_000},
		)
	})

	test('loses power while the original SSD is rebuilding', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		// The rebuild is the second half of the transition's progress
		await pWaitFor(
			async () => {
				let status: Awaited<ReturnType<typeof umbreld.client.hardware.raid.getStatus.query>>
				try {
					status = await umbreld.client.hardware.raid.getStatus.query()
				} catch {
					// The VM may still be going down for the reboot
					await umbreld.login().catch(() => {})
					return false
				}
				if (status.failsafeTransitionStatus?.state === 'error') throw new Error(status.failsafeTransitionStatus.error)
				return status.failsafeTransitionStatus?.state === 'rebuilding' && status.failsafeTransitionStatus.progress > 50
			},
			{interval: 200, timeout: 600_000},
		)
		await umbreld.vm.forcePowerOff()
	})

	test('finishes the rebuild and destroys the transition snapshots after power returns', async () => {
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.status === 'ONLINE' && status.rebuild?.state !== 'rebuilding'
			},
			{interval: 1000, timeout: 600_000},
		)

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.devices!.map((device) => device.id).sort()).toEqual([firstDeviceId, secondDeviceId].sort())
		expect(status.devices!.every((device) => device.status === 'ONLINE')).toBe(true)
		expect((await umbreld.vm.sshAsRoot('zfs list -H -t snapshot -o name')).trim()).toBe('')
		expect(await umbreld.vm.ssh('sha256sum --check ~/data.sha256')).toContain(': OK')
	})
})
