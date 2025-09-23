import {EXTERNAL_STORAGE_PATH, NETWORK_STORAGE_PATH} from '@/features/files/constants'

export type DeviceKind = 'NAS' | 'DRIVE'

export function getDeviceType(path: string): DeviceKind {
	return path.startsWith(NETWORK_STORAGE_PATH) ? 'NAS' : 'DRIVE'
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
