import os from 'node:os'
import {isIPv4} from 'node:net'
import {setTimeout} from 'node:timers/promises'

import systemInformation from 'systeminformation'
import {$, type ExecaError} from 'execa'
import fse from 'fs-extra'
import PQueue from 'p-queue'

import type Umbreld from '../../index.js'

import getDirectorySize from '../utilities/get-directory-size.js'

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

export async function getDiskUsageByPath(path: string): Promise<{size: number; totalUsed: number; available: number}> {
	if (typeof path !== 'string' || path === '') throw new Error('path must be a non-empty string')

	// Piggy back on df and get the result in bytes
	const df = await $`df --output=size,used,avail --block-size=1 ${path}`
	const [size, totalUsed, available] = df.stdout.split('\n').slice(-1)[0].split(' ').map(Number)

	return {size, totalUsed, available}
}

export async function getSystemDiskUsage(
	umbreld: Umbreld,
): Promise<{size: number; totalUsed: number; available: number}> {
	return await getDiskUsageByPath(umbreld.dataDirectory)
}

export async function getDiskUsage(
	umbreld: Umbreld,
): Promise<{size: number; totalUsed: number; system: number; files: number; apps: DiskUsage[]}> {
	const {size, totalUsed} = await getSystemDiskUsage(umbreld)

	// Get app disk usage
	const apps = await Promise.all(
		umbreld.apps.instances.map(async (app) => ({
			id: app.id,
			used: await app.getDiskUsage(),
		})),
	)
	const appsTotal = apps.reduce((total, app) => total + app.used, 0)

	const filesTotalUsage = (
		await Promise.all(
			[
				umbreld.files.getBaseDirectory('/Home'),
				umbreld.files.getBaseDirectory('/Trash'),
				umbreld.files.thumbnails.thumbnailDirectory,
			].map((directory) => getDirectorySize(directory).catch(() => 0)),
		)
	).reduce((total, usage) => total + usage, 0)

	const minSystemUsage = 2 * 1024 * 1024 * 1024 // 2GB

	return {
		size,
		totalUsed,
		system: Math.max(minSystemUsage, totalUsed - (appsTotal + filesTotalUsage)),
		files: filesTotalUsage,
		apps,
	}
}

// Returns a list of all processes and their memory usage
async function getProcessesMemory() {
	// Get a snapshot of system CPU and memory usage
	const ps = await $`ps -Ao pid,pss --no-header`

	// Format snapshot data
	const processes = ps.stdout.split('\n').map((line) => {
		// Parse values
		const [pid, pss] = line
			.trim()
			.split(/\s+/)
			.map((value) => Number(value))
		return {
			pid,
			// Convert proportional set size from kilobytes to bytes
			memory: pss * 1000,
		}
	})

	return processes
}

type MemoryUsage = {
	id: string
	used: number
}

export async function getSystemMemoryUsage(): Promise<{
	size: number
	totalUsed: number
}> {
	// Get total memory size
	const {total: size} = await systemInformation.mem()

	// Get a snapshot of system memory usage
	const processes = await getProcessesMemory()

	// Calculate total memory used by all processes
	const totalUsed = processes.reduce((total, process) => total + process.memory, 0)

	return {
		size,
		totalUsed,
	}
}

export async function getMemoryUsage(umbreld: Umbreld): Promise<{
	size: number
	totalUsed: number
	system: number
	apps: MemoryUsage[]
}> {
	// Get a snapshot of system memory usage
	const processes = await getProcessesMemory()

	// Get total and used memory size
	const {size, totalUsed} = await getSystemMemoryUsage()

	// Calculate memory used by the processes owned by each app
	const apps = await Promise.all(
		umbreld.apps.instances.map(async (app) => {
			let appUsed = 0
			try {
				const appPids = await app.getPids()
				appUsed = processes
					.filter((process) => appPids.includes(process.pid))
					.reduce((total, process) => total + process.memory, 0)
			} catch (error) {
				umbreld.logger.error(`Error getting memory`, error)
			}
			return {
				id: app.id,
				used: appUsed,
			}
		}),
	)

	// Calculate memory used by the system (total - apps)
	const appsTotal = apps.reduce((total, app) => total + app.used, 0)
	const system = Math.max(0, totalUsed - appsTotal)

	return {
		size,
		totalUsed,
		system,
		apps,
	}
}

