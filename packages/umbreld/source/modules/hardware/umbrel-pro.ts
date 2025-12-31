import {open} from 'node:fs/promises'
import {setTimeout} from 'node:timers/promises'

import PQueue from 'p-queue'
import fse from 'fs-extra'

import type Umbreld from '../../index.js'
import runEvery from '../utilities/run-every.js'

// Embedded Controller (EC) Communication
//
// The EC is a microcontroller on the motherboard that handles low-level hardware
// functions like fan control, power management, and LED control. We communicate
// with it via x86 I/O ports using a simple request/response protocol:
//
// 1. Wait for EC input buffer to be empty (ready to receive)
// 2. Send command byte (0x81 = write) to status/command port
// 3. Wait for EC to process command
// 4. Send register address to data port
// 5. Wait for EC to process address
// 6. Send data byte to data port
//
// All operations must be serialized to prevent corruption.

// EC I/O ports
const EC_STATUS_COMMAND_PORT = 0x66
const EC_DATA_PORT = 0x62

// EC status flags
const EC_INPUT_BUFFER_FULL = 0x02

// Read a byte from an x86 I/O port via /dev/port
async function readPort(port: number): Promise<number> {
	const fd = await open('/dev/port', 'r')
	try {
		const buffer = new Uint8Array(1)
		await fd.read(buffer, 0, 1, port)
		return buffer[0]
	} finally {
		await fd.close()
	}
}

// Write a byte to an x86 I/O port via /dev/port
async function writePort(port: number, value: number): Promise<void> {
	const fd = await open('/dev/port', 'r+')
	try {
		const buffer = new Uint8Array([value & 0xff])
		await fd.write(buffer, 0, 1, port)
	} finally {
		await fd.close()
	}
}

// Wait until EC is ready to receive data (input buffer clear)
async function waitForEcReady(): Promise<void> {
	for (let i = 0; i < 20_000; i++) {
		const status = await readPort(EC_STATUS_COMMAND_PORT)
		if ((status & EC_INPUT_BUFFER_FULL) === 0) return
		await setTimeout(0)
	}
	throw new Error('EC timeout waiting for input buffer to clear')
}

// Write a byte to an EC register address
async function writeEcRegister(register: number, value: number): Promise<void> {
	const EC_WRITE_COMMAND = 0x81
	await waitForEcReady()
	await writePort(EC_STATUS_COMMAND_PORT, EC_WRITE_COMMAND) // Send write command
	await waitForEcReady()
	await writePort(EC_DATA_PORT, register) // Send register address
	await waitForEcReady()
	await writePort(EC_DATA_PORT, value & 0xff) // Send data byte
}

