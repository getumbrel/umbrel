import {router, privateProcedure, publicProcedure} from '../trpc.js'

import {getCpuTemperature, getDiskUsage, getMemoryUsage, shutdown, reboot} from '../../../system.js'

export default router({
	// Public because we might want to ask user to update before they even log in?
	osVersion: publicProcedure.query(() => '1.0.0'),
	//
	cpuTemperature: privateProcedure.query(() => getCpuTemperature()),
	diskUsage: privateProcedure.query(({ctx}) => getDiskUsage(ctx.umbreld.dataDirectory)),
	memoryUsage: privateProcedure.query(() => getMemoryUsage()),
	shutdown: privateProcedure.mutation(() => shutdown()),
	reboot: privateProcedure.mutation(() => reboot()),
})
