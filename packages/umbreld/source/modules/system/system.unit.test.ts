// TODO: Re-enable this, we temporarily disable TS here since we broke tests
// and have since changed the API. We'll refactor these later.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import {describe, afterEach, expect, test, vi} from 'vitest'

// Mocks
import systemInformation from 'systeminformation'
import * as execa from 'execa'
import fse from 'fs-extra'

import Umbreld from '../../index.ts'
import {
	getCpuTemperature,
	getMemoryUsage,
	getDiskUsage,
	getDiskUsageByPath,
	shutdown,
	reboot,
	restoreStaticIp,
	clearStaticIp,
	getNetworkInterfaces,
	connectToWiFiNetwork,
	restoreWiFi,
} from './system.ts'

vi.mock('systeminformation')
vi.mock('execa')
vi.mock('fs-extra')
// Don't actually wait between WiFi restore attempts
vi.mock('node:timers/promises', () => ({setTimeout: vi.fn(async () => {})}))

afterEach(() => {
	vi.restoreAllMocks()
})

describe('getCpuTemperature', () => {
	test('should return main cpu temperature when system supports it', async () => {
		vi.mocked(systemInformation.cpuTemperature).mockResolvedValue({main: 69} as any)
		expect(await getCpuTemperature()).toMatchObject({warning: 'normal', temperature: 69})
	})

	test('should keep temperature warnings disabled during the 2.0 beta', async () => {
		vi.mocked(systemInformation.cpuTemperature).mockResolvedValue({main: 100} as any)
		expect(await getCpuTemperature()).toMatchObject({warning: 'normal', temperature: 100})
	})

	test('should throw error when system does not support cpu temperature', async () => {
		vi.mocked(systemInformation.cpuTemperature).mockResolvedValue({main: null} as any)
		expect(getCpuTemperature()).rejects.toThrow('Could not get CPU temperature')
	})
})

describe('getDiskUsageByPath', () => {
	test('should return disk usage for specified path', async () => {
		vi.mocked(execa.$).mockResolvedValue({
			stdout: `   1B-blocks         Used        Avail
290821033984 126167117824 164653916160`,
		})
		expect(await getDiskUsageByPath('/tmp')).toMatchObject({
			size: 290821033984,
			totalUsed: 126167117824,
			available: 164653916160,
		})
	})
})

describe('getDiskUsage', () => {
	test('keeps filesystem capacity live while using Files and app directory aggregates', async () => {
		vi.mocked(execa.$).mockResolvedValue({
			stdout: `1B-blocks Used Avail
1000 800 200`,
		})
		const getStorageUsage = vi.fn(async () => 130)
		const getAppDiskUsage = vi.fn(async () => 70)
		const storageResourceUsage = vi.fn(async () => [{id: 'machine', name: 'Machine', osId: 'linux', used: 110}])
		const umbreld = {
			dataDirectory: '/data',
			hardware: {umbrelPro: {isUmbrelPro: vi.fn(async () => false)}},
			apps: {instances: [{id: 'app', getDiskUsage: getAppDiskUsage}]},
			machines: {storageResourceUsage},
			files: {getStorageUsage},
		} as unknown as Umbreld

		await expect(getDiskUsage(umbreld)).resolves.toMatchObject({
			size: 1000,
			totalUsed: 800,
			available: 200,
			files: 130,
			apps: [{id: 'app', used: 70}],
			machines: [{id: 'machine', used: 110}],
		})
		expect(execa.$).toHaveBeenCalledOnce()
		expect(getStorageUsage).toHaveBeenCalledOnce()
		expect(getAppDiskUsage).toHaveBeenCalledOnce()
		expect(storageResourceUsage).toHaveBeenCalledOnce()
	})
})

