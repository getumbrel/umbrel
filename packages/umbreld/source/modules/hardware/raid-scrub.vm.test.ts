import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import type {ScrubStatus} from './raid.ts'

describe('RAID scrub', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let deviceId: string
	let additionDeviceId: string
	let replacementDeviceId: string
	let scrubSubscription: ReturnType<typeof umbreld.subscribeToEvents<ScrubStatus>>
	const scrubStatusCalls: ScrubStatus[] = []
	let failed = false

	beforeAll(async () => {
		umbreld = await createTestVm()
	})

	afterAll(async () => {
		scrubSubscription?.unsubscribe()
		await umbreld?.cleanup()
	})

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('adds three NVMe devices and boots the VM', async () => {
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.addNvme({slot: 3})
		await umbreld.vm.powerOn()
	})

	test('detects all three NVMe devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(3)
		deviceId = devices.find((device) => device.slot === 1)!.id!
		additionDeviceId = devices.find((device) => device.slot === 2)!.id!
		replacementDeviceId = devices.find((device) => device.slot === 3)!.id!
		expect(deviceId).toBeDefined()
		expect(additionDeviceId).toBeDefined()
		expect(replacementDeviceId).toBeDefined()
	})

	test('registers with a storage pool and waits for setup', async () => {
		await umbreld.signup({raidDevices: [deviceId], raidType: 'storage'})

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

	test('does not scrub immediately when Umbreld starts', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.scrub).toBeUndefined()
	})

	test('stores the scrub schedule in Umbreld data instead of the boot RAID config', async () => {
		const store = await umbreld.vm.ssh('cat /home/umbrel/umbrel/umbrel.yaml')
		const bootConfig = await umbreld.vm.ssh('cat /run/rugix/mounts/config/umbrel.yaml')

		expect(store).toMatch(/nextScrubAt: \d+/)
		expect(bootConfig).not.toContain('nextScrubAt')
	})

	test('keeps the manual scrub mutation private', async () => {
		await expect(umbreld.unauthenticatedClient.hardware.raid.scrub.mutate()).rejects.toThrow('Invalid token')
	})

	test('rejects a scrub while an add-device request is still preparing the pool', async () => {
		const addition = umbreld.client.hardware.raid.addDevice.mutate({deviceId: additionDeviceId})

		// Let the add request reach Umbreld while it is still validating and
		// partitioning the new device. The pool reservation is acquired before this
		// asynchronous work, so the reverse ordering cannot race into a scrub.
		await new Promise((resolve) => setTimeout(resolve, 100))
		await expect(umbreld.client.hardware.raid.scrub.mutate()).rejects.toThrow(
			'Cannot start a RAID scrub while RAID device addition is in progress',
		)
		await expect(addition).resolves.toBe(true)

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.devices).toHaveLength(2)
		expect(status.scrub).toBeUndefined()
	})

	test('writes enough data to observe scrub progress', async () => {
		await umbreld.vm.ssh('dd if=/dev/urandom of=~/scrub-test-data.bin bs=1M count=2000 conv=fsync status=none')
	})

	test('starts a scrub through tRPC', async () => {
		scrubSubscription = umbreld.subscribeToEvents<ScrubStatus>('raid:scrub-progress')
		await scrubSubscription.started

		await expect(umbreld.client.hardware.raid.scrub.mutate()).resolves.toBe(true)
	})

	test('prevents conflicting storage operations while the scrub runs', async () => {
		await expect(umbreld.client.hardware.raid.scrub.mutate()).rejects.toThrow('A RAID scrub is already in progress')
		await expect(umbreld.client.hardware.raid.addDevice.mutate({deviceId: replacementDeviceId})).rejects.toThrow(
			'Cannot add a RAID device while a RAID scrub is in progress',
		)

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.devices).toHaveLength(2)
		expect(status.scrub?.state).toBe('scrubbing')
	})

	test('reports scrub progress through status and events until completion', async () => {
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				if (status.scrub) scrubStatusCalls.push(status.scrub)

				const statusFinished = status.scrub?.state === 'finished'
				const eventFinished = scrubSubscription.collected.some((event) => event.state === 'finished')
				return statusFinished && eventFinished
			},
			{interval: 1000, timeout: 600_000},
		)

		scrubSubscription.unsubscribe()
	})

	test('emits monotonic scrub progress and the final result', () => {
		const events = scrubSubscription.collected
		expect(events.length).toBeGreaterThan(1)

		for (const event of events) {
			expect(['scrubbing', 'finished', 'canceled']).toContain(event.state)
			expect(event.progress).toBeGreaterThanOrEqual(0)
			expect(event.progress).toBeLessThanOrEqual(100)
			expect(event.errors).toBe(0)
		}

		const progress = events.map((event) => event.progress)
		for (let index = 1; index < progress.length; index++) {
			expect(progress[index]).toBeGreaterThanOrEqual(progress[index - 1])
		}

		expect(events.some((event) => event.state === 'scrubbing' && event.progress < 100)).toBe(true)
		expect(events.at(-1)).toEqual({state: 'finished', progress: 100, errors: 0})
	})

	test('retains the completed scrub result in RAID status', async () => {
		expect(scrubStatusCalls.some((status) => status.state === 'scrubbing')).toBe(true)

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.scrub).toEqual({state: 'finished', progress: 100, errors: 0})
	})

	test('lets an urgent device replacement preempt a scrub', async () => {
		scrubSubscription = umbreld.subscribeToEvents<ScrubStatus>('raid:scrub-progress')
		await scrubSubscription.started

		await expect(umbreld.client.hardware.raid.scrub.mutate()).resolves.toBe(true)
		await pWaitFor(async () => (await umbreld.client.hardware.raid.getStatus.query()).scrub?.state === 'scrubbing', {
			interval: 250,
			timeout: 30_000,
		})

		await expect(
			umbreld.client.hardware.raid.replaceDevice.mutate({oldDevice: deviceId, newDevice: replacementDeviceId}),
		).resolves.toBe(true)
		await pWaitFor(() => scrubSubscription.collected.some((event) => event.state === 'canceled'), {
			interval: 100,
			timeout: 10_000,
		})

		expect(scrubSubscription.collected.at(-1)).toMatchObject({state: 'canceled'})
		scrubSubscription.unsubscribe()
	})
})
