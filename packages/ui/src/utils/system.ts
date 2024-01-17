export function isDiskLow(remaining?: number) {
	if (remaining === undefined) return false
	// Return false because we don't want to show the warning if the disk is full
	if (isDiskFull(remaining)) return false
	// less than 1GB remaining
	return remaining < 1000000000
}

export function isDiskFull(remaining?: number) {
	if (remaining === undefined) return false
	// Less than 100mb remaining
	return remaining < 100000000
}

export function isCpuTooHot(cpuTemperature: number) {
	return cpuTemperature > 80
}

export function isMemoryLow({size, used}: {size?: number; used?: number}) {
	if (size === undefined || used === undefined) return false
	return used / size > 0.95
}
