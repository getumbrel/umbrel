import {t} from '@/utils/i18n'

// Maps raw backend bracketed error codes to user-friendly translated messages.
// If no known code is found, returns the raw message as-is.
export function getFilesErrorMessage(message: string): string {
	if (message.includes('[does-not-exist]')) return t('files-backend-error.does-not-exist')
	if (message.includes('[source-not-exists]')) return t('files-backend-error.source-not-exists')
	if (message.includes('[destination-not-exist]')) return t('files-backend-error.destination-not-exist')
	if (message.includes('[destination-already-exists]')) return t('files-backend-error.destination-already-exists')
	if (message.includes('[operation-not-allowed]')) return t('files-backend-error.operation-not-allowed')
	if (message.includes('[not-enough-space]')) return t('files-backend-error.not-enough-space')
	if (message.includes('[invalid-filename]')) return t('files-backend-error.invalid-filename')
	if (message.includes('[subdir-of-self]')) return t('files-backend-error.subdir-of-self')
	if (message.includes('[parent-not-exist]')) return t('files-backend-error.parent-not-exist')
	if (message.includes('[parent-not-directory]')) return t('files-backend-error.parent-not-directory')
	if (message.includes('[mkdir-failed]')) return t('files-backend-error.mkdir-failed')
	if (message.includes('[move-failed]')) return t('files-backend-error.move-failed')
	if (message.includes('[network-share-disconnected]')) return t('files-backend-error.network-share-disconnected')
	if (message.includes('[trash-meta-not-exists]')) return t('files-backend-error.trash-meta-not-exists')
	if (message.includes('[unique-name-index-exceeded]')) return t('files-backend-error.unique-name-index-exceeded')
	if (message.includes('[path-not-absolute]')) return t('files-backend-error.path-not-absolute')
	if (message.includes('[invalid-base]')) return t('files-backend-error.invalid-base')
	if (message.includes('[escapes-base]')) return t('files-backend-error.escapes-base')
	if (message.includes('[base-directory-not-found]')) return t('files-backend-error.base-directory-not-found')
	if (message.includes('[invalid-path]')) return t('files-backend-error.invalid-path')
	if (message.includes('[cant-find-root]')) return t('files-backend-error.cant-find-root')
	if (message.includes('[share-already-exists]')) return t('files-backend-error.share-already-exists')
	if (message.includes('[share-name-generation-failed]')) return t('files-backend-error.share-name-generation-failed')
	if (message.includes('[storage-in-use-by-apps]')) {
		const apps = message.split('[storage-in-use-by-apps]')[1]?.trim()
		return t('files-backend-error.storage-in-use-by-apps', {apps})
	}

	// Cloud (codes are namespaced [cloud-*] by the backend)
	if (message.includes('[cloud-account-already-exists]')) return t('files-cloud-error.account-already-exists')
	if (message.includes('[cloud-account-auth-required]')) return t('files-cloud-error.account-auth-required')
	if (message.includes('[cloud-account-busy]')) return t('files-cloud-error.account-busy')
	if (message.includes('[cloud-account-identity-mismatch]')) return t('files-cloud-error.account-identity-mismatch')
	if (message.includes('[cloud-account-not-found]')) return t('files-cloud-error.account-not-found')
	if (message.includes('[cloud-account-removal-confirmation-mismatch]'))
		return t('files-cloud-error.account-removal-confirmation-mismatch')
	if (message.includes('[cloud-ambiguous-remote-name]')) return t('files-cloud-error.ambiguous-remote-name')
	if (message.includes('[cloud-auth-session-expired]')) return t('files-cloud-error.auth-session-expired')
	if (message.includes('[cloud-auth-session-not-found]') || message.includes('[cloud-auth-session-mismatch]'))
		return t('files-cloud-error.auth-session-not-found')
	if (message.includes('[cloud-destination-low-space]')) return t('files-cloud-error.destination-low-space')
	if (message.includes('[cloud-destination-missing]')) return t('files-cloud-error.destination-missing')
	if (message.includes('[cloud-destination-not-empty]')) return t('files-cloud-error.destination-not-empty')
	if (message.includes('[cloud-destination-not-writable]')) return t('files-cloud-error.destination-not-writable')
	if (message.includes('[cloud-destination-overlap]')) return t('files-cloud-error.destination-overlap')
	if (message.includes('[cloud-icloud-auth-failed]')) return t('files-cloud-error.icloud-auth-failed')
	if (message.includes('[cloud-not-found]')) return t('files-cloud-error.not-found')
	if (message.includes('[cloud-invalid-apple-id]')) return t('files-cloud-error.invalid-apple-id')
	if (message.includes('[cloud-invalid-authorization-code]')) return t('files-cloud-error.invalid-authorization-code')
	if (message.includes('[cloud-invalid-destination]')) return t('files-cloud-error.invalid-destination')
	if (message.includes('[cloud-invalid-icloud-password]') || message.includes('[cloud-invalid-webdav-password]'))
		return t('files-cloud-error.invalid-password')
	if (message.includes('[cloud-invalid-webdav-url]')) return t('files-cloud-error.invalid-webdav-url')
	if (message.includes('[cloud-webdav-untrusted-certificate]'))
		return t('files-cloud-error.webdav-untrusted-certificate')
	if (message.includes('[cloud-invalid-webdav-username]')) return t('files-cloud-error.invalid-webdav-username')
	if (message.includes('[cloud-provider-request-failed]')) return t('files-cloud-error.provider-request-failed')
	if (message.includes('[cloud-provider-unavailable]')) return t('files-cloud-error.provider-unavailable')
	if (message.includes('[cloud-read-only]')) return t('files-cloud-error.cloud-read-only')
	// An expired or interrupted connect session always means the same thing to
	// the user: the sign-in didn't survive, start it over
	if (
		message.includes('[cloud-invalid-icloud-auth-state]') ||
		message.includes('[cloud-config-session-start-timeout]') ||
		message.includes('[cloud-config-session-control-timeout]') ||
		message.includes('[cloud-config-transaction-closed]')
	)
		return t('files-cloud-error.auth-session-expired')
	// Pathological listings the provider returned but the UI can't render
	if (message.includes('[cloud-rclone-output-too-large]') || message.includes('[cloud-invalid-rclone-listing]'))
		return t('files-cloud-error.folder-unreadable')
	// Every other cloud code is an internal invariant: never surface a
	// raw bracket code to the user
	if (message.includes('[cloud-')) return t('files-cloud-error.generic')

	return message
}

export function getFilesApiErrorMessage(responseText: string, fallback: string): string {
	try {
		const response: unknown = JSON.parse(responseText)
		if (
			typeof response === 'object' &&
			response !== null &&
			'error' in response &&
			typeof response.error === 'string'
		) {
			return getFilesErrorMessage(response.error)
		}
	} catch {
		// Non-JSON responses use the HTTP status fallback.
	}

	return fallback
}
