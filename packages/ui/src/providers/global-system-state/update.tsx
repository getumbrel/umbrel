import {BarePage} from '@/layouts/bare/bare-page'
import FailedLayout from '@/modules/bare/failed-layout'
import {ProgressLayout} from '@/modules/bare/progress-layout'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export function useUpdate({onMutate, onSuccess}: {onMutate?: () => void; onSuccess?: (didWork: boolean) => void}) {
	const updateVersionMut = trpcReact.system.update.useMutation({
		onMutate,
		onSuccess,
	})

	const update = () => updateVersionMut.mutate()

	return update
}

export function UpdatingCover({onRetry}: {onRetry: () => void}) {
	const latestVersionQ = trpcReact.system.latestAvailableVersion.useQuery()
	const updateStatusQ = trpcReact.system.updateStatus.useQuery(undefined, {
		refetchInterval: 500,
	})
	const latestVersion = latestVersionQ.data

	if (!latestVersion) {
		return null
	}

	const {progress, description, running, error} = updateStatusQ.data ?? {}
	const indeterminate = updateStatusQ.isLoading || !running

	return (
		<BarePage>
			{!error && (
				<ProgressLayout
					title={t('software-update.updating-to', {version: latestVersion.version})}
					callout={t('software-update.callout')}
					progress={indeterminate ? undefined : progress}
					message={description}
					isRunning={!!running}
				/>
			)}
			{error && (
				<FailedLayout
					title={t('software-update.failed')}
					description={
						<>
							{t('software-update.failed.description')}
							<br />
							{t('software-update.failed.please-try-again')}
						</>
					}
					buttonText={t('software-update.failed.retry')}
					buttonOnClick={onRetry}
				/>
			)}
		</BarePage>
	)
}
