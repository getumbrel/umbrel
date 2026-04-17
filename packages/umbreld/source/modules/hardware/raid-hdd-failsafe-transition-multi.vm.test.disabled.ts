import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'
import type {FailsafeTransitionStatus} from './raid.js'

describe('RAID HDD multi-disk storage to failsafe mirror transition', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let hddDeviceId1: string
	let hddDeviceId2: string
	let hddDeviceId3: string
	let hddDeviceId4: string
	let smallHddDeviceId: string
	let initialUsableSpace: number
	let transitionSubscription: ReturnType<typeof umbreld.subscribeToEvents<FailsafeTransitionStatus>>
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

	// --- Phase 1: Setup 2-HDD storage ---

	test('adds two HDDs and boots VM', async () => {
		await umbreld.vm.addHdd({slot: 1})
		await umbreld.vm.addHdd({slot: 2})
		await umbreld.vm.powerOn()
	})

	test('detects both HDDs', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		const hdds = devices.filter((d) => d.type === 'hdd')
		expect(hdds).toHaveLength(2)
		hddDeviceId1 = hdds[0].id!
		hddDeviceId2 = hdds[1].id!
	})

	test('registers user with single HDD storage (triggers reboot)', async () => {
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

	test('adds second HDD to storage array', async () => {
		await umbreld.client.hardware.raid.addDevice.mutate({deviceId: hddDeviceId2})
	})

	test('reports correct 2-device storage status', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.topology).toBe('stripe')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(2)
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([hddDeviceId1, hddDeviceId2].sort())
		initialUsableSpace = status.usableSpace!
		expect(initialUsableSpace).toBeGreaterThan(0)
	})

	test('creates marker directory to verify data consistency', async () => {
		await umbreld.client.files.createDirectory.mutate({path: '/Home/multi-transition-marker'})
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'multi-transition-marker')).toBe(true)
	})

	test('writes test data so rebuild takes time', async () => {
		await umbreld.vm.ssh('dd if=/dev/urandom of=~/test-data.bin bs=1M count=2000')
	})

	// --- Phase 2: Add devices for transition ---

	test('shuts down and adds three more HDDs (including one smaller drive)', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.addHdd({slot: 3})
		await umbreld.vm.addHdd({slot: 4})
		await umbreld.vm.addHdd({slot: 5, size: '500G'})
		await umbreld.vm.powerOn()
	})

	test('logs in after adding HDDs', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
	})

	test('detects all available HDDs for transition', async () => {
		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		const hdds = devices.filter((d) => d.type === 'hdd')
		expect(hdds).toHaveLength(5)

		const status = await umbreld.client.hardware.raid.getStatus.query()
		const poolDeviceIds = status.devices!.map((d) => d.id)
		const newHdds = hdds.filter((d) => !poolDeviceIds.includes(d.id!))
		expect(newHdds).toHaveLength(3)

		const smallHdd = newHdds.find((d) => d.size < 800_000_000_000)
		expect(smallHdd).toBeDefined()
		smallHddDeviceId = smallHdd!.id!

		const largeHdds = newHdds.filter((d) => d.id !== smallHddDeviceId)
		expect(largeHdds).toHaveLength(2)
		hddDeviceId3 = largeHdds[0].id!
		hddDeviceId4 = largeHdds[1].id!
	})

	// --- Phase 3: Transition validation ---

	test('rejects addMirror endpoint before mirror topology exists', async () => {
		await expect(
			umbreld.client.hardware.raid.addMirror.mutate({deviceIds: [hddDeviceId3, hddDeviceId4]}),
		).rejects.toThrow('addMirror is only supported for mirror failsafe mode')
	})

	test('rejects SSD raidz transition endpoint for HDD arrays', async () => {
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeRaidz.mutate({newDeviceId: hddDeviceId3}),
		).rejects.toThrow('transitionToFailsafeRaidz is only supported for SSD arrays')
	})

	test('rejects transition with wrong number of devices (1 instead of 2)', async () => {
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeMirror.mutate({
				pairs: [{existingDeviceId: hddDeviceId1, newDeviceId: hddDeviceId3}],
			}),
		).rejects.toThrow('Need exactly 2 mirror pair(s) to transition to failsafe mode')
	})

	test('rejects transition when an existing device in pairs is not in the RAID array', async () => {
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeMirror.mutate({
				pairs: [
					{existingDeviceId: hddDeviceId3, newDeviceId: hddDeviceId4},
					{existingDeviceId: hddDeviceId2, newDeviceId: hddDeviceId3},
				],
			}),
		).rejects.toThrow(`Device ${hddDeviceId3} is not in the RAID array`)
	})

	test('rejects transition with duplicate existing devices in pairs', async () => {
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeMirror.mutate({
				pairs: [
					{existingDeviceId: hddDeviceId1, newDeviceId: hddDeviceId3},
					{existingDeviceId: hddDeviceId1, newDeviceId: hddDeviceId4},
				],
			}),
		).rejects.toThrow(`Duplicate existing device in mirror pairs: ${hddDeviceId1}`)
	})

	test('rejects transition with duplicate new devices in pairs', async () => {
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeMirror.mutate({
				pairs: [
					{existingDeviceId: hddDeviceId1, newDeviceId: hddDeviceId3},
					{existingDeviceId: hddDeviceId2, newDeviceId: hddDeviceId3},
				],
			}),
		).rejects.toThrow(`Duplicate new device in mirror pairs: ${hddDeviceId3}`)
	})

	test('rejects transition when new device is already in the RAID array', async () => {
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeMirror.mutate({
				pairs: [
					{existingDeviceId: hddDeviceId1, newDeviceId: hddDeviceId2},
					{existingDeviceId: hddDeviceId2, newDeviceId: hddDeviceId3},
				],
			}),
		).rejects.toThrow('Cannot transition with a device that is already in the RAID array')
	})

	test('rejects transition when a new mirror device does not exist', async () => {
		const missingDeviceId = 'ata-missing-device-for-test'
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeMirror.mutate({
				pairs: [
					{existingDeviceId: hddDeviceId1, newDeviceId: missingDeviceId},
					{existingDeviceId: hddDeviceId2, newDeviceId: hddDeviceId3},
				],
			}),
		).rejects.toThrow(`Device not found: /dev/disk/by-umbrel-id/${missingDeviceId}`)
	})

	test('rejects transition when a new mirror device is smaller than its existing pair', async () => {
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeMirror.mutate({
				pairs: [
					{existingDeviceId: hddDeviceId1, newDeviceId: smallHddDeviceId},
					{existingDeviceId: hddDeviceId2, newDeviceId: hddDeviceId3},
				],
			}),
		).rejects.toThrow('Cannot transition with a device smaller than an existing device')
	})

	// --- Phase 4: Multi-disk transition to failsafe (mirrors) ---

	test('transitions 2-disk storage to failsafe with 2 new HDDs without rebooting', async () => {
		const pidBefore = umbreld.vm.pid

		transitionSubscription = umbreld.subscribeToEvents<FailsafeTransitionStatus>('raid:failsafe-transition-progress')

		const result = await umbreld.client.hardware.raid.transitionToFailsafeMirror.mutate({
			pairs: [
				{existingDeviceId: hddDeviceId1, newDeviceId: hddDeviceId3},
				{existingDeviceId: hddDeviceId2, newDeviceId: hddDeviceId4},
			],
		})
		expect(result).toBe(true)

		// Verify VM didn't reboot
		expect(umbreld.vm.pid).toBe(pidBefore)
	})

	test('reports mirror failsafe mode with all 4 devices', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(status.topology).toBe('mirror')
		expect(status.devices).toHaveLength(4)
		const deviceIds = status.devices!.map((d) => d.id).sort()
		expect(deviceIds).toEqual([hddDeviceId1, hddDeviceId2, hddDeviceId3, hddDeviceId4].sort())
	})

	test('preserves explicit mirror pair mapping in pool status output', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const actualPairs = (status.mirrors ?? [])
			.map((pair) => [...pair].sort())
			.sort((a, b) => a.join(',').localeCompare(b.join(',')))

		const expectedPairs = [[hddDeviceId1, hddDeviceId3].sort(), [hddDeviceId2, hddDeviceId4].sort()].sort((a, b) =>
			a.join(',').localeCompare(b.join(',')),
		)

		expect(actualPairs).toEqual(expectedPairs)
	})

	test('receives transition progress events and waits for completion', async () => {
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				if (status.failsafeTransitionStatus?.state === 'complete') return true
				if (!status.failsafeTransitionStatus && status.status === 'ONLINE') return true
				return false
			},
			{interval: 1000, timeout: 600_000},
		)

		transitionSubscription.unsubscribe()

		const events = transitionSubscription.collected
		expect(events.length).toBeGreaterThan(1)

		// Mirror transitions only have rebuilding and complete states
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
	})

	test('pool enters ONLINE state', async () => {
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.status === 'ONLINE'
			},
			{interval: 1000, timeout: 600_000},
		)
	})

	test('usable space is preserved after transition', async () => {
		// Mirrors maintain usable space — each existing stripe gets a mirror partner
		// so the same number of unique data vdevs still exist
		const status = await umbreld.client.hardware.raid.getStatus.query()
		// Allow some tolerance for ZFS overhead
		const ratio = status.usableSpace! / initialUsableSpace
		expect(ratio).toBeGreaterThan(0.9)
		expect(ratio).toBeLessThan(1.1)
	})

	test('marker directory still exists after transition', async () => {
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'multi-transition-marker')).toBe(true)
	})

	test('log all events', async () => {
		console.log('Transition events:', transitionSubscription.collected)
	})
})
