import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm, raidzDrives} from '../test-utilities/create-test-umbreld.ts'

// The array's drive type used to be read from its first drive, so when that was the drive that had
// failed and been pulled out, nothing could be checked against it and its replacement was refused
describe.each(raidzDrives)('RAID replacement of a missing first drive ($name)', (drive) => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstDeviceId: string
	let secondDeviceId: string
	let replacementDeviceId: string
	let failed = false

	beforeAll(async () => {
		umbreld = await createTestVm({device: drive.device})
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

	test('sets up a two-drive failsafe array (triggers reboot)', async () => {
		await drive.add(umbreld.vm, {slot: 1})
		await drive.add(umbreld.vm, {slot: 2})
		await umbreld.vm.powerOn()

		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		firstDeviceId = devices.find(drive.inSlot(1))!.id!
		secondDeviceId = devices.find(drive.inSlot(2))!.id!

		await umbreld.signup({
			raidDevices: [firstDeviceId, secondDeviceId],
			raidType: 'failsafe',
			failsafeLayout: drive.failsafeLayout,
		})
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

		// The drive in slot 1 is the array's first
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.devices![0].id).toBe(firstDeviceId)
	})

	test('writes data with a checksum', async () => {
		await umbreld.vm.ssh('dd if=/dev/urandom of=~/data.bin bs=1M count=1000 && sha256sum ~/data.bin > ~/data.sha256')
	})

	test('pulls the first drive and fits a new one', async () => {
		await umbreld.vm.powerOff()
		await drive.remove(umbreld.vm, {slot: 1})
		await drive.add(umbreld.vm, {slot: 3})
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		const devices = await umbreld.client.hardware.internalStorage.getDevices.query()
		expect(devices.find((device) => device.id === firstDeviceId)).toBeUndefined()
		replacementDeviceId = devices.find(drive.inSlot(3))!.id!

		await pWaitFor(async () => (await umbreld.client.hardware.raid.getStatus.query()).status === 'DEGRADED', {
			interval: 1000,
			timeout: 60_000,
		})
	})

	test('replaces the missing first drive with the new one', async () => {
		await umbreld.client.hardware.raid.replaceDevice.mutate({oldDevice: firstDeviceId, newDevice: replacementDeviceId})
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.status === 'ONLINE' && !status.devices!.some((device) => device.id === firstDeviceId)
			},
			{interval: 1000, timeout: 300_000},
		)

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.devices!.map((device) => device.id).sort()).toEqual([replacementDeviceId, secondDeviceId].sort())
		expect(status.devices!.every((device) => device.status === 'ONLINE')).toBe(true)
		expect(await umbreld.vm.ssh('sha256sum --check ~/data.sha256')).toContain(': OK')
	})
})
