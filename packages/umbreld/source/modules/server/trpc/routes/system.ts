import {setTimeout} from 'node:timers/promises'
import {router, privateProcedure, publicProcedure} from '../trpc.js'

import {getCpuTemperature, getDiskUsage, getMemoryUsage, shutdown, reboot} from '../../../system.js'

export default router({
	osVersion: privateProcedure.query(() => {
		// TODO: do this for real
		return '1.0.0'
	}),
	getLatestVersion: privateProcedure.query(async () => {
		// TODO: do this for real
		await setTimeout(500)
		return '1.0.1'
	}),
	updateOs: privateProcedure.mutation(async () => {
		// TODO: do this for real
		await setTimeout(500)
		return '1.0.1'
	}),
	//
	cpuTemperature: privateProcedure.query(() => getCpuTemperature()),
	diskUsage: privateProcedure.query(({ctx}) => getDiskUsage(ctx.umbreld.dataDirectory)),
	memoryUsage: privateProcedure.query(() => getMemoryUsage()),
	shutdown: privateProcedure.mutation(() => shutdown()),
	reboot: privateProcedure.mutation(() => reboot()),
})
