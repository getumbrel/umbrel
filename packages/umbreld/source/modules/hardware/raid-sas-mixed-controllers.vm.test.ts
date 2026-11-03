import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

// A typical DIY NAS: a SAS HBA adds drive bays to the motherboard's own SATA ports, with
// HDDs and SSDs on both. A FailSafe mirror can pair drives across the two controllers,
// SSDs behind the HBA can be its accelerator, and the pool has to keep importing when
// drives are re-cabled to different HBA ports.
describe('RAID across SATA and SAS HBA controllers', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let sataHddId: string
	let sasHddIds: string[]
	let sasSsdIds: string[]
	let failed = false

	async function expectHealthyPool() {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.topology).toBe('mirror')
		expect(status.status).toBe('ONLINE')
		expect(status.devices!.map((device) => device.id).sort()).toEqual([sataHddId, ...sasHddIds].sort())
		expect(status.devices!.every((device) => device.status === 'ONLINE')).toBe(true)
		expect(status.accelerator?.exists).toBe(true)
		expect(status.accelerator!.devices!.map((device) => device.id).sort()).toEqual([...sasSsdIds].sort())
		return status
	}

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

	test('boots a NAS VM with a SATA HDD and HDDs and SSDs behind a SAS HBA', async () => {
		await umbreld.vm.addHdd({slot: 1})
		await umbreld.vm.addHdd({slot: 1, bus: 'sas'})
		await umbreld.vm.addHdd({slot: 2, bus: 'sas'})
		await umbreld.vm.addHdd({slot: 3, bus: 'sas'})
		await umbreld.vm.addSsd({slot: 4, size: '512G', bus: 'sas'})
		await umbreld.vm.addSsd({slot: 5, size: '512G', bus: 'sas'})
		await umbreld.vm.powerOn()
	})

	test('detects every drive with its controller and type', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		const sataHdds = devices.filter((device) => device.transport === 'sata' && device.type === 'hdd')
		const sasHdds = devices.filter((device) => device.transport === 'sas' && device.type === 'hdd')
		const sasSsds = devices.filter((device) => device.transport === 'sas' && device.type === 'ssd')
		expect(sataHdds).toHaveLength(1)
		expect(sasHdds).toHaveLength(3)
		expect(sasSsds).toHaveLength(2)

		sataHddId = sataHdds[0].id!
		sasHddIds = sasHdds.map((device) => device.id!)
		sasSsdIds = sasSsds.map((device) => device.id!)
		expect(new Set([sataHddId, ...sasHddIds, ...sasSsdIds]).size).toBe(6)
	})

	test('creates a FailSafe mirror pairing a SATA and a SAS HDD with a SAS SSD accelerator', async () => {
		await umbreld.signup({
			raidDevices: [sataHddId, sasHddIds[0]],
			raidType: 'failsafe',
			acceleratorDevices: sasSsdIds,
		})
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

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.status).toBe('ONLINE')
		expect(status.devices!.map((device) => device.id).sort()).toEqual([sataHddId, sasHddIds[0]].sort())
		expect(status.accelerator!.devices!.map((device) => device.id).sort()).toEqual([...sasSsdIds].sort())
	})

	test('creates marker directory to verify data consistency', async () => {
		await umbreld.client.files.createDirectory.mutate({path: '/Home/data-consistency-marker'})
	})

	test('expands the mirror with a pair of SAS HDDs', async () => {
		await umbreld.client.hardware.raid.addMirror.mutate({deviceIds: [sasHddIds[1], sasHddIds[2]]})

		const status = await expectHealthyPool()
		expect(status.devices).toHaveLength(4)
	})

	test('imports the whole pool after a power cycle', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		await expectHealthyPool()
	})

	test('imports the pool after drives are re-cabled to different HBA ports', async () => {
		// Kernel device names follow the port, the Umbrel IDs follow the drive
		await umbreld.vm.powerOff()
		await umbreld.vm.moveHdd({fromSlot: 1, toSlot: 7, bus: 'sas'})
		await umbreld.vm.moveHdd({fromSlot: 4, toSlot: 8, bus: 'sas'})
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		const status = await expectHealthyPool()
		const vdevs = await umbreld.vm.sshAsRoot(`zpool status -P ${status.name}`)
		for (const id of [sataHddId, ...sasHddIds, ...sasSsdIds])
			expect(vdevs).toContain(`/dev/disk/by-umbrel-id/${id}-part`)
	})

	test('marker directory survived the expansion, power cycle and re-cabling', async () => {
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		expect(listing.files.some((f) => f.name === 'data-consistency-marker')).toBe(true)
	})
})