// Returns a list of all processes and their cpu usage
async function getProcessesCpu() {
	// Get a snapshot of system CPU and memory usage
	const top = await $`top --batch-mode --iterations 1`

	// Get lines
	const lines = top.stdout.split('\n').map((line) => line.trim().split(/\s+/))

	// Find header and CPU column
	const headerIndex = lines.findIndex((line) => line[0] === 'PID')
	const cpuIndex = lines[headerIndex].findIndex((column) => column === '%CPU')

	// Get CPU threads
	const threads = os.cpus().length

	// Ignore lines before the header
	const processes = lines.slice(headerIndex + 1).map((line) => {
		// Parse values
		return {
			pid: parseInt(line[0], 10),
			// Convert to % of total system not % of a single thread
			cpu: parseFloat(line[cpuIndex]) / threads,
		}
	})

	return processes
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
	// Get a snapshot of system CPU usage
	const processes = await getProcessesCpu()

	// Calculate total CPU used by all processes
	const totalUsed = processes.reduce((total, process) => total + process.cpu, 0)

	// Calculate CPU used by the processes owned by each app
	const apps = await Promise.all(
		umbreld.apps.instances.map(async (app) => {
			let appUsed = 0
			try {
				const appPids = await app.getPids()
				appUsed = processes
					.filter((process) => appPids.includes(process.pid))
					.reduce((total, process) => total + process.cpu, 0)
			} catch (error) {
				umbreld.logger.error(`Error getting cpu`, error)
			}
			return {
				id: app.id,
				used: appUsed,
			}
		}),
	)

	// Calculate CPU used by the system (total - apps)
	const appsTotal = apps.reduce((total, app) => total + app.used, 0)
	const system = Math.max(0, totalUsed - appsTotal)

	// Get total CPU threads
	const threads = os.cpus().length

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
		umbreld.logger.log('Committing OS partition...')
		await $`mender commit`
		umbreld.logger.log('Successfully commited to new OS partition.')
		return true
	} catch (error) {
		if (
			(error as ExecaError).stderr?.includes('level=error msg="Could not commit Artifact: There is nothing to commit"')
		) {
			umbreld.logger.log('No new OS partition to commit.')
			return true
		}
		umbreld.logger.error(`Failed to commit OS partition`, error)
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
	if (model === 'U130122') device = 'Umbrel Home (2025)'
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

export async function setupPiCpuGovernor(umbreld: Umbreld): Promise<void> {
	try {
		if (await isRaspberryPi()) {
			await setCpuGovernor('ondemand')
			umbreld.logger.log(`Set ondemand cpu governor`)
		}
	} catch (error) {
		umbreld.logger.error(`Failed to set ondemand cpu governor`, error)
	}
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

export async function restoreWiFi(umbreld: Umbreld): Promise<void> {
	const wifiCredentials = await umbreld.store.get('settings.wifi')
	if (!wifiCredentials) return

	while (true) {
		umbreld.logger.log(`Attempting to restore WiFi connection to ${wifiCredentials.ssid}...`)
		try {
			await connectToWiFiNetwork(wifiCredentials)
			umbreld.logger.log(`WiFi connection restored!`)
			break
		} catch (error) {
			umbreld.logger.error(`Failed to restore WiFi connection, retrying in 1 minute`, error)
			await setTimeout(1000 * 60)
		}
	}
}

// Get IP addresses of the device
export function getIpAddresses(): string[] {
	// Known good interfaces:
	// - Umbrel Home 2024: enp1s0, wlo1 (predictable naming)
	// - Raspberry Pi 4/5: end0, wlan0 (custom naming)
	// - Docker Dev: eth0 (traditional naming)
	const excludeInterfaceNames = [
		// Bridge interfaces
		/^br\-/,
		// Known Docker-specific interfaces
		/^docker/,
		/^services/,
		// Virtual ethernet (pairs)
		/^veth/,
		// TODO: Tunnel interfaces?
		// /^tun/,
	]
	// Known good IPv4 ranges:
	// - Class A private: 10.0.0.0/8 := /^10\./
	// - Class B private: 172.16.0.0/12 := /^172\.(1[6-9]|2[0-9]|3[0-1])\./
	// - Class C private: 192.168.0.0/16 := /^192\.168\./
	const excludeAddressRanges = [
		// Local loopback (127.0.0.0/8)
		/^127\./,
		// Non-routable APIPA (169.254.0.0/16), e.g. misconfigured DHCP
		/^169\.254\./,
	]
	return (
		Object.entries(os.networkInterfaces())
			// Omit interfaces with excluded names
			.filter(([name]) => !excludeInterfaceNames.some((expression) => expression.test(name)))
			// Flatten interface map to an array of addresses
			.flatMap(([name, addresses = []]) => addresses.map((address) => ({name, ...address})))
			// Select valid non-loopback IPv4 addresses
			.filter((entry) => entry.family === 'IPv4' && !entry.internal && isIPv4(entry.address))
			// Omit addresses within excluded ranges
			.filter((entry) => !excludeAddressRanges.some((expression) => expression.test(entry.address)))
			// Return remaining addresses
			.map((entry) => entry.address)
	)
}

const syncDnsQueue = new PQueue({concurrency: 1})

// Update DNS configuration to match user settings
export async function syncDns() {
	return await syncDnsQueue.add(async () => {
		const {mtimeMs: mtimeBefore} = await fse.promises.stat('/etc/resolv.conf')
		await $`systemctl restart umbrel-dns-sync`
		await setTimeout(1000) // evade restart limits
		await $`systemctl restart NetworkManager`
		let retries = 2
		do {
			await setTimeout(1000)
			const {mtimeMs: mtimeAfter} = await fse.promises.stat('/etc/resolv.conf')
			if (mtimeAfter > mtimeBefore) return true
		} while (retries--)
		return false
	})
}

// Wait for Pi system time to be synced for up to the number of seconds passed in.
export async function waitForSystemTime(umbreld: Umbreld, timeout: number): Promise<void> {
	try {
		// Only run on Pi
		if (!(await isRaspberryPi())) return

		umbreld.logger.log('Checking if system time is synced before continuing...')
		let tries = 0
		while (tries < timeout) {
			tries++
			const timeStatus = await $`timedatectl status`
			const isSynced = timeStatus.stdout.includes('System clock synchronized: yes')
			if (isSynced) {
				umbreld.logger.log('System time is synced. Continuing...')
				return
			}
			umbreld.logger.log('System time is not currently synced, waiting...')
			await setTimeout(1000)
		}
		umbreld.logger.error('System time is not synced but timeout was reached. Continuing...')
	} catch (error) {
		umbreld.logger.error(`Failed to check system time`, error)
	}
}

export async function getHostname() {
	const hostname = await fse.readFile('/etc/hostname', 'utf8')
	return hostname.trim()
}
