import {randomUUID} from 'node:crypto'

import {describe, expect, test} from 'vitest'

import type {MachineDefinition} from './domain.ts'
import {
	buildMachineNetworkXml,
	buildMachinePortForwardNftables,
	MACHINE_GUEST_HOST_ADDRESS,
	MACHINE_NETWORK_BRIDGE,
	machineDnsServersFromResolvConf,
	machineIpAddressSchema,
	nextMachineIpAddress,
	parseActiveMachineLeaseAddresses,
	parseMachineDhcpLeases,
} from './machine-network.ts'

function definition(id: string, ipAddress?: string): MachineDefinition {
	return {
		version: 1,
		id,
		name: id,
		osId: 'custom',
		osName: 'Custom',
		osVersion: 'Custom image',
		arch: 'amd64',
		platformProfile: 'modern-x86',
		machineType: 'pc-q35-9.2',
		firmware: 'uefi',
		uuid: randomUUID(),
		macAddress: id === 'first' ? '02:00:00:00:00:01' : '02:00:00:00:00:02',
		ipAddress,
		diskSizeGb: 1,
		cores: 1,
		memoryMb: 1_024,
		autostart: false,
		pinned: false,
		createdAt: 1,
		portForwards: [],
	}
}

describe('transient machine network', () => {
	test('allocates the first unused host address and validates the reserved subnet', () => {
		expect(nextMachineIpAddress([definition('first', '10.203.0.2')])).toBe('10.203.0.3')
		expect(machineIpAddressSchema.parse('10.203.0.254')).toBe('10.203.0.254')
		for (const address of ['10.203.0.1', '10.203.0.255', '100.101.102.2', '192.168.1.2']) {
			expect(() => machineIpAddressSchema.parse(address)).toThrow()
		}
	})

	test('reserves active dnsmasq leases when a recently removed address is still occupied', () => {
		const output = `
Expiry Time           MAC address         Protocol   IP address      Hostname
2026-07-15 08:23:28   d6:98:a4:f3:7b:6d   ipv4       10.203.0.4/24   removed-machine
2026-07-15 08:23:29   c6:ea:8e:51:a5:23   ipv4       10.203.0.4/24   duplicate-line
2026-07-15 08:23:30   c6:ea:8e:51:a5:24   ipv6       fd00::2/64      ignored
`
		const activeLeases = parseActiveMachineLeaseAddresses(output)
		expect(activeLeases).toEqual(['10.203.0.4'])
		expect(
			nextMachineIpAddress([
				definition('first', '10.203.0.2'),
				{ipAddress: '10.203.0.3'},
				...activeLeases.map((ipAddress) => ({ipAddress})),
			]),
		).toBe('10.203.0.5')
	})

	test('generates a transient NAT bridge with static MAC-keyed DHCP leases', () => {
		const definitions = [definition('first', '10.203.0.2'), definition('second', '10.203.0.3')]
		const xml = buildMachineNetworkXml(definitions, ['192.168.1.1', '1.1.1.1'])

		expect(xml).toContain('<name>umbrel-machines</name>')
		expect(xml).toContain("<forward mode='nat'>")
		expect(xml).toContain(`<bridge name='${MACHINE_NETWORK_BRIDGE}'`)
		expect(xml).toContain("<port isolated='yes'/>")
		expect(xml).toContain("<dns enable='no'/>")
		expect(xml).toContain("value='dhcp-option=option:dns-server,192.168.1.1,1.1.1.1'")
		expect(xml).toContain(`<ip address='${MACHINE_GUEST_HOST_ADDRESS}'`)
		expect(parseMachineDhcpLeases(xml)).toEqual([
			{macAddress: '02:00:00:00:00:01', ipAddress: '10.203.0.2', name: 'first'},
			{macAddress: '02:00:00:00:00:02', ipAddress: '10.203.0.3', name: 'second'},
		])
	})

	test('uses reachable IPv4 host resolvers for guest DHCP', () => {
		expect(
			machineDnsServersFromResolvConf(`
nameserver 127.0.0.53
nameserver ::1
nameserver 192.168.1.1
nameserver 1.1.1.1
nameserver 192.168.1.1
nameserver 9.9.9.9
nameserver 8.8.8.8
`),
		).toEqual(['192.168.1.1', '1.1.1.1', '9.9.9.9'])
	})

	test('falls back to public resolvers when host resolvers are not guest-reachable', () => {
		expect(
			machineDnsServersFromResolvConf(`
nameserver 127.0.0.1
nameserver 169.254.1.1
nameserver 10.203.0.1
nameserver ::1
`),
		).toEqual(['1.1.1.1', '9.9.9.9', '8.8.8.8'])
	})

	test('maps every configured forward onto the LAN and host LAN-address paths', () => {
		const machine = definition('first', '10.203.0.2')
		machine.portForwards = [
			{id: 'ssh', protocol: 'tcp', hostPort: 40_022, guestPort: 22},
			{id: 'dns', protocol: 'udp', hostPort: 40_053, guestPort: 53},
		]
		const rules = buildMachinePortForwardNftables([machine], 'wlan0')

		expect(rules).toContain('iifname "wlan0" fib daddr type local tcp dport 40022')
		expect(rules).toContain('iifname "wlan0" fib daddr type local udp dport 40053 counter dnat ip to 10.203.0.2:53')
		expect(rules).toContain(
			'ip daddr != 127.0.0.0/8 fib daddr type local udp dport 40053 counter dnat ip to 10.203.0.2:53',
		)
		expect(rules).not.toContain('ip saddr 127.0.0.0/8')
	})
})
