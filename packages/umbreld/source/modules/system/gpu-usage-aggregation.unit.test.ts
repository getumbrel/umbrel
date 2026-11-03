import {expect, test} from 'vitest'

import type {GpuDeviceUsage} from '../hardware/gpu-usage.ts'
import {aggregateGpuUsage} from './system.ts'

test('aggregates mixed GPUs without counting shared GPU allocations as extra system RAM', () => {
	const gib = 1024 ** 3
	const devices: GpuDeviceUsage[] = [
		{
			id: '0000:c7:00.0',
			vendor: 'AMD',
			model: 'Strix Halo',
			totalUsed: 80,
			dedicatedMemory: {total: gib, used: gib},
			sharedMemory: {used: 5 * gib},
			processes: [
				{
					pids: [101, 102],
					used: null,
					dedicatedMemoryUsed: 0,
					sharedMemoryUsed: 5 * gib,
				},
			],
		},
		{
			id: '0000:63:00.0',
			vendor: 'NVIDIA',
			model: 'RTX 3060',
			totalUsed: 30,
			dedicatedMemory: {total: 12 * gib, used: 2 * gib},
			sharedMemory: null,
			processes: [
				{
					pids: [101],
					used: 20,
					dedicatedMemoryUsed: 1.5 * gib,
					sharedMemoryUsed: 0,
				},
				{
					pids: [999],
					used: 5,
					dedicatedMemoryUsed: 0.5 * gib,
					sharedMemoryUsed: 0,
				},
			],
		},
	]

	const usage = aggregateGpuUsage(
		devices,
		new Map([
			[101, 'ai-app'],
			[102, 'ai-app'],
		]),
	)

	expect(usage).toMatchObject({
		totalUsed: 80,
		memoryUsed: 8 * gib,
		system: 60,
		systemMemoryUsed: 1.5 * gib,
		apps: [{id: 'ai-app', used: 20, memoryUsed: 6.5 * gib}],
	})
	// Shared allocations are reported as GPU telemetry but are not fed back
	// into memoryUsage, so this aggregate has no field that changes RAM totals.
	expect(usage.devices[0].sharedMemory).toStrictEqual({used: 5 * gib})
	expect(usage.devices[1].sharedMemory).toStrictEqual(null)
})

test('leaves a DRM client shared by different apps in the system residual', () => {
	const usage = aggregateGpuUsage(
		[
			{
				id: '0000:00:02.0',
				vendor: 'Intel',
				model: 'Intel Graphics',
				totalUsed: 50,
				dedicatedMemory: null,
				sharedMemory: {used: 1024},
				processes: [{pids: [10, 20], used: 30, dedicatedMemoryUsed: 0, sharedMemoryUsed: 1024}],
			},
		],
		new Map([
			[10, 'app-a'],
			[20, 'app-b'],
		]),
	)

	expect(usage.apps).toStrictEqual([])
	expect(usage.system).toBe(50)
	expect(usage.systemMemoryUsed).toBe(1024)
})

test('scales app utilization to a device-wide sample without changing memory attribution', () => {
	const usage = aggregateGpuUsage(
		[
			{
				id: '0000:c7:00.0',
				vendor: 'AMD',
				model: 'Strix Halo',
				totalUsed: 40,
				dedicatedMemory: {total: 1024, used: 900},
				sharedMemory: null,
				processes: [
					{pids: [10], used: 60, dedicatedMemoryUsed: 600, sharedMemoryUsed: 0},
					{pids: [20], used: 20, dedicatedMemoryUsed: 200, sharedMemoryUsed: 0},
				],
			},
		],
		new Map([
			[10, 'app-a'],
			[20, 'app-b'],
		]),
	)

	expect(usage.apps).toStrictEqual([
		{id: 'app-a', used: 30, memoryUsed: 600},
		{id: 'app-b', used: 10, memoryUsed: 200},
	])
	expect(usage.system).toBe(0)
	expect(usage.systemMemoryUsed).toBe(100)
})
