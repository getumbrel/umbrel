import os from 'node:os'
import {isIPv4} from 'node:net'
import {randomBytes} from 'node:crypto'
import {setTimeout} from 'node:timers/promises'

import systemInformation from 'systeminformation'
import {$, type ExecaError} from 'execa'
import fse from 'fs-extra'
import PQueue from 'p-queue'

import type Umbreld from '../../index.js'

import getDirectorySize from '../utilities/get-directory-size.js'
import {escapeSpecialRegExpLiterals} from '../utilities/regexp.js'
import pWaitFor from 'p-wait-for'

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
	// TODO: Do this a cleaner way
	if (await umbreld.hardware.umbrelPro.isUmbrelPro()) {
		const pool = await umbreld.hardware.raid.getStatus()
		if (pool.exists) {
			return {
				size: pool.usableSpace ?? 0,
				totalUsed: pool.usedSpace ?? 0,
				available: pool.freeSpace ?? 0,
			}
		}
	}
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

function getProcMemoryField(contents: string, field: string): number | null {
	const match = new RegExp(`^${field}:\\s+(\\d+)\\s+kB$`, 'm').exec(contents)
	if (!match) return null
	const value = Number(match[1])
	if (!Number.isFinite(value) || value < 0) return null
	return clampByteCount(value * 1024)
}

function clampNonNegativeNumber(value: number): number {
	if (!Number.isFinite(value)) return 0
	return Math.max(0, value)
}

function clampByteCount(value: number, max = Number.MAX_SAFE_INTEGER): number {
	const safeMax = clampNonNegativeNumber(max)
	const safeValue = clampNonNegativeNumber(value)
	return Math.min(safeMax, Math.round(safeValue))
}

// Returns a map of Docker container name to full container ID by running
// a single `docker ps` command. This lets us locate cgroup paths efficiently.
async function getDockerContainerIds(): Promise<Map<string, string>> {
	try {
		const {stdout} = await $`docker ps --no-trunc --format={{.ID}}|{{.Names}}`
		const result = new Map<string, string>()
		for (const line of stdout.trim().split('\n')) {
			if (!line) continue
			const separatorIndex = line.indexOf('|')
			if (separatorIndex === -1) continue
			const id = line.slice(0, separatorIndex)
			const name = line.slice(separatorIndex + 1)
			if (id && name) result.set(name, id)
		}
		return result
	} catch {
		return new Map()
	}
}

// Reads cgroup v2 memory usage for a Docker container.
// We subtract inactive_file from memory.current because inactive file cache is
// easily reclaimable and not counted as "used" by MemAvailable. This matches
// the convention Docker uses for its own memory reporting in `docker stats`.
async function getContainerCgroupMemory(containerId: string): Promise<{used: number; swap: number}> {
	try {
		const cgroupPath = `/sys/fs/cgroup/system.slice/docker-${containerId}.scope`
		const [currentStr, memoryStat, swapStr] = await Promise.all([
			fse.readFile(`${cgroupPath}/memory.current`, 'utf8'),
			fse.readFile(`${cgroupPath}/memory.stat`, 'utf8'),
			fse.readFile(`${cgroupPath}/memory.swap.current`, 'utf8').catch(() => '0'),
		])
		const current = clampNonNegativeNumber(parseInt(currentStr.trim(), 10))
		const inactiveFile = clampNonNegativeNumber(parseInt(memoryStat.match(/^inactive_file (\d+)$/m)?.[1] ?? '0', 10))
		return {
			used: clampNonNegativeNumber(current - inactiveFile),
			swap: clampNonNegativeNumber(parseInt(swapStr.trim(), 10)),
		}
	} catch {
		return {used: 0, swap: 0}
	}
}

// Returns the average ratio of RAM used per swapped byte in zram.
// We cannot query compressed zram usage per-process, so this global ratio is
// applied to each app's SwapPss as an approximation.
async function getZramRamFactor(): Promise<number> {
	try {
		const mmStat = await fse.readFile('/sys/block/zram0/mm_stat', 'utf8')
		const [origDataSize, , memUsedTotal] = mmStat
			.trim()
			.split(/\s+/)
			.map((value) => Number(value))
		if (!Number.isFinite(origDataSize) || !Number.isFinite(memUsedTotal) || origDataSize <= 0) return 0
		return clampNonNegativeNumber(memUsedTotal / origDataSize)
	} catch {
		return 0
	}
}

