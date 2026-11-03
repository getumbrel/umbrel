import type {TFunction} from 'i18next'
import type {IconType} from 'react-icons'
import {TbAlertTriangle, TbAlertTriangleFilled, TbBattery1, TbFlame, TbHeartBroken} from 'react-icons/tb'

import {formatTemperature} from '@/utils/temperature'

import {getDeviceHealth, RaidDevice, raidStatusLabels, StorageDevice} from '../hooks/use-storage'
import {hasRaidErrors} from '../utils'

export type SsdWarning = 'raidFailed' | 'raidErrors' | 'temperature' | 'unhealthy' | 'lowLife'

// Everything wrong with an SSD right now. A failed pool member shows only that: anything
// else is less important, and can still be seen in the health dialog.
export function getSsdWarnings(device: StorageDevice, raidDevice?: RaidDevice): SsdWarning[] {
	if (raidDevice && raidDevice.raidStatus !== 'ONLINE') return ['raidFailed']

	const {smartUnhealthy, lifeWarning, tempWarning, tempCritical} = getDeviceHealth(device)
	const warnings: SsdWarning[] = []
	if (hasRaidErrors(raidDevice)) warnings.push('raidErrors')
	if (tempWarning || tempCritical) warnings.push('temperature')
	if (smartUnhealthy) warnings.push('unhealthy')
	if (lifeWarning) warnings.push('lowLife')
	return warnings
}

// A failed pool member or a SMART/temperature/wear issue is red. ZFS error counters on an
// otherwise healthy online member are a lower-severity amber warning.
export function getSsdSeverity(device: StorageDevice, raidDevice?: RaidDevice): 'critical' | 'attention' | undefined {
	if (getDeviceHealth(device).hasWarning || (raidDevice && raidDevice.raidStatus !== 'ONLINE')) return 'critical'
	return hasRaidErrors(raidDevice) ? 'attention' : undefined
}

export function describeSsdWarning(
	warning: SsdWarning,
	{
		device,
		raidDevice,
		temperatureUnit,
		t,
	}: {device: StorageDevice; raidDevice?: RaidDevice; temperatureUnit: 'c' | 'f'; t: TFunction},
): {icon: IconType; label: string} {
	switch (warning) {
		case 'raidFailed': {
			const status = raidDevice?.raidStatus
			return {
				icon: TbAlertTriangleFilled,
				label: status && raidStatusLabels[status] ? t(raidStatusLabels[status]) : (status ?? ''),
			}
		}
		case 'raidErrors':
			return {icon: TbAlertTriangle, label: t('storage-manager.health.warnings')}
		case 'temperature':
			return {icon: TbFlame, label: formatTemperature(device.temperature, temperatureUnit)}
		case 'unhealthy':
			return {icon: TbHeartBroken, label: t('storage-manager.ssd-failing')}
		case 'lowLife':
			return {icon: TbBattery1, label: `${getDeviceHealth(device).lifeRemaining}%`}
	}
}
