import {expect, beforeAll, afterAll, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'
import type {ExpansionStatus} from './raid.js'

describe.sequential('RAID failsafe mode', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstDeviceId: string
	let secondDeviceId: string
	let thirdDeviceId: string
	let initialUsableSpace: number
	let expansionSubscription: ReturnType<typeof umbreld.subscribeToEvents<ExpansionStatus>>

	beforeAll(async () => {
		umbreld = await createTestVm()
	})

	afterAll(async () => {
		await umbreld?.cleanup()
	})

	test('adds two NVMe devices and boots VM', async () => {
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.powerOn()
	})

	test('detects both NVMe devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(2)
		const device1 = devices.find((d) => d.slot === 1)
		const device2 = devices.find((d) => d.slot === 2)
		expect(device1).toBeDefined()
		expect(device2).toBeDefined()
		firstDeviceId = device1!.id!
		secondDeviceId = device2!.id!
	})

	test('registers user with failsafe RAID config (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [firstDeviceId, secondDeviceId], raidType: 'failsafe'})
	})

	test('waits for RAID setup to complete and logs in', async () => {
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch (error) {
					// Ignore connection errors while VM is rebooting
					if (error instanceof Error && error.message.includes('fetch failed')) {
						return false
					}
					// Rethrow server errors (e.g., initialRaidSetupError)
					throw error
				}
			},
			{interval: 2000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('reports correct RAID status after setup', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(2)
		initialUsableSpace = status.usableSpace!
		expect(initialUsableSpace).toBeGreaterThan(0)
	})

	test('has both devices in the array', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([firstDeviceId, secondDeviceId].sort())
	})

	test('shuts down and adds third SSD', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.addNvme({slot: 3})
		await umbreld.vm.powerOn()
	})

	test('logs in after adding third SSD', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('detects all three NVMe devices after reboot', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(3)
		const thirdDevice = devices.find((d) => d.slot === 3)
		expect(thirdDevice).toBeDefined()
		thirdDeviceId = thirdDevice!.id!
		expect(thirdDeviceId).toBeDefined()
	})

	test('adds third SSD to RAID array and subscribes to expansion events', async () => {
		// Subscribe to expansion events before adding the device
		expansionSubscription = umbreld.subscribeToEvents<ExpansionStatus>('raid:expansion-progress')

		await umbreld.client.hardware.raid.addDevice.mutate({
			device: thirdDeviceId,
		})
	})

	test('reports correct RAID status with three devices', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(3)
	})

	test('has all three devices in the array', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([firstDeviceId, secondDeviceId, thirdDeviceId].sort())
	})

	// In RAIDZ1, when attaching a new device, the expansion is async.
	// Wait for expansion to complete and verify events only increase.
	test('receives expansion events via WebSocket', async () => {
		// Wait for expansion to complete via events
		await pWaitFor(
			() => {
				const events = expansionSubscription.collected
				const lastEvent = events[events.length - 1]
				return lastEvent?.state === 'finished' && lastEvent?.progress === 100
			},
			{interval: 1000, timeout: 30_000},
		)

		// Unsubscribe since expansion is complete
		expansionSubscription.unsubscribe()

		const events = expansionSubscription.collected
		expect(events.length).toBeGreaterThan(1)

		// Verify events have correct structure
		for (const event of events) {
			expect(['expanding', 'finished', 'canceled']).toContain(event.state)
			expect(event.progress).toBeGreaterThanOrEqual(0)
			expect(event.progress).toBeLessThanOrEqual(100)
		}

		// Verify progress only increased across events
		const progressFromEvents = events.map((e) => e.progress)
		for (let i = 1; i < progressFromEvents.length; i++) {
			expect(progressFromEvents[i]).toBeGreaterThanOrEqual(progressFromEvents[i - 1])
		}

		// Verify we started below 100 and ended at 100
		expect(progressFromEvents[0]).toBeLessThan(100)
		expect(progressFromEvents[progressFromEvents.length - 1]).toBe(100)
	})

	test('usable space increased after expansion', async () => {
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.usableSpace! > initialUsableSpace
			},
			{interval: 1000, timeout: 60_000},
		)
	})
})
