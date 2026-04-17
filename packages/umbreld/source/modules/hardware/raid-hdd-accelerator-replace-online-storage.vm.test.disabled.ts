import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'
import type {ReplaceStatus} from './raid.js'

const expectedSingleAcceleratorL2arcSizeGb = 10
const expectedSingleAcceleratorSpecialSizeGb = 490

function expectSizeToBeWithinTenPercentOfGb(actualBytes: number | undefined, expectedGb: number) {
	expect(actualBytes).toBeDefined()
	const actualGb = actualBytes! / 1_000_000_000
	expect(actualGb).toBeGreaterThanOrEqual(expectedGb * 0.9)
	expect(actualGb).toBeLessThanOrEqual(expectedGb * 1.1)
}

describe('RAID HDD storage mode accelerator replacement with an online device', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let hddDeviceId: string
	let acceleratorDeviceId: string
	let replacementAcceleratorDeviceId: string
	let replaceSubscription: ReturnType<typeof umbreld.subscribeToEvents<ReplaceStatus>>
	const replaceStatusCalls: ReplaceStatus[] = []
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

	test('adds one HDD and two NVMe SSDs and boots VM', async () => {
		await umbreld.vm.addHdd({slot: 1})
		await umbreld.vm.addNvme({slot: 1, size: '512G'})
		await umbreld.vm.addNvme({slot: 2, size: '500G'})
		await umbreld.vm.powerOn()
	})

	test('detects HDD and SSD devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		const hdds = devices.filter((device) => device.type === 'hdd')
		const ssds = devices.filter((device) => device.type === 'ssd')

		expect(hdds).toHaveLength(1)
		expect(ssds).toHaveLength(2)

		hddDeviceId = hdds[0].id!
		acceleratorDeviceId = ssds[0].id!
		replacementAcceleratorDeviceId = ssds[1].id!
	})

	test('registers user with HDD storage config and accelerator', async () => {
		await umbreld.signup({
			raidDevices: [hddDeviceId],
			raidType: 'storage',
			acceleratorDevices: [acceleratorDeviceId],
		})
	})

	test('waits for RAID setup to complete and logs in', async () => {
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch {
					return false
				}
			},
			{interval: 2000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('reports accelerator after initial setup', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('storage')
		expect(status.devices).toHaveLength(1)
		expect(status.accelerator).toMatchObject({exists: true})
		expect(status.accelerator?.devices).toHaveLength(1)
		expect(status.accelerator?.devices?.[0]).toMatchObject({id: acceleratorDeviceId})
		expectSizeToBeWithinTenPercentOfGb(status.accelerator?.l2arcSize, expectedSingleAcceleratorL2arcSizeGb)
		expectSizeToBeWithinTenPercentOfGb(status.accelerator?.specialSize, expectedSingleAcceleratorSpecialSizeGb)
	})

	test('replaces accelerator SSD while it is online', async () => {
		replaceSubscription = umbreld.subscribeToEvents<ReplaceStatus>('raid:replace-progress')

		await umbreld.client.hardware.raid.replaceDevice.mutate({
			oldDevice: acceleratorDeviceId,
			newDevice: replacementAcceleratorDeviceId,
		})
	})

	test('waits for accelerator replacement to complete', async () => {
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				if (status.replace) replaceStatusCalls.push(status.replace)
				const statusHasFinished = ['finished', 'canceled'].includes(status.replace?.state ?? '')
				const eventsHaveFinished = replaceSubscription.collected.some((e) => ['finished', 'canceled'].includes(e.state))
				return statusHasFinished && eventsHaveFinished
			},
			{interval: 1000, timeout: 600_000},
		)

		replaceSubscription.unsubscribe()
	})

	test('reports accelerator replace events', () => {
		const events = replaceSubscription.collected
		expect(events.length).toBeGreaterThan(1)

		for (const event of events) {
			expect(['rebuilding', 'finished', 'canceled']).toContain(event.state)
			expect(event.progress).toBeGreaterThanOrEqual(0)
			expect(event.progress).toBeLessThanOrEqual(100)
		}

		const progressFromEvents = events.map((event) => event.progress)
		for (let i = 1; i < progressFromEvents.length; i++) {
			expect(progressFromEvents[i]).toBeGreaterThanOrEqual(progressFromEvents[i - 1])
		}

		expect(progressFromEvents).toContain(100)
		expect(progressFromEvents.some((progress) => progress < 100)).toBe(true)
		expect(events.at(-1)).toMatchObject({state: 'finished', progress: 100})
	})

	test('reports accelerator replace status', () => {
		expect(replaceStatusCalls.length).toBeGreaterThan(0)

		for (const status of replaceStatusCalls) {
			expect(['rebuilding', 'finished', 'canceled']).toContain(status.state)
			expect(status.progress).toBeGreaterThanOrEqual(0)
			expect(status.progress).toBeLessThanOrEqual(100)
		}

		const progressFromStatus = replaceStatusCalls.map((status) => status.progress)
		for (let i = 1; i < progressFromStatus.length; i++) {
			expect(progressFromStatus[i]).toBeGreaterThanOrEqual(progressFromStatus[i - 1])
		}

		expect(replaceStatusCalls.at(-1)).toMatchObject({state: 'finished', progress: 100})
	})

	test('reports the replacement accelerator device with correct sizes', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.accelerator?.devices).toHaveLength(1)
		expect(status.accelerator?.devices?.[0]).toMatchObject({id: replacementAcceleratorDeviceId})
		expectSizeToBeWithinTenPercentOfGb(status.accelerator?.l2arcSize, expectedSingleAcceleratorL2arcSizeGb)
		expectSizeToBeWithinTenPercentOfGb(status.accelerator?.specialSize, expectedSingleAcceleratorSpecialSizeGb)
	})
})
