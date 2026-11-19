import i18next from 'i18next'
import prettyBytes from 'pretty-bytes'

import {roundForPrettyBytes} from '../../utils/round-for-pretty-bytes.ts'
import type {RaidStatus, StorageDevice} from './hooks/use-storage'

export function getPoolDeviceType(
	raidStatus: RaidStatus | undefined,
	allDevices: StorageDevice[],
): 'ssd' | 'hdd' | undefined {
	if (!raidStatus?.exists) return undefined

	const poolDeviceIds = new Set(raidStatus.devices?.map((device) => device.id) ?? [])
	const attachedPoolDevice = allDevices.find((device) => device.id && poolDeviceIds.has(device.id))
	if (attachedPoolDevice) return attachedPoolDevice.type

	// With no member attached, the layout only says what the storage is made of where one kind
	// of drive alone can have it: only hard drives are mirrored in pairs, protected against two
	// failures, or accelerated. One-drive protection and unprotected storage can be either.
	if (raidStatus.topology === 'mirror' || raidStatus.raidzParity === 2 || raidStatus.accelerator?.exists) return 'hdd'
	return undefined
}

// Format bytes without space, rounding to integer only for 3+ digit values (>=100) to avoid overflow
// e.g., "4.5TB", "45.2GB", "256GB" - only 256.1GB gets rounded because 256 >= 100
export const formatStorageSize = (bytes: number) => {
	// First format with 1 decimal to determine the numeric value
	const locale = i18next.language // "4,5TB" in German
	const formatted = prettyBytes(roundForPrettyBytes(bytes), {maximumFractionDigits: 1, locale})
	const numericValue = parseFloat(formatted)

	// If 3+ digits (>=100), round to integer to keep string short
	const fractionDigits = numericValue >= 100 ? 0 : 1

	return prettyBytes(roundForPrettyBytes(bytes), {maximumFractionDigits: fractionDigits, locale}).replace(' ', '')
}

// Standard SSD capacities in GB. The accelerator guidance is ~32x the device's RAM,
// mapped to the smallest standard drive that satisfies it and capped at 4TB:
// 4GB RAM -> 128GB, 8GB -> 256GB ... 128GB+ -> 4TB.
const ssdSizeBucketsGb = [128, 256, 512, 1024, 2048, 4096]
export function recommendedSsdSizeLabel(ramBytes: number) {
	const nominalRamGb = Math.max(1, Math.round(ramBytes / 2 ** 30))
	const sizeGb = ssdSizeBucketsGb.find((bucket) => bucket >= nominalRamGb * 32) ?? ssdSizeBucketsGb.at(-1)!
	return sizeGb >= 1024 ? `${sizeGb / 1024}TB` : `${sizeGb}GB`
}
