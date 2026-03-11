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
import {getCpuTemperature, getMemoryUsage, getDiskUsageByPath, shutdown, reboot} from './system.js'

vi.mock('systeminformation')
vi.mock('execa')
vi.mock('fs-extra')

afterEach(() => {
	vi.restoreAllMocks()
})

describe('getCpuTemperature', () => {
	test('should return main cpu temperature when system supports it', async () => {
		vi.mocked(systemInformation.cpuTemperature).mockResolvedValue({main: 69} as any)
		vi.mocked(systemInformation.system).mockResolvedValue({
			manufacturer: '',
			model: '',
			serial: '',
			uuid: '',
			sku: '',
			version: '',
		} as any)
		expect(await getCpuTemperature()).toMatchObject({warning: 'normal', temperature: 69})
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
