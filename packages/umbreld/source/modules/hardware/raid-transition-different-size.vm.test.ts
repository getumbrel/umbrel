import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'

import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

describe('RAID transition with different sized drives', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let smallDeviceId: string
	let mediumDeviceId: string
	let largeDeviceId: string
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

	test('adds three NVMe devices of different sizes and boots VM', async () => {
		// Small: 32GB, Medium: 64GB, Large: 128GB
		await umbreld.vm.addNvme({slot: 1, size: '32G'})
		await umbreld.vm.addNvme({slot: 2, size: '64G'})
		await umbreld.vm.addNvme({slot: 3, size: '128G'})
		await umbreld.vm.powerOn()
	})

	test('detects all three NVMe devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(3)
		smallDeviceId = devices.find((d) => d.slot === 1)!.id!
		mediumDeviceId = devices.find((d) => d.slot === 2)!.id!
		largeDeviceId = devices.find((d) => d.slot === 3)!.id!
	})

	test('registers user with storage RAID using medium device', async () => {
		await umbreld.signup({raidDevices: [mediumDeviceId], raidType: 'storage'})
	})

	test('waits for RAID setup to complete', async () => {
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch {
					return false
				}
			},
			{interval: 1000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('confirms storage mode RAID with medium device', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(1)
		expect(status.devices![0].id).toBe(mediumDeviceId)
	})

	test('rejects transition to smaller device', async () => {
		await expect(umbreld.client.hardware.raid.transitionToFailsafe.mutate({device: smallDeviceId})).rejects.toThrow(
			'Cannot transition to a device smaller than the current device',
		)
	})

	test('transitions to failsafe mode with larger device', async () => {
		await umbreld.client.hardware.raid.transitionToFailsafe.mutate({device: largeDeviceId})
	})

	test('waits for VM to come back up after transition', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('waits for migration to complete (2 devices in array)', async () => {
		let transitionError: string | undefined
		await pWaitFor(
			async () => {
				try {
					const status = await umbreld.client.hardware.raid.getStatus.query()
					if (status.failsafeTransitionStatus?.state === 'error') {
						transitionError = status.failsafeTransitionStatus.error
						return true
					}
					return status.devices?.length === 2
				} catch {
					return false
				}
			},
			{interval: 1000, timeout: 600_000},
		)
		if (transitionError) throw new Error(transitionError)
	})

	test('reports correct RAID status in failsafe mode', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(['ONLINE', 'DEGRADED']).toContain(status.status)
		expect(status.devices).toHaveLength(2)
	})

	test('waits for transition to complete', async () => {
		await pWaitFor(
			async () => {
				try {
					const status = await umbreld.client.hardware.raid.getStatus.query()
					if (status.failsafeTransitionStatus?.state === 'complete') return true
					if (!status.failsafeTransitionStatus && status.status === 'ONLINE') return true
					return false
				} catch {
					return false
				}
			},
			{interval: 1000, timeout: 600_000},
		)
	})

	test('pool eventually enters ONLINE state', async () => {
		await pWaitFor(
			async () => {
				try {
					const status = await umbreld.client.hardware.raid.getStatus.query()
					return status.status === 'ONLINE'
				} catch {
					return false
				}
			},
			{interval: 1000, timeout: 600_000},
		)
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.status).toBe('ONLINE')
	})
})
