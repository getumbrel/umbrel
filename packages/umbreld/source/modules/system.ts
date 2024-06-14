import systemInformation from 'systeminformation'
import {$} from 'execa'
import fse from 'fs-extra'

import type Umbreld from '../index.js'

import getDirectorySize from './utilities/get-directory-size.js'

export async function getCpuTemperature(): Promise<{
	warning: 'normal' | 'warm' | 'hot'
	temperature: number
}> {
	// Get CPU temperature
	const cpuTemperature = await systemInformation.cpuTemperature()
	if (typeof cpuTemperature.main !== 'number') throw new Error('Could not get CPU temperature')
	const temperature = cpuTemperature.main

	// Generic Intel thresholds
	let temperatureThreshold = {warm: 90, hot: 95}

	// Raspberry Pi thresholds
	if (await isRaspberryPi()) temperatureThreshold = {warm: 80, hot: 85}

	// Set warning level based on temperature
	let warning: 'normal' | 'warm' | 'hot' = 'normal'
	if (temperature >= temperatureThreshold.hot) warning = 'hot'
	else if (temperature >= temperatureThreshold.warm) warning = 'warm'

	return {
		warning,
		temperature,
	}
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

export async function isRaspberryPi() {
	const {productName} = await detectDevice()
	return productName === 'Raspberry Pi'
}

export async function isUmbrelOS() {
	return fse.exists('/umbrelOS')
}

export async function setCpuGovernor(governor: string) {
	await fse.writeFile('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor', governor)
}

export async function hasWifi() {
	const {stdout} = await $`nmcli --terse --fields TYPE device status`
	const networkDevices = stdout.split('\n')

	return networkDevices.includes('wifi')
}

export async function getWifiNetworks() {
	const listNetworks = await $`nmcli --terse --fields IN-USE,SSID,SECURITY,SIGNAL device wifi list`

	// Format into object
	const networks = listNetworks.stdout.split('\n').map((item: string) => {
		const [inUse, ssid, security, signal] = item.split(':')
		return {
			active: inUse === '*',
			ssid,
			authenticated: !!security,
			signal: parseInt(signal),
		}
	})

	const filteredNetworks = networks
		// Remove duplicate and empty SSIDs
		.filter((network, index, list) => {
			if (network.ssid === '') return false
			const indexOfFirstEntry = list.findIndex((item) => item.ssid === network.ssid)
			return indexOfFirstEntry === index
		})
		// Reapply active status in case it got removed in filtering
		.map((network) => {
			network.active = network.active || networks.some((item) => item.ssid === network.ssid && item.active)
			return network
		})
		// Order by SSID
		.sort((a, b) => a.ssid.localeCompare(b.ssid))

	return filteredNetworks
}

export async function deleteWifiConnections({inactiveOnly = false}: {inactiveOnly?: boolean}) {
	const connections = await $`nmcli --terse --fields UUID,TYPE,ACTIVE connection`
	for (const connection of connections.stdout.split('\n')) {
		const [uuid, type, active] = connection.split(':')
		// Type will be something like '802-11-wireless'
		if (!type?.includes('wireless')) continue
		if (inactiveOnly && active === 'yes') continue
		await $`nmcli connection delete ${uuid}`
	}
}

export async function connectToWiFiNetwork({ssid, password}: {ssid: string; password?: string}) {
	let connection
	if (password !== undefined) {
		connection = $`nmcli device wifi connect ${ssid} password ${password}`
	} else {
		connection = $`nmcli device wifi connect ${ssid}`
	}

	try {
		await connection

		// Destroy any inactive WiFi connections incase we just transitioned
		// from a previous wireless connection. We don't wanna leave that
		// conneciton in NetworkManager since it will be out of sync with umbreld.
		try {
			await deleteWifiConnections({inactiveOnly: true})
		} catch (error) {
			console.log(`Failed to cleanup WiFi connections: ${(error as Error).message}`)
		}

		return true
	} catch (error) {
		// We destroy the failed WiFi connection if we fail to connect to the network.
		// This is so umbreld retains ownership of the network connection management.
		// Otherwise if this fails nmcli will remember the connection and try to reconnect
		// which umbreld is not aware of.
		try {
			await deleteWifiConnections({inactiveOnly: true})
		} catch (error) {
			console.log(`Failed to cleanup WiFi connections: ${(error as Error).message}`)
		}

		if (connection.exitCode === 10) throw new Error('Network not found')
		if (connection.exitCode === 1 || connection.exitCode === 4) throw new Error('Incorrect password')
		throw new Error('Connection failed')
	}
}
