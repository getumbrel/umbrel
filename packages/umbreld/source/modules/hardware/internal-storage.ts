import fse from 'fs-extra'
import nodePath from 'node:path'

import {$} from 'execa'

import type Umbreld from '../../index.js'
import {getRoundedDeviceSize} from './raid.js'

function kelvinToCelsius(kelvin: number): number {
	return kelvin - 273
}

export type SsdDevice = {
	type: 'ssd'
	transport: 'nvme' | 'sata'
	device: string
	id?: string
	pciSlotNumber?: number
	slot?: number
	name: string
	model: string
	serial: string
	size: number
	roundedSize: number
	temperature?: number
	temperatureWarning?: number
	temperatureCritical?: number
	lifetimeUsed?: number
	smartStatus: 'healthy' | 'unhealthy' | 'unknown'
}

export type HddDevice = {
	type: 'hdd'
	transport: 'sata'
	device: string
	id?: string
	slot?: number
	name: string
	model: string
	serial: string
	size: number
	roundedSize: number
	temperature?: number
	smartStatus: 'healthy' | 'unhealthy' | 'unknown'
}

export type StorageDevice = SsdDevice | HddDevice

type SmartData = {
	temperature?: number
	temperatureWarning?: number
	temperatureCritical?: number
	lifetimeUsed?: number
	smartStatus: 'healthy' | 'unhealthy' | 'unknown'
}

// Get SMART data for any device using smartctl
async function getSmartData(devicePath: string): Promise<SmartData> {
	try {
		// smartctl uses exit code bits as status flags (e.g. bit 2 = SMART attributes failing)
		// so it can return non-zero even on success. We need to accept any exit code and parse
		// the JSON output regardless.
		const {stdout} = await $({reject: false})`smartctl -a ${devicePath} --json`
		const data = JSON.parse(stdout)

		// Temperature is reported directly in Celsius
		let temperature: number | undefined
		if (typeof data.temperature?.current === 'number') {
			temperature = data.temperature.current
		}

		// NVMe drives report percentage_used in their SMART health log
		let lifetimeUsed: number | undefined
		if (typeof data.nvme_smart_health_information_log?.percentage_used === 'number') {
			lifetimeUsed = data.nvme_smart_health_information_log.percentage_used
		}

		// Overall health assessment
		const smartStatus = data.smart_status?.passed === false ? 'unhealthy' : 'healthy'

		return {temperature, lifetimeUsed, smartStatus}
	} catch {
		return {smartStatus: 'unknown'}
	}
}

// Get NVMe warning and critical temperature thresholds from controller identify data
// These are only available via nvme-cli, smartctl doesn't expose them
async function getNvmeTemperatureThresholds(
	devicePath: string,
): Promise<{temperatureWarning?: number; temperatureCritical?: number}> {
	try {
		const {stdout} = await $`nvme id-ctrl ${devicePath} --output-format=json`
		const idCtrlData = JSON.parse(stdout)

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

		return {temperatureWarning, temperatureCritical}
	} catch {
		return {}
	}
}

// Get the disk/by-id name for a device
// These paths are more stable than the device name which ddepedns on enumeration order.
async function getDeviceId(deviceName: string): Promise<string | undefined> {
	const byIdDir = '/dev/disk/by-umbrel-id'
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

		matchingIds.sort((a, b) => a.localeCompare(b))
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

// Get all internal storage devices using lsblk and nvme commands
export async function getInternalStorageDevices(): Promise<StorageDevice[]> {
	type LsBlkDevice = {
		name: string
		model?: string
		serial?: string
		size?: number
		type?: string
		tran?: string
		rota?: boolean
	}

	const {stdout} = await $`lsblk --output NAME,MODEL,SERIAL,SIZE,TYPE,TRAN,ROTA --json --bytes`
	const {blockdevices} = JSON.parse(stdout) as {blockdevices: LsBlkDevice[]}

	// Filter to internal disk devices by transport protocol
	const supportedTransports = ['nvme', 'sata']
	const internalBlockDevices = blockdevices.filter(
		(device) => device.type === 'disk' && supportedTransports.includes(device.tran ?? ''),
	)

	// Fetch SMART data, device IDs, and PCIe slot numbers for all devices in parallel
	const devices: StorageDevice[] = await Promise.all(
		internalBlockDevices.map(async (device): Promise<StorageDevice> => {
			const devicePath = `/dev/${device.name}`
			const id = await getDeviceId(device.name).catch(() => undefined)
			const size = device.size ?? 0
			const isNvme = device.tran === 'nvme'
			const name = device.model?.trim() ?? (isNvme ? 'Unknown NVMe Device' : 'Unknown SATA Device')
			const model = device.model?.trim() ?? 'Unknown'
			const serial = device.serial?.trim() ?? 'Unknown'
			const roundedSize = getRoundedDeviceSize(size)
			const [smartData, temperatureThresholds, pciSlotNumber] = await Promise.all([
				getSmartData(devicePath),
				isNvme
					? getNvmeTemperatureThresholds(devicePath)
					: ({} as {temperatureWarning?: number; temperatureCritical?: number}),
				isNvme ? getDevicePciSlotNumber(device.name).catch(() => undefined) : undefined,
			])

			const isSsd = isNvme || device.rota === false

			if (isSsd) {
				return {
					type: 'ssd' as const,
					transport: device.tran as 'nvme' | 'sata',
					device: device.name,
					id,
					pciSlotNumber,
					name,
					model,
					serial,
					size,
					roundedSize,
					temperature: smartData.temperature,
					temperatureWarning: temperatureThresholds.temperatureWarning,
					temperatureCritical: temperatureThresholds.temperatureCritical,
					lifetimeUsed: smartData.lifetimeUsed,
					smartStatus: smartData.smartStatus,
				}
			}

			return {
				type: 'hdd' as const,
				transport: 'sata' as const,
				device: device.name,
				id,
				name,
				model,
				serial,
				size,
				roundedSize,
				temperature: smartData.temperature,
				smartStatus: smartData.smartStatus,
			}
		}),
	)

	// Sort by id
	return devices.sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''))
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

	// Get all internal storage devices with their info
	async getDevices(): Promise<StorageDevice[]> {
		let devices = await getInternalStorageDevices()

		// Attach slot numbers on Umbrel Pro
		if (await this.#umbreld.hardware.umbrelPro.isUmbrelPro()) {
			const ssdDevices = devices.filter((device) => device.type === 'ssd')
			const otherDevices = devices.filter((device) => device.type !== 'ssd')
			devices = [
				...ssdDevices.map((device) => ({
					...device,
					slot: this.#umbreld.hardware.umbrelPro.getSsdSlotFromPciSlotNumber(device.pciSlotNumber),
				})),
				...otherDevices,
			]
		}

		// Sort by slot number if all devices have slots
		const haveMissingSlots = devices.some((device) => device.slot === undefined)
		if (!haveMissingSlots) devices.sort((a, b) => a.slot! - b.slot!)

		return devices
	}
}
