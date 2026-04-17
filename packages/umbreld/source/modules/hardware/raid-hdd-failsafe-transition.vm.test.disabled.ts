import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'
import type {FailsafeTransitionStatus} from './raid.js'

describe('RAID HDD storage to failsafe mirror transition', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let hddDeviceId1: string
	let hddDeviceId2: string
	let hddDeviceId3: string
	let hddDeviceId4: string
	let ssdDeviceId: string
	let transitionSubscription: ReturnType<typeof umbreld.subscribeToEvents<FailsafeTransitionStatus>>
	const transitionStatusCalls: FailsafeTransitionStatus[] = []
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

	// --- Phase 1: Setup single HDD in storage mode ---

	test('adds HDD and NVMe device and boots VM', async () => {
		await umbreld.vm.addHdd({slot: 1})
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.powerOn()
	})

	test('detects devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(2)

		const hdd = devices.find((d) => d.type === 'hdd')
		const ssd = devices.find((d) => d.type === 'ssd')
		expect(hdd).toBeDefined()
		expect(ssd).toBeDefined()

		hddDeviceId1 = hdd!.id!
		ssdDeviceId = ssd!.id!
	})

	test('registers user with single HDD storage config (triggers reboot)', async () => {
		await umbreld.signup({raidDevices: [hddDeviceId1], raidType: 'storage'})
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
			{interval: 2000, timeout: 600_000},
		)
		await umbreld.login()
	})

	test('reports correct storage mode status', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.topology).toBe('stripe')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(1)
		expect(status.devices![0].id).toBe(hddDeviceId1)
	})

	test('creates marker directory to verify data consistency', async () => {
		await umbreld.client.files.createDirectory.mutate({path: '/Home/transition-marker'})
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'transition-marker')).toBe(true)
	})

	test('writes test data so rebuild takes time', async () => {
		await umbreld.vm.ssh('dd if=/dev/urandom of=~/test-data.bin bs=1M count=2000')
	})

	// --- Phase 2: Add second HDD and validate ---

	test('shuts down and adds second HDD', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.addHdd({slot: 2})
		await umbreld.vm.powerOn()
	})

	test('logs in after adding second HDD', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('detects both HDDs and SSD', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		const hdds = devices.filter((d) => d.type === 'hdd')
		expect(hdds).toHaveLength(2)

		const secondHdd = hdds.find((d) => d.id !== hddDeviceId1)
		expect(secondHdd).toBeDefined()
		hddDeviceId2 = secondHdd!.id!
	})

	test('still in storage mode with one device', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('storage')
		expect(status.devices).toHaveLength(1)
	})

	test('rejects transition with SSD (type mismatch)', async () => {
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeMirror.mutate({
				pairs: [{existingDeviceId: hddDeviceId1, newDeviceId: ssdDeviceId}],
			}),
		).rejects.toThrow('Cannot mix SSDs and HDDs')
	})

	// --- Phase 3: Transition to failsafe (mirror) - no reboot ---

	test('transitions to failsafe with second HDD without rebooting', async () => {
		// Record VM PID before transition
		const pidBefore = umbreld.vm.pid

		// Subscribe to transition progress events
		transitionSubscription = umbreld.subscribeToEvents<FailsafeTransitionStatus>('raid:failsafe-transition-progress')

		// Start transition — for HDDs this is in-place (no reboot)
		const result = await umbreld.client.hardware.raid.transitionToFailsafeMirror.mutate({
			pairs: [{existingDeviceId: hddDeviceId1, newDeviceId: hddDeviceId2}],
		})
		expect(result).toBe(true)

		// Verify VM didn't reboot (same PID, can still make API calls)
		expect(umbreld.vm.pid).toBe(pidBefore)
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
	})

	test('reports mirror failsafe mode immediately after transition', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(status.topology).toBe('mirror')
		expect(status.devices).toHaveLength(2)
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([hddDeviceId1, hddDeviceId2].sort())
	})

	test('receives transition progress events and waits for completion', async () => {
		// Poll status endpoint while monitoring events
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				if (status.failsafeTransitionStatus) {
					transitionStatusCalls.push(status.failsafeTransitionStatus)
				}
				if (status.failsafeTransitionStatus?.state === 'complete') return true
				if (!status.failsafeTransitionStatus && status.status === 'ONLINE') return true
				return false
			},
			{interval: 1000, timeout: 600_000},
		)

		transitionSubscription.unsubscribe()

		const events = transitionSubscription.collected
		expect(events.length).toBeGreaterThan(1)

		// Mirror transitions only have rebuilding and complete states (no syncing/rebooting)
		for (const event of events) {
			expect(['rebuilding', 'complete']).toContain(event.state)
			expect(event.progress).toBeGreaterThanOrEqual(0)
			expect(event.progress).toBeLessThanOrEqual(100)
		}

		// Verify progress only increased
		const progressValues = events.map((e) => e.progress)
		for (let i = 1; i < progressValues.length; i++) {
			expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1])
		}

		// Verify we started at 0 and ended at 100
		expect(progressValues[0]).toBe(0)
		expect(progressValues[progressValues.length - 1]).toBe(100)

		// Verify we captured intermediate progress
		expect(progressValues.some((p) => p > 0 && p < 100)).toBe(true)

		// Verify status endpoint calls
		expect(transitionStatusCalls.length).toBeGreaterThan(1)
		for (const status of transitionStatusCalls) {
			expect(['rebuilding', 'complete']).toContain(status.state)
		}
	})

	test('pool enters ONLINE state after transition', async () => {
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.status === 'ONLINE'
			},
			{interval: 1000, timeout: 600_000},
		)
	})

	test('marker directory still exists after transition', async () => {
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'transition-marker')).toBe(true)
	})

	// --- Phase 4: Expand mirror failsafe with new mirror pair ---

	test('shuts down and adds two more HDDs', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.addHdd({slot: 3})
		await umbreld.vm.addHdd({slot: 4})
		await umbreld.vm.powerOn()
	})

	test('logs in after adding HDDs', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('detects new HDDs', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		const hdds = devices.filter((d) => d.type === 'hdd')
		expect(hdds).toHaveLength(4)

		const status = await umbreld.client.hardware.raid.getStatus.query()
		const poolDeviceIds = status.devices!.map((d) => d.id)
		const newHdds = hdds.filter((d) => !poolDeviceIds.includes(d.id!))
		expect(newHdds).toHaveLength(2)

		hddDeviceId3 = newHdds[0].id!
		hddDeviceId4 = newHdds[1].id!
	})

	test('rejects adding single HDD to mirror pool', async () => {
		await expect(umbreld.client.hardware.raid.addDevice.mutate({deviceId: hddDeviceId3})).rejects.toThrow(
			'addDevice is not supported for mirror failsafe mode, use addMirror',
		)
	})

	test('adds mirror pair to array', async () => {
		await umbreld.client.hardware.raid.addMirror.mutate({deviceIds: [hddDeviceId3, hddDeviceId4]})
	})

	test('reports correct status with 4 devices after expansion', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(status.topology).toBe('mirror')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(4)
	})

	test('marker directory still exists after expansion', async () => {
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'transition-marker')).toBe(true)
	})

	test('log all events', async () => {
		console.log('Transition events:', transitionSubscription.collected)
		console.log('Status calls:', transitionStatusCalls)
	})
})
