import {useRestoreStatus} from '@/features/backups/hooks/use-backups'
import {BarePage} from '@/layouts/bare/bare-page'
import FailedLayout from '@/modules/bare/failed-layout'
import {ProgressLayout} from '@/modules/bare/progress-layout'
import {t} from '@/utils/i18n'
import {secondsToEta} from '@/utils/seconds-to-eta'

export function RestoreCover() {
	const restoreQ = useRestoreStatus()
	const {progress, running, error, secondsRemaining} = restoreQ.data ?? {}

	const p = typeof progress === 'number' ? progress : 0
	const hasSample = restoreQ.data !== undefined
	const isCompleting = !running && !error && p === 100
	const indeterminate = hasSample && !running && p === 0

	// Use our own copy for messages; ignore backend-provided description
	let message = isCompleting ? t('backups.restoring-completing') : t('backups.restoring-progress', {percent: p})

	if (running && secondsRemaining) {
		message += ` • ${t('backups.restoring-time-remaining', {time: secondsToEta(secondsRemaining)})}`
	}

	return (
		<BarePage>
			{!error && (
				<ProgressLayout
					title={t('backups.restoring')}
					callout={t('backups.restoring-warning')}
					progress={indeterminate ? undefined : p}
					message={message}
					isRunning={!!running}
				/>
			)}
			{error && (
				// Options to go to Home page or Restore wizard
				<FailedLayout
					title={t('backups.restore-failed.title')}
					description={t('backups.restore-failed.message')}
					buttonText={t('backups.restore-failed.retry')}
					buttonOnClick={() => (document.location.href = '/settings/backups/restore')}
				/>
			)}
		</BarePage>
	)
}
