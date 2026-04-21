import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

const expectedSingleAcceleratorL2arcSizeGb = 10
const expectedSingleAcceleratorSpecialSizeGb = 490
const expectedStripedAcceleratorL2arcSizeGb = 20
const expectedMirroredAcceleratorSpecialSizeGb = 490

function expectSizeToBeWithinTenPercentOfGb(actualBytes: number | undefined, expectedGb: number) {
	expect(actualBytes).toBeDefined()
	const actualGb = actualBytes! / 1_000_000_000
	expect(actualGb).toBeGreaterThanOrEqual(expectedGb * 0.9)
	expect(actualGb).toBeLessThanOrEqual(expectedGb * 1.1)
}

describe('RAID HDD accelerator from storage mode to failsafe transition', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let hddDeviceId1: string
	let hddDeviceId2: string
	let acceleratorDeviceId1: string
	let acceleratorDeviceId2: string
	let tooSmallAcceleratorDeviceId: string
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

	test('adds two HDDs and three NVMe SSDs and boots VM', async () => {
		await umbreld.vm.addHdd({slot: 1})
		await umbreld.vm.addHdd({slot: 2})
		await umbreld.vm.addNvme({slot: 1, size: '512G'})
		await umbreld.vm.addNvme({slot: 2, size: '500G'})
		await umbreld.vm.addNvme({slot: 3, size: '128G'})
		await umbreld.vm.powerOn()
	})

	test('detects HDD and SSD devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		const hdds = devices.filter((device) => device.type === 'hdd')
		const ssds = devices.filter((device) => device.type === 'ssd')

		expect(hdds).toHaveLength(2)
		expect(ssds).toHaveLength(3)

		hddDeviceId1 = hdds[0].id!
		hddDeviceId2 = hdds[1].id!
		acceleratorDeviceId1 = ssds[0].id!
		acceleratorDeviceId2 = ssds[1].id!
		tooSmallAcceleratorDeviceId = ssds[2].id!
	})

	test('registers user with single HDD storage config', async () => {
		await umbreld.signup({raidDevices: [hddDeviceId1], raidType: 'storage'})
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

	test('reports accelerator exists as false before accelerator setup', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.accelerator).toMatchObject({exists: false})
	})

	test('rejects supplying an accelerator mirror SSD when no accelerator exists', async () => {
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeMirror.mutate({
				pairs: [{existingDeviceId: hddDeviceId1, newDeviceId: hddDeviceId2}],
				acceleratorDeviceId: acceleratorDeviceId2,
			}),
		).rejects.toThrow('Cannot supply an accelerator mirror SSD when no accelerator exists')
	})

	test('adds a single SSD accelerator', async () => {
		await umbreld.client.hardware.raid.addAccelerator.mutate({deviceIds: [acceleratorDeviceId1]})
	})

	test('reports accelerator separately from RAID data devices', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.devices).toHaveLength(1)
		expect(status.devices![0].id).toBe(hddDeviceId1)
		expect(status.accelerator).toMatchObject({exists: true})
		expect(status.accelerator?.devices).toHaveLength(1)
		expect(status.accelerator?.devices?.[0]).toMatchObject({id: acceleratorDeviceId1})
		expect(status.accelerator?.devices?.[0]).toHaveProperty('status')
		expectSizeToBeWithinTenPercentOfGb(status.accelerator?.l2arcSize, expectedSingleAcceleratorL2arcSizeGb)
		expectSizeToBeWithinTenPercentOfGb(status.accelerator?.specialSize, expectedSingleAcceleratorSpecialSizeGb)
	})

	test('rejects transition without supplying an accelerator mirror SSD', async () => {
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeMirror.mutate({
				pairs: [{existingDeviceId: hddDeviceId1, newDeviceId: hddDeviceId2}],
			}),
		).rejects.toThrow('Transitioning to failsafe with an accelerator requires an additional SSD')
	})

	test('rejects reusing a RAID device as the accelerator mirror', async () => {
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeMirror.mutate({
				pairs: [{existingDeviceId: hddDeviceId1, newDeviceId: hddDeviceId2}],
				acceleratorDeviceId: hddDeviceId2,
			}),
		).rejects.toThrow('Cannot reuse a RAID device as the accelerator mirror')
	})

	test('rejects a smaller accelerator mirror SSD', async () => {
		await expect(
			umbreld.client.hardware.raid.transitionToFailsafeMirror.mutate({
				pairs: [{existingDeviceId: hddDeviceId1, newDeviceId: hddDeviceId2}],
				acceleratorDeviceId: tooSmallAcceleratorDeviceId,
			}),
		).rejects.toThrow('Cannot transition with an accelerator device smaller than the existing accelerator')
	})

	test('transitions to failsafe with an accelerator mirror SSD', async () => {
		await umbreld.client.hardware.raid.transitionToFailsafeMirror.mutate({
			pairs: [{existingDeviceId: hddDeviceId1, newDeviceId: hddDeviceId2}],
			acceleratorDeviceId: acceleratorDeviceId2,
		})
	})

	test('reports striped l2arc and mirrored special after the transition', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.topology).toBe('mirror')
		expect(status.devices).toHaveLength(2)
		expect(status.accelerator).toMatchObject({exists: true})
		expect(status.accelerator?.devices).toHaveLength(2)

		const acceleratorIds = status.accelerator!.devices!.map((device) => device.id).sort()
		expect(acceleratorIds).toEqual([acceleratorDeviceId1, acceleratorDeviceId2].sort())
		expectSizeToBeWithinTenPercentOfGb(status.accelerator?.l2arcSize, expectedStripedAcceleratorL2arcSizeGb)
		expectSizeToBeWithinTenPercentOfGb(status.accelerator?.specialSize, expectedMirroredAcceleratorSpecialSizeGb)
	})
})
