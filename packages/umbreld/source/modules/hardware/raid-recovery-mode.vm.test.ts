import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'
import {triggerFactoryReset, triggerRebootingAction} from '../test-utilities/rebooting-action.js'

describe('RAID mount failure detection', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let firstDeviceId: string
	let secondDeviceId: string
	let failed = false

	// After triggering a restart the old instance keeps answering until it
	// actually goes down, so a "wait for the API to come back" check can be
	// satisfied by the pre-restart instance. Wait for the API to disappear
	// first so the subsequent up-wait is guaranteed to see the new boot.
	async function waitForApiToGoDown() {
		await pWaitFor(
			async () => {
				try {
					await umbreld.unauthenticatedClient.system.status.query()
					return false
				} catch {
					return true
				}
			},
			{interval: 100, timeout: 60_000},
		)
	}

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

	test('registers user with storage RAID using both devices', async () => {
		await umbreld.signup({raidDevices: [firstDeviceId, secondDeviceId], raidType: 'storage'})
	})

	test('waits for RAID setup to complete', async () => {
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

	test('confirms RAID is online with both devices', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.raidType).toBe('storage')
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(2)
	})

	test('checkRaidMountFailure returns false when RAID is healthy', async () => {
		const failure = await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailure.query()
		expect(failure).toBe(false)
	})

	// Disconnect one SSD and verify mount failure detection
	test('powers off and disconnects one SSD', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.disconnectNvme({slot: 2})
		await umbreld.vm.powerOn()
	})

	test('checkRaidMountFailure returns true with one SSD disconnected', async () => {
		await umbreld.waitForStartup({waitForUser: false})
		const failure = await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailure.query()
		expect(failure).toBe(true)
	})

	test('checkRaidMountFailureDevices returns expected device status with one SSD disconnected', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailureDevices.query()
		expect(devices).toHaveLength(2)
		const firstDevice = devices.find((d) => d.name.includes(firstDeviceId))
		const secondDevice = devices.find((d) => d.name.includes(secondDeviceId))
		expect(firstDevice?.isOk).toBe(true)
		expect(secondDevice?.isOk).toBe(false)
	})

	// Disconnect both SSDs and verify mount failure detection
	test('powers off and disconnects remaining SSD', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.disconnectNvme({slot: 1})
		await umbreld.vm.powerOn()
	})

	test('checkRaidMountFailure returns true with both SSDs disconnected', async () => {
		await umbreld.waitForStartup({waitForUser: false})
		const failure = await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailure.query()
		expect(failure).toBe(true)
	})

	test('checkRaidMountFailureDevices returns expected device status with both SSDs disconnected', async () => {
		const devices = await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailureDevices.query()
		expect(devices).toHaveLength(2)
		expect(devices.every((d) => d.isOk === false)).toBe(true)
	})

	test('keeps the config partition read-only after the mount failure', async () => {
		// Rugix records the mount failure on the config partition, which also holds
		// the RAID config, and must leave it read-only again
		const options = await umbreld.vm.sshAsRoot('findmnt --noheadings --output OPTIONS /run/rugix/mounts/config')
		expect(options.split(',')).toContain('ro')
	})

	// Reconnect both SSDs and verify recovery
	test('powers off and reconnects both SSDs', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.connectNvme({slot: 1})
		await umbreld.vm.connectNvme({slot: 2})
		await umbreld.vm.powerOn()
	})

	test('checkRaidMountFailure returns false after reconnecting SSDs', async () => {
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
		const failure = await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailure.query()
		expect(failure).toBe(false)
	})

	test('RAID is back online after reconnecting SSDs', async () => {
		const status = await umbreld.client.hardware.raid.getStatus.query()
		expect(status.exists).toBe(true)
		expect(status.status).toBe('ONLINE')
		expect(status.devices).toHaveLength(2)
	})

	// Test recovery mode operations
	test('powers off and disconnects one SSD to enter recovery mode', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.disconnectNvme({slot: 2})
		await umbreld.vm.powerOn()
	})

	test('confirms we are in recovery mode', async () => {
		await umbreld.waitForStartup({waitForUser: false})
		const failure = await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailure.query()
		expect(failure).toBe(true)
	})

	test('can shutdown from recovery mode', async () => {
		await triggerRebootingAction(umbreld.unauthenticatedClient.system.shutdown.mutate(), ['poweroff'])
		await umbreld.vm.waitForShutdown()
	})

	test('powers on after shutdown test', async () => {
		await umbreld.vm.powerOn()
		await umbreld.waitForStartup({waitForUser: false})
		const failure = await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailure.query()
		expect(failure).toBe(true)
	})

	test('can restart from recovery mode', async () => {
		await triggerRebootingAction(umbreld.unauthenticatedClient.system.restart.mutate())
		await waitForApiToGoDown()
		// Wait for VM to restart and come back up
		await pWaitFor(
			async () => {
				const status = await umbreld.unauthenticatedClient.system.status.query().catch(() => '')
				return status === 'running'
			},
			{interval: 1000, timeout: 600_000},
		)
		const failure = await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailure.query()
		expect(failure).toBe(true)
	})

	test('can factory reset from recovery mode', async () => {
		// Factory reset triggers a reboot
		await triggerFactoryReset(umbreld.unauthenticatedClient.system.factoryReset.mutate({}))

		// Wait for VM to come back up after factory reset
		await pWaitFor(
			async () => {
				const status = await umbreld.unauthenticatedClient.system.status.query().catch(() => '')
				return status === 'running'
			},
			{interval: 1000, timeout: 600_000},
		)

		// Verify user no longer exists after factory reset. The API can come
		// back up before umbreld has finished resetting state, so poll until
		// the reset has settled and then assert the final state.
		await pWaitFor(
			async () => {
				try {
					return !(await umbreld.unauthenticatedClient.user.exists.query())
				} catch {
					return false
				}
			},
			{interval: 1000, timeout: 600_000},
		)
		expect(await umbreld.unauthenticatedClient.user.exists.query()).toBe(false)

		// Verify mount failure is false (no RAID config to fail), again polling
		// until the freshly reset state is reflected
		await pWaitFor(
			async () => {
				try {
					return !(await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailure.query())
				} catch {
					return false
				}
			},
			{interval: 1000, timeout: 120_000},
		)
		expect(await umbreld.unauthenticatedClient.hardware.raid.checkRaidMountFailure.query()).toBe(false)
	})
})
