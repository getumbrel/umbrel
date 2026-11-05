import {afterEach, describe, expect, test, vi} from 'vitest'

vi.mock('execa')
vi.mock('node:fs/promises')
vi.mock('fs-extra')
vi.mock('../system/system.ts', () => ({restoreStaticIp: vi.fn(async () => {})}))

import fsp from 'node:fs/promises'

import {execa} from 'execa'
import fse from 'fs-extra'

import {restoreStaticIp} from '../system/system.ts'
import LanBridge, {
	lanBridgeAvailability,
	lanBridgeConnectionArgs,
	lanBridgePortConnectionArgs,
	parseIpv4Settings,
} from './lan-bridge.ts'

describe('lanBridgeAvailability', () => {
	test('bridges the wired interface carrying the default route', () => {
		expect(lanBridgeAvailability([{dev: 'enp1s0', metric: 100}], {enp1s0: 'ethernet'})).toEqual({
			available: true,
			interface: 'enp1s0',
		})
	})

	test('picks the lowest metric default route when there are several', () => {
		expect(
			lanBridgeAvailability(
				[
					{dev: 'wlo1', metric: 600},
					{dev: 'enp1s0', metric: 100},
				],
				{wlo1: 'wifi', enp1s0: 'ethernet'},
			),
		).toEqual({available: true, interface: 'enp1s0'})
		expect(
			lanBridgeAvailability(
				[
					{dev: 'enp1s0', metric: 700},
					{dev: 'wlo1', metric: 600},
				],
				{wlo1: 'wifi', enp1s0: 'ethernet'},
			),
		).toEqual({available: false, reason: 'wifi'})
	})

	test('explains that Wi-Fi cannot carry bridged machines', () => {
		expect(lanBridgeAvailability([{dev: 'wlo1'}], {wlo1: 'wifi'})).toEqual({available: false, reason: 'wifi'})
	})

	test('stays available once the bridge already carries the default route', () => {
		expect(lanBridgeAvailability([{dev: 'umbrel-lan'}], {'umbrel-lan': 'bridge'}, 'enp1s0')).toEqual({
			available: true,
			interface: 'enp1s0',
		})
	})

	test('is unavailable without a wired default route', () => {
		expect(lanBridgeAvailability([], {})).toEqual({available: false, reason: 'no-ethernet'})
		expect(lanBridgeAvailability([{dev: 'tailscale0'}], {tailscale0: 'other'})).toEqual({
			available: false,
			reason: 'no-ethernet',
		})
		// An unrelated bridge, like Docker's, is not the LAN
		expect(lanBridgeAvailability([{dev: 'br-123'}], {'br-123': 'bridge'})).toEqual({
			available: false,
			reason: 'no-ethernet',
		})
	})
})

describe('parseIpv4Settings', () => {
	test('reads a static configuration', () => {
		expect(
			parseIpv4Settings(
				'ipv4.method:manual\nipv4.addresses:192.168.1.50/24\nipv4.gateway:192.168.1.1\nipv4.dns:1.1.1.1,8.8.8.8\n',
			),
		).toEqual({method: 'manual', addresses: '192.168.1.50/24', gateway: '192.168.1.1', dns: '1.1.1.1,8.8.8.8'})
	})

	test('treats DHCP and anything unusual as automatic', () => {
		expect(parseIpv4Settings('ipv4.method:auto\nipv4.addresses:\nipv4.gateway:\nipv4.dns:\n')).toEqual({
			method: 'auto',
		})
		expect(parseIpv4Settings('ipv4.method:manual\nipv4.addresses:\n')).toEqual({method: 'auto'})
		expect(parseIpv4Settings('')).toEqual({method: 'auto'})
	})

	test('omits empty gateway and DNS fields', () => {
		expect(parseIpv4Settings('ipv4.method:manual\nipv4.addresses:10.0.0.5/8\nipv4.gateway:\nipv4.dns:\n')).toEqual({
			method: 'manual',
			addresses: '10.0.0.5/8',
			gateway: undefined,
			dns: undefined,
		})
	})
})

