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

// Get the disk/by-id name for a device (e.g., nvme-Samsung_SSD_990_PRO-DEADBEEF)
async function getDeviceId(deviceName: string): Promise<string | undefined> {
	const byIdDir = '/dev/disk/by-id'
	try {
		const entries = await fse.readdir(byIdDir)
		for (const entry of entries) {
			// Skip partition entries (they end with -partN)
			if (/-part\d+$/.test(entry)) continue

			const fullPath = nodePath.join(byIdDir, entry)
			const target = await fse.readlink(fullPath)
			const resolvedTarget = nodePath.resolve(byIdDir, target)

			if (resolvedTarget === `/dev/${deviceName}`) {
				return entry
			}
		}
	} catch {
		// Directory might not exist or be readable
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

	// Fetch SMART data and device IDs for all devices in parallel
	const nvmeDevices = await Promise.all(
		nvmeBlockDevices.map(async (device) => {
			const devicePath = `/dev/${device.name}`
			const [smartData, id] = await Promise.all([getNvmeSmartData(devicePath), getDeviceId(device.name)])

			return {
				device: device.name,
				id,
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
		return getNvmeDevices()
	}
}
