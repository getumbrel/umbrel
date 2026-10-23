import {describe, expect, test} from 'vitest'

import {
	calculateDrmUtilization,
	mergeGpuDeviceUsage,
	normalizePciAddress,
	parseDrmFdinfo,
	parseNvidiaGpuCsv,
	parseNvidiaPmon,
	parsePciControllers,
	type DrmClientSample,
} from './gpu-usage.ts'

describe('PCI GPU parsing', () => {
	test('normalizes NVIDIA and Linux PCI address formats', () => {
		expect(normalizePciAddress('00000000:63:00.0')).toBe('0000:63:00.0')
		expect(normalizePciAddress('0000:C7:00.0')).toBe('0000:c7:00.0')
	})

	test('keeps the PCI address and every display-controller subclass', () => {
		const output = [
			'0000:63:00.0 "VGA compatible controller [0300]" "NVIDIA Corporation [10de]" "GA104 [GeForce RTX 3060] [2487]"',
			'0000:c7:00.0 "Display controller [0380]" "Advanced Micro Devices, Inc. [AMD/ATI] [1002]" "Strix Halo [Radeon Graphics] [1586]"',
			'0000:c7:00.1 "Audio device [0403]" "Advanced Micro Devices, Inc. [AMD/ATI] [1002]" "Audio [1640]"',
		].join('\n')

		expect(parsePciControllers(output)).toStrictEqual([
			{id: '0000:63:00.0', vendor: 'NVIDIA Corporation', model: 'GA104 [GeForce RTX 3060]'},
			{
				id: '0000:c7:00.0',
				vendor: 'Advanced Micro Devices, Inc. [AMD/ATI]',
				model: 'Strix Halo [Radeon Graphics]',
			},
		])
	})
})

describe('DRM client usage', () => {
	test('parses engines and prefers resident memory without double-counting aliases', () => {
		const sample = parseDrmFdinfo(
			[
				'drm-driver: i915',
				'drm-pdev: 0000:00:02.0',
				'drm-client-id: 7',
				'drm-engine-render: 9288864723 ns',
				'drm-engine-video: 100000000 ns',
				'drm-engine-capacity-video: 2',
				'drm-total-memory: 2 MiB',
				'drm-memory-memory: 1536 KiB',
				'drm-resident-memory: 1024 KiB',
				'drm-resident-vram0: 8 MiB',
			].join('\n'),
			123,
		)

		expect(sample).toMatchObject({
			key: '0000:00:02.0:7',
			deviceId: '0000:00:02.0',
			pids: [123],
			engines: {
				render: {busy: 9_288_864_723, capacity: 1},
				video: {busy: 100_000_000, capacity: 2},
			},
			dedicatedMemoryUsed: 8 * 1024 ** 2,
			sharedMemoryUsed: 1024 * 1024,
		})
	})

	test('uses the busiest engine and attributes only that engine to clients', () => {
		const client = (key: string, render: number, copy: number): DrmClientSample => ({
			key,
			deviceId: '0000:00:02.0',
			pids: [Number(key.at(-1))],
			engines: {render: {busy: render, capacity: 1}, copy: {busy: copy, capacity: 1}},
			cycles: {},
			dedicatedMemoryUsed: 0,
			sharedMemoryUsed: 0,
		})
		const before = [client('client-1', 1_000_000_000, 1_000_000_000), client('client-2', 2_000_000_000, 2_000_000_000)]
		const after = [client('client-1', 1_100_000_000, 1_025_000_000), client('client-2', 2_050_000_000, 2_025_000_000)]

		expect(calculateDrmUtilization(before, after, 250_000_000).get('0000:00:02.0')).toStrictEqual({
			totalUsed: 60,
			clients: new Map([
				['client-1', 40],
				['client-2', 20],
			]),
		})
	})

	test('uses GPU cycle ratios and engine capacity when available', () => {
		const sample = (busy: number, total: number): DrmClientSample => ({
			key: 'xe-client',
			deviceId: '0000:03:00.0',
			pids: [1],
			engines: {},
			cycles: {ccs: {busy, total, capacity: 4}},
			dedicatedMemoryUsed: 0,
			sharedMemoryUsed: 0,
		})

		expect(calculateDrmUtilization([sample(100, 1_000)], [sample(300, 1_200)], 1).get('0000:03:00.0')).toStrictEqual({
			totalUsed: 25,
			clients: new Map([['xe-client', 25]]),
		})
	})
})

describe('NVIDIA usage parsing', () => {
	test('parses device utilization and framebuffer memory', () => {
		const [device] = parseNvidiaGpuCsv('0, GPU-7b97c340, 00000000:63:00.0, NVIDIA GeForce RTX 3060, 37, 12288, 2048')
		expect(device).toMatchObject({
			id: '0000:63:00.0',
			model: 'NVIDIA GeForce RTX 3060',
			totalUsed: 37,
			dedicatedMemory: {total: 12_288 * 1024 ** 2, used: 2_048 * 1024 ** 2},
		})
	})

	test('parses supported process metrics and preserves unsupported utilization', () => {
		const output = [
			'# gpu         pid   type     sm    mem    enc    dec    jpg    ofa     fb   ccpm    command',
			'# Idx           #    C/G      %      %      %      %      %      %     MB     MB    name',
			'    0       16695     C      42      0      -      -      -      -    152      0    nbody',
			'    0       16696     G       -      -      -      -      -      -     64      0    vulkan-app',
		].join('\n')

		expect(parseNvidiaPmon(output)).toStrictEqual([
			{index: 0, pid: 16695, used: 42, memoryUsed: 152 * 1024 ** 2},
			{index: 0, pid: 16696, used: null, memoryUsed: 64 * 1024 ** 2},
		])
	})

	test('uses NVIDIA process telemetry without double-counting matching DRM clients', () => {
		const drmProcess = {pids: [10], used: 25, dedicatedMemoryUsed: 256, sharedMemoryUsed: 0}
		const nvidiaProcess = {pids: [10], used: 30, dedicatedMemoryUsed: 256, sharedMemoryUsed: 0}
		const device = (model: string, processes: (typeof drmProcess)[]) => ({
			id: '0000:63:00.0',
			vendor: 'NVIDIA Corporation',
			model,
			totalUsed: 30,
			dedicatedMemory: {total: 1024, used: 256},
			sharedMemory: null,
			processes,
		})

		expect(mergeGpuDeviceUsage([device('drm', [drmProcess])], [device('RTX 3060', [nvidiaProcess])])).toHaveLength(1)
		expect(mergeGpuDeviceUsage([device('drm', [drmProcess])], [device('RTX 3060', [nvidiaProcess])])[0]).toMatchObject({
			model: 'RTX 3060',
			processes: [nvidiaProcess],
		})
		expect(mergeGpuDeviceUsage([device('drm', [drmProcess])], [device('RTX 3060', [])])[0].processes).toStrictEqual([
			drmProcess,
		])
	})
})
