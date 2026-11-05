import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pRetry from 'p-retry'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

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

		// Wait for the connection to re-establish after down/up. This has taken
		// over 5 seconds on a busy CI runner. It must still finish well inside the
		// 30 seconds setStaticIp waits for confirmation before rolling back.
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
			{interval: 100, timeout: 20_000},
		)

		// Settings should not be persisted until the client confirms the change worked
		expect(after.configuredStaticSettings).toBeUndefined()

		// Confirm the static IP change
		await umbreld.client.system.confirmStaticIp.mutate({ip: ip!})

		// Wait for the set job to resolve (it was waiting for the confirmation)
		await setStaticIpPromise

		// Applying the static config briefly reconnects the interface, so an
		// immediate query can observe it mid-transition. Wait until it's back
		// up with the static settings before asserting on the details.
		await pWaitFor(
			async () => {
				const iface = (await umbreld.client.system.getNetworkInterfaces.query()).find((i) => i.mac === interfaceMac)
				if (iface?.connected && iface.ipMethod === 'static' && iface.configuredStaticSettings) {
					after = iface
					return true
				}
				return false
			},
			{interval: 250, timeout: 10_000},
		)

		// Only the method should change, everything else stays the same
		expect(after.ipMethod).toBe('static')
		expect(after.configuredStaticSettings).toEqual({ip, subnetPrefix, gateway, dns})
		expect(after.ip).toBe(ip)
		expect(after.subnetPrefix).toBe(subnetPrefix)
		expect(after.gateway).toBe(gateway)
		expect(after.dns).toEqual(dns)
	})

	test('static IP settings persist after reboot', async () => {
		// Capture the interface state only once it has settled with the static
		// config applied, in case the previous test's reconnect is still ongoing.
		let before!: Awaited<ReturnType<typeof umbreld.client.system.getNetworkInterfaces.query>>[number]
		await pWaitFor(
			async () => {
				const iface = (await umbreld.client.system.getNetworkInterfaces.query()).find((i) => i.mac === interfaceMac)
				if (iface?.connected && iface.ipMethod === 'static' && iface.configuredStaticSettings) {
					before = iface
					return true
				}
				return false
			},
			{interval: 250, timeout: 10_000},
		)

		// Flush the persisted static IP config to disk so it survives the power
		// cycle even if graceful shutdown degrades to a hard stop.
		await umbreld.vm.sshAsRoot('sync')

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
			{retries: 300, minTimeout: 200, maxTimeout: 200},
		)
	})

	test('static IP is applied from boot without DHCP or reconnecting', async () => {
		const {id: device} = (await umbreld.client.system.getNetworkInterfaces.query()).find((i) => i.mac === interfaceMac)!

		// Wait for umbreld to finish restoring the static IP so any reconnect would be logged
		await pWaitFor(
			async () => {
				const umbreldLogs = await umbreld.vm.sshAsRoot('journalctl -b -u umbrel --no-pager')
				return umbreldLogs.includes(`Restored static IP for ${interfaceMac}`)
			},
			{interval: 1000, timeout: 60_000},
		)
		const networkManagerLogs = await umbreld.vm.sshAsRoot('journalctl -b -u NetworkManager --no-pager')

		// NetworkManager should bring the interface up with the static IP straight
		// away, instead of starting it on DHCP until umbreld restores the static IP
		expect(networkManagerLogs).not.toContain(`dhcp4 (${device})`)

		// umbreld should find the static IP already applied and leave the connection
		// alone, instead of reconnecting it while apps are starting
		expect(networkManagerLogs).not.toContain(`device (${device}): state change: activated -> deactivating`)

		// The connection written at boot should keep NetworkManager's default IPv6 address
		// generation, like the DHCP connection it replaces, instead of deriving the IPv6
		// addresses from the MAC address (EUI-64)
		const [a, b, c, d, e, f] = interfaceMac.split(':').map((byte) => parseInt(byte, 16))
		const eui64 = [((a ^ 0x02) << 8) | b, (c << 8) | 0xff, 0xfe00 | d, (e << 8) | f]
			.map((group) => group.toString(16))
			.join(':')
		const ipv6Addresses = await umbreld.vm.sshAsRoot(`ip -6 address show dev ${device}`)
		expect(ipv6Addresses).toContain('inet6 fe80::')
		expect(ipv6Addresses).not.toContain(eui64)
	})

	test('changing a saved static IP setting still applies it', async () => {
		const before = (await umbreld.client.system.getNetworkInterfaces.query()).find((i) => i.mac === interfaceMac)!
		// Keep the IP so QEMU port forwarding stays intact, but add a DNS server
		const {ip, subnetPrefix, gateway} = before
		const dns = [...before.dns!, '1.1.1.1']

		const setStaticIpPromise = umbreld.client.system.setStaticIp.mutate({
			mac: before.mac,
			ip: ip!,
			subnetPrefix: subnetPrefix!,
			gateway: gateway!,
			dns,
		})

		// Wait for the connection to come back up with the new DNS server applied
		await pRetry(
			async () => {
				const iface = (await umbreld.client.system.getNetworkInterfaces.query()).find((i) => i.mac === interfaceMac)
				expect(iface?.connected).toBe(true)
				expect(iface?.dns).toEqual(dns)
			},
			{retries: 100, minTimeout: 200, maxTimeout: 200},
		)

		// Confirm the change and check it's saved
		await umbreld.client.system.confirmStaticIp.mutate({ip: ip!})
		await setStaticIpPromise
		const after = (await umbreld.client.system.getNetworkInterfaces.query()).find((i) => i.mac === interfaceMac)!
		expect(after.ipMethod).toBe('static')
		expect(after.configuredStaticSettings).toEqual({ip, subnetPrefix, gateway, dns})
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

	test('DHCP is still used after reboot once the static IP is cleared', async () => {
		// Flush the cleared config to disk before power cycling the VM
		await umbreld.vm.sshAsRoot('sync')
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.login()

		await pRetry(
			async () => {
				const iface = (await umbreld.client.system.getNetworkInterfaces.query()).find((i) => i.mac === interfaceMac)
				expect(iface?.connected).toBe(true)
				expect(iface?.ipMethod).toBe('dhcp')
				expect(iface?.configuredStaticSettings).toBeUndefined()
				expect(iface?.ip).toBeDefined()
			},
			{retries: 300, minTimeout: 200, maxTimeout: 200},
		)
	})
})
