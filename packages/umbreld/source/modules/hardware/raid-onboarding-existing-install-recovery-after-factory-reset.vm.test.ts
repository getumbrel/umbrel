import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import {triggerFactoryReset} from '../test-utilities/rebooting-action.ts'

describe('RAID onboarding existing install recovery after factory reset', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstDeviceId: string
	let secondDeviceId: string
	let failed = false

	const markerPath = '/data/umbrel/home/raid-recovery-marker.txt'

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

	test('adds two NVMe devices and boots VM', async () => {
		await umbreld.vm.addNvme({slot: 1})
		await umbreld.vm.addNvme({slot: 2})
		await umbreld.vm.powerOn()
	})

	test('detects both NVMe devices', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.internalStorage.getDevices.query()
		expect(devices).toHaveLength(2)
		firstDeviceId = devices.find((d) => d.slot === 1)!.id!
		secondDeviceId = devices.find((d) => d.slot === 2)!.id!
	})

	test('registers user with failsafe RAID config', async () => {
		await umbreld.signup({raidDevices: [firstDeviceId, secondDeviceId], raidType: 'failsafe'})
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

	test('factory resets the install', async () => {
		await triggerFactoryReset(umbreld.client.system.factoryReset.mutate({password: 'moneyprintergobrrr'}))
	})

	test('boots into onboarding after factory reset', async () => {
		await pWaitFor(
			async () => {
				try {
					return !(await umbreld.unauthenticatedClient.user.exists.query())
				} catch {
					return false
				}
			},
			{interval: 2000, timeout: 600_000},
		)
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
		expect(status.status).toBe('ONLINE')
		expect(status.devices?.map((device) => device.id).sort()).toEqual([firstDeviceId, secondDeviceId].sort())

		const marker = await umbreld.vm.sshAsRoot(`cat ${markerPath}`)
		expect(marker.trim()).toBe('recovered')
	})
})
