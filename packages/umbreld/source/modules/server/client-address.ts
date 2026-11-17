import type http from 'node:http'
import {BlockList, isIPv6} from 'node:net'
import os from 'node:os'

import randomToken from '../utilities/random-token.ts'

// LAN ingress sets this header on the requests it forwards to umbreld. Other
// things can reach umbreld's loopback port too, such as an app that uses the
// host's network, and without it they could claim to be forwarding for any
// address they liked.
export const lanIngressHeader = {name: 'x-umbrel-lan-ingress', value: randomToken(256)}

// The Umbrel's own addresses, and the IPv6 networks it is directly connected to
function localAddresses() {
	const own = new BlockList()
	own.addSubnet('127.0.0.0', 8)
	const networks = new BlockList()
	for (const addresses of Object.values(os.networkInterfaces())) {
		for (const {address, family, cidr} of addresses ?? []) {
			own.addAddress(address, family === 'IPv6' ? 'ipv6' : 'ipv4')
			if (family === 'IPv6' && cidr) networks.addSubnet(address, Number(cidr.split('/')[1]), 'ipv6')
		}
	}
	return {own, networks}
}

// Who a request was sent by, for telling clients apart: a network address, or
// 'local' for the Umbrel itself.
//
// umbreld only listens on loopback. Requests reach it through LAN ingress,
// which appends the address it accepted the connection from to
// X-Forwarded-For. Only that last entry is used: anything before it was sent
// by the client.
//
// Everything on the Umbrel itself is one client, whichever of its addresses a
// request comes from, since something running there can use any of them.
// Devices on the Umbrel's own networks are told apart by their full address,
// so that one of them can't get another blocked. An IPv6 client from anywhere
// else is identified by its /64 network instead, because it can use any
// address in it.
export default function clientAddress(request: http.IncomingMessage) {
	const forwardedByLanIngress = request.headers[lanIngressHeader.name] === lanIngressHeader.value
	const forwardedFor = forwardedByLanIngress ? String(request.headers['x-forwarded-for'] ?? '') : ''
	let address = forwardedFor.split(',').at(-1)!.trim() || request.socket.remoteAddress || ''

	// IPv4 clients of a dual-stack listener, such as ::ffff:192.168.1.5
	address = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1] ?? address
	// Link-local addresses name the interface they arrived on, such as fe80::1%eth0
	address = address.toLowerCase().split('%')[0]

	const family = isIPv6(address) ? 'ipv6' : 'ipv4'
	const {own, networks} = localAddresses()
	if (own.check(address, family)) return 'local'
	if (family === 'ipv4' || networks.check(address, family)) return address

	const [head, tail] = address.split('::')
	const groups = head ? head.split(':') : []
	if (tail !== undefined) {
		const trailing = tail ? tail.split(':') : []
		groups.push(...Array(8 - groups.length - trailing.length).fill('0'), ...trailing)
	}
	return `${groups
		.slice(0, 4)
		.map((group) => Number.parseInt(group, 16).toString(16))
		.join(':')}::/64`
}
