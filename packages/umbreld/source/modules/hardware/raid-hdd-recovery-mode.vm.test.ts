import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm, driveBuses} from '../test-utilities/create-test-umbreld.ts'

// The data mount runs at early boot, after the initramfs and before systemd starts, so HDDs
// in drive bays (including those behind a SAS HBA, whose driver has to come up in the
// initramfs) must be found and imported before the root overlay is set up. A storage mode
// pool with a missing member can't be imported and has to land in recovery mode rather
// than booting without data.
describe.each(driveBuses)('RAID HDD mount failure detection (%s)', (bus) => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstHddId: string
	let secondHddId: string
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

	test('creates a storage mode pool on both HDDs (triggers reboot)', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		const hdds = devices.filter((device) => device.type === 'hdd' && device.transport === bus)
		expect(hdds).toHaveLength(2)
		;[firstHddId, secondHddId] = hdds.map((hdd) => hdd.id!)

		await umbreld.signup({raidDevices: [firstHddId, secondHddId], raidType: 'storage'})
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

	test('imports the pool at boot and reports no mount failure', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices!.map((device) => device.id).sort()).toEqual([firstHddId, secondHddId].sort())

		// The pool was imported through Umbrel's stable ID namespace
		const vdevs = await umbreld.vm.sshAsRoot(`zpool status -P ${status.name}`)
		expect(vdevs).toContain(`/dev/disk/by-umbrel-id/${firstHddId}-part`)
		expect(vdevs).toContain(`/dev/disk/by-umbrel-id/${secondHddId}-part`)

		expect(await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailure.query()).toBe(false)
	})

	test('boots into recovery mode with one HDD disconnected', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.disconnectHdd({slot: 2, bus})
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: false})

		expect(await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailure.query()).toBe(true)
	})

	test('reports exactly which HDD is missing', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailureDevices.query()
		expect(devices).toHaveLength(2)
		expect(devices.find((device) => device.name.includes(firstHddId))?.isOk).toBe(true)
		expect(devices.find((device) => device.name.includes(secondHddId))?.isOk).toBe(false)
	})

	test('reports both HDDs missing with both disconnected', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.disconnectHdd({slot: 1, bus})
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: false})

		expect(await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailure.query()).toBe(true)
		const devices = await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailureDevices.query()
		expect(devices).toHaveLength(2)
		expect(devices.every((device) => device.isOk === false)).toBe(true)
	})

	test('mounts the pool again once both HDDs are reconnected', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.connectHdd({slot: 1, bus})
		await umbreld.vm.connectHdd({slot: 2, bus})
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		expect(await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailure.query()).toBe(false)
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.status).toBe('ONLINE')
		expect(status.devices!.map((device) => device.id).sort()).toEqual([firstHddId, secondHddId].sort())
	})
})
