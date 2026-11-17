import type http from 'node:http'
import os from 'node:os'

import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import clientAddress, {lanIngressHeader} from './client-address.ts'

const request = (remoteAddress: string, headers: http.IncomingHttpHeaders = {}) =>
	({headers, socket: {remoteAddress}}) as unknown as http.IncomingMessage
// A request LAN ingress forwarded over loopback for a client at this address
const forwarded = (forwardedFor: string | string[]) =>
	clientAddress(
		request('127.0.0.1', {'x-forwarded-for': forwardedFor, [lanIngressHeader.name]: lanIngressHeader.value}),
	)

// A LAN interface with a link-local and a global IPv6 network
beforeEach(() => {
	const address = {netmask: '', mac: '', internal: false, scopeid: 0}
	vi.spyOn(os, 'networkInterfaces').mockReturnValue({
		lo: [{...address, family: 'IPv6', address: '::1', cidr: '::1/128', internal: true}],
		eth0: [
			{...address, family: 'IPv4', address: '192.168.1.2', cidr: '192.168.1.2/24'},
			{...address, family: 'IPv6', address: 'fe80::2', cidr: 'fe80::2/64'},
			{...address, family: 'IPv6', address: '2001:db8:12:3400::2', cidr: '2001:db8:12:3400::2/64'},
		],
	})
})
afterEach(() => void vi.restoreAllMocks())

test('uses the address LAN ingress appended, not ones the client sent', () => {
	expect(forwarded('192.168.1.5')).toBe('192.168.1.5')
	expect(forwarded('10.0.0.1, 172.16.0.1,192.168.1.5')).toBe('192.168.1.5')
	expect(forwarded(['10.0.0.1', '192.168.1.5'])).toBe('192.168.1.5')
})

test('ignores forwarded addresses on requests that did not come through LAN ingress', () => {
	expect(clientAddress(request('127.0.0.1', {'x-forwarded-for': '192.168.1.5'}))).toBe('local')
	expect(
		clientAddress(request('127.0.0.1', {'x-forwarded-for': '192.168.1.5', [lanIngressHeader.name]: 'a guess'})),
	).toBe('local')
	expect(clientAddress(request('192.168.1.9', {'x-forwarded-for': '192.168.1.5'}))).toBe('192.168.1.9')
})

test("treats every one of the Umbrel's own addresses as one client", () => {
	for (const address of ['127.0.0.1', '127.0.0.2', '127.255.255.254', '::1', '192.168.1.2', '::ffff:192.168.1.2']) {
		expect(forwarded(address)).toBe('local')
	}
	for (const address of ['fe80::2%eth0', 'FE80::2', '2001:db8:12:3400::2', '2001:db8:12:3400:0:0:0:2']) {
		expect(forwarded(address)).toBe('local')
	}
	// A client reaching LAN ingress over loopback can't pose as another address
	expect(forwarded('10.0.0.1,127.0.0.1')).toBe('local')
})

test('reads IPv4 clients of a dual-stack listener as IPv4', () => {
	expect(forwarded('::ffff:192.168.1.5')).toBe('192.168.1.5')
})

test("tells IPv6 devices on the Umbrel's own networks apart by their full address", () => {
	expect(forwarded('fe80::1c2b:3aff:fe4d:5e6f%eth0')).toBe('fe80::1c2b:3aff:fe4d:5e6f')
	expect(forwarded('FE80::5')).toBe('fe80::5')
	expect(forwarded('2001:db8:12:3400:1:2:3:4')).toBe('2001:db8:12:3400:1:2:3:4')
	expect(forwarded('2001:db8:12:3400:1:2:3:5')).toBe('2001:db8:12:3400:1:2:3:5')
})

test('identifies IPv6 clients from other networks by their /64', () => {
	expect(forwarded('2001:db8:99:1:1:2:3:4')).toBe('2001:db8:99:1::/64')
	expect(forwarded('2001:DB8:99:1::4')).toBe('2001:db8:99:1::/64')
	// A short gap leaves later groups inside the network part
	expect(forwarded('2001:db8::7:1:2:3:4')).toBe('2001:db8:0:7::/64')
	expect(forwarded('2001:0db8:0099::1')).toBe('2001:db8:99:0::/64')
})
