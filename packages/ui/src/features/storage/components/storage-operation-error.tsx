import {useTranslation} from 'react-i18next'

import {trpcReact} from '@/trpc/trpc'

import {usePendingRaidOperation} from '../providers/pending-operation-context'
import {StorageNotice} from './storage-page'

export function StorageOperationError() {
	const {t} = useTranslation()
	const {operationError, setOperationError} = usePendingRaidOperation()
	const status = trpcReact.hardware.raid.getStatus.useQuery()
	const transition = status.data?.failsafeTransitionStatus
	const reportedError =
		transition?.state === 'error' ? (transition.error ?? t('storage-manager.failsafe-transition-failed')) : undefined
	const message = operationError ?? reportedError
	// A dismissed request rejection should not hide an error still reported by the pool.
	const dismiss = operationError && operationError !== reportedError ? () => setOperationError(null) : undefined
	if (!message) return null
	return (
		<StorageNotice onDismiss={dismiss}>
			<p>{t('storage-status.operation-error')}</p>
			<details className='mt-2 text-white/50'>
				<summary className='cursor-pointer'>{t('storage-status.details')}</summary>
				<p className='mt-2 break-words'>{message}</p>
			</details>
		</StorageNotice>
	)
}
