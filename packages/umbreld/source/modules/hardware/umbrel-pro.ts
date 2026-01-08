import {open} from 'node:fs/promises'
import {setTimeout} from 'node:timers/promises'

import PQueue from 'p-queue'

import type Umbreld from '../../index.js'
import runEvery from '../utilities/run-every.js'
import {detectDevice} from '../system/system.js'

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

// EC I/O port addresses
const EC_STATUS_COMMAND_PORT_ADDRESS = 0x66
const EC_DATA_PORT_ADDRESS = 0x62

// EC status flag values
const EC_INPUT_BUFFER_FULL_VALUE = 0x02

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
		const status = await readPort(EC_STATUS_COMMAND_PORT_ADDRESS)
		if ((status & EC_INPUT_BUFFER_FULL_VALUE) === 0) return
		await setTimeout(0)
	}
	throw new Error('EC timeout waiting for input buffer to clear')
}

// Write a byte to an EC register address
async function writeEcRegister(register: number, value: number): Promise<void> {
	const EC_WRITE_COMMAND_VALUE = 0x81
	await waitForEcReady()
	await writePort(EC_STATUS_COMMAND_PORT_ADDRESS, EC_WRITE_COMMAND_VALUE) // Send write command
	await waitForEcReady()
	await writePort(EC_DATA_PORT_ADDRESS, register) // Send register address
	await waitForEcReady()
	await writePort(EC_DATA_PORT_ADDRESS, value & 0xff) // Send data byte
}

// Read a byte from an EC register address
async function readEcRegister(register: number): Promise<number> {
	const EC_READ_COMMAND_VALUE = 0x80
	await waitForEcReady()
	await writePort(EC_STATUS_COMMAND_PORT_ADDRESS, EC_READ_COMMAND_VALUE) // Send read command
	await waitForEcReady()
	await writePort(EC_DATA_PORT_ADDRESS, register) // Send register address
	await waitForEcReady()
	return readPort(EC_DATA_PORT_ADDRESS) // Read data byte
}

