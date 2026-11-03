import fsp from 'node:fs/promises'
import nodePath from 'node:path'

import {execa} from 'execa'
import fse from 'fs-extra'
import PQueue from 'p-queue'
import pWaitFor from 'p-wait-for'

import type Umbreld from '../../index.ts'
import {restoreStaticIp} from '../system/system.ts'
import {MACHINE_LAN_BRIDGE} from './domain.ts'

// The NetworkManager profiles that put Umbrel's wired interface behind the
// bridge. umbrel-static-ip-restore writes the same two profiles before
// NetworkManager starts, so keep the two in step.
export const LAN_BRIDGE_CONNECTION = MACHINE_LAN_BRIDGE
export const LAN_BRIDGE_PORT_CONNECTION = `${MACHINE_LAN_BRIDGE}-port`

const SYS_CLASS_NET = '/sys/class/net'

export type LanBridgeAvailability =
	| {available: true; interface: string}
	| {available: false; reason: 'wifi' | 'no-ethernet'}

type InterfaceKind = 'ethernet' | 'wifi' | 'bridge' | 'other'
type DefaultRoute = {dev?: string; metric?: number}

export type Ipv4Settings = {method: 'auto'} | {method: 'manual'; addresses: string; gateway?: string; dns?: string}

// A guest can only join the LAN through a wired interface. Wi-Fi access points
// drop frames from MAC addresses that never associated with them, and Linux
// refuses to add a Wi-Fi client interface to a bridge at all. Use the
// interface carrying Umbrel's own default route so machines join the same
// network Umbrel is reachable on.
export function lanBridgeAvailability(
	routes: DefaultRoute[],
	kinds: Record<string, InterfaceKind>,
	bridgePort?: string,
): LanBridgeAvailability {
	const dev = [...routes].sort((a, b) => (a.metric ?? 0) - (b.metric ?? 0)).find((route) => route.dev)?.dev
	if (dev === MACHINE_LAN_BRIDGE && bridgePort) return {available: true, interface: bridgePort}
	if (dev && kinds[dev] === 'ethernet') return {available: true, interface: dev}
	if (dev && kinds[dev] === 'wifi') return {available: false, reason: 'wifi'}
	return {available: false, reason: 'no-ethernet'}
}

export function parseIpv4Settings(output: string): Ipv4Settings {
	const fields = Object.fromEntries(
		output
			.split('\n')
			.filter(Boolean)
			.map((line) => {
				const [key, ...value] = line.split(':')
				return [key, value.join(':')]
			}),
	)
	if (fields['ipv4.method'] !== 'manual' || !fields['ipv4.addresses']) return {method: 'auto'}
	return {
		method: 'manual',
		addresses: fields['ipv4.addresses'],
		gateway: fields['ipv4.gateway'] || undefined,
		dns: fields['ipv4.dns'] || undefined,
	}
}

// Spanning tree is off and ports forward immediately, otherwise every guest
// tap waits 30 seconds in the listening and learning states before passing
// traffic, and BPDUs would leak onto the user's network. The bridge takes the
// interface's MAC so the router keeps handing Umbrel the same DHCP lease.
export function lanBridgeConnectionArgs({mac, ipv4}: {mac: string; ipv4: Ipv4Settings}) {
	const ipv4Args =
		ipv4.method === 'manual'
			? [
					'ipv4.method',
					'manual',
					'ipv4.addresses',
					ipv4.addresses,
					...(ipv4.gateway ? ['ipv4.gateway', ipv4.gateway] : []),
					...(ipv4.dns ? ['ipv4.dns', ipv4.dns] : []),
				]
			: ['ipv4.method', 'auto']
	return [
		'connection',
		'add',
		'type',
		'bridge',
		'con-name',
		LAN_BRIDGE_CONNECTION,
		'ifname',
		MACHINE_LAN_BRIDGE,
		'connection.autoconnect-ports',
		'true',
		'bridge.stp',
		'no',
		'bridge.forward-delay',
		'0',
		'ethernet.cloned-mac-address',
		mac,
		...ipv4Args,
		'ipv6.method',
		'auto',
		'ipv6.addr-gen-mode',
		'default',
	]
}

