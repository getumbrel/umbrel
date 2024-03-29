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

	// to calculate the disk usage of each app
	const fileSystemSize = await systemInformation.fsSize()

	// Get the disk usage information for the file system containing the Umbreld data dir.
	// Sort by mount length to get the most specific mount point
	const df = await $`df -h ${umbreld.dataDirectory}`
	const partition = df.stdout.split('\n').slice(-1)[0].split(' ')[0]
	const dataDirectoryFilesystem = fileSystemSize.find((filesystem) => filesystem.fs === partition)

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

	const minSystemUsage = 2 * 1024 * 1024 * 1024 // 2GB

	return {
		size,
		totalUsed: used,
		system: Math.max(minSystemUsage, used - (appsTotal + downloads)),
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
	let {total: size, active: totalUsed} = await systemInformation.mem()
	const apps = await Promise.all(
		umbreld.apps.instances.map(async (app) => ({
			id: app.id,
			used: await app.getMemoryUsage(),
		})),
	)
	const appsTotal = apps.reduce((total, app) => total + app.used, 0)

	const minSystemUsage = 100 * 1024 * 1024 // 100MB
	const system = Math.max(minSystemUsage, totalUsed - appsTotal)

	// Hack to make sure total always adds up and don't overflow.
	// These values come direct from Docker and don't seem to be very
	// accurate. We should implement our own custom logic and calculate
	// these values in a more reliable way.
	totalUsed = Math.min(size, appsTotal + system)

	return {
		size,
		totalUsed,
		system,
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
	const totalUsed = cpu.currentLoad

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

export async function detectDevice() {
	let {manufacturer, model, serial, uuid, sku, version} = await systemInformation.system()
	let productName = model
	model = sku
	let device = productName // TODO: Maybe format this better in the future.

	// Used for update server
	let deviceId = 'unknown'

	if (model === 'U130120') device = 'Umbrel Home (2023)'
	if (model === 'U130121') device = 'Umbrel Home (2024)'
	if (productName === 'Umbrel Home') deviceId = model

	// I haven't been able to find another way to reliably detect Pi hardware. Most existing
	// solutions don't actually detect Pi hardware but just detect Pi OS which we don't match.
	// e.g systemInformation includes Pi detection which fails here. Also there's no SMBIOS so
	// no values like manufacturer or model to check. I did notice the Raspberry Pi model is
	// appended to the output of `/proc/cpuinfo` so we can use that to detect Pi hardware.
	try {
		const cpuInfo = await fse.readFile('/proc/cpuinfo')
		if (cpuInfo.includes('Raspberry Pi ')) {
			manufacturer = 'Raspberry Pi'
			productName = 'Raspberry Pi'
			model = version
			if (cpuInfo.includes('Raspberry Pi 5 ')) {
				device = 'Raspberry Pi 5'
				deviceId = 'pi-5'
			}
			if (cpuInfo.includes('Raspberry Pi 4 ')) {
				device = 'Raspberry Pi 4'
				deviceId = 'pi-4'
			}
		}
	} catch (error) {
		// /proc/cpuinfo might not exist on some systems, do nothing.
	}

	// Blank out model and serial for non Umbrel Home devices
	if (productName !== 'Umbrel Home') {
		model = ''
		serial = ''
	}

	return {deviceId, device, productName, manufacturer, model, serial, uuid}
}

export async function isUmbrelOS() {
	return fse.exists('/umbrelOS')
}

export async function setCpuGovernor(governor: string) {
	await fse.writeFile('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor', governor)
}
