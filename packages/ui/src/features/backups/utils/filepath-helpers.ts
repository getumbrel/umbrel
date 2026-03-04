import {APPS_PATH, EXTERNAL_STORAGE_PATH, NETWORK_STORAGE_PATH} from '@/features/files/constants'

// File name used by Umbrel backups within a repository directory
export const BACKUP_FILE_NAME = 'Umbrel Backup.backup'

// Returns a display path starting from the device name up to the parent directory
// containing the Umbrel backup file, always ending with a trailing slash.
// Examples:
//  - /Network/samba.orb.local/data/My Backups/Umbrel Backup.backup -> samba.orb.local/data/My Backups/
//  - /External/USB-DISK/Umbrel Backup.backup -> USB-DISK/
//  - /Network/samba.orb.local/data/My Backups -> samba.orb.local/data/My Backups/
export function getDisplayRepositoryPath(path: string): string {
	const segments = path.split('/').filter(Boolean)

	// For /Network/<device>/... or /External/<device>/..., the device starts at index 1
	let startIndex = 0
	if (path.startsWith(NETWORK_STORAGE_PATH) || path.startsWith(EXTERNAL_STORAGE_PATH)) {
		startIndex = 1
	}

	// Cut off at the backup file if present
	const backupIdx = segments.findIndex((s) => s === BACKUP_FILE_NAME)
	const endIndexExclusive = backupIdx !== -1 ? backupIdx : segments.length

	const parts = segments.slice(startIndex, endIndexExclusive)
	if (parts.length === 0) return ''
	return parts.join('/') + '/'
}

// Convert '/app-data/<appId>/path...' to '/Apps/<appId>/path...'
export function formatAppPathForDisplay(path: string) {
	// Replace anything up to and including '/app-data/' with the UI's Apps prefix.
	// If '/app-data/' is not present, this is a no-op and returns the original path. But this should never happen.
	return path.replace(/^.*\/app-data\//, `${APPS_PATH}/`)
}

// Return the final segment of a path, trimming a trailing slash if present.
export function getLastPathSegment(p?: string) {
	if (!p) return ''
	const trimmed = p.endsWith('/') ? p.slice(0, -1) : p
	const idx = trimmed.lastIndexOf('/')
	return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
}

// Return a path relative to a given root, always starting with '/'.
// If path does not start with root, the original path is returned.
export function getRelativePathFromRoot(path: string, root: string): string {
	if (!path || !root) return path
	if (path.startsWith(root)) {
		let p = path.slice(root.length) || '/'
		if (!p.startsWith('/')) p = '/' + p
		return p
	}
	return path
}

// Extract the device/host name from a repository path, e.g.
//  - /Network/<host>/... -> <host>
//  - /External/<device>/... -> <device>
// Returns empty string if not applicable.
export function getRepositoryDisplayName(path: string): string {
	const segments = path.split('/').filter(Boolean)
	if (path.startsWith(NETWORK_STORAGE_PATH) || path.startsWith(EXTERNAL_STORAGE_PATH)) {
		return segments[1] || ''
	}
	return ''
}

// Returns the path within the device (excluding the device name) and without the backup file name.
// Example:
//  - /Network/host/data/Umbrel Backup.backup -> /
//  - /Network/host/data/My Backups/Umbrel Backup.backup -> /data/My Backups
//  - /External/USB-DISK/Umbrel Backup.backup -> /
export function getRepositoryRelativePath(path: string): string {
	const segments = path.split('/').filter(Boolean)

	// Skip root and device segments when present
	let startIndex = 0
	if (path.startsWith(NETWORK_STORAGE_PATH) || path.startsWith(EXTERNAL_STORAGE_PATH)) {
		startIndex = 2 // skip 'Network' or 'External' and the device name
	}

	// Cut off the backup file if present at the end
	const backupIdx = segments.findIndex((s) => s === BACKUP_FILE_NAME)
	const endIndexExclusive = backupIdx !== -1 ? backupIdx : segments.length

	let inner = segments.slice(startIndex, endIndexExclusive).join('/')
	if (!inner) return '/'
	if (!inner.startsWith('/')) inner = '/' + inner
	return inner
}

// Extracts the repository path (parent directory) from a backup file path.
// e.g., /Network/host/data/Umbrel Backup.backup -> /Network/host/data
export function getRepositoryPathFromBackupFile(backupFilePath: string): string {
	const path = backupFilePath.trim()
	return path.endsWith(BACKUP_FILE_NAME) ? path.slice(0, -BACKUP_FILE_NAME.length).replace(/\/$/, '') || '/' : path
}
