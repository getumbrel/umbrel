import systemInformation from 'systeminformation'
import {$} from 'execa'

export async function getCpuTemperature(): Promise<number> {
	const cpuTemperature = await systemInformation.cpuTemperature()

	if (typeof cpuTemperature.main !== 'number') {
		throw new Error('Could not get CPU temperature')
	}

	return cpuTemperature.main
}

type DiskUsage = {
	id: string
	used: number
}

export async function getDiskUsage(
	umbreldDataDir: string,
): Promise<{size: number; totalUsed: number; system: number; downloads: number; apps: DiskUsage[]}> {
	if (typeof umbreldDataDir !== 'string' || umbreldDataDir === '') {
		throw new Error('umbreldDataDir must be a non-empty string')
	}

	// TODO: get list of installed apps and their disk usage
	// to calculate the disk usage of each app
	const fileSystemSize = await systemInformation.fsSize()

	// Get the disk usage information for the file system containing the Umbreld data dir.
	// Sort by mount length to get the most specific mount point
	const dataDirectoryFilesystem = fileSystemSize
		.filter((fs) => umbreldDataDir.startsWith(fs.mount))
		.sort((a, b) => b.mount.length - a.mount.length)[0]

	if (!dataDirectoryFilesystem) {
		throw new Error('Could not find file system containing Umbreld data directory')
	}

	const {size, used} = dataDirectoryFilesystem

	return {
		size,
		totalUsed: used,
		system: 69_420, // TODO: totalUsed - sumOfAppsAndDownloads,
		downloads: 42_690,
		apps: [
			{
				id: 'bitcoin',
				used: 30_000,
			},
			{
				id: 'lightning',
				used: 60_000,
			},
			{
				id: 'nostr-relay',
				used: 90_000,
			},
		],
	}
}

type MemoryUsage = {
	appId: string
	memory: number
}

export async function getMemoryUsage(): Promise<{
	size: number
	used: number
	available: number
	apps: MemoryUsage[]
}> {
	const {total: size, active: used, available} = await systemInformation.mem()
	return {
		size,
		used,
		available,
		// TODO: get list of installed apps and their memory usage
		// to calculate the memory usage of each app
		apps: [
			{
				appId: 'system',
				memory: Math.random() * 10_000,
			},
			{
				appId: 'bitcoin',
				memory: Math.random() * 10_000,
			},
			{
				appId: 'lightning',
				memory: Math.random() * 10_000,
			},
			{
				appId: 'nostr-relay',
				memory: Math.random() * 10_000,
			},
		],
	}
}

// TODO: For powercycle methods we will probably want to handle cleanly stopping
// as much Umbrel stuff as possible ourselves before handing over to the OS.
// This will give us more control over the order of things terminating and allow
// us to communicate shutdown progress with the user for as long as possible before
// umbreld gets killed.

export async function shutdown(): Promise<boolean> {
	await $`poweroff`

	return true
}

export async function reboot(): Promise<boolean> {
	await $`reboot`

	return true
}