export function lanBridgePortConnectionArgs(device: string) {
	return [
		'connection',
		'add',
		'type',
		'ethernet',
		'con-name',
		LAN_BRIDGE_PORT_CONNECTION,
		'ifname',
		device,
		'port-type',
		'bridge',
		'controller',
		LAN_BRIDGE_CONNECTION,
	]
}

async function interfaceKind(device: string): Promise<InterfaceKind> {
	const path = nodePath.join(SYS_CLASS_NET, device)
	if (await fse.pathExists(nodePath.join(path, 'wireless'))) return 'wifi'
	if (await fse.pathExists(nodePath.join(path, 'bridge'))) return 'bridge'
	if (await fse.pathExists(nodePath.join(path, 'device'))) return 'ethernet'
	return 'other'
}

// The physical interface behind the bridge, if the bridge exists
export async function lanBridgePort() {
	const ports = await fsp.readdir(nodePath.join(SYS_CLASS_NET, MACHINE_LAN_BRIDGE, 'brif')).catch(() => [])
	for (const port of ports) if ((await interfaceKind(port)) === 'ethernet') return port
	return undefined
}

// Guest taps currently attached to the bridge
async function lanBridgeGuests() {
	const ports = await fsp.readdir(nodePath.join(SYS_CLASS_NET, MACHINE_LAN_BRIDGE, 'brif')).catch(() => [])
	const guests: string[] = []
	for (const port of ports) if ((await interfaceKind(port)) !== 'ethernet') guests.push(port)
	return guests
}

async function defaultRoutes() {
	const {stdout} = await execa('ip', ['-json', 'route', 'show', 'default'], {timeout: 10_000})
	return JSON.parse(stdout) as DefaultRoute[]
}

async function hasIpv4Address(device: string) {
	const {stdout} = await execa('ip', ['-4', '-json', 'address', 'show', 'dev', device], {
		reject: false,
		timeout: 10_000,
	})
	try {
		const [link] = JSON.parse(stdout) as Array<{addr_info?: Array<{scope?: string}>}>
		return !!link?.addr_info?.some((address) => address.scope === 'global')
	} catch {
		return false
	}
}

async function nmcli(args: string[]) {
	return execa('nmcli', args, {timeout: 60_000})
}

async function hasAvailableConnection(device: string) {
	const {stdout} = await execa(
		'nmcli',
		['--get-values', 'CONNECTIONS.AVAILABLE-CONNECTIONS', 'device', 'show', device],
		{
			reject: false,
			timeout: 10_000,
		},
	)
	return stdout.trim() !== ''
}

async function activeConnection(device: string) {
	const {stdout} = await execa('nmcli', ['--get-values', 'GENERAL.CONNECTION', 'device', 'show', device], {
		reject: false,
		timeout: 10_000,
	})
	const connection = stdout.trim()
	return connection && connection !== '--' ? connection : undefined
}