// Returns the reclaimable portion of ZFS ARC in bytes. ARC is a filesystem
// cache that MemAvailable doesn't account for. Under high memory pressure
// the ARC can shrink down to c_min, so the reclaimable portion is size - c_min.
async function getReclaimableZfsArcSize(): Promise<number> {
	try {
		const arcstats = await fse.readFile('/proc/spl/kstat/zfs/arcstats', 'utf8')
		const getField = (name: string) => {
			const match = arcstats.match(new RegExp(`^${name}\\s+\\d+\\s+(\\d+)$`, 'm'))
			return match ? parseInt(match[1], 10) : 0
		}
		return clampNonNegativeNumber(getField('size') - getField('c_min'))
	} catch {
		return 0
	}
}

// Returns total and pressure-relevant used memory from /proc/meminfo.
// Uses MemAvailable which reflects reclaimable memory and matches free/htop semantics.
// Also subtracts reclaimable ZFS ARC since MemAvailable doesn't account for it.
async function getSystemMemoryFromMeminfo(): Promise<{size: number; totalUsed: number}> {
	const [meminfo, arcSize] = await Promise.all([fse.readFile('/proc/meminfo', 'utf8'), getReclaimableZfsArcSize()])
	const size = clampByteCount(getProcMemoryField(meminfo, 'MemTotal') ?? 0)
	const memAvailable = clampByteCount(getProcMemoryField(meminfo, 'MemAvailable') ?? 0)
	const totalUsed = clampByteCount(size - memAvailable - arcSize, size)
	return {size, totalUsed}
}

type MemoryUsage = {
	id: string
	used: number
}

export async function getSystemMemoryUsage(): Promise<{
	size: number
	totalUsed: number
}> {
	return await getSystemMemoryFromMeminfo()
}

