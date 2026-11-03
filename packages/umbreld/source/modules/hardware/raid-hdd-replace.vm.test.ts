import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm, driveBuses} from '../test-utilities/create-test-umbreld.ts'
import type {ReplaceStatus} from './raid.ts'

async function waitForInitialRaidSetup(umbreld: Awaited<ReturnType<typeof createTestVm>>) {
	await pWaitFor(
		async () => {
			try {
				return await umbreld.unauthenticatedClient.hardware.raid.checkInitialRaidSetupStatus.query()
			} catch (error) {
				// Ignore connection errors while VM is rebooting
				if (error instanceof Error && error.message.includes('fetch failed')) return false
				// Rethrow server errors (e.g., initialRaidSetupError)
				throw error
			}
		},
		{interval: 2000, timeout: 600_000},
	)
}

// A failed HDD is pulled from its bay and a fresh drive goes in its place, the way a
// drive is replaced in a real NAS. The pool has to boot degraded with the member
// missing, resilver onto the new drive and keep importing with it across reboots.
describe.each(driveBuses)('RAID HDD failed drive replacement in failsafe mode (%s)', (bus) => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstHddId: string
	let secondHddId: string
	let replacementHddId: string
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

	test('boots a NAS VM with two HDD bays', async () => {
		await umbreld.vm.addHdd({slot: 1, bus})
		await umbreld.vm.addHdd({slot: 2, bus})
		await umbreld.vm.powerOn()
	})

	test('creates a FailSafe mirror on the HDDs (triggers reboot)', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		const hdds = devices.filter((device) => device.type === 'hdd' && device.transport === bus)
		expect(hdds).toHaveLength(2)
		;[firstHddId, secondHddId] = hdds.map((hdd) => hdd.id!)

		await umbreld.signup({raidDevices: [firstHddId, secondHddId], raidType: 'failsafe'})
		await waitForInitialRaidSetup(umbreld)
		await umbreld.login()

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.topology).toBe('mirror')
		expect(status.status).toBe('ONLINE')
	})

	test('creates marker directory to verify data consistency', async () => {
		await umbreld.client.files.createDirectory.mutate({path: '/Home/data-consistency-marker'})
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'data-consistency-marker')).toBe(true)
	})

	test('writes test data to ensure resilver takes time', async () => {
		// Write 2GB of random data so resilver takes long enough to capture progress
		await umbreld.vm.ssh('dd if=/dev/urandom of=~/test-data.bin bs=1M count=2000')
	})

	test('pulls the failed second drive, fits a fresh one in its bay and boots degraded', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.removeHdd({slot: 2, bus})
		await umbreld.vm.addHdd({slot: 2, bus})
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

	test('reports the missing member and detects the replacement drive', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		const missingMember = status.devices!.find((device) => device.id === secondHddId)
		expect(missingMember).toBeDefined()
		expect(missingMember!.status).not.toBe('ONLINE')

		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		const hdds = devices.filter((device) => device.type === 'hdd' && device.transport === bus)
		expect(hdds).toHaveLength(2)
		expect(hdds.some((device) => device.id === secondHddId)).toBe(false)
		const replacementHdd = hdds.find((device) => device.id !== firstHddId)
		expect(replacementHdd).toBeDefined()
		replacementHddId = replacementHdd!.id!
	})

	test('replaces the missing member with the new drive', async () => {
		replaceSubscription = umbreld.subscribeToEvents<ReplaceStatus>('raid:replace-progress')
		await replaceSubscription.started

		await umbreld.client.hardware.raid.replaceDevice.mutate({oldDevice: secondHddId, newDevice: replacementHddId})
	})

	test('waits for the resilver to complete', async () => {
		// Poll status endpoint while waiting, collecting replace status
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

	test('reports monotonic resilver progress that finishes at 100%', () => {
		for (const progress of [replaceSubscription.collected, replaceStatusCalls]) {
			expect(progress.length).toBeGreaterThan(1)
			for (const update of progress) expect(['rebuilding', 'finished', 'canceled']).toContain(update.state)

			// Progress only increases and we captured intermediate progress, not just the end state
			const percentages = progress.map((update) => update.progress)
			for (let i = 1; i < percentages.length; i++) expect(percentages[i]).toBeGreaterThanOrEqual(percentages[i - 1])
			expect(percentages.some((percentage) => percentage < 100)).toBe(true)

			const last = progress[progress.length - 1]
			expect(last.state).toBe('finished')
			expect(last.progress).toBe(100)
		}
	})

	test('reports an ONLINE mirror with the replacement drive', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.status).toBe('ONLINE')
		expect(status.devices!.map((device) => device.id).sort()).toEqual([firstHddId, replacementHddId].sort())
		expect(status.devices!.every((device) => device.status === 'ONLINE')).toBe(true)
	})

	test('imports the repaired pool with the replacement drive after a power cycle', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.status).toBe('ONLINE')
		expect(status.devices!.map((device) => device.id).sort()).toEqual([firstHddId, replacementHddId].sort())
	})

	test('marker directory still exists after replacement', async () => {
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'data-consistency-marker')).toBe(true)
	})
})

