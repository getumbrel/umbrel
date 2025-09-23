import {useRestoreProgress} from '@/features/backups/hooks/use-backups'
import {BarePage} from '@/layouts/bare/bare-page'
import {ProgressLayout} from '@/modules/bare/progress-layout'
import {t} from '@/utils/i18n'
import {secondsToEta} from '@/utils/seconds-to-eta'

export function RestoreCover() {
	const restoreQ = useRestoreProgress(1000)
	const progress = restoreQ.data?.percent
	const running = restoreQ.data != null
	const p = typeof progress === 'number' ? Math.max(0, Math.min(100, progress)) : 0
	let message = `${t('backups.restoring-progress', {percent: p})}`

	if (restoreQ.data?.secondsRemaining) {
		message += ` • ${t('backups.restoring-time-remaining', {time: secondsToEta(restoreQ.data?.secondsRemaining)})}`
	}

	return (
		<BarePage>
			<ProgressLayout
				title={t('backups.restoring')}
				callout={t('backups.restoring-warning')}
				progress={p}
				message={message}
				isRunning={!!running}
			/>
		</BarePage>
	)
}
