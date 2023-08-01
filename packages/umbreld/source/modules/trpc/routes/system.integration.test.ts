import {describe, expect, test} from 'vitest'
import systeminformation from 'systeminformation'

import system from './system.js'

const context = {
	umbreld: {dataDirectory: '/tmp'},
	logger: {error() {}},
}

const router = system.createCaller({
	...context,
	dangerouslyBypassAuthentication: true,
})
const unAuthedRouter = system.createCaller(context)

describe('cpuTemperature', async () => {
	const {main} = await systeminformation.cpuTemperature()
	const isCpuTemperatureSupported = typeof main === 'number'

	// Pick one of the following tests depending on what environmnet we're running on
	test.skipIf(!isCpuTemperatureSupported)('should return cpu temperature', async () => {
		expect(await router.cpuTemperature()).toBeTypeOf('number')
	})
	test.skipIf(isCpuTemperatureSupported)('should throw error if cpu temp is unsupported', async () => {
		expect(router.cpuTemperature).rejects.toThrow('Could not get CPU temperature')
	})

	test('should be behind authentication', async () => {
		expect(unAuthedRouter.cpuTemperature()).rejects.toHaveProperty('code', 'UNAUTHORIZED')
	})
})

describe('getDiskUsage', () => {
	test('should return disk usage', async () => {
		const result = await router.diskUsage()
		expect(result.size).toBeTypeOf('number')
		expect(result.used).toBeTypeOf('number')
		expect(result.available).toBeTypeOf('number')
	})

	test('should be behind authentication', async () => {
		expect(unAuthedRouter.diskUsage()).rejects.toHaveProperty('code', 'UNAUTHORIZED')
	})
})

describe('memoryUsage', () => {
	test('should return memory usage', async () => {
		const result = await router.memoryUsage()
		expect(result.size).toBeTypeOf('number')
		expect(result.used).toBeTypeOf('number')
		expect(result.available).toBeTypeOf('number')
	})

	test('should be behind authentication', async () => {
		expect(unAuthedRouter.memoryUsage()).rejects.toHaveProperty('code', 'UNAUTHORIZED')
	})
})
