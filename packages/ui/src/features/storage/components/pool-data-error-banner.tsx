import {useTranslation} from 'react-i18next'

import {StorageNotice} from './storage-page'

type PoolDataErrorBannerProps = {
	errorCount?: number
}

// Stays up while the pool reports errors, so it carries the count and what to do next
export function PoolDataErrorBanner({errorCount = 0}: PoolDataErrorBannerProps) {
	const {t} = useTranslation()
	if (errorCount <= 0) return null

	return (
		<StorageNotice tone='danger'>{t('storage-manager.scrub.error-description', {count: errorCount})}</StorageNotice>
	)
}
