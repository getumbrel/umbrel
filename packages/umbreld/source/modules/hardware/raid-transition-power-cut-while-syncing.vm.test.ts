import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

// Enabling FailSafe on a single SSD first copies everything to a new pool, which can take hours.
// Losing power during the copy leaves the storage array in use, and the snapshot and half-built
// pool the copy was using behind. Enabling FailSafe again has to work despite them.
describe('RAID storage to failsafe transition after losing power while syncing', () => {
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

		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		firstDeviceId = devices.find((device) => device.slot === 1)!.id!
		secondDeviceId = devices.find((device) => device.slot === 2)!.id!
	})

	test('sets up a single-SSD storage array (triggers reboot)', async () => {
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
		// Enough data that the copy is still running when the power is cut
		await umbreld.vm.ssh('dd if=/dev/urandom of=~/data.bin bs=1M count=3000 && sha256sum ~/data.bin > ~/data.sha256')
	})

	test('leaves the storage array in use after losing power while syncing', async () => {
		await umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({newDeviceId: secondDeviceId})
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
		expect(status.status).toBe('ONLINE')
		expect(status.devices!.map((device) => device.id)).toEqual([firstDeviceId])
		expect(status.failsafeTransitionStatus).toBeUndefined()
		expect(await umbreld.vm.ssh('sha256sum --check ~/data.sha256')).toContain(': OK')
	})

	test('syncs again on the first retry and reboots', async () => {
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

	test('finishes as a failsafe array with the data intact', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

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
				return status.failsafeTransitionStatus?.state === 'complete'
			},
			{interval: 1000, timeout: 600_000},
		)

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.status).toBe('ONLINE')
		expect(status.devices!.map((device) => device.id).sort()).toEqual([firstDeviceId, secondDeviceId].sort())
		expect(await umbreld.vm.ssh('sha256sum --check ~/data.sha256')).toContain(': OK')
	})
})
