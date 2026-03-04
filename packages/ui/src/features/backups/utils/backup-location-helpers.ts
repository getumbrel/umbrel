import {EXTERNAL_STORAGE_PATH, NETWORK_STORAGE_PATH} from '@/features/files/constants'
import {t} from '@/utils/i18n'

export type DeviceKind = 'NAS' | 'DRIVE'

export function getDeviceType(path: string): DeviceKind {
	return path.startsWith(NETWORK_STORAGE_PATH) ? 'NAS' : 'DRIVE'
}

/**
 * Extracts a human-readable device name from a backup repository path.
 * Examples:
 * - "/Network/nas.local/Backups" -> "nas.local"
 * - "/External/MyDrive/Backups" -> "MyDrive"
 * - "/Unknown/path" -> fallback to translated backup location
 */
export function getDeviceNameFromPath(path: string): string {
	const parts = path.split('/').filter(Boolean)
	if (path.startsWith('/Network/')) return parts[1] || t('nas')
	if (path.startsWith('/External/')) return parts[1] || t('external-drive')
	return parts[0] || t('backups.backup-location')
}

/**
 * Determines whether a repository path is currently connected/available.
 * - NAS: uses doesHostHaveMountedShares('/Network/<host>')
 * - External: presence of any mountpoint under /External/<device>
 */
export function isRepoConnected(
	path: string,
	doesHostHaveMountedShares: (rootPath: string) => boolean,
	disks: Array<{partitions?: Array<{mountpoints?: string[]}>}> | undefined,
): boolean {
	if (path.startsWith(NETWORK_STORAGE_PATH)) {
		const host = path.split('/')[2]
		return !!host && doesHostHaveMountedShares(`${NETWORK_STORAGE_PATH}/${host}`)
	}
	// Otherwise treat as external drive
	const device = path.split('/')[2]
	if (!device) return false
	const prefix = `${EXTERNAL_STORAGE_PATH}/${device}`
	return (disks || []).some((disk) =>
		(disk.partitions || []).some((part) =>
			(part.mountpoints || []).some((m) => typeof m === 'string' && m.startsWith(prefix)),
		),
	)
}
