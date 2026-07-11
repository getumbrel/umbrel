import {$} from 'execa'

import runEvery from '../utilities/run-every.js'

import type Umbreld from '../../index.js'
import type ExternalStorage from './external-storage.js'

// throttled=0x1 — undervoltage now; 0x10000 — undervoltage since boot
const UNDERVOLTAGE_THROTTLE_MASK = 0x0001 | 0x00010000

export const EXTERNAL_STORAGE_POWER_FAULT_NOTIFICATION = 'external-storage-power-fault'

const POLL_INTERVAL = '15 seconds'
const JOURNAL_LOOKBACK = '30 seconds ago'
const FAULT_COOLDOWN_MS = 5 * 60 * 1000

export function startExternalStoragePowerMonitor(umbreld: Umbreld, externalStorage: ExternalStorage) {
	const logger = umbreld.logger.createChildLogger('files:external-storage-power-monitor')
	let lastFaultHandledAt = 0

	const check = async () => {
		const mountedDevices = await externalStorage.getMountedExternalDevices()
		if (mountedDevices.length === 0) return

		const powerFault = await detectPowerRelatedFault(mountedDevices.map((device) => device.id))
		if (!powerFault) return

		const now = Date.now()
		if (now - lastFaultHandledAt < FAULT_COOLDOWN_MS) return
		lastFaultHandledAt = now

		logger.warn(
			`Raspberry Pi power fault detected (${powerFault}) with external USB storage mounted; unmounting drives`,
		)

		for (const device of mountedDevices) {
			await externalStorage
				.unmountExternalDevice(device.id, {remove: false})
				.catch((error) => logger.error(`Failed to unmount ${device.id} after power fault`, error))
		}

		await umbreld.notifications.add(EXTERNAL_STORAGE_POWER_FAULT_NOTIFICATION).catch((error) => {
			logger.error('Failed to add power fault notification', error)
		})
	}

	return runEvery(POLL_INTERVAL, check, {runInstantly: false})
}

async function detectPowerRelatedFault(deviceIds: string[]) {
	const [undervoltage, ioErrors] = await Promise.all([
		hasUndervoltageSignals(),
		hasRecentIoErrors(deviceIds),
	])

	if (undervoltage) return 'undervoltage'
	if (ioErrors) return 'io-error'
	return false
}

async function hasUndervoltageSignals() {
	const [throttled, kernelMessage] = await Promise.all([
		hasThrottledUndervoltage(),
		hasRecentKernelUnderVoltageMessage(),
	])
	return throttled || kernelMessage
}

async function hasThrottledUndervoltage() {
	try {
		const {stdout} = await $`vcgencmd get_throttled`
		const match = stdout.match(/throttled=(0x[0-9a-f]+)/i)
		if (!match?.[1]) return false
		const value = Number.parseInt(match[1], 16)
		return (value & UNDERVOLTAGE_THROTTLE_MASK) !== 0
	} catch {
		return false
	}
}

async function hasRecentKernelUnderVoltageMessage() {
	try {
		const {stdout} = await $`journalctl -k --since ${JOURNAL_LOOKBACK} --grep Under-voltage --no-pager -q`
		return stdout.trim().length > 0
	} catch {
		return false
	}
}

async function hasRecentIoErrors(deviceIds: string[]) {
	for (const deviceId of deviceIds) {
		try {
			const {stdout} = await $`journalctl -k --since ${JOURNAL_LOOKBACK} --grep ${deviceId} --grep "I/O error" --no-pager -q`
			if (stdout.trim().length > 0) return true
		} catch {
			// Continue checking other devices
		}
	}
	return false
}
