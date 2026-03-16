import type {ExternalStorageDevice} from '@/features/files/types'

/**
 * Determines why a share is unavailable.
 *
 * For external paths, checks whether the drive is still connected by looking
 * for a matching mountpoint in `disks`. If no mountpoint matches, the drive
 * was disconnected; otherwise the folder itself was deleted.
 *
 * Non-external shares (/Home/) are auto-removed by the file watcher on
 * deletion, so unavailability there is purely defensive and falls through
 * to "folder-not-found".
 */
export function getShareUnavailableReason(
	share: {path: string; available?: boolean},
	disks: ExternalStorageDevice[] | undefined,
): 'drive-disconnected' | 'folder-not-found' | undefined {
	if (share.available !== false) return undefined

	const isExternalPath = share.path.startsWith('/External/')
	const isDriveConnected =
		isExternalPath &&
		disks?.some((disk) =>
			disk.partitions.some((partition) => partition.mountpoints?.some((mp: string) => share.path.startsWith(mp + '/'))),
		)

	if (isExternalPath && !isDriveConnected) return 'drive-disconnected'
	return 'folder-not-found'
}
