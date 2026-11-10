import {BACKUP_FILE_NAME} from '@/features/backups/utils/filepath-helpers'
import {EXTERNAL_STORAGE_PATH, NETWORK_STORAGE_PATH} from '@/features/files/constants'
import type {ExternalStorageDevice} from '@/features/files/types'
import type {RouterOutput} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export type DeviceKind = 'NAS' | 'DRIVE'

export function getDeviceType(path: string): DeviceKind {
	return path.startsWith(NETWORK_STORAGE_PATH) ? 'NAS' : 'DRIVE'
}

type StorageDevices = {
	disks?: ExternalStorageDevice[]
	shares?: RouterOutput['files']['listNetworkShares']
}

const isWithin = (path: string, root: string) => path === root || path.startsWith(`${root}/`)

// The folder a host's shares are mounted in: /Network/<host> for /Network/<host>/<share>
export const getNetworkHostPath = (mountPath: string) => mountPath.slice(0, mountPath.lastIndexOf('/'))

/**
 * Describes where a backup lives, using the names its owner knows it by.
 *
 * Mount paths only keep a small set of characters, so a drive labelled
 * "Clé 64 Go" is mounted at /External/Cl 64 Go. While the drive or share is
 * known we show the drive's label, or the share's host and name, and fall back
 * to the names in the path when it isn't (e.g. an unplugged drive).
 *
 * For /External/Cl 64 Go/Backups/Umbrel Backup.backup on that drive:
 * - name: "Clé 64 Go", the drive or NAS
 * - folder: "/Backups", the folder within it ("/" at its root)
 * - path: "Clé 64 Go/Backups/", both together
 */
export function describeBackupLocation(path: string, {disks, shares}: StorageDevices = {}) {
	const isNas = getDeviceType(path) === 'NAS'

	// Names from the device down, leaving out the backup itself
	let names = path.split('/').filter(Boolean).slice(1)
	const backupIndex = names.indexOf(BACKUP_FILE_NAME)
	if (backupIndex !== -1) names = names.slice(0, backupIndex)

	if (isNas) {
		// The host is named on its own too, for a path that isn't in a known share
		const host = shares?.find((share) => isWithin(path, getNetworkHostPath(share.mountPath)))?.host
		const share = shares?.find((share) => isWithin(path, share.mountPath))?.share
		if (host) names[0] = host
		if (share) names[1] = share
	} else {
		const partition = disks
			?.flatMap((disk) => disk.partitions)
			.find((partition) => partition.mountpoints.some((mountpoint) => isWithin(path, mountpoint)))
		if (partition?.label) names[0] = partition.label
	}

	const [name = isNas ? t('nas') : t('external-drive'), ...folders] = names
	return {name, folder: `/${folders.join('/')}`, path: `${[name, ...folders].join('/')}/`}
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
