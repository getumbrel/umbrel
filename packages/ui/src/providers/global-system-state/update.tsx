import {useTranslation} from 'react-i18next'

import {BarePage} from '@/layouts/bare/bare-page'
import FailedLayout from '@/modules/bare/failed-layout'
import {ProgressLayout} from '@/modules/bare/progress-layout'
import {RouterOutput, trpcReact} from '@/trpc/trpc'

export function useUpdate({onMutate, onSuccess}: {onMutate?: () => void; onSuccess?: (didWork: boolean) => void}) {
	const updateVersionMut = trpcReact.update.install.useMutation({
		onMutate,
		onSuccess,
	})

	// Given the manifestHash of the release the user was shown, umbreld only installs that one
	const update = (manifestHash?: string) => updateVersionMut.mutate({manifestHash})

	return update
}

export function UpdatingCover({onRetry}: {onRetry: () => void}) {
	const {t} = useTranslation()
	const latestVersionQ = trpcReact.update.check.useQuery()
	const utils = trpcReact.useUtils()
	const isOwner = trpcReact.user.get.useQuery().data?.role === 'owner'
	const updateStatusQ = trpcReact.update.status.useQuery(undefined, {
		refetchInterval: 500,
	})
	// Events keep progress moving between polls. Polling stays as the fallback
	// since the connection drops when the device reboots into the update, and an
	// in-flight poll is cancelled so its older status can't land on top of an event.
	trpcReact.eventBus.listen.useSubscription(
		{event: 'system:update-status'},
		{
			enabled: isOwner,
			onData: (data) => {
				utils.update.status.cancel()
				utils.update.status.setData(undefined, data as RouterOutput['update']['status'])
			},
			onError: (error) => console.error('system:update-status subscription error', error),
		},
	)
	// The version name comes from a separate check that can fail or lag mid-update,
	// so the cover never waits for it
	const latestVersion = latestVersionQ.data

	const {progress, description, running, error} = updateStatusQ.data ?? {}
	const indeterminate = updateStatusQ.isLoading || !running

	return (
		<BarePage>
			{!error && (
				<ProgressLayout
					title={
						latestVersion ? t('software-update.updating-to', {name: latestVersion.name}) : t('software-update.updating')
					}
					callout={t('software-update.callout')}
					progress={indeterminate ? undefined : progress}
					message={description}
					isRunning={!!running}
				/>
			)}
			{error && (
				<FailedLayout
					title={t('software-update.failed')}
					description={error}
					buttonText={t('software-update.failed.retry')}
					buttonOnClick={onRetry}
				/>
			)}
		</BarePage>
	)
}