describe('getMemoryUsage', () => {
	test('should return memory usage', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		vi.mocked(fse.readFile).mockImplementation(async (path) => {
			if (path === '/proc/meminfo') {
				return (
					'MemTotal:        1000 kB\n' +
					'MemAvailable:     360 kB\n' +
					'MemFree:          100 kB\n' +
					'Buffers:           50 kB\n' +
					'Cached:           200 kB\n' +
					'SReclaimable:      30 kB\n' +
					'Shmem:             20 kB\n'
				)
			}
			throw new Error('ENOENT')
		})
		vi.mocked(execa.$).mockResolvedValue({
			stdout: '1 100',
		})
		expect(await getMemoryUsage(umbreld)).toMatchObject({
			size: 1_024_000,
			totalUsed: 655_360, // 1000kB - 360kB
		})
	})

	test('should clamp memory outputs to non-negative values within total size', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		;(umbreld.apps as any).instances = [
			{
				id: 'test-app',
				getContainerNames: async () => ['test_web_1'],
			},
		]
		vi.mocked(execa.$).mockImplementation(async (...args: any[]) => {
			const template = args[0]
			const str = Array.isArray(template) ? template.join('') : String(template)
			if (str.includes('docker ps')) {
				return {stdout: 'abc123def456|test_web_1'} as any
			}
			return {stdout: ''} as any
		})
		vi.mocked(fse.readFile).mockImplementation(async (path) => {
			if (path === '/proc/meminfo') {
				return (
					'MemTotal:        1000 kB\n' +
					'MemFree:            0 kB\n' +
					'Buffers:            0 kB\n' +
					'Cached:             0 kB\n' +
					'SReclaimable:       0 kB\n' +
					'Shmem:           2000 kB\n'
				)
			}
			if (String(path).includes('memory.current')) {
				return '5120000'
			}
			if (String(path).includes('memory.stat')) {
				return 'inactive_file 0\n'
			}
			if (String(path).includes('memory.swap.current')) {
				return '5120000'
			}
			if (path === '/sys/block/zram0/mm_stat') {
				return '1 0 2'
			}
			throw new Error('ENOENT')
		})

		expect(await getMemoryUsage(umbreld)).toMatchObject({
			size: 1_024_000,
			totalUsed: 1_024_000,
			system: 0,
			apps: [{id: 'test-app', used: 1_024_000}],
		})
	})
})

describe('shutdown', () => {
	test('should call execa.$ with "poweroff"', async () => {
		expect(await shutdown()).toBe(true)
		expect(execa.$).toHaveBeenCalledWith(['poweroff'])
	})

	test('should throw error when "poweroff" command fails', async () => {
		vi.mocked(execa.$).mockRejectedValue(new Error('Failed'))
		await expect(shutdown()).rejects.toThrow()
	})
})

describe('reboot', () => {
	test('should call execa.$ with "reboot"', async () => {
		expect(await reboot()).toBe(true)
		expect(execa.$).toHaveBeenCalledWith(['reboot'])
	})

	test('should throw error when "shutdown" command fails', async () => {
		vi.mocked(execa.$).mockRejectedValue(new Error('Failed'))
		await expect(reboot()).rejects.toThrow()
	})
})

