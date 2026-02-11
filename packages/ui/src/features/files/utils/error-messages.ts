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

	return message
}
