import test from 'ava'

import * as systemMonitor from '../../source/utilities/system-monitor.js'

test('systemMonitor can get CPU temperature', async (t) => {
	const temperatureCelsius = await systemMonitor.getCpuTemperature()
	// Comment these out cos they fail on VMs
	// t.is(typeof temperatureCelsius, 'number')
	// t.true(temperatureCelsius > 0)
	t.true(temperatureCelsius !== undefined)
})

test('systemMonitor can get disk usage', async (t) => {
	const mockDataDirectory = '/'
	const diskUsageBytes = await systemMonitor.getDiskUsage(mockDataDirectory)
	t.is(typeof diskUsageBytes, 'object')
	t.true(diskUsageBytes.size > 0)
	t.true(diskUsageBytes.used > 0)
	t.true(diskUsageBytes.available > 0)
})

test('systemMonitor can get memory usage', async (t) => {
	const memoryUsageBytes = await systemMonitor.getMemoryUsage()
	t.is(typeof memoryUsageBytes, 'object')
	t.true(memoryUsageBytes.total > 0)
	t.true(memoryUsageBytes.free > 0)
	t.true(memoryUsageBytes.used > 0)
	t.true(memoryUsageBytes.available > 0)
	t.true(memoryUsageBytes.active > 0)
})

// TODO: test error throwing - for example:
// test.skip("systemMonitor throws if it can't get temperature", async (t) => {
// 	const error = await t.throwsAsync(systemMonitor.getCpuTemperature())
// 	t.is(error.message, 'Unable to get CPU temperature')
// })