export default class UmbrelPro {
	#umbreld: Umbreld
	#ecRegisterWriteQueue = new PQueue({concurrency: 1})
	#stopManagingFan?: () => void
	#lastFanSpeed?: number
	logger: Umbreld['logger']

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(`hardware:${name.toLowerCase()}`)
	}

	// TODO: Implement detection properly once we have SMBIOS/DMI data.
	async isUmbrelPro(): Promise<boolean> {
		const cpuInfo = await fse.readFile('/proc/cpuinfo')
		return cpuInfo.includes('Intel(R) Core(TM) i3-N300')
	}

	async start() {
		// Skip if not Umbrel Pro
		if (!(await this.isUmbrelPro())) return

		this.logger.log('Starting Umbrel Pro')

		// Clear min fan speed
		this.logger.log('Clearing min fan speed')
		await this.setMinFanSpeed(0).catch((error) => this.logger.error('Failed to clear min fan speed', error))

		// Start fan management loop
		this.logger.log('Starting fan speed management')
		this.#stopManagingFan = runEvery('1 minute', () => this.#manageFanSpeed())
	}

	async stop() {
		this.logger.log('Stopping Umbrel Pro')
		this.#stopManagingFan?.()
	}

	// Automatic Fan Speed Management
	//
	// The Umbrel Pro has a single fan that cools both the CPU and all NVMe SSDs.
	// The EC firmware has its own fan curve for the CPU. We calculate fan curves
	// for each SSD in umbreld, take the highest value, and set that as the minimum
	// fan speed in the EC. The EC then uses whichever is higher - our SSD minimum or
	// its CPU curve.
	//
	// SSD fan curve (linear):
	//
	//   100% |           _______
	//        |         /
	//   Min  |       /
	//   Fan  |     /
	//  Speed |   /
	//     0% |_/
	//        +------------------
	//          |        |
	//         50°C    Warning
	//               Temperature
	//
	// - Below 50°C: Min fan speed 0% (EC controls baseline)
	// - 50°C to warning temp: Linear ramp from 0% to 100%
	// - Above warning temp: Min fan speed 100%
	//
	// Uses the hottest SSD's temperature. Warning temp comes from SSD
	// SMART data, defaulting to 70°C if not reported.
	async #manageFanSpeed(): Promise<void> {
		// Fan speed constants
		const FAN_MIN_TEMP = 50 // Temperature (C) at which fan starts ramping
		const FAN_DEFAULT_WARNING_TEMP = 70 // Default warning temp if not reported by drive

		try {
			const devices = await this.#umbreld.hardware.internalStorage.getDevices()

			// Calculate required fan speed for each device
			const deviceFanSpeeds = devices.map((device) => {
				// Skip devices without temperature data
				if (device.temperature === undefined) return {device, fanSpeed: 0}

				// Get warning temp from device or use default
				const warningTemp = device.temperatureWarning ?? FAN_DEFAULT_WARNING_TEMP

				// Below min temp = 0% fan
				if (device.temperature <= FAN_MIN_TEMP) return {device, fanSpeed: 0}

				// At or above warning temp = 100% fan
				if (device.temperature >= warningTemp) return {device, fanSpeed: 100}

				// Linear interpolation between min temp and warning temp
				const tempRange = warningTemp - FAN_MIN_TEMP
				const tempAboveMin = device.temperature - FAN_MIN_TEMP
				return {device, fanSpeed: Math.round((tempAboveMin / tempRange) * 100)}
			})

			// Find the device requiring the highest fan speed
			const highest = deviceFanSpeeds.reduce((max, current) => (current.fanSpeed > max.fanSpeed ? current : max))

			// Apply hysteresis: increase immediately, but only decrease if 5% or more lower.
			// This prevents bouncing between a few percent repeatedly and reduces excessive EC writes.
			// Always allow returning to 0% so we can fully release control back to EC.
			const lastFanSpeed = this.#lastFanSpeed ?? 0
			const shouldIncrease = highest.fanSpeed > lastFanSpeed
			const shouldDecrease = highest.fanSpeed <= lastFanSpeed - 5 || (highest.fanSpeed === 0 && lastFanSpeed !== 0)
			if (shouldIncrease || shouldDecrease) {
				await this.setMinFanSpeed(highest.fanSpeed)
				this.#lastFanSpeed = highest.fanSpeed
				this.logger.log(
					`Min fan speed set to ${highest.fanSpeed}% (${highest.device.id} at ${highest.device.temperature}°C)`,
				)
			}
		} catch (error) {
			this.logger.error('Failed to manage fan speed', error)
		}
	}

	// Write a byte to an EC register address (queued to prevent concurrent access)
	async #writeEcRegister(register: number, value: number): Promise<void> {
		return this.#ecRegisterWriteQueue.add(async () => writeEcRegister(register, value))
	}

	// Set minimum fan speed (0-100%)
	async setMinFanSpeed(percent: number): Promise<void> {
		// EC register addresses for fan control
		const EC_MIN_FAN_SPEED_ENABLE = 0x5e
		const EC_MIN_FAN_SPEED_VALUE = 0x5f

		// Clamp to valid range
		const clampedPercent = Math.max(0, Math.min(100, percent))

		// Convert 0-100% to 0-255 for EC
		const minFanSpeedValue = Math.round((clampedPercent / 100) * 255)

		// Enable minimum fan speed mode and set the value
		await this.#writeEcRegister(EC_MIN_FAN_SPEED_ENABLE, 1)
		await this.#writeEcRegister(EC_MIN_FAN_SPEED_VALUE, minFanSpeedValue)
	}
}