// Upgrading a storage mode pool to bigger drives one at a time, with both the old and the
// new drive connected during the swap.
describe.each(driveBuses)('RAID HDD storage mode replacement with a larger drive (%s)', (bus) => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstHddId: string
	let secondHddId: string
	let largerHddId: string
	let initialTotalSpace: number
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

	test('boots a NAS VM with two 500GB HDDs', async () => {
		await umbreld.vm.addHdd({slot: 1, size: '500G', bus})
		await umbreld.vm.addHdd({slot: 2, size: '500G', bus})
		await umbreld.vm.powerOn()
	})

	test('creates a storage mode pool on both HDDs (triggers reboot)', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		const hdds = devices.filter((device) => device.type === 'hdd' && device.transport === bus)
		expect(hdds).toHaveLength(2)
		;[firstHddId, secondHddId] = hdds.map((hdd) => hdd.id!)

		await umbreld.signup({raidDevices: [firstHddId, secondHddId], raidType: 'storage'})
		await waitForInitialRaidSetup(umbreld)
		await umbreld.login()

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		initialTotalSpace = status.totalSpace!
	})

	test('creates marker directory to verify data consistency', async () => {
		await umbreld.client.files.createDirectory.mutate({path: '/Home/data-consistency-marker'})
	})

	test('shuts down and adds a 1TB HDD in a third bay', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.addHdd({slot: 3, size: '1T', bus})
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		const largerHdd = devices.find((device) => device.id !== firstHddId && device.id !== secondHddId)
		expect(largerHdd?.type).toBe('hdd')
		expect(largerHdd?.transport).toBe(bus)
		largerHddId = largerHdd!.id!
	})

	test('replaces the second HDD with the larger HDD while both are online', async () => {
		await umbreld.client.hardware.raid.replaceDevice.mutate({oldDevice: secondHddId, newDevice: largerHddId})

		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.replace?.state === 'finished'
			},
			{interval: 1000, timeout: 600_000},
		)
	})

	test('pool contains the larger HDD and grew by the extra capacity', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.status).toBe('ONLINE')
		expect(status.devices!.map((device) => device.id).sort()).toEqual([firstHddId, largerHddId].sort())

		// Storage mode expands per disk, so 500GB + 500GB becomes 500GB + 1TB
		expect(status.totalSpace! / initialTotalSpace).toBeGreaterThan(1.4)
		expect(status.totalSpace! / initialTotalSpace).toBeLessThan(1.6)
	})

	test('marker directory still exists after the upgrade and a power cycle', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.status).toBe('ONLINE')
		expect(status.devices!.map((device) => device.id).sort()).toEqual([firstHddId, largerHddId].sort())
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'data-consistency-marker')).toBe(true)
	})
})
