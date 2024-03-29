// TODO: Re-enable this, we temporarily disable TS here since we broke tests
// and have since changed the API. We'll refactor these later.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import {describe, afterEach, expect, test, vi} from 'vitest'

// Mocks
import systemInformation from 'systeminformation'
import * as execa from 'execa'

import {getCpuTemperature, getMemoryUsage, getDiskUsage, shutdown, reboot} from './system.js'

vi.mock('systeminformation')
vi.mock('execa')

afterEach(() => {
	vi.restoreAllMocks()
})

describe('getCpuTemperature', () => {
	test('should return main cpu temperature when system supports it', async () => {
		vi.mocked(systemInformation.cpuTemperature).mockResolvedValue({main: 69} as any)
		expect(await getCpuTemperature()).toBe(69)
	})

	test('should throw error when system does not support cpu temperature', async () => {
		vi.mocked(systemInformation.cpuTemperature).mockResolvedValue({main: null} as any)
		expect(getCpuTemperature()).rejects.toThrow('Could not get CPU temperature')
	})
})

describe('getDiskUsage', () => {
	const mockData = [
		{
			size: 10_308_186_112,
			used: 3_557_232_640,
			available: 6_282_067_968,
			mount: '/',
		},
		{
			size: 209_489_920,
			used: 42_782_720,
			available: 166_707_200,
			mount: '/boot/efi',
		},
		{
			size: 1_963_188_352_000,
			used: 628_978_500_608,
			available: 1_271_395_512_320,
			mount: '/data',
		},
	]

	test('should return disk usage for specified path', async () => {
		vi.mocked(systemInformation.fsSize).mockResolvedValue(mockData as any)
		expect(await getDiskUsage('/home/umbrel/umbrel')).toMatchObject({
			size: 10_308_186_112,
			totalUsed: 3_557_232_640,
		})
	})

	test('should throw error when no matching filesystems are found', async () => {
		vi.mocked(systemInformation.fsSize).mockResolvedValue([])
		expect(getDiskUsage('/home/umbrel/umbrel')).rejects.toThrow(
			'Could not find file system containing Umbreld data directory',
		)
	})

	test('should throw error when umbreldDataDir is an empty string', async () => {
		vi.mocked(systemInformation.fsSize).mockResolvedValue(mockData as any)
		expect(getDiskUsage('')).rejects.toThrow('umbreldDataDir must be a non-empty string')
	})

	test('should throw error when umbreldDataDir is undefined', async () => {
		vi.mocked(systemInformation.fsSize).mockResolvedValue(mockData as any)
		// @ts-expect-error Testing invalid arguments
		expect(getDiskUsage()).rejects.toThrow('umbreldDataDir must be a non-empty string')
	})

	test('should return disk usage for the most specific mount point', async () => {
		vi.mocked(systemInformation.fsSize).mockResolvedValue([
			{
				size: 10_308_186_112,
				used: 3_557_232_640,
				available: 6_282_067_968,
				mount: '/home',
			},
			{
				size: 209_489_920,
				used: 42_782_720,
				available: 166_707_200,
				mount: '/home/umbrel/umbrel',
			},
		] as any)
		expect(await getDiskUsage('/home/umbrel/umbrel')).toMatchObject({
			size: 209_489_920,
			totalUsed: 42_782_720,
		})
	})
})

describe('getMemoryUsage', () => {
	test('should return memory usage', async () => {
		vi.mocked(systemInformation.mem).mockResolvedValue({
			total: 69_420,
			active: 420,
		} as any)
		expect(await getMemoryUsage()).toMatchObject({
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
