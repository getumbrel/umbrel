import systemInformation from 'systeminformation'
import {$} from 'execa'
import fse from 'fs-extra'

import type Umbreld from '../index.js'

import getDirectorySize from './utilities/get-directory-size.js'

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

	// TODO: Fix this, it gets the disk usage of the system partition not the data partition on umbrelOS

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

	const downloadsDirectory = `${umbreld.dataDirectory}/data/storage/downloads/`
	let downloads = 0
	if (await fse.pathExists(downloadsDirectory)) downloads = await getDirectorySize(downloadsDirectory)

	return {
		size,
		totalUsed: used,
		system: used - appsTotal,
		downloads,
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
	// TODO: Handle errors so we don't kill the entire response
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

type CpuUsage = {
	id: string
	used: number
}

export async function getCpuUsage(umbreld: Umbreld): Promise<{
	threads: number
	totalUsed: number
	system: number
	apps: CpuUsage[]
}> {
	const cpu = await systemInformation.currentLoad()
	const threads = cpu.cpus.length
	// We devide all cpu usage by the number of threads to get the percentage usage of the overall CPU.
	// e.g If an app is maxxing out two cores the system will report 200% CPU usage. In a 4 core system
	// we want to report that as 50%.
	const totalUsed = cpu.currentLoad / threads

	// TODO: Handle errors so we don't kill the entire response
	const apps = await Promise.all(
		umbreld.apps.instances.map(async (app) => ({
			id: app.id,
			used: (await app.getCpuUsage()) / threads,
		})),
	)
	const appsTotal = apps.reduce((total, app) => total + app.used, 0)
	const system = Math.max(0, totalUsed - appsTotal)
	return {
		threads,
		totalUsed,
		system,
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

export async function commitOsPartition(umbreld: Umbreld): Promise<boolean> {
	try {
		await $`mender commit`
		umbreld.logger.log('Successfully commited to new OS partition.')
		return true
	} catch (error) {
		// TODO: We should detect if we're running in umbrelOS and make a bigger deal about this if it fails.
		umbreld.logger.error(`Failed to commit OS partition: ${(error as Error).message}`)
		return false
	}
}

type Device = 'pi4' | 'pi5' | 'home' | 'unknown'

export async function detectDevice(): Promise<Device> {
	const {model} = await systemInformation.system()
	if (model === 'Umbrel Home') return 'home'

	// I haven't been able to find another way to reliably detect Pi hardware. Most existing
	// solutions don't actually detect Pi hardware but just detect Pi OS which we don't match.
	// e.g systemInformation includes Pi detection which fails here. Also there's no SMBIOS so
	// no values like manufacturer or model to check. I did notice the Raspberry Pi model is
	// appended to the output of `/proc/cpuinfo` so we can use that to detect Pi hardware.
	try {
		const cpuInfo = await fse.readFile('/proc/cpuinfo')
		if (cpuInfo.includes('Raspberry Pi 5 ')) return 'pi5'
		if (cpuInfo.includes('Raspberry Pi 4 ')) return 'pi4'
	} catch (error) {
		// /proc/cpuinfo might not exist on some systems, do nothing.
	}

	// This will be returned for users running custom installs on self built Linux machines or VMs.
	return 'unknown'
}
