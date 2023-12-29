import {setTimeout} from 'node:timers/promises'
import {privateProcedure, router} from '../trpc.js'

import {getCpuTemperature, getDiskUsage, getMemoryUsage, reboot, shutdown} from '../../../system.js'

type Device = 'umbrel-home' | 'raspberry-pi' | 'linux'

export default router({
	// TODO: have consistent naming for these
	osVersion: privateProcedure.query(() => {
		// TODO: do this for real
		return '1.0.0'
	}),
	getLatestVersion: privateProcedure.query(async () => {
		// TODO: do this for real
		await setTimeout(1000)
		return '1.0.1'
	}),
	updateOs: privateProcedure.mutation(async () => {
		// TODO: do this for real
		await setTimeout(1000)
		return '1.0.1'
	}),
	//
	deviceInfo: privateProcedure.query(() => ({
		// Maybe rename `device` to `container` or `osContainer`?
		device: 'umbrel-home' as Device,
		modelNumber: 'U130121',
		serialNumber: 'U230300078',
	})),
	//
	cpuTemperature: privateProcedure.query(() => getCpuTemperature()),
	diskUsage: privateProcedure.query(({ctx}) => getDiskUsage(ctx.umbreld.dataDirectory)),
	memoryUsage: privateProcedure.query(() => getMemoryUsage()),
	shutdown: privateProcedure.mutation(() => shutdown()),
	reboot: privateProcedure.mutation(() => reboot()),
})
