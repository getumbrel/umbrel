import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm, raidzDrives} from '../test-utilities/create-test-umbreld.ts'

describe.each(raidzDrives)('Degraded RAID onboarding recovery after boot disk reflash ($name)', (drive) => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstDeviceId: string
	let secondDeviceId: string
	let failed = false

	const markerPath = '/data/umbrel/home/raid-recovery-marker.txt'

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

	test('adds two NVMe devices and boots VM', async () => {
		await drive.add(umbreld.vm, {slot: 1})
		await drive.add(umbreld.vm, {slot: 2})
		await umbreld.vm.powerOn()
	})

	test('detects both NVMe devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(2)
		firstDeviceId = devices.find(drive.inSlot(1))!.id!
		secondDeviceId = devices.find(drive.inSlot(2))!.id!
	})

	test('registers user with failsafe RAID config', async () => {
		await umbreld.signup({
			raidDevices: [firstDeviceId, secondDeviceId],
			raidType: 'failsafe',
			failsafeLayout: drive.failsafeLayout,
		})
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

	test('creates a marker file on the RAID filesystem', async () => {
		await umbreld.vm.sshAsRoot(`mkdir -p /data/umbrel/home && echo recovered > ${markerPath}`)
		const marker = await umbreld.vm.sshAsRoot(`cat ${markerPath}`)
		expect(marker.trim()).toBe('recovered')
	})

	test('reflashes the boot disk with one RAID member disconnected', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.reflash()
		await drive.disconnect(umbreld.vm, {slot: 2})
		await umbreld.vm.powerOn()
	})

	test('boots into onboarding after reflash', async () => {
		await umbreld.waitForStartup({waitForUser: false})
		const userExists = await umbreld.unauthenticatedClient.user.exists.query()
		expect(userExists).toBe(false)
	})

	test('previous RAID install is degraded but still importable', async () => {
		const importablePools = await umbreld.vm.sshAsRoot('zpool import -d /dev/disk/by-umbrel-id')
		expect(importablePools).toContain('state: DEGRADED')
	})

	test('detects a recoverable previous RAID install', async () => {
		const hasRecoverableInstall = await umbreld.unauthenticatedClient.hardware.raid.hasRecoverableInstall.query()
		expect(hasRecoverableInstall).toBe(true)
	})

	test('recovers the previous RAID install and reboots', async () => {
		const recovered = await umbreld.unauthenticatedClient.hardware.raid.recoverExistingInstall.mutate()
		expect(recovered).toBe(true)

		await umbreld.waitForStartup({waitForUser: true})
	})

	test('logs into the recovered install and finds the marker file', async () => {
		await umbreld.login()

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('failsafe')
		expect(status.topology).toBe('raidz')
		expect(status.status).toBe('DEGRADED')
		expect(status.devices?.map((device) => device.id).sort()).toEqual([firstDeviceId, secondDeviceId].sort())

		const marker = await umbreld.vm.sshAsRoot(`cat ${markerPath}`)
		expect(marker.trim()).toBe('recovered')
	})
})