describe('restoreStaticIp', () => {
	const mac = '52:54:00:12:34:56'
	const savedSettings = {ip: '192.168.1.50', subnetPrefix: 24, gateway: '192.168.1.1', dns: ['1.1.1.1', '8.8.8.8']}
	const matchingConnection = {
		'ipv4.method': 'manual',
		'ipv4.addresses': '192.168.1.50/24',
		'ipv4.gateway': '192.168.1.1',
		'ipv4.dns': '1.1.1.1,8.8.8.8',
	}

	// Fake nmcli for a single ethernet interface and return the commands that were run
	function mockNetworkManager({connection}: {connection?: Record<string, string>}) {
		const commands: string[] = []
		// A physical interface that isn't behind a bridge
		vi.mocked(fse.pathExists).mockImplementation(async (path) => !String(path).endsWith('/bridge'))
		vi.mocked(fse.realpath).mockRejectedValue(Object.assign(new Error('ENOENT'), {code: 'ENOENT'}))
		vi.mocked(fse.readFile).mockResolvedValue(`${mac}\n`)
		vi.mocked(execa.$).mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
			const command = strings.reduce((command, string, index) => command + values[index - 1] + string)
			commands.push(command)
			let stdout = ''
			if (command.endsWith('device status')) {
				stdout = `enp1s0:ethernet:connected:${connection ? 'Wired connection 1' : '--'}`
			} else if (command.endsWith('--fields UUID connection show')) {
				stdout = connection ? 'uuid-1' : ''
			} else if (command.endsWith('connection show uuid-1')) {
				stdout = 'connection.interface-name:enp1s0\nconnection.id:Wired connection 1'
			} else if (command.includes('--fields ipv4.method,ipv4.addresses') && connection) {
				stdout = Object.entries(connection)
					.map(([key, value]) => `${key}:${value}`)
					.join('\n')
			}
			return {stdout}
		})
		return commands
	}

	function createUmbreld() {
		return {
			store: {get: async () => ({[mac]: savedSettings})},
			logger: {log: vi.fn(), error: vi.fn()},
		} as any
	}

	test('leaves the connection alone when it already has the saved settings', async () => {
		const commands = mockNetworkManager({connection: matchingConnection})
		const umbreld = createUmbreld()

		await restoreStaticIp(umbreld)

		expect(umbreld.logger.error).not.toHaveBeenCalled()
		expect(umbreld.logger.log).toHaveBeenCalledWith(`Restored static IP for ${mac} (enp1s0)`)
		expect(commands.filter((command) => /connection (add|modify|down|up) /.test(command))).toEqual([])
	})

	test.each([
		['the connection is on DHCP', {'ipv4.method': 'auto', 'ipv4.addresses': '', 'ipv4.gateway': '', 'ipv4.dns': ''}],
		['the IP differs', {'ipv4.addresses': '192.168.1.51/24'}],
		['the subnet prefix differs', {'ipv4.addresses': '192.168.1.50/16'}],
		['the gateway differs', {'ipv4.gateway': '192.168.1.254'}],
		['a DNS server differs', {'ipv4.dns': '1.1.1.1,9.9.9.9'}],
		['the DNS servers are in a different order', {'ipv4.dns': '8.8.8.8,1.1.1.1'}],
	])('applies the saved settings and reconnects when %s', async (_, difference) => {
		const commands = mockNetworkManager({connection: {...matchingConnection, ...difference}})
		const umbreld = createUmbreld()

		await restoreStaticIp(umbreld)

		expect(umbreld.logger.error).not.toHaveBeenCalled()
		expect(commands.filter((command) => /connection (add|modify|down|up) /.test(command))).toEqual([
			'nmcli connection modify Wired connection 1 ipv4.method manual ipv4.addresses 192.168.1.50/24 ipv4.gateway 192.168.1.1 ipv4.dns 1.1.1.1,8.8.8.8',
			'nmcli connection down Wired connection 1',
			'nmcli connection up Wired connection 1',
		])
	})

	test('creates a connection with the saved settings when the interface has none', async () => {
		const commands = mockNetworkManager({})
		const umbreld = createUmbreld()

		await restoreStaticIp(umbreld)

		expect(umbreld.logger.error).not.toHaveBeenCalled()
		const changes = commands.filter((command) => /connection (add|modify|down|up) /.test(command))
		expect(changes).toHaveLength(2)
		expect(changes[0]).toMatch(
			/^nmcli connection add type ethernet con-name wired-connection-[0-9a-f]{8} ifname enp1s0$/,
		)
		expect(changes[1]).toMatch(
			/^nmcli connection modify wired-connection-[0-9a-f]{8} ipv4.method manual ipv4.addresses 192.168.1.50\/24 ipv4.gateway 192.168.1.1 ipv4.dns 1.1.1.1,8.8.8.8$/,
		)
	})
})

