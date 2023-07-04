import systemInformation from 'systeminformation'

export const getCpuTemperature = async () => {
	const cpuTemperature = await systemInformation.cpuTemperature()
	return cpuTemperature.main
}

export const getDiskUsage = async (umbreldDataDir) => {
	// TODO: get list of installed apps and their disk usage
	// to calculate the disk usage of each app
	const fileSystemSize = await systemInformation.fsSize()
	// Get the disk usage information for the file system containing the Umbreld data dir.
	// Sort by mount length to get the most specific mount point
	const [{size, used, available}] = fileSystemSize
		.filter((fs) => umbreldDataDir.startsWith(fs.mount))
		.sort((a, b) => b.mount.length - a.mount.length)
	return {
		size,
		used,
		available,
	}
}

export const getMemoryUsage = async () => {
	// TODO: get list of installed apps and their memory usage
	// to calculate the memory usage of each app
	const {total, free, used, active, available} = await systemInformation.mem()
	return {
		total,
		free,
		used,
		active,
		available,
	}
}
