import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm, driveBuses} from '../test-utilities/create-test-umbreld.ts'

// Capacity reporting must stay stable while a mirror member is missing. ZFS stops
// reporting phys_space for missing members, which used to make totalSpace (and the UI's
// "Total capacity added" / "For FailSafe" numbers derived from it) drop by the size of
// every missing drive while the pool was degraded. The rep_dev_size fallback keeps raw
// capacity stable; usable space was always unaffected.
describe.each(driveBuses)('Mirror pool capacity with a missing member (%s)', (bus) => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstHddId: string
	let secondHddId: string
	let healthyTotalSpace: number
	let healthyUsableSpace: number
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

	test('reports healthy mirror capacity', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.topology).toBe('mirror')
		expect(status.status).toBe('ONLINE')
		healthyTotalSpace = status.totalSpace!
		healthyUsableSpace = status.usableSpace!
		// Raw capacity counts both members, usable capacity one member's worth
		expect(healthyTotalSpace).toBeGreaterThan(healthyUsableSpace * 1.9)
	})

	test('detaches one mirror member and reboots degraded', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.disconnectHdd({slot: 2, bus})
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

	test('raw and usable capacity stay stable while degraded', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.devices).toHaveLength(2)

		// Usable space is exactly unchanged; raw capacity uses the missing member's
		// rep_dev_size which is marginally smaller than phys_space, so allow 1% slack
		expect(status.usableSpace).toBe(healthyUsableSpace)
		expect(status.totalSpace!).toBeGreaterThan(healthyTotalSpace * 0.99)
		expect(status.totalSpace!).toBeLessThanOrEqual(healthyTotalSpace)
	})

	test('reattaching the member restores a healthy pool', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.connectHdd({slot: 2, bus})
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

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.totalSpace).toBe(healthyTotalSpace)
		expect(status.usableSpace).toBe(healthyUsableSpace)
	})
})
