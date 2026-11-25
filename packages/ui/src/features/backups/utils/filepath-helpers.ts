import {APPS_PATH} from '@/features/files/constants'

// File name used by Umbrel backups within a repository directory
export const BACKUP_FILE_NAME = 'Umbrel Backup.backup'

// Convert '/app-data/<appId>/path...' to '/Apps/<appId>/path...'
export function formatAppPathForDisplay(path: string) {
	// Replace anything up to and including '/app-data/' with the UI's Apps prefix.
	// If '/app-data/' is not present, this is a no-op and returns the original path. But this should never happen.
	return path.replace(/^.*\/app-data\//, `${APPS_PATH}/`)
}

// Extracts the repository path (parent directory) from a backup file path.
// e.g., /Network/host/data/Umbrel Backup.backup -> /Network/host/data
export function getRepositoryPathFromBackupFile(backupFilePath: string): string {
	const path = backupFilePath.trim()
	return path.endsWith(BACKUP_FILE_NAME) ? path.slice(0, -BACKUP_FILE_NAME.length).replace(/\/$/, '') || '/' : path
}