export default class UmbrelPro {
	#umbreld: Umbreld
	#ecRegisterCommandQueue = new PQueue({concurrency: 1})
	#stopManagingFan?: () => void
	#lastFanSpeed?: number
	logger: Umbreld['logger']

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(`hardware:${name.toLowerCase()}`)
	}

	// Canonical check for Umbrel Pro hardware
	async isUmbrelPro(): Promise<boolean> {
		const {productName} = await detectDevice()
		return productName === 'Umbrel Pro'
	}

	async start() {
		// Skip if not Umbrel Pro
		if (!(await this.isUmbrelPro())) return

		this.logger.log('Starting Umbrel Pro')

		// Set light to constant white now we're booted up
		this.logger.log('Setting LED to default state')
		await this.setLedDefault().catch((error) => this.logger.error('Failed to set LED to default state', error))

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

	// EC utils

	// Write a byte to an EC register address (queued to prevent concurrent access)
	async #writeEcRegister(register: number, value: number): Promise<void> {
		if (!(await this.isUmbrelPro())) throw new Error('Refusing to write EC register on non Umbrel Pro hardware')
		return this.#ecRegisterCommandQueue.add(async () => writeEcRegister(register, value))
	}

	// Read a byte from an EC register address (queued to prevent concurrent access)
	async #readEcRegister(register: number): Promise<number> {
		if (!(await this.isUmbrelPro())) throw new Error('Refusing to read EC register on non Umbrel Pro hardware')
		return this.#ecRegisterCommandQueue.add(async () => readEcRegister(register)) as Promise<number>
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

	// Set minimum fan speed (0-100%)
	async setMinFanSpeed(percent: number): Promise<void> {
		const EC_MIN_FAN_SPEED_ENABLE_ADDRESS = 0x5e
		const EC_MIN_FAN_SPEED_ADDRESS = 0x5f

		// Clamp to valid range
		const clampedPercent = Math.max(0, Math.min(100, percent))

		// Convert 0-100% to 0-255 for EC
		const fanSpeedValue = Math.round((clampedPercent / 100) * 255)

		// Enable minimum fan speed mode and set the value
		await this.#writeEcRegister(EC_MIN_FAN_SPEED_ENABLE_ADDRESS, 1)
		await this.#writeEcRegister(EC_MIN_FAN_SPEED_ADDRESS, fanSpeedValue)
	}

	// LED Control

	// TODO: Set LED behaviour during umbrelOS operation.

	EC_LED_STATE_ADDRESS = 0x50

	// Turn off the LED
	async setLedOff(): Promise<void> {
		const LED_STATE_OFF_VALUE = 0
		await this.#writeEcRegister(this.EC_LED_STATE_ADDRESS, LED_STATE_OFF_VALUE)
	}

	// Set the LED to be static
	// Note: If the LED was previously blinking or breathing, it will keep it's colour.
	// If the LED was previously off, it will need to then have it's color set along with being
	// set to static to beturned on.
	async setLedStatic(): Promise<void> {
		const LED_STATE_STATIC_VALUE = 1
		await this.#writeEcRegister(this.EC_LED_STATE_ADDRESS, LED_STATE_STATIC_VALUE)
	}

	// Set LED color
	async setLedColor({red, green, blue}: {red: number; green: number; blue: number}): Promise<void> {
		const EC_LED_RED_ADDRESS = 0x51
		const EC_LED_GREEN_ADDRESS = 0x59
		const EC_LED_BLUE_ADDRESS = 0x55

		// Clamp to valid range
		red = Math.max(0, Math.min(255, Math.round(red)))
		green = Math.max(0, Math.min(255, Math.round(green)))
		blue = Math.max(0, Math.min(255, Math.round(blue)))

		await this.#writeEcRegister(EC_LED_RED_ADDRESS, red)
		await this.#writeEcRegister(EC_LED_GREEN_ADDRESS, green)
		await this.#writeEcRegister(EC_LED_BLUE_ADDRESS, blue)
	}

	// Set LED to white
	async setLedWhite(): Promise<void> {
		// We use these values to adjust for brighter LEDs.
		// 255 across all channels gives us a turquoise color.
		await this.setLedColor({red: 255, green: 100, blue: 128})
	}

	// Set LED to default state (static white)
	async setLedDefault(): Promise<void> {
		await this.setLedStatic()
		await this.setLedWhite()
	}

	// Set LED to blinking
	async setLedBlinking(): Promise<void> {
		const LED_STATE_BLINKING_VALUE = 2
		await this.#writeEcRegister(this.EC_LED_STATE_ADDRESS, LED_STATE_BLINKING_VALUE)
	}

	// Set LED to breathing mode
	// duration: 0-19 (higher = longer breathing cycle)
	async setLedBreathe(duration: number = 14): Promise<void> {
		const EC_LED_BREATHING_DURATION_ADDRESS = 0x52
		const LED_STATE_BREATHING_VALUE = 3

		const clampedDuration = Math.max(0, Math.min(19, Math.round(duration)))
		await this.#writeEcRegister(EC_LED_BREATHING_DURATION_ADDRESS, clampedDuration)
		await this.#writeEcRegister(this.EC_LED_STATE_ADDRESS, LED_STATE_BREATHING_VALUE)
	}

	// Reset Boot Key Flag
	//
	// The EC sets a flag at register 0xA8 when the device is powered on via
	// the reset button. This allows software to detect if the reset button
	// was used for boot (e.g., for recovery mode or special boot options).

	// TODO: Handle reset boot flags and show recovery ui.

	EC_RESET_BOOT_FLAG_ADDRESS = 0xa8

	// Check if device was booted via reset button
	async wasBootedViaResetButton(): Promise<boolean> {
		const flag = await this.#readEcRegister(this.EC_RESET_BOOT_FLAG_ADDRESS)
		return flag === 1
	}

	// Clear the reset boot flag (should be called on shutdown)
	async clearResetBootFlag(): Promise<void> {
		await this.#writeEcRegister(this.EC_RESET_BOOT_FLAG_ADDRESS, 0)
	}

	// Get hardware SSD slot number from PCIe Physical Slot Number
	//
	// The PCI bus address (pci-0000:01:00.0-nvme-1) and root port address (1c.0, 1d.0) are not stable identifiers.
	// They appear stable in many situations but change based on which slots are populated.
	//
	// Using a single SSD and testing each physical slot individually casuses the bus address to return
	// inconsistent values. And for the  root port address multiple physical slots share a root port
	// when not all slots are populated.
	// For example, physical slots 1 and 2 both appear on root port 1c.0 when only
	// one is occupied, we can't distinguish which physical slot the SSD is in. Same
	// for slots 3 and 4 on 1d.0.
	//
	// The PCIe Slot Number from lspci appears to uniquely identify each physical slot and has been
	// tested to be stable in many situations.
	getSsdSlotFromPciSlotNumber(pciSlotNumber: number | undefined): number | undefined {
		if (pciSlotNumber === 6) return 1
		if (pciSlotNumber === 4) return 2
		if (pciSlotNumber === 14) return 3
		if (pciSlotNumber === 12) return 4

		return undefined
	}
}