// Machines puts the wired interface behind the umbrel-lan bridge so machines
// can join the LAN. Its IP settings then live on the bridge's connection.
describe('static IP behind a bridge', () => {
	const mac = '52:54:00:12:34:56'
	const savedSettings = {ip: '192.168.1.50', subnetPrefix: 24, gateway: '192.168.1.1', dns: ['1.1.1.1']}

	function mockBridgedNetworkManager(bridgeIpv4: Record<string, string>) {
		const commands: string[] = []
		vi.mocked(fse.realpath).mockImplementation((async (path: string) => {
			if (path === '/sys/class/net/enp1s0/master') return '/sys/devices/virtual/net/umbrel-lan'
			throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'})
		}) as any)
		vi.mocked(fse.pathExists).mockImplementation(async (path) =>
			[
				'/sys/class/net/enp1s0/device',
				'/sys/devices/virtual/net/umbrel-lan/bridge',
				'/sys/class/net/umbrel-lan/bridge',
			].includes(String(path)),
		)
		vi.mocked(fse.readFile).mockResolvedValue(`${mac}\n`)
		vi.mocked(execa.$).mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
			const command = strings.reduce((command, string, index) => command + values[index - 1] + string)
			commands.push(command)
			let stdout = ''
			if (command.endsWith('device status')) {
				stdout = 'umbrel-lan:bridge:connected:umbrel-lan\nenp1s0:ethernet:connected:umbrel-lan-port'
			} else if (command.endsWith('--fields UUID connection show')) {
				stdout = 'uuid-port\nuuid-bridge'
			} else if (command.endsWith('connection show uuid-port')) {
				stdout = 'connection.interface-name:enp1s0\nconnection.id:umbrel-lan-port'
			} else if (command.endsWith('connection show uuid-bridge')) {
				stdout = 'connection.interface-name:umbrel-lan\nconnection.id:umbrel-lan'
			} else if (command.endsWith('connection show umbrel-lan')) {
				stdout = Object.entries(bridgeIpv4)
					.map(([key, value]) => `${key}:${value}`)
					.join('\n')
			}
			return {stdout}
		})
		return commands
	}

	function createUmbreld(staticIp: Record<string, typeof savedSettings> = {[mac]: savedSettings}) {
		return {
			store: {
				get: async () => staticIp,
				getWriteLock: async (callback: any) => callback({get: async () => staticIp, set: async () => {}}),
			},
			lanIngress: {refresh: async () => {}},
			logger: {log: vi.fn(), error: vi.fn()},
		} as any
	}

	test('reports the address on the bridge as the interface address', async () => {
		mockBridgedNetworkManager({
			'ipv4.method': 'auto',
			'IP4.ADDRESS[1]': '192.168.1.148/24',
			'IP4.GATEWAY': '192.168.1.1',
			'IP4.DNS[1]': '192.168.1.1',
		})

		const interfaces = await getNetworkInterfaces(createUmbreld({}))

		// The bridge itself isn't a physical interface and stays hidden
		expect(interfaces).toEqual([
			{
				id: 'enp1s0',
				mac,
				type: 'ethernet',
				connected: true,
				ipMethod: 'dhcp',
				ip: '192.168.1.148',
				subnetPrefix: 24,
				gateway: '192.168.1.1',
				dns: ['192.168.1.1'],
			},
		])
	})

	test('applies saved settings to the bridge and reapplies it in place so machines stay attached', async () => {
		const commands = mockBridgedNetworkManager({'ipv4.method': 'auto'})
		const umbreld = createUmbreld()

		await restoreStaticIp(umbreld)

		expect(umbreld.logger.error).not.toHaveBeenCalled()
		expect(commands.filter((command) => /connection (add|modify|down|up) |device reapply/.test(command))).toEqual([
			'nmcli connection modify umbrel-lan ipv4.method manual ipv4.addresses 192.168.1.50/24 ipv4.gateway 192.168.1.1 ipv4.dns 1.1.1.1',
			'nmcli device reapply umbrel-lan',
		])
	})

	test('clears static settings from the bridge and reapplies it in place', async () => {
		const commands = mockBridgedNetworkManager({
			'ipv4.method': 'manual',
			'IP4.ADDRESS[1]': '192.168.1.50/24',
		})

		await clearStaticIp(createUmbreld(), {mac})

		expect(commands.filter((command) => /connection (add|modify|down|up) |device reapply/.test(command))).toEqual([
			'nmcli connection modify umbrel-lan ipv4.method auto ipv4.addresses  ipv4.gateway  ipv4.dns ',
			'nmcli device reapply umbrel-lan',
		])
	})
})

