import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

let umbreld: Awaited<ReturnType<typeof createTestVm>>

beforeAll(async () => {
	umbreld = await createTestVm({device: 'umbrel-home'})
	await umbreld.vm.powerOn()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
})

describe('cpuTemperature', () => {
	// QEMU exposes no thermal sensors so the VM deterministically exercises the
	// unsupported branch (on real hardware this returns a number).
	test('should throw error if cpu temp is unsupported', async () => {
		await expect(umbreld.client.system.cpuTemperature.query()).rejects.toThrow('Could not get CPU temperature')
	})

	test('should be behind authentication', async () => {
		await expect(umbreld.unauthenticatedClient.system.cpuTemperature.query()).rejects.toThrow('Invalid token')
	})
})

describe('diskUsage', () => {
	test('should return disk usage', async () => {
		const result = await umbreld.client.system.diskUsage.query()
		expect(result.size).toBeTypeOf('number')
		expect(result.totalUsed).toBeTypeOf('number')
		expect(result.files).toBeTypeOf('number')
	})

	test('should be behind authentication', async () => {
		await expect(umbreld.unauthenticatedClient.system.diskUsage.query()).rejects.toThrow('Invalid token')
	})
})

describe('memoryUsage', () => {
	test('should return memory usage', async () => {
		const result = await umbreld.client.system.memoryUsage.query()
		expect(result.size).toBeTypeOf('number')
		expect(result.totalUsed).toBeTypeOf('number')
	})

	test('should be behind authentication', async () => {
		await expect(umbreld.unauthenticatedClient.system.memoryUsage.query()).rejects.toThrow('Invalid token')
	})
})

describe('power actions', () => {
	let failed = false

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('acknowledges restart through LAN ingress before rebooting', async () => {
		const bootIdBeforeRestart = (await umbreld.vm.ssh('cat /proc/sys/kernel/random/boot_id')).trim()
		await expect(umbreld.client.system.restart.mutate()).resolves.toBe(true)

		// The acknowledgement must not merely delay or prevent the requested reboot.
		await pWaitFor(
			async () => {
				try {
					await umbreld.unauthenticatedClient.user.exists.query()
					return false
				} catch {
					return true
				}
			},
			{interval: 100, timeout: 30_000},
		)
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
		const bootIdAfterRestart = (await umbreld.vm.ssh('cat /proc/sys/kernel/random/boot_id')).trim()
		expect(bootIdAfterRestart).not.toBe(bootIdBeforeRestart)
	})

	test('acknowledges shutdown through LAN ingress before powering off', async () => {
		await expect(umbreld.client.system.shutdown.mutate()).resolves.toBe(true)
		await umbreld.vm.waitForShutdown()
	})
})
