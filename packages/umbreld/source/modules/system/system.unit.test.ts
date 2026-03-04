// TODO: Re-enable this, we temporarily disable TS here since we broke tests
// and have since changed the API. We'll refactor these later.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import {describe, afterEach, expect, test, vi} from 'vitest'

// Mocks
import systemInformation from 'systeminformation'
import * as execa from 'execa'

import Umbreld from '../../index.js'
import {getCpuTemperature, getMemoryUsage, getDiskUsageByPath, shutdown, reboot} from './system.js'

vi.mock('systeminformation')
vi.mock('execa')

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
		vi.mocked(systemInformation.mem).mockResolvedValue({
			total: 69_420,
			active: 420,
		} as any)
		vi.mocked(execa.$).mockResolvedValue({
			stdout: '1 0.420',
		})
		expect(await getMemoryUsage(umbreld)).toMatchObject({
			size: 69_420,
			totalUsed: 420,
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