export default class LanBridge {
	#umbreld: Umbreld
	#queue = new PQueue({concurrency: 1})
	logger: Umbreld['logger']

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		this.logger = umbreld.logger.createChildLogger('lan-bridge')
	}

	async availability(): Promise<LanBridgeAvailability> {
		const routes = await defaultRoutes()
		const kinds: Record<string, InterfaceKind> = {}
		for (const {dev} of routes) if (dev) kinds[dev] = await interfaceKind(dev)
		return lanBridgeAvailability(routes, kinds, await lanBridgePort())
	}

	// Put Umbrel's own address on a bridge over its wired interface so machines
	// can join the LAN beside it. Umbrel drops off the network for a couple of
	// seconds while the address moves.
	async ensure() {
		return this.#queue.add(async () => {
			if ((await lanBridgePort()) && (await hasIpv4Address(MACHINE_LAN_BRIDGE))) return
			const availability = await this.availability()
			if (!availability.available) throw new Error(`[machine-lan-bridge-unavailable-${availability.reason}]`)
			const device = availability.interface
			const mac = (await fsp.readFile(nodePath.join(SYS_CLASS_NET, device, 'address'), 'utf8')).trim()
			const previousConnection = await activeConnection(device)
			const ipv4 = previousConnection
				? parseIpv4Settings(
						(
							await nmcli([
								'--terse',
								'--fields',
								'ipv4.method,ipv4.addresses,ipv4.gateway,ipv4.dns',
								'connection',
								'show',
								previousConnection,
							])
						).stdout,
					)
				: ({method: 'auto'} as const)

			this.logger.log(`Moving Umbrel's address on ${device} onto the ${MACHINE_LAN_BRIDGE} bridge`)
			await this.#deleteConnections()
			try {
				await nmcli(lanBridgeConnectionArgs({mac, ipv4}))
				await nmcli(lanBridgePortConnectionArgs(device))
				await nmcli(['--wait', '30', 'connection', 'up', LAN_BRIDGE_CONNECTION])
				await pWaitFor(
					async () =>
						(await lanBridgePort()) === device &&
						(await hasIpv4Address(MACHINE_LAN_BRIDGE)) &&
						(await defaultRoutes()).some((route) => route.dev === MACHINE_LAN_BRIDGE),
					{interval: 250, timeout: 30_000},
				)
			} catch (error) {
				this.logger.error(`Failed to bring up the ${MACHINE_LAN_BRIDGE} bridge, restoring ${device}`, error)
				await this.#deleteConnections()
				await this.#reconnect(device, previousConnection)
				throw new Error('[machine-lan-bridge-failed]')
			}
			await this.#umbreld.store.set('settings.lanBridge', {mac})
		})
	}

	// Give Umbrel's address back to its wired interface once nothing needs the
	// bridge. Machines still running on it keep it until they stop. Whether a
	// machine still wants it is checked again here, after any start that already
	// asked for the bridge.
	async remove(stillWanted: () => Promise<boolean> = async () => false) {
		return this.#queue.add(async () => {
			if (await stillWanted()) return
			// Don't bring it back on the next boot, even while a machine switched
			// away from it is still running on it
			if (await this.#umbreld.store.get('settings.lanBridge')) await this.#umbreld.store.delete('settings.lanBridge')
			if ((await lanBridgeGuests()).length > 0) return
			const device = await lanBridgePort()
			if (!device && !(await fse.pathExists(nodePath.join(SYS_CLASS_NET, MACHINE_LAN_BRIDGE)))) return
			this.logger.log(`Moving Umbrel's address off the ${MACHINE_LAN_BRIDGE} bridge`)
			await this.#deleteConnections()
			if (device) await this.#reconnect(device)
		})
	}

	async #deleteConnections() {
		for (const connection of [LAN_BRIDGE_PORT_CONNECTION, LAN_BRIDGE_CONNECTION]) {
			await execa('nmcli', ['connection', 'delete', connection], {reject: false, timeout: 30_000})
		}
	}

	async #reconnect(device: string, connection?: string) {
		// NetworkManager normally falls back to the interface's own profile by
		// itself. When the bridge was restored at boot there's no such profile
		// yet, so don't wait for it, and asking it to connect the device creates one.
		const fallsBack = connection !== undefined || (await hasAvailableConnection(device))
		const connected =
			fallsBack &&
			(await pWaitFor(() => hasIpv4Address(device), {interval: 250, timeout: 10_000})
				.then(() => true)
				.catch(() => false))
		if (!connected) {
			const args = connection ? ['connection', 'up', connection] : ['device', 'connect', device]
			await execa('nmcli', ['--wait', '30', ...args], {reject: false, timeout: 60_000})
		}
		// Static settings saved for the interface lived on the bridge while it
		// existed, so put them back on the interface's own profile.
		await restoreStaticIp(this.#umbreld)
		// And if they were cleared while on the bridge, the profile it fell back
		// to may still have the old ones
		const mac = (await fsp.readFile(nodePath.join(SYS_CLASS_NET, device, 'address'), 'utf8')).trim()
		const fallback = await activeConnection(device)
		if (fallback && !(await this.#umbreld.store.get('settings.staticIp'))?.[mac]) {
			const {stdout} = await nmcli(['--terse', '--fields', 'ipv4.method', 'connection', 'show', fallback])
			if (stdout.trim() === 'ipv4.method:manual') {
				await nmcli([
					'connection',
					'modify',
					fallback,
					'ipv4.method',
					'auto',
					'ipv4.addresses',
					'',
					'ipv4.gateway',
					'',
					'ipv4.dns',
					'',
				])
				await nmcli(['--wait', '30', 'connection', 'up', fallback])
			}
		}
	}
}
