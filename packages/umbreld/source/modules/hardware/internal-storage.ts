import fse from 'fs-extra'
import nodePath from 'node:path'

import {$} from 'execa'

import type Umbreld from '../../index.js'

function kelvinToCelsius(kelvin: number): number {
	return kelvin - 273
}

export type NvmeDevice = {
	device: string
	id?: string
	pciSlotNumber?: number
	slot?: number
	name: string
	model: string
	serial: string
	size: number
	temperature?: number
	temperatureWarning?: number
	temperatureCritical?: number
	lifetimeUsed?: number
	smartStatus: 'healthy' | 'unhealthy' | 'unknown'
}

type NvmeSmartData = {
	temperature?: number
	temperatureWarning?: number
	temperatureCritical?: number
	lifetimeUsed?: number
	smartStatus: 'healthy' | 'unhealthy' | 'unknown'
}

// Parse NVMe SMART log and controller identify data for temperature and health
async function getNvmeSmartData(devicePath: string): Promise<NvmeSmartData> {
	try {
		// Get SMART log and controller identify data in parallel
		const [smartLogResult, idCtrlResult] = await Promise.all([
			$`nvme smart-log ${devicePath} --output-format=json`,
			$`nvme id-ctrl ${devicePath} --output-format=json`,
		])

		const smartData = JSON.parse(smartLogResult.stdout)
		const idCtrlData = JSON.parse(idCtrlResult.stdout)

		// Temperature is reported in Kelvin, convert to Celsius
		// The field is typically 'temperature' or 'temperature_sensor_1'
		let temperature: number | undefined
		if (typeof smartData.temperature === 'number') {
			temperature = kelvinToCelsius(smartData.temperature)
		} else if (typeof smartData.temperature_sensor_1 === 'number') {
			temperature = kelvinToCelsius(smartData.temperature_sensor_1)
		}

		// Get warning and critical temperature thresholds from controller identify
		// wctemp = Warning Composite Temperature Threshold (Kelvin)
		// cctemp = Critical Composite Temperature Threshold (Kelvin)
		let temperatureWarning: number | undefined
		let temperatureCritical: number | undefined
		if (typeof idCtrlData.wctemp === 'number' && idCtrlData.wctemp > 0) {
			temperatureWarning = kelvinToCelsius(idCtrlData.wctemp)
		}
		if (typeof idCtrlData.cctemp === 'number' && idCtrlData.cctemp > 0) {
			temperatureCritical = kelvinToCelsius(idCtrlData.cctemp)
		}

		// Get percent_used which indicates how much of the drive's rated endurance has been consumed
		// Values can exceed 100 if the drive has been used beyond its rated endurance
		let lifetimeUsed: number | undefined
		if (typeof smartData.percent_used === 'number') {
			lifetimeUsed = smartData.percent_used
		}

		// Check critical warning flags for health status
		// critical_warning is a bitmask: 0 means healthy
		const smartStatus = smartData.critical_warning === 0 ? 'healthy' : 'unhealthy'

		return {temperature, temperatureWarning, temperatureCritical, lifetimeUsed, smartStatus}
	} catch {
		return {smartStatus: 'unknown'}
	}
}

// Get the disk/by-id name for a device
// These paths are more stable than the device name which ddepedns on enumeration order.
async function getDeviceId(deviceName: string): Promise<string | undefined> {
	const byIdDir = '/dev/disk/by-id'
	try {
		const entries = await fse.readdir(byIdDir)
		const matchingIds: string[] = []

		for (const entry of entries) {
			try {
				// Skip partition entries (they end with -partN)
				if (/-part\d+$/.test(entry)) continue

				const fullPath = nodePath.join(byIdDir, entry)
				const target = await fse.readlink(fullPath)
				const resolvedTarget = nodePath.resolve(byIdDir, target)

				if (resolvedTarget === `/dev/${deviceName}`) matchingIds.push(entry)
			} catch {
				// Skip entries that can't be resolved
			}
		}

		if (matchingIds.length === 0) return undefined

		// Sort by preference order, then alphabetically for determinism
		// Preference order for by-id names (lower index = higher preference)
		// We prefer descriptive names with model/serial over opaque identifiers like eui
		const preferences = [
			/^nvme-eui\./,
			/^nvme-nvme\./,
			/^nvme-(?!eui\.|nvme\.)/, // nvme- but not nvme-eui. or nvme-nvme.
		]
		matchingIds.sort((a, b) => {
			const aIndex = preferences.findIndex((pattern) => pattern.test(a))
			const bIndex = preferences.findIndex((pattern) => pattern.test(b))
			// -1 means no match, treat as lowest priority
			const aPriority = aIndex === -1 ? preferences.length : aIndex
			const bPriority = bIndex === -1 ? preferences.length : bIndex
			if (aPriority !== bPriority) return aPriority - bPriority
			return a.localeCompare(b)
		})

		return matchingIds[0]
	} catch {
		// Directory might not exist or be readable
	}
	return undefined
}

