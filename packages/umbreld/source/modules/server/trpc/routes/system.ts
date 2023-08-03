import {router, privateProcedure} from '../trpc.js'

import {getCpuTemperature, getDiskUsage, getMemoryUsage, shutdown, reboot} from '../../../system.js'

export default router({
	cpuTemperature: privateProcedure.query(() => getCpuTemperature()),
	diskUsage: privateProcedure.query(({ctx}) => getDiskUsage(ctx.umbreld.dataDirectory)),
	memoryUsage: privateProcedure.query(() => getMemoryUsage()),
	shutdown: privateProcedure.mutation(() => shutdown()),
	reboot: privateProcedure.mutation(() => reboot()),
})
