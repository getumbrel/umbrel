import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'
import type {ReplaceStatus} from './raid.js'

describe('RAID device replacement - storage mode', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstDeviceId: string
	let secondDeviceId: string
	let thirdDeviceId: string
	let replaceSubscription: ReturnType<typeof umbreld.subscribeToEvents<ReplaceStatus>>
	const replaceStatusCalls: ReplaceStatus[] = []
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

	test('registers user with storage RAID config (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [firstDeviceId, secondDeviceId], raidType: 'storage'})
	})

	test('waits for RAID setup to complete and logs in', async () => {
		await pWaitFor(
			async () => {
				try {
					return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
				} catch (error) {
					if (error instanceof Error && error.message.includes('fetch failed')) {
						return false
					}
					throw error
				}
			},
			{interval: 1000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('reports correct RAID status in storage mode', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(2)
	})

	test('writes test data to ensure resilver takes time', async () => {
		// Write 5GB of random data so resilver takes long enough to capture progress
		await umbreld.vm.ssh('dd if=/dev/urandom of=~/test-data.bin bs=1M count=5000')
	})

	test('shuts down and adds third NVMe device (replacement drive)', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.addNvme({slot: 3})
		await umbreld.vm.powerOn()
	})

	test('logs in after adding third device', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('detects all three NVMe devices', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(3)
		const thirdDevice = devices.find((d) => d.slot === 3)
		expect(thirdDevice).toBeDefined()
		thirdDeviceId = thirdDevice!.id!
	})

	test('replaces second device with third device in storage mode', async () => {
		// Subscribe to replace events before starting
		replaceSubscription = umbreld.subscribeToEvents<ReplaceStatus>('raid:replace-progress')

		await umbreld.client.hardware.raid.replaceDevice.mutate({
			oldDevice: secondDeviceId,
			newDevice: thirdDeviceId,
		})
	})

	test('waits for replacement to complete in storage mode', async () => {
		// Poll status endpoint while waiting, collecting replace status
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				if (status.replace) {
					replaceStatusCalls.push(status.replace)
				}
				const statusHasFinished = ['finished', 'canceled'].includes(status.replace?.state ?? '')
				const eventsHaveFinished = replaceSubscription.collected.some((e) => ['finished', 'canceled'].includes(e.state))
				return statusHasFinished && eventsHaveFinished
			},
			{interval: 1000, timeout: 600_000},
		)

		replaceSubscription.unsubscribe()
	})

	test('validates replace events have correct structure', () => {
		const events = replaceSubscription.collected
		expect(events.length).toBeGreaterThan(1)

		// Verify events have correct structure
		for (const event of events) {
			expect(['rebuilding', 'finished', 'canceled']).toContain(event.state)
			expect(event.progress).toBeGreaterThanOrEqual(0)
			expect(event.progress).toBeLessThanOrEqual(100)
		}

		// Verify progress only increased across events
		const progressFromEvents = events.map((e) => e.progress)
		for (let i = 1; i < progressFromEvents.length; i++) {
			expect(progressFromEvents[i]).toBeGreaterThanOrEqual(progressFromEvents[i - 1])
		}

		// Verify we have intermediate progress and 100%
		expect(progressFromEvents).toContain(100)
		expect(progressFromEvents.some((p) => p < 100)).toBe(true)

		// Verify final event is finished state at 100%
		const lastEvent = events[events.length - 1]
		expect(lastEvent.state).toBe('finished')
		expect(lastEvent.progress).toBe(100)
	})

	test('validates replace status calls have correct structure', () => {
		expect(replaceStatusCalls.length).toBeGreaterThan(1)

		// Verify status calls have correct structure
		for (const status of replaceStatusCalls) {
			expect(['rebuilding', 'finished', 'canceled']).toContain(status.state)
			expect(status.progress).toBeGreaterThanOrEqual(0)
			expect(status.progress).toBeLessThanOrEqual(100)
		}

		// Verify progress only increased across status calls
		const progressFromStatus = replaceStatusCalls.map((s) => s.progress)
		for (let i = 1; i < progressFromStatus.length; i++) {
			expect(progressFromStatus[i]).toBeGreaterThanOrEqual(progressFromStatus[i - 1])
		}

		// Verify we captured intermediate progress (not just end state)
		expect(progressFromStatus.some((p) => p < 100)).toBe(true)

		// Verify final status shows completion
		const lastStatus = replaceStatusCalls[replaceStatusCalls.length - 1]
		expect(lastStatus.progress).toBe(100)
		expect(lastStatus.state).toBe('finished')
	})

	test('reports correct RAID status after storage mode replacement', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.devices).toHaveLength(2)
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([firstDeviceId, thirdDeviceId].sort())
	})

	test('logs all collected events and status calls', () => {
		const events = replaceSubscription.collected
		console.log('Events collected:', events.length)
		for (const event of events) console.log(event)
		console.log('Status calls collected:', replaceStatusCalls.length)
		for (const status of replaceStatusCalls) console.log(status)
	})
})

