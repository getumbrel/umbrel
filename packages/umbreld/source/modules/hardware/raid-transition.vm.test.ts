import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'

import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'
import type {FailsafeTransitionStatus} from './raid.js'

describe('RAID storage to failsafe transition', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstDeviceId: string
	let secondDeviceId: string
	let syncSubscription: ReturnType<typeof umbreld.subscribeToEvents<FailsafeTransitionStatus>>
	let rebuildSubscription: ReturnType<typeof umbreld.subscribeToEvents<FailsafeTransitionStatus>>
	// Collect all status endpoint responses for verification
	const transitionStatusCalls: FailsafeTransitionStatus[] = []
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

	test('adds one NVMe device and boots VM', async () => {
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.powerOn()
	})

	test('detects NVMe device', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(1)
		expect(devices[0].slot).toBe(1)
		firstDeviceId = devices[0].id!
		expect(firstDeviceId).toBeDefined()
	})

	test('registers user with storage RAID config (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [firstDeviceId], raidType: 'storage'})
	})

	test('waits for VM to come back up and logs in', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('reports correct RAID status in storage mode', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(1)
		expect(status.devices![0].id).toBe(firstDeviceId)
	})

	test('creates marker directory to verify data migration', async () => {
		await umbreld.client.files.createDirectory.mutate({path: '/Home/migration-test-directory'})
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'migration-test-directory')).toBe(true)
	})

	test('writes test data to ensure sync and rebuild take time', async () => {
		// Write 10GB of random data so sync/rebuild take long enough to capture progress
		await umbreld.vm.ssh('dd if=/dev/urandom of=/data/test-data.bin bs=1M count=10000')
	})

	test('shuts down and adds second NVMe device', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.powerOn()
	})

	test('logs in after adding second device', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('detects both NVMe devices', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(2)
		const secondDevice = devices.find((d) => d.slot === 2)
		expect(secondDevice).toBeDefined()
		secondDeviceId = secondDevice!.id!
		expect(secondDeviceId).toBeDefined()
	})

	test('still in storage mode with one device', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.devices).toHaveLength(1)
	})

	test('receives transition progress (sync phase 0-50%) via WebSocket and status endpoint', async () => {
		// Subscribe to transition progress events before starting
		syncSubscription = umbreld.subscribeToEvents<FailsafeTransitionStatus>('raid:failsafe-transition-progress')

		// Start transition without awaiting - we want to monitor progress while it runs
		const transitionPromise = umbreld.client.hardware.raid.transitionToFailsafe.mutate({
			device: secondDeviceId,
		})

		// Wait for rebooting state at 50% (sync phase complete)
		await pWaitFor(
			async () => {
				// Collect status endpoint data on every poll
				const status = await umbreld.client.hardware.raid.getStatus.query()
				if (status.failsafeTransitionStatus) {
					transitionStatusCalls.push(status.failsafeTransitionStatus)
				}

				const events = syncSubscription.collected
				const lastEvent = events[events.length - 1]
				return lastEvent?.state === 'rebooting' && lastEvent?.progress === 50
			},
			{interval: 1000, timeout: 600_000},
		)

		// Wait for the mutation to complete
		const result = await transitionPromise
		expect(result).toBe(true)

		// Unsubscribe since we're about to reboot
		syncSubscription.unsubscribe()

		const events = syncSubscription.collected
		expect(events.length).toBeGreaterThan(1)

		// Verify events have correct structure for sync phase
		for (const event of events) {
			expect(['syncing', 'rebooting']).toContain(event.state)
			expect(event.progress).toBeGreaterThanOrEqual(0)
			expect(event.progress).toBeLessThanOrEqual(50)
		}

		// Verify progress only increased across events
		const progressFromEvents = events.map((e) => e.progress)
		for (let i = 1; i < progressFromEvents.length; i++) {
			expect(progressFromEvents[i]).toBeGreaterThanOrEqual(progressFromEvents[i - 1])
		}

		// Verify we have 0%, intermediate progress, and 50%
		expect(progressFromEvents).toContain(0)
		expect(progressFromEvents).toContain(50)
		expect(progressFromEvents.some((p) => p > 0 && p < 50)).toBe(true)

		// Verify final event is rebooting state at 50%
		const lastEvent = events[events.length - 1]
		expect(lastEvent.state).toBe('rebooting')
		expect(lastEvent.progress).toBe(50)

		// Verify status endpoint calls for sync phase
		const syncStatusCalls = transitionStatusCalls.filter((s) => s.progress <= 50)
		expect(syncStatusCalls.length).toBeGreaterThan(1)

		// Verify status calls have correct structure
		for (const status of syncStatusCalls) {
			expect(['syncing', 'rebooting']).toContain(status.state)
			expect(status.progress).toBeGreaterThanOrEqual(0)
			expect(status.progress).toBeLessThanOrEqual(50)
		}
	})

	test('waits for VM to come back up after transition and logs in', async () => {
		// After reboot, we need to wait for umbreld and re-login for WebSocket auth
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		// Subscribe to transition events immediately - rebuild is part of the transition (51-100%)
		rebuildSubscription = umbreld.subscribeToEvents<FailsafeTransitionStatus>('raid:failsafe-transition-progress')
	})

	test('waits for migration to complete (2 devices in array)', async () => {
		// umbreld completes the migration asynchronously on startup
		// Wait for both devices to appear in the array
		let status: Awaited<ReturnType<typeof umbreld.client.hardware.raid.getStatus.query>>
		await pWaitFor(
			async () => {
				try {
					status = await umbreld.client.hardware.raid.getStatus.query()
					if (status.devices?.length === 2) return true
				} catch {}
				if (status?.failsafeTransitionStatus?.state === 'error') {
					throw new Error(status.failsafeTransitionStatus.error)
				}
				return false
			},
			{interval: 1000, timeout: 600_000},
		)
		expect(status!.devices).toHaveLength(2)
	})

	test('reports correct RAID status in failsafe mode after migration', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		// Pool may be DEGRADED while rebuilding the old device into the array
		expect(['ONLINE', 'DEGRADED']).toContain(status.status)
		expect(status.devices).toHaveLength(2)
		expect(status.failsafeTransitionStatus?.state).not.toBe('error')
	})

	test('has both devices in the array after migration', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([firstDeviceId, secondDeviceId].sort())
	})

	test('receives transition progress (rebuild phase 51-100%) via WebSocket and status endpoint', async () => {
		// rebuildSubscription was set up earlier in 'waits for VM to come back up' test
		// so we capture events from the start of the rebuild phase

		// Poll status endpoint for transition progress while monitoring events
		await pWaitFor(
			async () => {
				// Collect status endpoint data on every poll
				const status = await umbreld.client.hardware.raid.getStatus.query()
				if (status.failsafeTransitionStatus) {
					transitionStatusCalls.push(status.failsafeTransitionStatus)
				}

				if (status.failsafeTransitionStatus?.state === 'complete') {
					return true
				}
				// Also consider complete if no transition status and pool is ONLINE
				if (!status.failsafeTransitionStatus && status.status === 'ONLINE') {
					return true
				}
				return false
			},
			{interval: 1000, timeout: 600_000},
		)

		// Unsubscribe since transition is complete
		rebuildSubscription.unsubscribe()

		const events = rebuildSubscription.collected

		// Verify we received events via WebSocket
		expect(events.length).toBeGreaterThan(1)

		// Verify events have correct structure for rebuild phase
		for (const event of events) {
			expect(['rebuilding', 'complete']).toContain(event.state)
			expect(event.progress).toBeGreaterThanOrEqual(50)
			expect(event.progress).toBeLessThanOrEqual(100)
		}

		// Verify progress only increased across events
		const progressFromEvents = events.map((e) => e.progress)
		for (let i = 1; i < progressFromEvents.length; i++) {
			expect(progressFromEvents[i]).toBeGreaterThanOrEqual(progressFromEvents[i - 1])
		}

		// Verify we captured intermediate progress (not just start/end state)
		expect(progressFromEvents.some((p) => p > 50 && p < 100)).toBe(true)

		// Verify status endpoint calls for rebuild phase
		const rebuildStatusCalls = transitionStatusCalls.filter((s) => s.progress > 50)
		expect(rebuildStatusCalls.length).toBeGreaterThan(1)

		// Verify status calls have correct structure
		for (const status of rebuildStatusCalls) {
			expect(['rebuilding', 'complete']).toContain(status.state)
			expect(status.progress).toBeGreaterThanOrEqual(50)
			expect(status.progress).toBeLessThanOrEqual(100)
		}

		// Verify final status shows completion
		const lastStatus = transitionStatusCalls[transitionStatusCalls.length - 1]
		expect(lastStatus.progress).toBe(100)
		expect(lastStatus.state).toBe('complete')
	})

	test('pool eventually enters ONLINE state', async () => {
		let status: Awaited<ReturnType<typeof umbreld.client.hardware.raid.getStatus.query>>
		await pWaitFor(
			async () => {
				status = await umbreld.client.hardware.raid.getStatus.query()
				return status.status === 'ONLINE'
			},
			{interval: 1000, timeout: 600_000},
		)
		expect(status!.status).toBe('ONLINE')
	})

	test('verifies marker directory was migrated correctly', async () => {
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'migration-test-directory')).toBe(true)
	})

	// Unskip this test for extra debug info
	test('log all events', async () => {
		console.log('Sync phase events:', syncSubscription.collected)
		console.log('Rebuild phase events:', rebuildSubscription.collected)
		console.log('All transition status calls:', transitionStatusCalls)
	})
})
