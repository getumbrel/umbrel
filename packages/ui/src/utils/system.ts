import {RouterOutput} from '@/trpc/trpc'

export function trpcDiskToLocal(
	data?: RouterOutput['system']['diskUsage'] | RouterOutput['system']['systemDiskUsage'],
) {
	if (data === undefined) return undefined

	const used = data?.totalUsed
	const size = data?.size
	const available = !size || !used ? undefined : size - used

	return {
		used,
		size,
		available,
	}
}

export function trpcMemoryToLocal(
	data?: RouterOutput['system']['memoryUsage'] | RouterOutput['system']['systemMemoryUsage'],
) {
	if (data === undefined) return undefined

	const used = data?.totalUsed
	const size = data?.size
	const available = !size || !used ? undefined : size - used
	return {
		used,
		size,
		available,
	}
}

export function isTrpcDiskFull(data?: RouterOutput['system']['systemDiskUsage']) {
	return isDiskFull(trpcDiskToLocal(data)?.available)
}

export function isTrpcDiskLow(data?: RouterOutput['system']['systemDiskUsage']) {
	return isDiskLow(trpcDiskToLocal(data)?.available)
}

export function isTrpcMemoryLow(data?: RouterOutput['system']['systemMemoryUsage']) {
	return isMemoryLow({size: data?.size, used: data?.totalUsed})
}

// ---

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

export function isCpuTooHot(warning?: string) {
	if (warning === undefined) return false
	return warning === 'hot'
}

export function isMemoryLow({size, used}: {size?: number; used?: number}) {
	if (size === undefined || used === undefined) return false
	return used / size > 0.95
}
