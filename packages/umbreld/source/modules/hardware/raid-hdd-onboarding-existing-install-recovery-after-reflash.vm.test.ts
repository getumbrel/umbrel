import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm, driveBuses} from '../test-utilities/create-test-umbreld.ts'

// Reinstalling umbrelOS on the boot disk must find the HDD pool left in the drive bays and
// offer to recover it, even with one mirror member missing.
describe.each(driveBuses)('Degraded HDD RAID onboarding recovery after boot disk reflash (%s)', (bus) => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstHddId: string
	let secondHddId: string
	let failed = false

	const markerPath = '/data/umbrel/home/raid-recovery-marker.txt'

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
		await umbreld.vm.disconnectHdd({slot: 2, bus})
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
		expect(status.status).toBe('DEGRADED')
		expect(status.devices?.map((device) => device.id).sort()).toEqual([firstHddId, secondHddId].sort())

		const marker = await umbreld.vm.sshAsRoot(`cat ${markerPath}`)
		expect(marker.trim()).toBe('recovered')
	})

	test('the reconnected member rejoins the recovered pool', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.connectHdd({slot: 2, bus})
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()

		await pWaitFor(
			async () => {
				const status = await umbreld.client.hardware.raid.getStatus.query()
				return status.status === 'ONLINE'
			},
			{interval: 1000, timeout: 120_000},
		)
	})
})