describe('RAID device replacement - failsafe mode', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstDeviceId: string
	let secondDeviceId: string
	let newSecondDeviceId: string
	let replaceSubscription: ReturnType<typeof umbreld.subscribeToEvents<ReplaceStatus>>
	const replaceStatusCalls: ReplaceStatus[] = []
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
					if (error instanceof Error && error.message.includes('fetch failed')) {
						return false
					}
					throw error
				}
			},
			{interval: 1000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('reports correct RAID status in failsafe mode', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(2)
	})

	test('writes test data to ensure resilver takes time', async () => {
		// Write 5GB of random data so resilver takes long enough to capture progress
		await umbreld.vm.ssh('dd if=/dev/urandom of=~/test-data.bin bs=1M count=5000')
	})

	test('shuts down, nukes second drive, and adds fresh replacement', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.removeNvme({slot: 2})
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.powerOn()
	})

	test('logs in after replacing drive', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('detects new replacement drive in slot 2', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(2)
		const newDevice2 = devices.find((d) => d.slot === 2)
		expect(newDevice2).toBeDefined()
		newSecondDeviceId = newDevice2!.id!
		// The new drive should have a different ID than the original
		expect(newSecondDeviceId).not.toBe(secondDeviceId)
	})

	test('replaces old device with new device in failsafe mode', async () => {
		// Subscribe to replace events before starting
		replaceSubscription = umbreld.subscribeToEvents<ReplaceStatus>('raid:replace-progress')

		await umbreld.client.hardware.raid.replaceDevice.mutate({
			oldDevice: secondDeviceId,
			newDevice: newSecondDeviceId,
		})
	})

	test('waits for replacement to complete in failsafe mode', async () => {
		// Poll status endpoint while waiting, collecting replace status
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				if (status.replace) {
					replaceStatusCalls.push(status.replace)
				}
				const statusHasFinished = ['finished', 'canceled'].includes(status.replace?.state ?? '')
				const eventsHaveFinished = replaceSubscription.collected.some((e) => ['finished', 'canceled'].includes(e.state))
				return statusHasFinished && eventsHaveFinished
			},
			{interval: 1000, timeout: 600_000},
		)

		replaceSubscription.unsubscribe()
	})

	test('validates replace events have correct structure', () => {
		const events = replaceSubscription.collected
		expect(events.length).toBeGreaterThan(1)

		// Verify events have correct structure
		for (const event of events) {
			expect(['rebuilding', 'finished', 'canceled']).toContain(event.state)
			expect(event.progress).toBeGreaterThanOrEqual(0)
			expect(event.progress).toBeLessThanOrEqual(100)
		}

		// Verify progress only increased across events
		const progressFromEvents = events.map((e) => e.progress)
		for (let i = 1; i < progressFromEvents.length; i++) {
			expect(progressFromEvents[i]).toBeGreaterThanOrEqual(progressFromEvents[i - 1])
		}

		// Verify we have intermediate progress and 100%
		expect(progressFromEvents).toContain(100)
		expect(progressFromEvents.some((p) => p < 100)).toBe(true)

		// Verify final event is finished state at 100%
		const lastEvent = events[events.length - 1]
		expect(lastEvent.state).toBe('finished')
		expect(lastEvent.progress).toBe(100)
	})

	test('validates replace status calls have correct structure', () => {
		expect(replaceStatusCalls.length).toBeGreaterThan(1)

		// Verify status calls have correct structure
		for (const status of replaceStatusCalls) {
			expect(['rebuilding', 'finished', 'canceled']).toContain(status.state)
			expect(status.progress).toBeGreaterThanOrEqual(0)
			expect(status.progress).toBeLessThanOrEqual(100)
		}

		// Verify progress only increased across status calls
		const progressFromStatus = replaceStatusCalls.map((s) => s.progress)
		for (let i = 1; i < progressFromStatus.length; i++) {
			expect(progressFromStatus[i]).toBeGreaterThanOrEqual(progressFromStatus[i - 1])
		}

		// Verify we captured intermediate progress (not just end state)
		expect(progressFromStatus.some((p) => p < 100)).toBe(true)

		// Verify final status shows completion
		const lastStatus = replaceStatusCalls[replaceStatusCalls.length - 1]
		expect(lastStatus.progress).toBe(100)
		expect(lastStatus.state).toBe('finished')
	})

	test('reports correct RAID status after failsafe mode replacement', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(status.devices).toHaveLength(2)
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([firstDeviceId, newSecondDeviceId].sort())
	})

	test('pool is in ONLINE state after failsafe replacement', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.status).toBe('ONLINE')
	})

	test('logs all collected events and status calls', () => {
		const events = replaceSubscription.collected
		console.log('Events collected:', events.length)
		for (const event of events) console.log(event)
		console.log('Status calls collected:', replaceStatusCalls.length)
		for (const status of replaceStatusCalls) console.log(status)
	})
})