export async function getMemoryUsage(umbreld: Umbreld): Promise<{
	size: number
	totalUsed: number
	system: number
	apps: MemoryUsage[]
}> {
	// Attribution model:
	// - totalUsed: system-wide pressure-relevant used memory from MemAvailable
	// - app.used: cgroup memory.current + (memory.swap.current * avg zram RAM ratio)
	//   This captures all memory the kernel charges to the container: process RSS,
	//   file cache, slab, page tables, and kernel stacks — not just process-visible PSS.
	// - system: residual (totalUsed - sum(app.used))

	// Read meminfo first so the measurment isn't affected by docker
	const {size, totalUsed} = await getSystemMemoryFromMeminfo()
	const [containerIds, zramRamFactor] = await Promise.all([getDockerContainerIds(), getZramRamFactor()])
	const safeZramRamFactor = clampNonNegativeNumber(zramRamFactor)

	const apps = await Promise.all(
		umbreld.apps.instances.map(async (app) => {
			try {
				const containerNames = await app.getContainerNames()

				// Look up cgroup memory for each of the app's containers.
				const cgroupResults = await Promise.all(
					containerNames.map(async (name) => {
						const containerId = containerIds.get(name)
						if (!containerId) return {used: 0, swap: 0}
						return getContainerCgroupMemory(containerId)
					}),
				)

				const appUsed = clampByteCount(cgroupResults.reduce((total, cg) => total + cg.used, 0))
				const appSwap = clampByteCount(cgroupResults.reduce((total, cg) => total + cg.swap, 0))

				return {
					id: app.id,
					used: clampByteCount(appUsed + appSwap * safeZramRamFactor, size),
				}
			} catch (error) {
				umbreld.logger.error(`Error getting memory`, error)
				return {
					id: app.id,
					used: 0,
				}
			}
		}),
	)

	// Calculate memory used by the system (total - apps)
	const appsTotal = clampByteCount(apps.reduce((total, app) => total + app.used, 0))
	const system = clampByteCount(totalUsed - appsTotal, totalUsed)

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
		await $`rugix-ctrl system commit`
		umbreld.logger.log('Successfully commited to new OS partition.')
		return true
	} catch (error) {
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

	// No year suffix for Umbrel Pro until if/when a newer model exists
	if (model === 'U4XN1') device = 'Umbrel Pro'
	if (productName === 'Umbrel Pro') deviceId = model

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

	// Blank out model and serial for non Umbrel devices
	if (productName !== 'Umbrel Home' && productName !== 'Umbrel Pro') {
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

type NetworkInterface = {
	id: string
	mac: string
	type: 'ethernet' | 'wifi'
	connected: boolean
	configuredStaticSettings?: {
		ip: string
		subnetPrefix: number
		gateway: string
		dns: string[]
	}
	ipMethod?: 'dhcp' | 'static'
	ip?: string
	subnetPrefix?: number
	gateway?: string
	dns?: string[]
}

// Get all physical network interfaces with connection details
export async function getNetworkInterfaces(umbreld?: Umbreld): Promise<NetworkInterface[]> {
	const {stdout: deviceOutput} = await $`nmcli --terse --fields DEVICE,TYPE,STATE,CONNECTION device status`
	const configuredStaticSettings = (await umbreld?.store.get('settings.staticIp')) ?? {}

	const interfaces = await Promise.all(
		deviceOutput
			.split('\n')
			.filter((line) => line.trim())
			.map((line) => {
				const parts = line.split(':')
				return {
					device: parts[0],
					type: parts[1],
					state: parts[2],
					// Connection name could contain colons, so join remaining parts
					connection: parts.slice(3).join(':'),
				}
			})
			// Only include ethernet and wifi types
			.filter(({type}) => type === 'ethernet' || type === 'wifi')
			.map(async ({device, type, state, connection}) => {
				// For ethernet interfaces, verify they're backed by physical hardware
				// by checking for the presence of a device symlink in sysfs. Virtual
				// interfaces (veth, bridges, docker) won't have this.
				if (type === 'ethernet') {
					const isPhysical = await fse.pathExists(`/sys/class/net/${device}/device`)
					if (!isPhysical) return null
				}

				const mac = (await fse.readFile(`/sys/class/net/${device}/address`, 'utf8')).trim()

				const iface: NetworkInterface = {
					id: device,
					mac,
					type: type as 'ethernet' | 'wifi',
					connected: state === 'connected',
				}
				const configuredStaticSetting = configuredStaticSettings[mac]
				if (configuredStaticSetting) iface.configuredStaticSettings = configuredStaticSetting

				// If connected, get IP configuration from the active connection
				if (iface.connected && connection && connection !== '--') {
					try {
						const {stdout} =
							await $`nmcli --terse --fields ipv4.method,IP4.ADDRESS,IP4.GATEWAY,IP4.DNS connection show ${connection}`

						// nmcli terse format uses ":" as delimiter with keys like
						// "IP4.ADDRESS[1]", "IP4.DNS[1]", "IP4.DNS[2]" for multi-value fields
						for (const connLine of stdout.split('\n')) {
							const [key, ...valueParts] = connLine.split(':')
							const value = valueParts.join(':')

							if (key === 'ipv4.method') {
								iface.ipMethod = value === 'manual' ? 'static' : 'dhcp'
							} else if (key.startsWith('IP4.ADDRESS') && !iface.ip) {
								const [ip, prefix] = value.split('/')
								iface.ip = ip
								iface.subnetPrefix = parseInt(prefix)
							} else if (key === 'IP4.GATEWAY' && value && value !== '0.0.0.0') {
								iface.gateway = value
							} else if (key.startsWith('IP4.DNS') && value) {
								if (!iface.dns) iface.dns = []
								iface.dns.push(value)
							}
						}
					} catch {
						// Connection details unavailable
					}
				}

				return iface
			}),
	)

	// Filter out null entries (virtual ethernet interfaces)
	return interfaces.filter((iface) => iface !== null)
}

// Find an interface by MAC address
async function getInterfaceByMac(mac: string): Promise<NetworkInterface> {
	const networkInterface = (await getNetworkInterfaces()).find((iface) => iface.mac === mac)
	if (networkInterface) return networkInterface
	throw new Error(`No interface found with MAC address ${mac}`)
}

// Find the saved connection name for a device, even if it's not currently connected
async function getConnectionByDevice(device: string): Promise<string | false> {
	// `nmcli device status` only shows the active connection, which is not enough
	// when we need to clear static IP settings from a disconnected interface.
	const {stdout: uuidsOutput} = await $`nmcli --terse --fields UUID connection show`
	for (const uuid of uuidsOutput.split('\n')) {
		if (!uuid.trim()) continue
		try {
			const {stdout} = await $`nmcli --terse --fields connection.interface-name,connection.id connection show ${uuid}`
			let connectionDevice = ''
			let connectionId = ''
			for (const line of stdout.split('\n')) {
				const [key, ...valueParts] = line.split(':')
				const value = valueParts.join(':')
				if (key === 'connection.interface-name') connectionDevice = value
				else if (key === 'connection.id') connectionId = value
			}
			if (connectionDevice === device && connectionId) return connectionId
		} catch {
			continue
		}
	}
	return false
}

// Apply a static IP configuration to an interface via nmcli
async function applyStaticIp({
	mac,
	ip,
	subnetPrefix,
	gateway,
	dns,
}: {
	mac: string
	ip: string
	subnetPrefix: number
	gateway: string
	dns: string[]
}) {
	const {id: device} = await getInterfaceByMac(mac)

	// Get the connection id, or create a new connection
	let connection = await getConnectionByDevice(device)
	let existingConnection = true
	if (!connection) {
		existingConnection = false
		const hex = randomBytes(4).toString('hex')
		connection = `wired-connection-${hex}`
		await $`nmcli connection add type ethernet con-name ${connection} ifname ${device}`
	}

	// Modify the connection with static ip settings
	await $`nmcli connection modify ${connection} ipv4.method manual ipv4.addresses ${`${ip}/${subnetPrefix}`} ipv4.gateway ${gateway} ipv4.dns ${dns.join(',')}`

	// If we modified an existing connction, hard reload it
	if (existingConnection) {
		await $`nmcli connection down ${connection}`
		await $`nmcli connection up ${connection}`
	}
	return device
}

// Track confirmed static IP — set by confirmStaticIp endpoint when client pings back
let confirmedStaticIp = ''

export function confirmStaticIp(ip: string) {
	confirmedStaticIp = ip
}

// Set a static IP configuration on a network interface
export async function setStaticIp(
	umbreld: Umbreld,
	config: {mac: string; ip: string; subnetPrefix: number; gateway: string; dns: string[]},
) {
	const {mac, ip, subnetPrefix, gateway, dns} = config
	const networkInterface = await getInterfaceByMac(mac)
	if (networkInterface.type === 'wifi') throw new Error('Static IP is not supported for WiFi interfaces')

	// Capture previous config for rollback
	const currentSettings = await umbreld.store.get('settings.staticIp')
	const previousConfig = currentSettings?.[mac] ? {mac, ...currentSettings[mac]} : null

	// Apply the new config
	await applyStaticIp(config)

	// Wait for the client to confirm connectivity by calling confirmStaticIp
	// with the new IP. If not confirmed within 30 seconds, revert.
	confirmedStaticIp = ''
	try {
		await pWaitFor(() => confirmedStaticIp === ip, {interval: 100, timeout: 30_000})
	} catch {
		// Timed out — revert to previous config
		if (previousConfig) await applyStaticIp(previousConfig).catch(() => {})
		else await clearStaticIp(umbreld, {mac}).catch(() => {})
		throw new Error('Static IP change was not confirmed within 30 seconds, reverted to previous settings')
	}

	// If we haven't thrown by now the new static IP settings are confirmed to be working, so we can persist them.
	// Persist to store so settings survive reboots
	await umbreld.store.getWriteLock(async ({get, set}) => {
		const settings = (await get('settings.staticIp')) ?? {}
		settings[mac] = {ip, subnetPrefix, gateway, dns}
		await set('settings.staticIp', settings)
	})
}

// Clear static IP and revert to DHCP
export async function clearStaticIp(umbreld: Umbreld, {mac}: {mac: string}) {
	const networkInterface = await getInterfaceByMac(mac)
	const device = networkInterface.id
	const connection = await getConnectionByDevice(device)
	if (connection) {
		await $`nmcli connection modify ${connection} ipv4.method auto ipv4.addresses ${''} ipv4.gateway ${''} ipv4.dns ${''}`
		// If the interface is disconnected we still want to clear the saved
		// profile, but there is no live connection to bounce.
		if (networkInterface.connected) {
			await $`nmcli connection down ${connection}`
			await $`nmcli connection up ${connection}`
		}
	}

	// Remove from store
	await umbreld.store.getWriteLock(async ({get, set}) => {
		const settings = (await get('settings.staticIp')) ?? {}
		delete settings[mac]
		await set('settings.staticIp', settings)
	})
}

// Restore static IP settings from store on startup
export async function restoreStaticIp(umbreld: Umbreld): Promise<void> {
	const settings = await umbreld.store.get('settings.staticIp')
	if (!settings) return

	for (const [mac, config] of Object.entries(settings)) {
		try {
			const networkInterface = await getInterfaceByMac(mac)
			if (networkInterface.type === 'wifi') {
				umbreld.logger.log(`Skipping static IP restore for ${mac}: WiFi interfaces are not supported`)
				continue
			}
			const device = await applyStaticIp({mac, ...config})
			umbreld.logger.log(`Restored static IP for ${mac} (${device})`)
		} catch (error) {
			umbreld.logger.error(`Failed to restore static IP for ${mac}`, error)
		}
	}
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

async function applyHostname(umbreld: Umbreld, hostname: string) {
	const previousHostname = await getHostname().catch(() => '')

	// Update static hostname and hosts mapping
	await fse.writeFile('/etc/hostname', `${hostname}\n`)

	const etcHosts = await fse.readFile('/etc/hosts', 'utf8')
	const previousHostnameInEtcHostsRe =
		previousHostname &&
		new RegExp(`^(\\s*127\\.0\\.(?:0|1)\\.1\\s+)${escapeSpecialRegExpLiterals(previousHostname)}\\s*$`, 'm')
	let updatedEtcHosts = previousHostnameInEtcHostsRe
		? etcHosts.replace(previousHostnameInEtcHostsRe, `$1${hostname}`)
		: etcHosts

	const hostnameInEtcHostsRe = new RegExp(
		`^\\s*127\\.0\\.(?:0|1)\\.1\\s+${escapeSpecialRegExpLiterals(hostname)}\\s*$`,
		'm',
	)
	if (!hostnameInEtcHostsRe.test(updatedEtcHosts)) {
		updatedEtcHosts = `${updatedEtcHosts.trimEnd()}\n127.0.0.1       ${hostname}\n`
	}
	if (updatedEtcHosts !== etcHosts) await fse.writeFile('/etc/hosts', updatedEtcHosts)

	// Apply new hostname
	await $`hostname ${hostname}`

	// Restart hostname-dependent services
	await $`systemctl restart avahi-daemon`

	umbreld.logger.log(`Applied hostname '${hostname}'`)
	return hostname
}

export async function setHostname(umbreld: Umbreld, hostname: string) {
	const previousConfiguredHostname = await umbreld.store.get('settings.hostname')

	await umbreld.store.set('settings.hostname', hostname)
	try {
		return await applyHostname(umbreld, hostname)
	} catch (error) {
		if (previousConfiguredHostname) await umbreld.store.set('settings.hostname', previousConfiguredHostname)
		else await umbreld.store.delete('settings.hostname')
		throw error
	}
}

export async function restoreHostname(umbreld: Umbreld) {
	const configuredHostname = await umbreld.store.get('settings.hostname')
	if (!configuredHostname) return
	try {
		await applyHostname(umbreld, configuredHostname)
	} catch (error) {
		umbreld.logger.error(`Failed to restore hostname`, error)
	}
}
