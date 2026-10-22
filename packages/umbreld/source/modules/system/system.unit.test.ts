// TODO: Re-enable this, we temporarily disable TS here since we broke tests
// and have since changed the API. We'll refactor these later.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import {describe, afterEach, expect, test, vi} from 'vitest'

// Mocks
import systemInformation from 'systeminformation'
import * as execa from 'execa'
import fse from 'fs-extra'

import Umbreld from '../../index.js'
import {
	getCpuTemperature,
	getMemoryUsage,
	getDiskUsage,
	getDiskUsageByPath,
	shutdown,
	reboot,
	restoreStaticIp,
} from './system.js'

vi.mock('systeminformation')
vi.mock('execa')
vi.mock('fs-extra')

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
		vi.mocked(fse.pathExists).mockResolvedValue(true)
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
