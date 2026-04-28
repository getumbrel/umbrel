import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pRetry from 'p-retry'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

describe('Static IP configuration', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false
	let interfaceMac: string

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
	})

	afterAll(async () => await umbreld?.cleanup())

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('getNetworkInterfaces() returns the VM ethernet interface with DHCP', async () => {
		const interfaces = await umbreld.client.system.getNetworkInterfaces.query()

		// The VM has a single physical ethernet interface
		expect(interfaces).toHaveLength(1)
		const iface = interfaces[0]
		interfaceMac = iface.mac

		expect(iface.type).toBe('ethernet')
		expect(iface.mac).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/)
		expect(iface.connected).toBe(true)
		expect(iface.ipMethod).toBe('dhcp')
		expect(iface.configuredStaticSettings).toBeUndefined()
		expect(iface.ip).toBeDefined()
		expect(iface.subnetPrefix).toBeTypeOf('number')
		expect(iface.gateway).toBeDefined()
		expect(iface.dns).toBeInstanceOf(Array)
		expect(iface.dns!.length).toBeGreaterThan(0)
	})

	test('switching to a static IP is reflected in getNetworkInterfaces()', async () => {
		const before = (await umbreld.client.system.getNetworkInterfaces.query()).find((i) => i.mac === interfaceMac)!
		// Re-apply the same DHCP-assigned values as a static config so the IP
		// doesn't change, keeping QEMU port forwarding intact
		const {ip, subnetPrefix, gateway, dns} = before

		const setStaticIpPromise = umbreld.client.system.setStaticIp.mutate({
			mac: before.mac,
			ip: ip!,
			subnetPrefix: subnetPrefix!,
			gateway: gateway!,
			dns: dns!,
		})

		await new Promise((resolve) => setTimeout(resolve, 2000)) // Give the mutation a moment to trigger the network change

		// Wait for the connection to re-establish after down/up
		let after!: Awaited<ReturnType<typeof umbreld.client.system.getNetworkInterfaces.query>>[number]
		await pWaitFor(
			async () => {
				try {
					const iface = (await umbreld.client.system.getNetworkInterfaces.query()).find((i) => i.mac === interfaceMac)
					if (iface?.connected && iface.ip) {
						after = iface
						return true
					}
					return false
				} catch {
					return false
				}
			},
			{interval: 100, timeout: 5000},
		)

		// Settings should not be persisted until the client confirms the change worked
		expect(after.configuredStaticSettings).toBeUndefined()

		// Confirm the static IP change
		await umbreld.client.system.confirmStaticIp.mutate({ip: ip!})

		// Wait for the set job to resolve (it was waiting fro the confirmation)
		await setStaticIpPromise
		after = (await umbreld.client.system.getNetworkInterfaces.query()).find((i) => i.mac === interfaceMac)!

		// Only the method should change, everything else stays the same
		expect(after.ipMethod).toBe('static')
		expect(after.configuredStaticSettings).toEqual({ip, subnetPrefix, gateway, dns})
		expect(after.ip).toBe(ip)
		expect(after.subnetPrefix).toBe(subnetPrefix)
		expect(after.gateway).toBe(gateway)
		expect(after.dns).toEqual(dns)
	})

	test('static IP settings persist after reboot', async () => {
		const before = (await umbreld.client.system.getNetworkInterfaces.query()).find((i) => i.mac === interfaceMac)!

		// Power cycle the VM
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.login()

		// Retry until the interface comes back up with the static config intact
		await pRetry(
			async () => {
				const iface = (await umbreld.client.system.getNetworkInterfaces.query()).find((i) => i.mac === interfaceMac)
				expect(iface?.connected).toBe(true)
				expect(iface?.ipMethod).toBe('static')
				expect(iface?.configuredStaticSettings).toEqual({
					ip: before.ip!,
					subnetPrefix: before.subnetPrefix!,
					gateway: before.gateway!,
					dns: before.dns!,
				})
				expect(iface?.ip).toBe(before.ip)
				expect(iface?.subnetPrefix).toBe(before.subnetPrefix)
				expect(iface?.gateway).toBe(before.gateway)
				expect(iface?.dns).toEqual(before.dns)
			},
			{retries: 100, minTimeout: 100, maxTimeout: 100},
		)
	})

	test('clearStaticIp() reverts to DHCP', async () => {
		await umbreld.client.system.clearStaticIp.mutate({mac: interfaceMac})

		// Wait for the connection to re-establish on DHCP
		await pRetry(
			async () => {
				const iface = (await umbreld.client.system.getNetworkInterfaces.query()).find((i) => i.mac === interfaceMac)
				expect(iface?.connected).toBe(true)
				expect(iface?.ipMethod).toBe('dhcp')
				expect(iface?.configuredStaticSettings).toBeUndefined()
				expect(iface?.ip).toBeDefined()
				expect(iface?.gateway).toBeDefined()
				expect(iface?.dns).toBeInstanceOf(Array)
			},
			{retries: 50, minTimeout: 100, maxTimeout: 100},
		)
	})
})
