// TODO: Re-enable this, we temporarily disable TS here since we broke tests
// and have since changed the API. We'll refactor these later.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import {describe, afterEach, expect, test, vi} from 'vitest'

// Mocks
import systemInformation from 'systeminformation'
import * as execa from 'execa'

import Umbreld from '../index.js'
import {getCpuTemperature, getMemoryUsage, getDiskUsage, shutdown, reboot} from './system.js'

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

describe('getDiskUsage', () => {
	const mockData = [
		{
			fs: '/dev/sda',
			size: 10_308_186_112,
			used: 3_557_232_640,
			available: 6_282_067_968,
			mount: '/',
		},
		{
			fs: '/dev/sdb',
			size: 209_489_920,
			used: 42_782_720,
			available: 166_707_200,
			mount: '/boot/efi',
		},
		{
			fs: '/dev/sdc',
			size: 1_963_188_352_000,
			used: 628_978_500_608,
			available: 1_271_395_512_320,
			mount: '/data',
		},
	]

	test('should return disk usage for specified path', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		vi.mocked(systemInformation.fsSize).mockResolvedValue(mockData as any)
		vi.mocked(execa.$).mockResolvedValue({stdout: `\n/dev/sda`})
		expect(await getDiskUsage(umbreld)).toMatchObject({
			size: 10_308_186_112,
			totalUsed: 3_557_232_640,
		})
	})

	test('should throw error when no matching filesystems are found', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		vi.mocked(systemInformation.fsSize).mockResolvedValue([])
		vi.mocked(execa.$).mockResolvedValue({stdout: `\n/dev/sde`})
		expect(getDiskUsage(umbreld)).rejects.toThrow('Could not find file system containing Umbreld data directory')
	})

	test('should throw error when umbreldDataDir is an empty string', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		umbreld.dataDirectory = ''
		vi.mocked(systemInformation.fsSize).mockResolvedValue(mockData as any)
		expect(getDiskUsage(umbreld)).rejects.toThrow('umbreldDataDir must be a non-empty string')
	})

	test('should throw error when umbreldDataDir is undefined', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		umbreld.dataDirectory = undefined
		vi.mocked(systemInformation.fsSize).mockResolvedValue(mockData as any)
		expect(getDiskUsage(umbreld)).rejects.toThrow('umbreldDataDir must be a non-empty string')
	})

	test('should return disk usage for the most specific mount point', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		vi.mocked(systemInformation.fsSize).mockResolvedValue([
			{
				fs: '/dev/sda',
				size: 10_308_186_112,
				used: 3_557_232_640,
				available: 6_282_067_968,
				mount: '/home',
			},
			{
				fs: '/dev/sdb',
				size: 209_489_920,
				used: 42_782_720,
				available: 166_707_200,
				mount: '/home/umbrel/umbrel',
			},
		] as any)
		vi.mocked(execa.$).mockResolvedValue({stdout: `\n/dev/sdb`})
		expect(await getDiskUsage(umbreld)).toMatchObject({
			size: 209_489_920,
			totalUsed: 42_782_720,
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