describe('bridge connection arguments', () => {
	test('creates a bridge without spanning tree that keeps the interface MAC', () => {
		const args = lanBridgeConnectionArgs({mac: 'e0:51:d8:14:24:60', ipv4: {method: 'auto'}})
		const settings = Object.fromEntries(
			args.slice(4).reduce<string[][]>((pairs, value, index, all) => {
				if (index % 2 === 0) pairs.push([value, all[index + 1]])
				return pairs
			}, []),
		)
		expect(args.slice(0, 4)).toEqual(['connection', 'add', 'type', 'bridge'])
		expect(settings).toEqual({
			'con-name': 'umbrel-lan',
			ifname: 'umbrel-lan',
			'connection.autoconnect-ports': 'true',
			'bridge.stp': 'no',
			'bridge.forward-delay': '0',
			'ethernet.cloned-mac-address': 'e0:51:d8:14:24:60',
			'ipv4.method': 'auto',
			'ipv6.method': 'auto',
			'ipv6.addr-gen-mode': 'default',
		})
	})

	test('carries a static configuration over to the bridge', () => {
		const args = lanBridgeConnectionArgs({
			mac: 'e0:51:d8:14:24:60',
			ipv4: {method: 'manual', addresses: '192.168.1.50/24', gateway: '192.168.1.1', dns: '1.1.1.1'},
		})
		expect(args.join(' ')).toContain(
			'ipv4.method manual ipv4.addresses 192.168.1.50/24 ipv4.gateway 192.168.1.1 ipv4.dns 1.1.1.1',
		)
	})

	test('leaves out a missing gateway and DNS', () => {
		const args = lanBridgeConnectionArgs({mac: 'e0:51:d8:14:24:60', ipv4: {method: 'manual', addresses: '10.0.0.5/8'}})
		expect(args).not.toContain('ipv4.gateway')
		expect(args).not.toContain('ipv4.dns')
	})

	test('makes the wired interface a port of the bridge', () => {
		expect(lanBridgePortConnectionArgs('enp1s0')).toEqual([
			'connection',
			'add',
			'type',
			'ethernet',
			'con-name',
			'umbrel-lan-port',
			'ifname',
			'enp1s0',
			'port-type',
			'bridge',
			'controller',
			'umbrel-lan',
		])
	})
})

// A fake host: sysfs, `ip` and NetworkManager. Activating the bridge moves the
// interface behind it unless the activation is set to fail.
function fakeHost({
	bridged = false,
	activationFails = false,
	guests = [] as string[],
	// What the interface's own profile is left with once the bridge is gone
	fallbackMethod = 'auto',
	// Whether the interface has a profile of its own besides the bridge port,
	// which it doesn't when the bridge was restored at boot
	ownProfile = true,
} = {}) {
	const state = {bridged, ports: bridged ? ['enp1s0', ...guests] : [], connected: ownProfile, commands: [] as string[]}
	const kinds: Record<string, string> = {enp1s0: 'device', wlo1: 'wireless', 'umbrel-lan': 'bridge'}
	vi.mocked(fse.pathExists).mockImplementation((async (path: string) => {
		const [, , , , device, entry] = path.split('/')
		if (device === 'umbrel-lan' && !entry) return state.bridged
		return kinds[device] === entry
	}) as any)
	vi.mocked(fsp.readdir).mockImplementation((async (path: string) => {
		if (path === '/sys/class/net/umbrel-lan/brif' && state.bridged) return state.ports
		throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'})
	}) as any)
	vi.mocked(fsp.readFile).mockResolvedValue('e0:51:d8:14:24:60\n' as any)
	vi.mocked(execa).mockImplementation((async (file: string, args: string[]) => {
		const command = [file, ...args].join(' ')
		state.commands.push(command)
		const device = state.bridged ? 'umbrel-lan' : 'enp1s0'
		if (command === 'ip -json route show default') return {stdout: JSON.stringify([{dev: device, metric: 100}])}
		if (command.startsWith('ip -4 -json address show dev ')) {
			const hasAddress = args.at(-1) === device && (state.bridged || state.connected)
			return {stdout: JSON.stringify([{addr_info: hasAddress ? [{scope: 'global'}] : []}])}
		}
		if (command === 'nmcli --get-values CONNECTIONS.AVAILABLE-CONNECTIONS device show enp1s0') {
			return {stdout: state.connected ? '39e5a110-4c0b-4de0-9267-af0f41e38254 | Wired connection 1' : ''}
		}
		if (command === 'nmcli --wait 30 device connect enp1s0') state.connected = true
		if (command === 'nmcli --get-values GENERAL.CONNECTION device show enp1s0') return {stdout: 'Wired connection 1'}
		if (command === 'nmcli --terse --fields ipv4.method connection show Wired connection 1') {
			return {stdout: `ipv4.method:${fallbackMethod}`}
		}
		if (command.includes('connection show Wired connection 1')) {
			return {stdout: 'ipv4.method:manual\nipv4.addresses:192.168.1.50/24\nipv4.gateway:192.168.1.1\nipv4.dns:1.1.1.1'}
		}
		if (command === 'nmcli --wait 30 connection up umbrel-lan') {
			if (activationFails) throw new Error('Connection activation failed')
			state.bridged = true
			state.ports = ['enp1s0']
		}
		if (command === 'nmcli connection delete umbrel-lan') {
			state.bridged = false
			state.ports = []
		}
		return {stdout: '', exitCode: 0}
	}) as any)
	return state
}

