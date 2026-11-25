import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

// ZFS debugging switch that stops a rebuild from making progress, so there's one that is reliably still
// running for as long as the test needs it
const suspendRebuildProgress = '/sys/module/zfs/parameters/zfs_scan_suspend_progress'

// umbreld only remembered a running replacement in memory, so after a restart it let a second one start
// while ZFS was still rebuilding the first
describe('RAID replacement while another replacement is rebuilding', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let deviceIds: string[]
	let failed = false

	const replaceSecondDevice = () =>
		umbreld.client.hardware.raid.replaceDevice.mutate({oldDevice: deviceIds[1], newDevice: deviceIds[3]})

	const waitForHealthyArray = () =>
		pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.status === 'ONLINE' && status.rebuild?.state !== 'rebuilding' && status.devices!.length === 2
			},
			{interval: 1000, timeout: 300_000},
		)

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

	test('sets up a two-SSD failsafe array with two spare SSDs fitted (triggers reboot)', async () => {
		for (const slot of [1, 2, 3, 4]) await umbreld.vm.addNvme({slot})
		await umbreld.vm.powerOn()

		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		deviceIds = [1, 2, 3, 4].map((slot) => devices.find((device) => device.slot === slot)!.id!)

		await umbreld.signup({raidDevices: [deviceIds[0], deviceIds[1]], raidType: 'failsafe'})
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

	test('writes data with a checksum', async () => {
		await umbreld.vm.ssh('dd if=/dev/urandom of=~/data.bin bs=1M count=1000 && sha256sum ~/data.bin > ~/data.sha256')
	})

	test('starts replacing the first SSD and holds its rebuild', async () => {
		await umbreld.vm.sshAsRoot(`echo 1 > ${suspendRebuildProgress}`)
		await umbreld.client.hardware.raid.replaceDevice.mutate({oldDevice: deviceIds[0], newDevice: deviceIds[2]})
		await pWaitFor(async () => (await umbreld.client.hardware.raid.getStatus.query()).rebuild?.state === 'rebuilding', {
			interval: 1000,
			timeout: 60_000,
		})
	})

	test('refuses a second replacement while the first is rebuilding', async () => {
		await expect(replaceSecondDevice()).rejects.toThrow('Already replacing device')
	})

	test('still refuses it after umbreld has restarted', async () => {
		await umbreld.vm.sshAsRoot('systemctl restart umbrel')
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.rebuild?.state).toBe('rebuilding')
		await expect(replaceSecondDevice()).rejects.toThrow('Cannot replace a device while a RAID rebuild is in progress')

		// Only the first replacement is underway
		const zpoolStatus = await umbreld.vm.sshAsRoot(`zpool status -P ${status.name}`)
		expect(zpoolStatus.match(/^\s+replacing-\d+/gm)).toHaveLength(1)
		expect(zpoolStatus).not.toContain(deviceIds[3])
	})

	test('finishes the first replacement once the rebuild can make progress', async () => {
		await umbreld.vm.sshAsRoot(`echo 0 > ${suspendRebuildProgress}`)
		await waitForHealthyArray()

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.devices!.map((device) => device.id).sort()).toEqual([deviceIds[1], deviceIds[2]].sort())
	})

	test('accepts the second replacement now the rebuild has finished', async () => {
		await replaceSecondDevice()
		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return !status.devices!.some((device) => device.id === deviceIds[1])
			},
			{interval: 1000, timeout: 300_000},
		)
		await waitForHealthyArray()

		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.raidType).toBe('failsafe')
		expect(status.devices!.map((device) => device.id).sort()).toEqual([deviceIds[2], deviceIds[3]].sort())
		expect(status.devices!.every((device) => device.status === 'ONLINE')).toBe(true)
		expect(await umbreld.vm.ssh('sha256sum --check ~/data.sha256')).toContain(': OK')
	})
})