// Get the PCIe Physical Slot Number for an NVMe device from its parent root port
// This is read from the Slot Capabilities register via lspci and is a stable identifier
// for the physical pci slot.
async function getDevicePciSlotNumber(deviceName: string): Promise<number | undefined> {
	try {
		// deviceName is like "nvme0n1", we need "nvme0" for the controller
		const controllerName = deviceName.replace(/n\d+$/, '')
		const sysfsPath = `/sys/class/nvme/${controllerName}/device`

		// Resolve the symlink to get the full device path
		// e.g., /sys/devices/pci0000:00/0000:00:1c.0/0000:01:00.0
		const devicePath = await fse.realpath(sysfsPath)

		// Extract the root port address from the path (second PCI address component)
		// Path format: /sys/devices/pci0000:00/0000:00:1c.0/0000:01:00.0
		const match = devicePath.match(/(0000:00:[0-9a-f]+\.[0-9a-f]+)\//)
		if (!match) return undefined

		const rootPortAddress = match[1]

		// Use lspci to get the Physical Slot Number from Slot Capabilities
		const {stdout} = await $`lspci -vvs ${rootPortAddress}`
		const slotMatch = stdout.match(/Slot #(\d+)/)
		if (slotMatch) return parseInt(slotMatch[1], 10)
	} catch {
		// Device might not exist or lspci might fail
	}
	return undefined
}

// Get all NVMe devices using lsblk and nvme commands
export async function getNvmeDevices(): Promise<NvmeDevice[]> {
	type LsBlkDevice = {
		name: string
		model?: string
		serial?: string
		size?: number
		type?: string
		tran?: string
	}

	const {stdout} = await $`lsblk --output NAME,MODEL,SERIAL,SIZE,TYPE,TRAN --json --bytes`
	const {blockdevices} = JSON.parse(stdout) as {blockdevices: LsBlkDevice[]}

	// Filter to only NVMe disk devices
	const nvmeBlockDevices = blockdevices.filter((device) => device.type === 'disk' && device.tran === 'nvme')

	// Fetch SMART data, device IDs, and PCIe slot numbers for all devices in parallel
	const nvmeDevices = await Promise.all(
		nvmeBlockDevices.map(async (device) => {
			const devicePath = `/dev/${device.name}`
			const [smartData, id, pciSlotNumber] = await Promise.all([
				getNvmeSmartData(devicePath),
				getDeviceId(device.name).catch(() => undefined),
				getDevicePciSlotNumber(device.name).catch(() => undefined),
			])

			return {
				device: device.name,
				id,
				pciSlotNumber,
				name: device.model?.trim() ?? 'Unknown NVMe Device',
				model: device.model?.trim() ?? 'Unknown',
				serial: device.serial?.trim() ?? 'Unknown',
				size: device.size ?? 0,
				temperature: smartData.temperature,
				temperatureWarning: smartData.temperatureWarning,
				temperatureCritical: smartData.temperatureCritical,
				lifetimeUsed: smartData.lifetimeUsed,
				smartStatus: smartData.smartStatus,
			}
		}),
	)

	// Sort by id
	return nvmeDevices.sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''))
}

export default class InternalStorage {
	#umbreld: Umbreld
	logger: Umbreld['logger']

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(`hardware:${name.toLowerCase()}`)
	}

	async start() {
		this.logger.log('Starting internal storage')
	}

	async stop() {
		this.logger.log('Stopping internal storage')
	}

	// Get all NVMe devices with their info
	async getDevices(): Promise<NvmeDevice[]> {
		let devices = await getNvmeDevices()

		// Attach slot numbers on Umbrel Pro
		if (await this.#umbreld.hardware.umbrelPro.isUmbrelPro()) {
			devices = devices.map((device) => ({
				...device,
				slot: this.#umbreld.hardware.umbrelPro.getSsdSlotFromPciSlotNumber(device.pciSlotNumber),
			}))
		}

		// Sort by slot number if all devices have slots
		const haveMissingSlots = devices.some((device) => device.slot === undefined)
		if (!haveMissingSlots) devices.sort((a, b) => a.slot! - b.slot!)

		return devices
	}
}
