export function isDiskLow(remaining: number) {
	// Return false because we don't want to show the warning if the disk is full
	if (isDiskFull(remaining)) return false
	// less than 1GB remaining
	return remaining < 1000000000
}

export function isDiskFull(remaining: number) {
	// Less than 100mb remaining
	return remaining < 100000000
}

export function isCpuTooHot(cpuTemperature: number) {
	return cpuTemperature > 80
}

export function isMemoryLow(memoryData: {used: number; size: number}) {
	return memoryData.used / memoryData.size > 0.95
}