describe('WiFi', () => {
	const credentials = {ssid: 'Home', password: 'hunter22'}

	// Fake nmcli where each `wifi connect` takes the next exit code from the list
	// (0 for success) and return the commands that were run
	function mockNetworkManager(connectExitCodes: number[]) {
		const commands: string[] = []
		vi.mocked(execa.$).mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
			const command = strings.reduce((command, string, index) => command + values[index - 1] + string)
			commands.push(command)
			if (command.startsWith('nmcli device wifi connect')) {
				const exitCode = connectExitCodes.shift() ?? 0
				if (exitCode !== 0) throw Object.assign(new Error(`Command failed: ${command}`), {exitCode})
			}
			return {stdout: ''}
		})
		return commands
	}

	const connectCommand = 'nmcli device wifi connect Home password hunter22'
	const rescanCommand = 'nmcli device wifi list --rescan yes'
	const nmcliCalls = (commands: string[]) =>
		commands.filter((command) => command === connectCommand || command === rescanCommand)

	describe('connectToWiFiNetwork', () => {
		test('connects without rescanning when the network is already known', async () => {
			const commands = mockNetworkManager([0])

			await expect(connectToWiFiNetwork(credentials)).resolves.toBe(true)
			expect(nmcliCalls(commands)).toEqual([connectCommand])
		})

		test('rescans and tries again when the network is not in the scan results yet', async () => {
			const commands = mockNetworkManager([10, 0])

			await expect(connectToWiFiNetwork(credentials)).resolves.toBe(true)
			expect(nmcliCalls(commands)).toEqual([connectCommand, rescanCommand, connectCommand])
		})

		test('fails with network not found when the network is still missing after a rescan', async () => {
			const commands = mockNetworkManager([10, 10])

			await expect(connectToWiFiNetwork(credentials)).rejects.toThrow('Network not found')
			expect(nmcliCalls(commands)).toEqual([connectCommand, rescanCommand, connectCommand])
		})

		test('does not rescan when the connection fails for another reason', async () => {
			const commands = mockNetworkManager([4])

			await expect(connectToWiFiNetwork(credentials)).rejects.toThrow('Incorrect password')
			expect(nmcliCalls(commands)).toEqual([connectCommand])
		})
	})

	describe('restoreWiFi', () => {
		// Fake store whose saved WiFi settings come from the list in turn, sticking on the last one.
		// An Error in the list makes that read fail.
		function createUmbreld(savedWifiSettings: unknown[]) {
			return {
				store: {
					get: vi.fn(async () => {
						const settings = savedWifiSettings.length > 1 ? savedWifiSettings.shift() : savedWifiSettings[0]
						if (settings instanceof Error) throw settings
						return settings
					}),
				},
				logger: {log: vi.fn(), error: vi.fn()},
			} as any
		}

		test('does nothing when no WiFi network is saved', async () => {
			const commands = mockNetworkManager([])

			await restoreWiFi(createUmbreld([undefined]))
			expect(nmcliCalls(commands)).toEqual([])
		})

		test('keeps retrying until the saved network connects', async () => {
			const commands = mockNetworkManager([10, 10, 10, 10, 0])
			const umbreld = createUmbreld([credentials])

			await restoreWiFi(umbreld)
			expect(nmcliCalls(commands).filter((command) => command === connectCommand)).toHaveLength(5)
			expect(umbreld.logger.log).toHaveBeenCalledWith('WiFi connection restored!')
		})

		test.each([
			['disconnects from WiFi', undefined],
			['switches to another network', {ssid: 'Neighbour', password: 'hunter33'}],
			['changes the password', {ssid: 'Home', password: 'hunter33'}],
		])('stops retrying when the user %s in the meantime', async (_, newWifiSettings) => {
			const commands = mockNetworkManager([10, 10, 0])
			const umbreld = createUmbreld([credentials, newWifiSettings])

			await restoreWiFi(umbreld)
			// Only the first attempt (with its rescan) ran, and nothing reconnected to the old network
			expect(nmcliCalls(commands)).toEqual([connectCommand, rescanCommand, connectCommand])
			expect(umbreld.logger.log).not.toHaveBeenCalledWith('WiFi connection restored!')
		})

		test('keeps retrying when the saved settings cannot be read', async () => {
			const commands = mockNetworkManager([10, 10, 0])
			const umbreld = createUmbreld([credentials, new Error('Failed to read store'), credentials])

			await expect(restoreWiFi(umbreld)).resolves.toBeUndefined()
			expect(nmcliCalls(commands).filter((command) => command === connectCommand)).toHaveLength(3)
			expect(umbreld.logger.log).toHaveBeenCalledWith('WiFi connection restored!')
		})
	})
})
