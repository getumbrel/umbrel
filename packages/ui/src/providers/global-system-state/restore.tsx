import {useRestoreProgress} from '@/features/backups/hooks/use-backups'
import {BarePage} from '@/layouts/bare/bare-page'
import {ProgressLayout} from '@/modules/bare/progress-layout'
import {t} from '@/utils/i18n'
import {secondsToEta} from '@/utils/seconds-to-eta'

export function RestoreCover() {
	const restoreQ = useRestoreProgress(1000)
	const progress = restoreQ.data?.percent
	const running = restoreQ.data != null

	// We handle the transition period between restore completion and system restart
	// When restore finishes, umbreld clears progress (restoreQ.data becomes null) and changes the system status to 'restarting'.
	// During the brief window when the frontend hasn't yet detected the system status change, we show 100% progress with "Finishing up..." message instead of 0% to avoid
	// confusing users with a progress reset before restart.
	const isCompleting = !running && restoreQ.data === null

	const p = isCompleting ? 100 : typeof progress === 'number' ? Math.max(0, Math.min(100, progress)) : 0

	let message = isCompleting ? t('backups.restoring-completing') : `${t('backups.restoring-progress', {percent: p})}`

	if (!isCompleting && restoreQ.data?.secondsRemaining) {
		message += ` • ${t('backups.restoring-time-remaining', {time: secondsToEta(restoreQ.data?.secondsRemaining)})}`
	}

	// Currently umbreld restarts even on a restore failure, so no error UI is needed here
	// TODO: Add error handling with FailedLayout if we change umbreld to not restart on failure

	return (
		<BarePage>
			<ProgressLayout
				title={t('backups.restoring')}
				callout={t('backups.restoring-warning')}
				progress={p}
				message={message}
				isRunning={!!running || isCompleting}
			/>
		</BarePage>
	)
}
