import systemInformation from 'systeminformation'
import {$} from 'execa'

import type Umbreld from '../index.js'

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
	umbreld: Umbreld,
): Promise<{size: number; totalUsed: number; system: number; downloads: number; apps: DiskUsage[]}> {
	if (typeof umbreld.dataDirectory !== 'string' || umbreld.dataDirectory === '') {
		throw new Error('umbreldDataDir must be a non-empty string')
	}

	// TODO: get list of installed apps and their disk usage
	// to calculate the disk usage of each app
	const fileSystemSize = await systemInformation.fsSize()

	// Get the disk usage information for the file system containing the Umbreld data dir.
	// Sort by mount length to get the most specific mount point
	const dataDirectoryFilesystem = fileSystemSize
		.filter((fs) => umbreld.dataDirectory.startsWith(fs.mount))
		.sort((a, b) => b.mount.length - a.mount.length)[0]

	if (!dataDirectoryFilesystem) {
		throw new Error('Could not find file system containing Umbreld data directory')
	}

	const {size, used} = dataDirectoryFilesystem

	// Get app disk usage
	const apps = await Promise.all(
		umbreld.apps.instances.map(async (app) => ({
			id: app.id,
			used: await app.getDiskUsage(),
		})),
	)
	const appsTotal = apps.reduce((total, app) => total + app.used, 0)

	return {
		size,
		totalUsed: used,
		system: used - appsTotal,
		downloads: 42_690, // TODO: calculate this and also remove it from system
		apps,
	}
}

type MemoryUsage = {
	id: string
	used: number
}

export async function getMemoryUsage(umbreld: Umbreld): Promise<{
	size: number
	totalUsed: number
	system: number
	apps: MemoryUsage[]
}> {
	const {total: size, active: totalUsed} = await systemInformation.mem()
	const apps = await Promise.all(
		umbreld.apps.instances.map(async (app) => ({
			id: app.id,
			used: await app.getMemoryUsage(),
		})),
	)
	const appsTotal = apps.reduce((total, app) => total + app.used, 0)
	return {
		size,
		totalUsed,
		system: totalUsed - appsTotal,
		apps,
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