function createUmbreld(store: Record<string, unknown> = {'settings.lanBridge': {mac: 'e0:51:d8:14:24:60'}}) {
	return {
		store: {
			get: vi.fn(async (key: string) => store[key]),
			set: vi.fn(async (key: string, value: unknown) => void (store[key] = value)),
			delete: vi.fn(async (key: string) => void delete store[key]),
			values: store,
		},
		logger: {createChildLogger: () => ({log: vi.fn(), error: vi.fn()})},
	} as any
}

describe('LanBridge', () => {
	afterEach(() => vi.resetAllMocks())

	test('moves the interface and its static settings onto the bridge', async () => {
		const host = fakeHost()
		const umbreld = createUmbreld()

		await new LanBridge(umbreld).ensure()

		const changes = host.commands.filter((command) => /^nmcli (--wait 30 )?connection (add|up)/.test(command))
		expect(changes).toEqual([
			expect.stringContaining('nmcli connection add type bridge con-name umbrel-lan'),
			'nmcli connection add type ethernet con-name umbrel-lan-port ifname enp1s0 port-type bridge controller umbrel-lan',
			'nmcli --wait 30 connection up umbrel-lan',
		])
		expect(changes[0]).toContain('ethernet.cloned-mac-address e0:51:d8:14:24:60')
		expect(changes[0]).toContain(
			'ipv4.method manual ipv4.addresses 192.168.1.50/24 ipv4.gateway 192.168.1.1 ipv4.dns 1.1.1.1',
		)
		// Remembered so the bridge is rebuilt before NetworkManager starts on boot
		expect(umbreld.store.set).toHaveBeenCalledWith('settings.lanBridge', {mac: 'e0:51:d8:14:24:60'})
	})

	test('does nothing when the bridge is already up', async () => {
		const host = fakeHost({bridged: true})
		const umbreld = createUmbreld()

		await new LanBridge(umbreld).ensure()

		expect(host.commands.filter((command) => command.startsWith('nmcli'))).toEqual([])
		expect(umbreld.store.set).not.toHaveBeenCalled()
	})

	test('refuses to bridge Wi-Fi', async () => {
		const host = fakeHost()
		vi.mocked(execa).mockImplementation((async (file: string, args: string[]) => {
			host.commands.push([file, ...args].join(' '))
			if (args.join(' ') === '-json route show default') return {stdout: JSON.stringify([{dev: 'wlo1'}])}
			return {stdout: ''}
		}) as any)

		await expect(new LanBridge(createUmbreld()).ensure()).rejects.toThrow('[machine-lan-bridge-unavailable-wifi]')
		expect(host.commands.filter((command) => command.startsWith('nmcli connection add'))).toEqual([])
	})

	test('puts the interface back the way it was when the bridge fails to come up', async () => {
		const host = fakeHost({activationFails: true})
		const umbreld = createUmbreld()

		await expect(new LanBridge(umbreld).ensure()).rejects.toThrow('[machine-lan-bridge-failed]')

		const afterFailure = host.commands.slice(host.commands.indexOf('nmcli --wait 30 connection up umbrel-lan') + 1)
		expect(afterFailure).toContain('nmcli connection delete umbrel-lan-port')
		expect(afterFailure).toContain('nmcli connection delete umbrel-lan')
		expect(restoreStaticIp).toHaveBeenCalledWith(umbreld)
		expect(umbreld.store.set).not.toHaveBeenCalled()
	})

	test('gives the address back to the interface once no machine needs the bridge', async () => {
		const host = fakeHost({bridged: true})
		const umbreld = createUmbreld()

		await new LanBridge(umbreld).remove()

		expect(host.commands).toContain('nmcli connection delete umbrel-lan-port')
		expect(host.commands).toContain('nmcli connection delete umbrel-lan')
		expect(umbreld.store.delete).toHaveBeenCalledWith('settings.lanBridge')
		// Static settings saved for the interface lived on the bridge until now
		expect(restoreStaticIp).toHaveBeenCalledWith(umbreld)
	})

	test('connects the interface straight away when it has no profile of its own to fall back to', async () => {
		const host = fakeHost({bridged: true, ownProfile: false})

		const started = Date.now()
		await new LanBridge(createUmbreld()).remove()

		expect(host.commands).toContain('nmcli --wait 30 device connect enp1s0')
		// Nothing would reconnect it, so it doesn't wait for NetworkManager to
		expect(Date.now() - started).toBeLessThan(1_000)
	})

	test('keeps the bridge while a machine is still attached to it, but not past the next boot', async () => {
		const host = fakeHost({bridged: true, guests: ['vnet0']})
		const umbreld = createUmbreld()

		await new LanBridge(umbreld).remove()

		expect(host.commands.filter((command) => command.startsWith('nmcli'))).toEqual([])
		expect(umbreld.store.delete).toHaveBeenCalledWith('settings.lanBridge')
	})

	test('leaves the bridge alone when a machine wants it again by the time it would be removed', async () => {
		const host = fakeHost({bridged: true})
		const umbreld = createUmbreld()

		await new LanBridge(umbreld).remove(async () => true)

		expect(host.commands.filter((command) => command.startsWith('nmcli'))).toEqual([])
		expect(umbreld.store.delete).not.toHaveBeenCalled()
	})

	test('drops static settings that were cleared while they lived on the bridge', async () => {
		const host = fakeHost({bridged: true, fallbackMethod: 'manual'})

		await new LanBridge(createUmbreld()).remove()

		expect(host.commands).toContain(
			'nmcli connection modify Wired connection 1 ipv4.method auto ipv4.addresses  ipv4.gateway  ipv4.dns ',
		)
		expect(host.commands).toContain('nmcli --wait 30 connection up Wired connection 1')
	})

	test('keeps static settings that are still saved for the interface', async () => {
		const host = fakeHost({bridged: true, fallbackMethod: 'manual'})
		const umbreld = createUmbreld({
			'settings.lanBridge': {mac: 'e0:51:d8:14:24:60'},
			'settings.staticIp': {
				'e0:51:d8:14:24:60': {ip: '192.168.1.50', subnetPrefix: 24, gateway: '192.168.1.1', dns: ['1.1.1.1']},
			},
		})

		await new LanBridge(umbreld).remove()

		expect(restoreStaticIp).toHaveBeenCalledWith(umbreld)
		expect(host.commands.filter((command) => command.includes('ipv4.method auto'))).toEqual([])
	})
})
