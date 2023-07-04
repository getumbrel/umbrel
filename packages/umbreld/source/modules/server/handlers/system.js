export const cpuTemperature = async ({response, system}) => {
	const temperatureCelsius = await system.getCpuTemperature()
	response.json({temperatureCelsius})
}

export const memoryUsage = async ({response, system}) => {
	const memoryUsageBytes = await system.getMemoryUsage()
	response.json({memoryUsageBytes})
}

export const diskUsage = async ({response, system}) => {
	const diskUsageBytes = await system.getDiskUsage(system.umbreld.dataDirectory)
	response.json({diskUsageBytes})
}

export const shutdown = async ({response, system}) => {
	// TODO: stop umbreld modules before restart
	await system.shutdown()
	response.json({success: true})
}

export const restart = async ({response, system}) => {
	// TODO: stop umbreld modules before restart
	await system.restart()
	response.json({success: true})
}
