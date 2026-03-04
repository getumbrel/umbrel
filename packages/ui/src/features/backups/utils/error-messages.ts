import {t} from '@/utils/i18n'

// Helper function to convert backend error messages to user-friendly messages
export function getUserFriendlyErrorMessage(error: any): string {
	const message = error?.message ?? t('unknown-error')

	// ========================================
	// Handle specific bracketed error codes
	// ========================================
	// Backup/restore already running
	if (message.includes('[in-progress]')) {
		return t('backups-error.in-progress')
	}
	// Insufficient disk space for operation
	if (message.includes('[not-enough-space]')) {
		return t('backups-error.not-enough-space')
	}
	// Repository or backup not found
	if (message.includes('[not-found]')) {
		return t('backups-error.not-found')
	}

	// ========================================
	// Handle Kopia errors
	// ========================================
	// Wrong encryption password
	if (message.includes('invalid repository password')) {
		return t('backups-error.invalid-password')
	}
	// Network/filesystem timeout
	if (message.includes('Mount timeout')) {
		return t('backups-error.mount-timeout')
	}
	// Mount process failed
	if (message.includes('Mount exited with code')) {
		return t('backups-error.mount-failed')
	}

	// ========================================
	// Defense-in-depth errors (prevented by frontend validation)
	// ========================================
	// NOTE: The following errors are prevented by frontend validation but kept for defense-in-depth:
	// - Repository already exists (prevented by useExistingBackupDetection)
	// - Repository not found (prevented by only showing existing repositories)
	// - Backup not found (prevented by only showing existing backups)
	// - Invalid path (prevented by file browser restrictions)
	// - Path to exclude must be in /Home (prevented by MiniBrowser rootPath restriction)

	// From Kopia repository creation
	if (message.includes('Repository already exists')) {
		return t('backups-error.repository-exists')
	}
	// From Kopia repository access
	if (message.includes('Repository') && message.includes('not found')) {
		return t('backups-error.repository-not-found')
	}
	// From Kopia backup operations
	if (message.includes('Backup') && message.includes('not found')) {
		return t('backups-error.backup-not-found')
	}
	// From file system operations
	if (message.includes('Invalid path')) {
		return t('backups-error.invalid-path')
	}
	// From backup exclusion validation
	if (message.includes('Path to exclude must be in /Home')) {
		return t('backups-error.invalid-exclusion-path')
	}

	// For any other errors, return generic message with actual details
	return t('backups-error.generic', {details: message})
}
